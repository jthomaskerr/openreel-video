import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResolveExportStartResponse,
  ResolvePublicExportJob,
} from "../../../services/resolve-bridge-client";
import {
  useResolveExportJob,
  type ResolveExportJobClient,
  type ResolveExportSelection,
} from "./useResolveExportJob";

const projectId = "vintage-tokyo";
const jobId = "2430ba4b-6b35-4c51-8ed2-cf0920710617";
const launchUrl = "openreel-resolve://import/9b705f5b-638e-4307-bf1f-313ba3e157b7";
const selection: ResolveExportSelection = {
  projectId,
  projectModifiedAt: Date.UTC(2026, 6, 22, 10),
  target: "resolve",
  range: { startTime: 0, endTime: 266 },
};

function backendJob(
  phase: ResolvePublicExportJob["phase"],
  overrides: Partial<ResolvePublicExportJob> = {},
): ResolvePublicExportJob {
  return {
    id: jobId,
    projectId,
    revision: "revision-vintage-tokyo",
    phase,
    processed: phase === "ready" ? 38 : 0,
    total: 38,
    percent: phase === "ready" ? 100 : 0,
    warnings: [],
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    ...overrides,
  };
}

function client(overrides: Partial<ResolveExportJobClient> = {}): ResolveExportJobClient {
  const readyResponse: ResolveExportStartResponse = {
    job: backendJob("ready"),
    jobId,
    revision: "revision-vintage-tokyo",
    phase: "ready",
    statusUrl: `/api/projects/${projectId}/exports/resolve/${jobId}`,
    cancelUrl: `/api/projects/${projectId}/exports/resolve/${jobId}`,
    bridgeLaunchUrl: launchUrl,
  };
  return {
    startExport: vi.fn(async () => readyResponse),
    getExportJob: vi.fn(async () => backendJob("ready")),
    cancelExport: vi.fn(async () => backendJob("cancelled")),
    launch: vi.fn(),
    ...overrides,
  };
}

async function start(result: { current: ReturnType<typeof useResolveExportJob> }) {
  await act(async () => {
    await result.current.start(projectId, "revision-vintage-tokyo", selection);
  });
}

describe("useResolveExportJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts the exact backend revision and selection and launches once when ready", async () => {
    const bridge = client();
    const { result } = renderHook(() => useResolveExportJob(bridge));

    await start(result);

    expect(bridge.startExport).toHaveBeenCalledWith(
      projectId,
      { revision: "revision-vintage-tokyo", selection },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.phase).toBe("ready");
    expect(bridge.launch).toHaveBeenCalledTimes(1);
    expect(bridge.launch).toHaveBeenCalledWith(launchUrl);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(bridge.launch).toHaveBeenCalledTimes(1);
  });

  it("preserves a ready job when launch is rejected and retries without creating a job", async () => {
    const launch = vi.fn().mockImplementationOnce(() => {
      throw new Error("scheme unavailable");
    });
    const bridge = client({ launch });
    const { result } = renderHook(() => useResolveExportJob(bridge));

    await start(result);
    expect(result.current.phase).toBe("ready");
    expect(result.current.launchError).toMatch(/could not open davinci resolve/i);

    act(() => result.current.retryLaunch());
    expect(launch).toHaveBeenCalledTimes(2);
    expect(bridge.startExport).toHaveBeenCalledTimes(1);
    expect(result.current.launchError).toBeNull();
  });

  it("cancels only a cancellable backend phase and a late poll cannot revive it", async () => {
    const poll = vi.fn(async () => backendJob("launching"));
    const bridge = client({ getExportJob: poll });
    const { result } = renderHook(() => useResolveExportJob(bridge));
    await start(result);

    await act(() => result.current.cancel());
    expect(bridge.cancelExport).toHaveBeenCalledWith(
      projectId,
      jobId,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.phase).toBe("cancelled");

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.phase).toBe("cancelled");
    expect(poll).not.toHaveBeenCalled();
  });

  it("aborts polling on unmount and never overlaps poll requests", async () => {
    let pollSignal: AbortSignal | undefined;
    const getExportJob = vi.fn((_projectId, _jobId, options) => {
      pollSignal = options?.signal;
      return new Promise<ResolvePublicExportJob>(() => undefined);
    });
    const bridge = client({ getExportJob });
    const { result, unmount } = renderHook(() => useResolveExportJob(bridge));
    await start(result);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(getExportJob).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(getExportJob).toHaveBeenCalledTimes(1);
    unmount();
    expect(pollSignal?.aborted).toBe(true);
  });

  it("ignores a stale start response after a newer start", async () => {
    type StartResponse = Awaited<ReturnType<ResolveExportJobClient["startExport"]>>;
    let resolveFirst!: (value: StartResponse) => void;
    const first = new Promise<StartResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const bridge = client({
      startExport: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({
          job: backendJob("failed", { id: "bcf6c105-ad9a-4fac-89f5-19b6ebd424f5" }),
          jobId: "bcf6c105-ad9a-4fac-89f5-19b6ebd424f5",
          revision: "new-revision",
          phase: "failed",
          statusUrl: "/status",
          cancelUrl: "/status",
        }),
    });
    const { result } = renderHook(() => useResolveExportJob(bridge));

    let firstStart!: Promise<void>;
    act(() => {
      firstStart = result.current.start(projectId, "revision-vintage-tokyo", selection);
    });
    await act(async () => {
      await result.current.start(projectId, "new-revision", selection);
    });
    await act(async () => {
      resolveFirst({
        job: backendJob("ready"),
        jobId,
        revision: "revision-vintage-tokyo",
        phase: "ready",
        statusUrl: "/status",
        cancelUrl: "/status",
        bridgeLaunchUrl: launchUrl,
      });
      await firstStart;
    });

    expect(result.current.phase).toBe("failed");
    expect(bridge.launch).not.toHaveBeenCalled();
  });

  it("surfaces safe actionable backend failures and never launches", async () => {
    const bridge = client({
      startExport: vi.fn(async () => {
        throw Object.assign(new Error("private path /Users/example/project.json"), {
          code: "STALE_PROJECT_REVISION",
        });
      }),
    });
    const { result } = renderHook(() => useResolveExportJob(bridge));

    await start(result);

    expect(result.current.statusMessage).toMatch(/project changed.*refresh/i);
    expect(result.current.statusMessage).not.toContain("/Users/");
    expect(bridge.launch).not.toHaveBeenCalled();
  });
});
