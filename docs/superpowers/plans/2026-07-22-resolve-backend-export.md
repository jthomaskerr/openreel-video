# Resolve Backend Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orchestrator authoritative for Resolve project previews, export jobs, verified artifacts, and import evidence.

**Architecture:** Shared Zod contracts live in core. A self-contained orchestrator service reads confirmed projects through `ProjectStore`, builds previews and FCPXML with the existing handoff modules, persists jobs/artifacts under the project worktree, and exposes idempotent routes.

**Tech Stack:** TypeScript, Zod, Express, Node filesystem/crypto, Vitest, existing `@openreel/core` handoff modules.

## Global Constraints

- Preserve compatibility with persisted projects that do not yet contain `description`.
- Never expose arbitrary filesystem paths from API responses.
- Store FCPXML, manifests, reports, job state, and import results under `exports/resolve/{jobId}/` inside the backend project store and commit them to the project Git history.
- Do not copy media binaries; Resolve references the canonical project-store files.
- `MediaItem.externallyReferenced` is sticky once true. The record and canonical file may be updated but not deleted.
- Only loopback clients may redeem bridge launch tokens.
- Tokens are single-use, expire after five minutes, and are redacted from logs.
- Compatibility is advertised only for Resolve 21.0.3 build 21.0.30007 after live acceptance.
- Tests must be deterministic, local, non-flaky, and preferably under two seconds.

---

### Task 1: Shared Resolve bridge contracts and project description

**Files:**
- Create: `packages/core/src/export/handoff/resolve-bridge.ts`
- Create: `packages/core/src/export/handoff/resolve-bridge.test.ts`
- Modify: `packages/core/src/export/handoff/index.ts`
- Modify: `packages/core/src/types/project.ts`
- Modify: `packages/core/src/storage/project-serializer.test.ts`

**Interfaces:**
- Produces: `ResolvePreviewSchema`, `ResolveExportJobSchema`, `ResolveImportResultSchema`, `ResolveBridgeErrorCodeSchema`, and their inferred TypeScript types.
- Produces: optional `Project.description?: string` with empty-string normalization on new writes and absent-field compatibility on reads.
- Produces: optional `MediaItem.externallyReferenced?: boolean`, absent/false for legacy records and permanently true after a confirmed external import.

- [ ] **Step 1: Write failing contract tests**

```ts
it("rejects launch URLs containing project data or filesystem paths", () => {
  const readyJob = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    projectId: "vintage-tokyo",
    revision: "rev-123",
    phase: "ready",
    processed: 33,
    total: 33,
    percent: 100,
    warnings: [],
    createdAt: "2026-07-22T09:00:00.000Z",
    updatedAt: "2026-07-22T09:01:00.000Z",
    bridgeLaunchUrl: "openreel-resolve://import/223e4567-e89b-12d3-a456-426614174000",
  };
  expect(() => ResolveExportJobSchema.parse({
    ...readyJob,
    bridgeLaunchUrl: "openreel-resolve://import/job-1?path=/tmp/export",
  })).toThrow();
});

it("accepts legacy projects without a description", () => {
  const result = serializer.importFromJsonWithValidation(JSON.stringify(projectFixture));
  expect(result.project?.description).toBeUndefined();
});

it("accepts legacy media without an external-reference marker", () => {
  const result = serializer.importFromJsonWithValidation(JSON.stringify(projectFixture));
  expect(result.project?.mediaLibrary.items[0].externallyReferenced).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/handoff/resolve-bridge.test.ts src/storage/project-serializer.test.ts`

Expected: FAIL because the bridge schemas and description field are absent.

- [ ] **Step 3: Implement the shared schemas**

