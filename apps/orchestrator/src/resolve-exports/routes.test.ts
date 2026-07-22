import assert from "node:assert/strict";
import express from "express";
import { test } from "vitest";
import type { ResolveExportJob, ResolveImportResult, ResolvePreview } from "@openreel/core";
import { isLoopbackRemoteAddress, createResolveExportRouter, type ResolveExportRouteService } from "./routes";
import { ResolveExportServiceError } from "./service";

const projectId = "vintage-tokyo";
const jobId = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const now = "2026-07-22T00:00:00.000Z";

const job: ResolveExportJob = {
  id: jobId, projectId, revision: "a".repeat(40), phase: "ready", processed: 8, total: 8,
  percent: 100, warnings: [], createdAt: now, updatedAt: now,
  bridgeLaunchUrl: `openreel-resolve://import/${token}`,
};

const preview = {
  projectId, revision: "a".repeat(40), name: "Vintage Tokyo", description: "Night footage",
  createdAt: 1, modifiedAt: 2, durationFrames: 100, frameRate: 30, trackCount: 2, clipCount: 2,
  mediaCount: 2, render: { status: "unavailable", reason: "No current render" },
  miniTimeline: { durationFrames: 100, tracks: [] }, clipGroups: [],
  compatibility: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
} as unknown as ResolvePreview;

const result: ResolveImportResult = {
  requestId, status: "completed", resolveVersion: "21.0.3", resolveBuild: "21.0.30007",
  projectName: "Vintage Tokyo", timelineName: "Vintage Tokyo", durationFrames: 100,
  trackCounts: { video: 1 }, clipCounts: { video: 2 }, offlineMediaIds: [],
  referencedMediaIds: ["media-1"], saved: true, artifactSha256: "a".repeat(64),
};

function startRequest(extra: Record<string, unknown> = {}) {
  return {
    revision: "a".repeat(40),
    selection: { projectId, projectModifiedAt: 2, target: "resolve", range: { startTime: 0, endTime: 4 } },
    ...extra,
  };
}

function fakeService(overrides: Partial<ResolveExportRouteService> = {}): ResolveExportRouteService {
  return {
    preview: async () => preview,
    start: async () => job,
    status: async () => job,
    cancel: async () => ({ ...job, phase: "cancelled" }),
    redeem: async () => ({
      jobId, projectId, revision: job.revision,
      artifacts: [{ path: "/Volumes/secret/exports/resolve/job/manifest.json", mediaType: "application/json", byteLength: 42, sha256: "b".repeat(64) }],
    }),
    recordImportResult: async (_jobId, input) => input,
    ...overrides,
  };
}

async function withRouter(service: ResolveExportRouteService, run: (baseUrl: string) => Promise<void>, peerIsLoopback?: (address: string | undefined) => boolean) {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createResolveExportRouter(service, { peerIsLoopback }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}/api/projects`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Resolve routes expose preview, export, status, cancellation, redemption, and import evidence without secrets", async () => {
  await withRouter(fakeService(), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/${projectId}/resolve-preview`)).status, 200);
    const started = await fetch(`${baseUrl}/${projectId}/exports/resolve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(startRequest()),
    });
    assert.equal(started.status, 202);
    const startedBody = await started.json() as { statusUrl: string; cancelUrl: string; job: ResolveExportJob };
    assert.equal(startedBody.statusUrl, `/api/projects/${projectId}/exports/resolve/${jobId}`);
    assert.equal(startedBody.cancelUrl, startedBody.statusUrl);
    assert.ok(!JSON.stringify(startedBody).includes("/Volumes/"));
    const status = await fetch(`${baseUrl}/${projectId}/exports/resolve/${jobId}`);
    assert.equal(status.status, 200);
    assert.ok(!JSON.stringify(await status.json()).includes(token));
    const cancelled = await fetch(`${baseUrl}/${projectId}/exports/resolve/${jobId}`, { method: "DELETE" });
    assert.equal(cancelled.status, 200);
    assert.ok(!JSON.stringify(await cancelled.json()).includes(token));
    const redemption = await fetch(`${baseUrl}/resolve-launches/${token}/redeem`, { method: "POST" });
    assert.equal(redemption.status, 200);
    assert.ok(!JSON.stringify(await redemption.json()).includes("/Volumes/"));
    const imported = await fetch(`${baseUrl}/${projectId}/exports/resolve/${jobId}/import-result`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result),
    });
    assert.equal(imported.status, 202);
    assert.ok(!JSON.stringify(await imported.json()).includes(result.artifactSha256));
  });
});

test("Resolve routes reject malformed and unknown request fields before the service", async () => {
  let startCalls = 0;
  await withRouter(fakeService({ start: async () => { startCalls += 1; return job; } }), async (baseUrl) => {
  for (const body of [startRequest({ unexpected: true }), { revision: "bad", selection: {} }, startRequest({ revision: "x" })]) {
      const response = await fetch(`${baseUrl}/${projectId}/exports/resolve`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    const malformedResult = await fetch(`${baseUrl}/${projectId}/exports/resolve/${jobId}/import-result`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...result, unexpected: true }),
    });
    assert.equal(malformedResult.status, 400);
  });
  assert.equal(startCalls, 0);
});

test("Resolve routes map stable service errors and never leak paths, hashes, tokens, or stacks", async () => {
  const cases = [
    ["PROJECT_NOT_FOUND", 404], ["STALE_PROJECT_REVISION", 409], ["LAUNCH_TOKEN_EXPIRED", 410], ["EXPORT_PERSIST_FAILED", 500],
  ] as const;
  for (const [code, expected] of cases) {
    await withRouter(fakeService({ preview: async () => { throw new ResolveExportServiceError(code, `/Volumes/private ${"a".repeat(64)} ${token}`); } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/${projectId}/resolve-preview`);
      assert.equal(response.status, expected);
      const body = JSON.stringify(await response.json());
      assert.ok(!body.includes("/Volumes/"));
      assert.ok(!body.includes(token));
      assert.ok(!body.includes("a".repeat(64)));
      assert.ok(!body.includes("stack"));
    });
  }
});

test("loopback redemption accepts IPv4 and IPv6 loopback addresses only", () => {
  for (const address of ["127.0.0.1", "127.44.3.2", "::1", "::ffff:127.0.0.1", "::ffff:127.44.3.2"]) assert.equal(isLoopbackRemoteAddress(address), true);
  for (const address of [undefined, "192.168.1.2", "::ffff:192.168.1.2"]) assert.equal(isLoopbackRemoteAddress(address), false);
});

test("forwarded headers never grant non-loopback bridge access", async () => {
  await withRouter(fakeService(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/resolve-launches/${token}/redeem`, { method: "POST", headers: { "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1" } });
    assert.equal(response.status, 404);
  }, () => false);
});
