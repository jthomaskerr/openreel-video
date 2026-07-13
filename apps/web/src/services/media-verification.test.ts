import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaVerificationBatchResponse } from "@openreel/core";
import {
  MediaAvailabilityRuntime,
  MediaVerificationCoordinator,
  classifyProbeResponse,
  classifyTransportFailure,
  probeMediaUrl,
  requestMediaVerification,
} from "./media-verification";

afterEach(() => { vi.restoreAllMocks(); });

describe("media verification", () => {
  it.each([
    [401, "unauthorized"], [403, "unauthorized"], [500, "temporarily_unavailable"],
    [404, "temporarily_unavailable"], [410, "temporarily_unavailable"],
  ] as const)("classifies HTTP %s without inventing absence", (status, expected) => {
    expect(classifyProbeResponse(new Response(null, { status }))).toBe(expected);
  });

  it("rejects HTML success, wrong MIME, malformed ranges, zero and truncated bodies", async () => {
    expect(classifyProbeResponse(new Response("<html/>", { headers: { "content-type": "text/html" } }), { expectedBytes: 7 })).toBe("decode_error");
    expect(classifyProbeResponse(new Response("abc", { headers: { "content-type": "application/json" } }), { expectedBytes: 3, expectedType: "video" })).toBe("decode_error");
    expect(classifyProbeResponse(new Response(null, { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 2-3/4", "content-length": "2" } }), { rangeProbe: true })).toBe("decode_error");
    expect(classifyProbeResponse(new Response(null, { headers: { "content-type": "video/mp4", "content-length": "0" } }))).toBe("decode_error");
    expect(classifyProbeResponse(new Response(null, { headers: { "content-type": "video/mp4", "content-length": "2" } }), { expectedBytes: 4 })).toBe("decode_error");
  });

  it("falls back from unsupported HEAD to a one-byte range GET", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/8", "content-length": "1" } }));
    await expect(probeMediaUrl("/clip", { fetcher, expectedType: "video", expectedBytes: 8 })).resolves.toBe("available");
    expect(fetcher).toHaveBeenNthCalledWith(2, "/clip", expect.objectContaining({ headers: { Range: "bytes=0-0" } }));
  });

  it("deduplicates per project/media, bounds concurrency, retries transients, and can cancel", async () => {
    let active = 0; let peak = 0; let calls = 0;
    const batch = vi.fn(async (_projectId: string, ids: readonly string[], signal: AbortSignal): Promise<MediaVerificationBatchResponse> => {
      calls++; active++; peak = Math.max(peak, active);
      await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, 2); signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }); });
      active--;
      return { projectId: "p", outcomes: ids.map(mediaId => ({ mediaId, status: calls === 1 ? "temporarily_unavailable" : "available", evidence: { authoritative: true, mapping: "present", object: "present" } })) };
    });
    const coordinator = new MediaVerificationCoordinator({ batch, concurrency: 1, baseDelayMs: 1, jitter: () => 0 });
    const first = coordinator.verify("p", ["a", "a"]); const second = coordinator.verify("p", ["b"]);
    const [a] = await first; await second;
    expect(a?.status).toBe("available"); expect(peak).toBe(1); expect(batch).toHaveBeenCalledTimes(3);
    const pending = coordinator.verify("q", ["c"]); coordinator.cancelProject("q");
    await expect(pending).resolves.toEqual([expect.objectContaining({ status: "temporarily_unavailable" })]);
  });

  it("guards project generation and does not overwrite a relinked URL", async () => {
    let resolveBatch!: (value: MediaVerificationBatchResponse) => void;
    const batch = () => new Promise<MediaVerificationBatchResponse>(resolve => { resolveBatch = resolve; });
    const coordinator = new MediaVerificationCoordinator({ batch, concurrency: 2 });
    const pending = coordinator.verify("p", ["a"], { generation: 1, getGeneration: () => 2, currentUrl: () => "blob:relinked" });
    await Promise.resolve();
    resolveBatch({ projectId: "p", outcomes: [{ mediaId: "a", status: "confirmed_missing", evidence: { authoritative: true, mapping: "absent", object: "absent" } }] });
    expect(await pending).toEqual([]);
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [500, "temporarily_unavailable"],
    [503, "temporarily_unavailable"],
  ] as const)("maps batch HTTP %s to %s", async (status, expected) => {
    const response = await requestMediaVerification(
      "p",
      ["a", "b"],
      new AbortController().signal,
      vi.fn().mockResolvedValue(new Response(null, { status })),
    );
    expect(response.outcomes).toEqual([
      expect.objectContaining({ mediaId: "a", status: expected }),
      expect.objectContaining({ mediaId: "b", status: expected }),
    ]);
  });

  it.each([
    [new DOMException("expired", "TimeoutError"), "timeout"],
    [new Error("getaddrinfo ENOTFOUND host"), "dns"],
    [new Error("ECONNREFUSED"), "refused"],
    [new TypeError("CORS request blocked"), "cors"],
    [new Error("HMR websocket replaced fetch"), "hmr"],
    [new TypeError("Failed to fetch"), "transport"],
  ])("classifies transport failure %s as %s", (error, expected) => {
    expect(classifyTransportFailure(error)).toBe(expected);
  });

  it("classifies abort and offline deterministically", () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyTransportFailure(new TypeError("Failed to fetch"), controller.signal)).toBe("cancelled");
    vi.stubGlobal("navigator", { onLine: false });
    expect(classifyTransportFailure(new TypeError("Failed to fetch"))).toBe("offline");
    vi.unstubAllGlobals();
  });

  it("bounds a hung batch request with a deterministic timeout", async () => {
    vi.useFakeTimers();
    const pending = requestMediaVerification(
      "p",
      ["a"],
      new AbortController().signal,
      vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })),
      10,
    );
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toEqual(expect.objectContaining({
      outcomes: [expect.objectContaining({ status: "temporarily_unavailable", evidence: expect.objectContaining({ reason: "timeout" }) })],
    }));
    vi.useRealTimers();
  });

  it("publishes verifying and completed outcomes atomically and deduplicates clip media IDs", async () => {
    const batch = vi.fn(async (projectId: string, ids: readonly string[]) => ({
      projectId,
      outcomes: ids.map(mediaId => ({
        mediaId,
        status: "available" as const,
        evidence: { authoritative: true, mapping: "present" as const, object: "present" as const },
      })),
    }));
    const runtime = new MediaAvailabilityRuntime(
      new MediaVerificationCoordinator({ batch, maxRetries: 0 }),
      { automaticRecoveryAttempts: 0 },
    );
    const snapshots: string[][] = [];
    runtime.subscribe(snapshot => snapshots.push([...snapshot.outcomes.values()].map(value => value.status)));

    await runtime.verify("p", ["a", "a", "b"]);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(snapshots).toEqual([
      ["verifying", "verifying"],
      ["available", "available"],
    ]);
  });

  it("discards stale active-project, generation, and relink results", async () => {
    let resolveBatch!: (value: MediaVerificationBatchResponse) => void;
    const batch = vi.fn(() => new Promise<MediaVerificationBatchResponse>(resolve => { resolveBatch = resolve; }));
    const runtime = new MediaAvailabilityRuntime(
      new MediaVerificationCoordinator({ batch, maxRetries: 0 }),
      { automaticRecoveryAttempts: 0 },
    );
    let activeProject = "p";
    let url = "remote:old";
    const pending = runtime.verify("p", ["a"], {
      getActiveProjectId: () => activeProject,
      currentUrl: () => url,
    });
    await vi.waitFor(() => expect(batch).toHaveBeenCalledOnce());
    activeProject = "new-project";
    url = "blob:relinked";
    resolveBatch({ projectId: "p", outcomes: [{ mediaId: "a", status: "confirmed_missing", evidence: { authoritative: true, mapping: "absent", object: "absent" } }] });

    expect(await pending).toEqual([]);
    expect(runtime.get("p", "a")).toBeUndefined();

    const stale = runtime.verify("p", ["a"]);
    await vi.waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    runtime.cancel("p");
    resolveBatch({ projectId: "p", outcomes: [{ mediaId: "a", status: "available", evidence: { authoritative: true, mapping: "present", object: "present" } }] });
    expect(await stale).toEqual([]);
  });

  it("performs one bounded post-load recovery and preserves decode state on thumbnail-only updates", async () => {
    vi.useFakeTimers();
    const batch = vi.fn()
      .mockResolvedValueOnce({ projectId: "p", outcomes: [{ mediaId: "a", status: "temporarily_unavailable", evidence: { authoritative: false, mapping: "unknown", object: "unknown" } }] })
      .mockResolvedValueOnce({ projectId: "p", outcomes: [{ mediaId: "a", status: "available", evidence: { authoritative: true, mapping: "present", object: "present" } }] });
    const runtime = new MediaAvailabilityRuntime(
      new MediaVerificationCoordinator({ batch, maxRetries: 0 }),
      { automaticRecoveryAttempts: 1, recoveryDelayMs: 10 },
    );
    await runtime.verify("p", ["a"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(runtime.get("p", "a")?.status).toBe("available");
    expect(batch).toHaveBeenCalledTimes(2);

    runtime.markDecodeError("p", "a", "decoder rejected bytes");
    expect(runtime.get("p", "a")?.status).toBe("decode_error");
    runtime.cancel("p");
  });
});