```ts
export const ResolveBridgeErrorCodeSchema = z.enum([
  "STALE_PROJECT_REVISION", "MEDIA_INCOMPLETE", "EXPORT_FAILED",
  "BRIDGE_NOT_INSTALLED", "ACCESSIBILITY_DENIED", "RESOLVE_NOT_FOUND",
  "RESOLVE_UI_UNEXPECTED", "SCRIPT_NOT_DISCOVERED", "REQUEST_EXPIRED",
  "REQUEST_CONSUMED", "ARTIFACT_HASH_MISMATCH", "FCPXML_REJECTED",
  "SAVE_FAILED", "OFFLINE_MEDIA", "IMPORT_TIMEOUT",
]);

export const ResolveImportResultSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["completed", "failed"]),
  resolveVersion: z.string().min(1),
  resolveBuild: z.string().min(1),
  projectName: z.string().min(1),
  timelineName: z.string().min(1).optional(),
  durationFrames: z.number().int().nonnegative().optional(),
  trackCounts: z.record(z.number().int().nonnegative()),
  clipCounts: z.record(z.number().int().nonnegative()),
  offlineMediaIds: z.array(z.string()),
  saved: z.boolean(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  failure: z.object({ code: ResolveBridgeErrorCodeSchema, message: z.string() }).optional(),
});

export const ResolveExportJobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  revision: z.string().min(1),
  phase: z.enum(["queued", "loading", "assessing", "resolving-media", "serializing",
    "verifying", "ready", "launching", "importing", "saving", "validating",
    "completed", "failed", "cancelled"]),
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  warnings: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  bridgeLaunchUrl: z.string().regex(/^openreel-resolve:\/\/import\/[0-9a-f-]{36}$/).optional(),
});
```

Add `readonly description?: string` to `Project`, `readonly externallyReferenced?: boolean` to `MediaItem`, and export all bridge contracts from the handoff index. Add `referencedMediaIds: z.array(z.string()).default([])` to `ResolveImportResultSchema` so the backend marks only media actually linked by Resolve.

- [ ] **Step 4: Run tests and typecheck**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/handoff/resolve-bridge.test.ts src/storage/project-serializer.test.ts`

Expected: PASS.

Run: `rtk ./packages/core/node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/core/src/export/handoff packages/core/src/types/project.ts packages/core/src/storage/project-serializer.test.ts
rtk git commit -m "feat(core): define Resolve bridge contracts"
```

### Task 2: Externally referenced media invariant

**Files:**
- Modify: `packages/core/src/actions/action-executor.ts`
- Modify: `packages/core/src/actions/action-executor.test.ts`
- Modify: `apps/orchestrator/src/projects/project-store.ts`
- Modify: `apps/orchestrator/src/projects/project-store.test.ts`
- Modify: `apps/orchestrator/src/projects/routes.ts`
- Modify: `apps/orchestrator/src/projects/routes.test.ts`

**Interfaces:**
- Produces: `assertExternallyReferencedMediaPreserved(previous, next): void`.
- Produces: stable `EXTERNAL_MEDIA_DELETE_BLOCKED` action/API error.
- Existing metadata and binary update paths remain permitted while the same media ID and canonical path remain present.

- [ ] **Step 1: Write failing deletion and update tests**

```ts
it("blocks deletion of media referenced by Resolve", async () => {
  const project = projectWithMedia({ externallyReferenced: true });
  const result = await executor.execute({ type: "media/delete", params: { mediaId: "media-1" } }, project);
  expect(result).toMatchObject({ success: false, error: { code: "EXTERNAL_MEDIA_DELETE_BLOCKED" } });
});

test("backend rejects a saved project that omits externally referenced media", async () => {
  await store.saveProject(projectWithMedia({ externallyReferenced: true }));
  await expect(store.saveProject(projectWithout("media-1")))
    .rejects.toMatchObject({ code: "EXTERNAL_MEDIA_DELETE_BLOCKED", mediaId: "media-1" });
});

