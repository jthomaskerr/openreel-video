import { describe, expect, it, vi } from "vitest";
import {
  ResolveBridgeClientError,
  cancelExport,
  getExportJob,
  getPreview,
  launchResolveBridge,
  listProjects,
  startExport,
} from "./resolve-bridge-client";

const jobId = "123e4567-e89b-12d3-a456-426614174000";
const revision = "0123456789abcdef0123456789abcdef01234567";
const projectId = "vintage tokyo";
const encodedProjectId = "vintage%20tokyo";

const publicJob = {
  id: jobId,
  projectId,
  revision,
  phase: "ready" as const,
  processed: 10,
  total: 10,
  percent: 100,
  warnings: [],
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:01:00.000Z",
};

const preview = {
  projectId,
  revision,
  name: "Vintage Tokyo",
  description: "Tokyo at night",
  createdAt: 1,
  modifiedAt: 2,
  durationFrames: 300,
  frameRate: 30,
  trackCount: 2,
  clipCount: 4,
  mediaCount: 3,
  render: { status: "missing" as const, reason: "No render yet." },
  miniTimeline: { durationFrames: 300, tracks: [] },
  clipGroups: [],
  compatibility: { status: "ready" as const, blockingIssueCount: 0, warningCount: 0 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Resolve bridge client", () => {
  it("launches only a canonical one-token OpenReel Resolve URL", () => {
    const assign = vi.fn();
    launchResolveBridge(
      "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000",
      { assign },
    );

    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(
      "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it.each([
    "file:///tmp/export",
    "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000?token=leak",
    "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000#fragment",
    "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000/extra",
    "openreel-resolve://user@import/123e4567-e89b-12d3-a456-426614174000",
    "openreel-resolve://import/%2e%2e/123e4567-e89b-12d3-a456-426614174000",
  ])("rejects unsafe bridge URL %s", (url) => {
    expect(() => launchResolveBridge(url, { assign: vi.fn() })).toThrow(
      "invalid bridge URL",
    );
  });

  it("maps malformed successful JSON to a user-safe client error", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "not-a-uuid", secret: "/private/path" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      getExportJob("vintage-tokyo", "123e4567-e89b-12d3-a456-426614174000", {
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({
      name: "ResolveBridgeClientError",
      code: "INVALID_RESPONSE",
      message: "The Resolve export returned an invalid response.",
    } satisfies Partial<ResolveBridgeClientError>);
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo/exports/resolve/123e4567-e89b-12d3-a456-426614174000",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("uses the backend's stable error code without exposing untrusted details", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "LAUNCH_TOKEN_EXPIRED", message: "/project/private/internal" },
        }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      getExportJob("vintage-tokyo", "123e4567-e89b-12d3-a456-426614174000", {
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({
      name: "ResolveBridgeClientError",
      code: "LAUNCH_TOKEN_EXPIRED",
      message: "The Resolve launch request is no longer available.",
    } satisfies Partial<ResolveBridgeClientError>);
  });

  it("uses the exact list and preview endpoints and parses their public DTOs", async () => {
    const listFetcher = vi.fn(async () => jsonResponse([
      { id: projectId, name: "Vintage Tokyo", description: "A neon travel film", createdAt: 1, modifiedAt: 2 },
    ]));
    await expect(listProjects({ fetch: listFetcher })).resolves.toEqual([
      { id: projectId, name: "Vintage Tokyo", description: "A neon travel film", createdAt: 1, modifiedAt: 2 },
    ]);
    expect(listFetcher).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects",
      { method: "GET", signal: undefined },
    );

    const previewFetcher = vi.fn(async () => jsonResponse(preview));
    await expect(getPreview(projectId, { fetch: previewFetcher })).resolves.toEqual(preview);
    expect(previewFetcher).toHaveBeenCalledWith(
      `http://localhost:4041/api/projects/${encodedProjectId}/resolve-preview`,
      { method: "GET", signal: undefined },
    );
  });

  it("requires every strict public project summary to include a description", async () => {
    await expect(listProjects({ fetch: vi.fn(async () => jsonResponse([
      { id: projectId, name: "Legacy summary", createdAt: 1, modifiedAt: 2 },
    ])) })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("posts the exact start request and parses the backend's strict 202 envelope", async () => {
    const bridgeLaunchUrl = `openreel-resolve://import/${jobId}`;
    const statusUrl = `/api/projects/${projectId}/exports/resolve/${jobId}`;
    const response = {
      job: publicJob,
      jobId,
      revision,
      phase: "ready" as const,
      statusUrl,
      cancelUrl: statusUrl,
      bridgeLaunchUrl,
    };
    const fetcher = vi.fn(async () => jsonResponse(response, 202));
    const input = {
      revision,
      selection: {
        projectId,
        projectModifiedAt: 2,
        target: "resolve" as const,
        range: { startTime: 0, endTime: 10 },
      },
    };

    await expect(startExport(projectId, input, { fetch: fetcher })).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith(
      `http://localhost:4041/api/projects/${encodedProjectId}/exports/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: undefined,
      },
    );
  });

  it("uses exact encoded status and cancellation paths and parses public jobs", async () => {
    const encodedJobId = "job%2Fone";
    const statusFetcher = vi.fn(async () => jsonResponse(publicJob));
    await expect(getExportJob(projectId, "job/one", { fetch: statusFetcher }))
      .resolves.toEqual(publicJob);
    expect(statusFetcher).toHaveBeenCalledWith(
      `http://localhost:4041/api/projects/${encodedProjectId}/exports/resolve/${encodedJobId}`,
      { method: "GET", signal: undefined },
    );

    const cancelFetcher = vi.fn(async () => jsonResponse({ ...publicJob, phase: "cancelled" }));
    await expect(cancelExport(projectId, "job/one", { fetch: cancelFetcher }))
      .resolves.toMatchObject({ phase: "cancelled" });
    expect(cancelFetcher).toHaveBeenCalledWith(
      `http://localhost:4041/api/projects/${encodedProjectId}/exports/resolve/${encodedJobId}`,
      { method: "DELETE", signal: undefined },
    );
  });

  it.each([
    ["project list", () => listProjects({ fetch: vi.fn(async () => jsonResponse([
      { id: projectId, name: "Vintage Tokyo", description: "A neon travel film", createdAt: 1, modifiedAt: 2, extra: true },
    ])) })],
    ["preview", () => getPreview(projectId, { fetch: vi.fn(async () => jsonResponse({
      ...preview,
      extra: true,
    })) })],
    ["public job", () => getExportJob(projectId, jobId, { fetch: vi.fn(async () =>
      jsonResponse({ ...publicJob, bridgeLaunchUrl: `openreel-resolve://import/${jobId}` })) })],
    ["start envelope", () => startExport(projectId, {
      revision,
      selection: {
        projectId,
        projectModifiedAt: 2,
        target: "resolve",
        range: { startTime: 0, endTime: 10 },
      },
    }, { fetch: vi.fn(async () => jsonResponse({
      job: publicJob,
      jobId,
      revision,
      phase: "ready",
      statusUrl: `/api/projects/${projectId}/exports/resolve/${jobId}`,
      cancelUrl: `/api/projects/${projectId}/exports/resolve/${jobId}`,
      unexpected: true,
    }, 202)) })],
  ] as const)("rejects unknown fields in the %s success DTO", async (_name, request) => {
    await expect(request()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("propagates the signal's custom abort reason and passes the signal to fetch", async () => {
    const controller = new AbortController();
    const reason = new Error("picker closed");
    controller.abort(reason);
    const fetcher = vi.fn(async () => { throw reason; });

    await expect(getPreview(projectId, { fetch: fetcher, signal: controller.signal }))
      .rejects.toBe(reason);
    expect(fetcher).toHaveBeenCalledWith(
      `http://localhost:4041/api/projects/${encodedProjectId}/resolve-preview`,
      { method: "GET", signal: controller.signal },
    );
  });

  it("propagates standard AbortError variants unchanged", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetcher = vi.fn(async () => { throw abortError; });

    await expect(getPreview(projectId, { fetch: fetcher })).rejects.toBe(abortError);
  });
});