test("backend permits updates to externally referenced media", async () => {
  const original = projectWithMedia({ externallyReferenced: true, title: "Original" });
  await store.saveProject(original);
  await expect(store.saveProject(updateMedia(original, "media-1", { title: "Updated" }))).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/actions/action-executor.test.ts && rtk pnpm --filter @openreel/orchestrator exec vitest run src/projects/project-store.test.ts src/projects/routes.test.ts`

Expected: FAIL because external references are not protected.

- [ ] **Step 3: Implement the invariant in both trust boundaries**

```ts
export function assertExternallyReferencedMediaPreserved(previous: Project, next: Project): void {
  const nextIds = new Set(next.mediaLibrary.items.map(item => item.id));
  const removed = previous.mediaLibrary.items.find(item => item.externallyReferenced === true && !nextIds.has(item.id));
  if (removed) throw new ExternalMediaDeleteBlockedError(removed.id);
}
```

Check the marker in the core `media/delete` action before mutation. In `ProjectStore.saveProject`, load the prior persisted project when present and call the invariant before writing. Map the backend error to HTTP 409 with its stable code and media ID.

- [ ] **Step 4: Run focused tests and typechecks**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/actions/action-executor.test.ts && rtk pnpm --filter @openreel/orchestrator exec vitest run src/projects/project-store.test.ts src/projects/routes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/core/src/actions apps/orchestrator/src/projects
rtk git commit -m "feat(media): protect externally referenced files"
```

### Task 3: Backend preview builder

**Files:**
- Create: `apps/orchestrator/src/resolve-exports/preview.ts`
- Create: `apps/orchestrator/src/resolve-exports/preview.test.ts`
- Modify: `apps/orchestrator/src/projects/project-store.ts`
- Modify: `apps/orchestrator/src/projects/project-store.test.ts`

**Interfaces:**
- Consumes: `ProjectStore.listProjects()`, `ProjectStore.loadProject(projectId)`, and project media storage.
- Produces: `buildResolvePreview(project, revision, mediaAvailability): ResolvePreview`.
- Produces: extended `ProjectSummary` fields `description`, `createdAt`, `modifiedAt`, `duration`, `frameRate`, `trackCount`, `clipCount`, and representative media ID.

- [ ] **Step 1: Write failing preview tests**

```ts
test("groups clips by type and preserves timing in mini timeline primitives", () => {
  const preview = buildResolvePreview(projectFixture(), "rev-123", availabilityFixture());
  expect(preview.clipGroups.map(group => [group.type, group.clips.length])).toEqual([
    ["video", 2], ["audio", 1], ["titles", 1],
  ]);
  expect(preview.miniTimeline.tracks[0].clips[0]).toMatchObject({ startFrame: 0, endFrame: 90 });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `rtk pnpm --filter @openreel/orchestrator exec vitest run src/resolve-exports/preview.test.ts src/projects/project-store.test.ts`

Expected: FAIL because preview building and summary metadata do not exist.

- [ ] **Step 3: Implement preview derivation**

```ts
export function buildResolvePreview(
  project: Project,
  revision: string,
  availability: ReadonlyMap<string, PreviewMediaAvailability>,
): ResolvePreview {
  return ResolvePreviewSchema.parse({
    projectId: project.id,
    revision,
    name: project.name,
    description: project.description ?? "",
    createdAt: project.createdAt,
    modifiedAt: project.modifiedAt,
    durationFrames: secondsToFrames(project.timeline.duration, project.settings.frameRate),
    frameRate: project.settings.frameRate,
    render: resolveLatestRender(project, availability),
    miniTimeline: buildMiniTimeline(project),
    clipGroups: buildClipGroups(project, availability),
  });
}
```

Use existing media IDs and media endpoints for preview URLs. Return explicit `missing`, `stale`, or `ready` render states.

- [ ] **Step 4: Run focused tests**

Run: `rtk pnpm --filter @openreel/orchestrator exec vitest run src/resolve-exports/preview.test.ts src/projects/project-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/orchestrator/src/resolve-exports/preview.ts apps/orchestrator/src/resolve-exports/preview.test.ts apps/orchestrator/src/projects/project-store.ts apps/orchestrator/src/projects/project-store.test.ts
rtk git commit -m "feat(orchestrator): build rich Resolve project previews"
```

### Task 4: Durable export job and artifact service

**Files:**
- Create: `apps/orchestrator/src/resolve-exports/job-store.ts`
- Create: `apps/orchestrator/src/resolve-exports/job-store.test.ts`
- Create: `apps/orchestrator/src/resolve-exports/service.ts`
- Create: `apps/orchestrator/src/resolve-exports/service.test.ts`

**Interfaces:**
- Consumes: core compatibility, FCPXML, media-map, report, and target-profile functions.
- Produces: `ResolveExportService.preview(projectId)`, `start(projectId, revision, selection)`, `status(jobId)`, `cancel(jobId)`, `redeem(launchToken)`, and `recordImportResult(jobId, result)`.

- [ ] **Step 1: Write failing lifecycle and idempotency tests**

```ts
test("locks the requested revision and rejects a stale preview", async () => {
  await expect(service.start("vintage-tokyo", "stale", fullSelection))
    .rejects.toMatchObject({ code: "STALE_PROJECT_REVISION" });
});

test("accepts the same import result twice but rejects a conflict", async () => {
  await expect(service.recordImportResult(job.id, result)).resolves.toEqual(result);
  await expect(service.recordImportResult(job.id, result)).resolves.toEqual(result);
  await expect(service.recordImportResult(job.id, { ...result, saved: false }))
    .rejects.toMatchObject({ code: "IMPORT_RESULT_CONFLICT" });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `rtk pnpm --filter @openreel/orchestrator exec vitest run src/resolve-exports/job-store.test.ts src/resolve-exports/service.test.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement atomic job persistence and export**

```ts
export class ResolveExportService {
  async start(projectId: string, revision: string, selection: HandoffSelection): Promise<ResolveExportJob> {
    const project = await this.projects.loadProject(projectId);
    await this.revisions.assertConfirmed(projectId, revision);
    const audit = await this.projects.auditSnapshot(project, { requireOriginals: true });
    if (!audit.complete) throw bridgeError("MEDIA_INCOMPLETE", "Required media is unavailable");
    return this.jobs.createAndRun({ project, revision, selection }, job => this.buildArtifact(job, audit));
  }
}
```

Write job JSON via temporary file plus rename. Store FCPXML, manifest, report, job state, and final result under `ProjectStore.projectDir(projectId)/exports/resolve/{jobId}/`. Do not copy media binaries. Hash every artifact after close and commit the export directory through `GitStore.commit(projectId, message, transaction)` with an exact allowlist. Issue an opaque UUID launch token, persist only its SHA-256 hash, and expire it after five minutes.

When an idempotent completed import result arrives, mark every listed `referencedMediaId` as `externallyReferenced: true`, persist the project, write the result file, and commit both changes in one exact Git transaction. A failed result marks only IDs explicitly reported as linked; an empty list changes no media records.

- [ ] **Step 4: Run lifecycle tests**

Run: `rtk pnpm --filter @openreel/orchestrator exec vitest run src/resolve-exports/job-store.test.ts src/resolve-exports/service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/orchestrator/src/resolve-exports/job-store.ts apps/orchestrator/src/resolve-exports/job-store.test.ts apps/orchestrator/src/resolve-exports/service.ts apps/orchestrator/src/resolve-exports/service.test.ts
rtk git commit -m "feat(orchestrator): persist verified Resolve export jobs"
```

### Task 5: Resolve preview and export routes

**Files:**
- Create: `apps/orchestrator/src/resolve-exports/routes.ts`
- Create: `apps/orchestrator/src/resolve-exports/routes.test.ts`
- Modify: `apps/orchestrator/src/app.ts`

**Interfaces:**
- Produces the five HTTP endpoints specified by the approved design.
- Consumes: `ResolveExportService` and `buildResolvePreview`.

- [ ] **Step 1: Write failing route tests**

```ts
test("POST export returns 202 and never exposes artifact paths", async () => {
  const response = await fetch(`${baseUrl}/api/projects/vintage-tokyo/exports/resolve`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: "rev-123", selection: fullSelection }),
  });
  expect(response.status).toBe(202);
  expect(JSON.stringify(await response.json())).not.toContain("/Volumes/");
});
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `rtk pnpm --filter @openreel/orchestrator exec vitest run src/resolve-exports/routes.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement and mount routes**

```ts
router.get("/:projectId/resolve-preview", asyncHandler(async (req, res) => {
  res.json(await service.preview(req.params.projectId));
}));

router.post("/:projectId/exports/resolve", asyncHandler(async (req, res) => {
  const input = ResolveExportStartRequestSchema.parse(req.body);
  res.status(202).json(await service.start(req.params.projectId, input.revision, input.selection));
}));
```

Mount under `/api/projects` in `createApp`. Map stable errors to 400, 404, 409, 410, or 500 without leaking stack traces.

- [ ] **Step 4: Run route and package gates**

Run: `rtk pnpm --filter @openreel/orchestrator exec vitest run src/resolve-exports/routes.test.ts`

Expected: PASS.

Run: `rtk ./apps/orchestrator/node_modules/.bin/tsc --noEmit -p apps/orchestrator/tsconfig.json`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/orchestrator/src/resolve-exports/routes.ts apps/orchestrator/src/resolve-exports/routes.test.ts apps/orchestrator/src/app.ts
rtk git commit -m "feat(orchestrator): expose Resolve export API"
```
