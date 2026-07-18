import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaItem, Project, ProjectBaseRevision } from "@openreel/core";
import type { GenerationJob, GenerationOutput, GenerationTarget } from "@openreel/music-video-domain/generation";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../env.js";
import { GitStore } from "../../projects/git-store.js";
import { buildRequiredMediaManifest } from "../../projects/media-manifest.js";
import { ProjectStore } from "../../projects/project-store.js";
import { storePendingUpload } from "../../projects/pending-media.js";
import { executeSaveTransaction } from "../../projects/save-transaction.js";
import { ensureSafeTestProjectRoot } from "../../projects/test-project-root.js";
import * as generationServices from "./index.js";
import { GenerationProjectActionAdapter } from "./project-action-adapter.js";

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

const fixtureRoots = new Set<string>();
afterEach(async () => {
  await Promise.all([...fixtureRoots].map((root) => rm(root, { recursive: true, force: true })));
  fixtureRoots.clear();
});

const route = {
  providerInstanceId: "wavespeed-primary",
  providerModelId: "wavespeed/model",
  requestedMode: "text-to-video" as const,
  providerSchemaId: "schema",
  providerEndpointId: "endpoint",
  providerSchemaVersion: "v1",
};

function generationJob(projectId: string, target: GenerationTarget, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: "job-1",
    projectId,
    provider: "wavespeed",
    providerInstanceId: route.providerInstanceId,
    modelId: route.providerModelId,
    modelSchemaVersion: route.providerSchemaVersion,
    routing: route,
    providerJobId: "provider-1",
    status: "finalizing",
    attempt: 1,
    target,
    context: {
      projectId,
      entryContext: { kind: "new-asset" },
      mode: route.requestedMode,
      placementPolicy: "none",
      prompt: "generate",
      references: [],
    },
    providerInputs: { prompt: "generate" },
    attempts: [{ attemptNumber: 1, routing: route, providerJobId: "provider-1", startedAt: 1 }],
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function imageItem(id: string, name = `${id}.png`, assetGroupId = id): MediaItem {
  return {
    id,
    name,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: { fileSize: 4, width: 1, height: 1, duration: 0, frameRate: 0, codec: "image/png", sampleRate: 0, channels: 0 },
    thumbnailUrl: null,
    assetGroupId,
    isCurrent: true,
  };
}

interface AdapterFixture {
  root: string;
  store: ProjectStore;
  gitStore: GitStore;
  project: Project;
  cacheDir: string;
  adapter: GenerationProjectActionAdapter;
}

async function adapterFixture(): Promise<AdapterFixture> {
  const root = await mkdtemp(join(tmpdir(), "openreel-generation-project-action-"));
  fixtureRoots.add(root);
  const emptyTemplate = join(root, "empty-git-template");
  await mkdir(emptyTemplate);
  process.env.GIT_TEMPLATE_DIR = emptyTemplate;
  const emptyGitConfig = join(root, "empty-git-config");
  await writeFile(emptyGitConfig, "");
  process.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  const repoDir = join(root, "repo");
  await mkdir(repoDir);
  await ensureSafeTestProjectRoot(repoDir, { assignedTempRoot: root, userProjectsRoot: config.projectsRepo });
  const gitStore = new GitStore(repoDir);
  const store = new ProjectStore(gitStore);
  const project = await store.createProject("Generation Adapter");
  await gitStore.commit(project.id, "test: create project", {
    allowlist: ["project.json"],
    expectedEntries: [{ status: "A", path: "project.json" }],
  });
  const cacheDir = join(root, "download-cache");
  await mkdir(cacheDir);
  const adapter = new GenerationProjectActionAdapter({ projectStore: store, gitStore, downloadCacheDir: cacheDir, clock: () => 1_000, actionId: ({ jobId, kind }) => `${jobId}-${kind}` });
  return { root, store, gitStore, project, cacheDir, adapter };
}

function revision(receipt: { commitSha: string; treeSha: string; projectBlobSha: string }, project: Project): ProjectBaseRevision {
  return { ...receipt, sourceModifiedAt: project.modifiedAt };
}

async function seedMedia(fixture: AdapterFixture, item: MediaItem, bytes = new Uint8Array([1, 2, 3, 4])): Promise<Project> {
  const current = await fixture.store.loadProject(fixture.project.id);
  const receipt = await fixture.gitStore.readConfirmedReceipt(fixture.project.id);
  if (!current || !receipt) throw new Error("fixture-project-missing");
  const tempPath = join(fixture.root, `${item.id}.upload`);
  await writeFile(tempPath, bytes);
  await storePendingUpload(fixture.store.projectDir(current.id), item.id, tempPath, item.name, "image/png", bytes.byteLength);
  const next = { ...current, modifiedAt: current.modifiedAt + 1, mediaLibrary: { ...current.mediaLibrary, items: [...current.mediaLibrary.items, item] } };
  return (await executeSaveTransaction(fixture.store, fixture.gitStore, {
    projectId: current.id,
    baseRevision: revision(receipt, current),
    project: next,
    requiredMediaManifest: buildRequiredMediaManifest(next),
  })).project;
}

async function saveProjectMutation(fixture: AdapterFixture, mutate: (project: Project) => Project): Promise<Project> {
  const current = await fixture.store.loadProject(fixture.project.id);
  const receipt = await fixture.gitStore.readConfirmedReceipt(fixture.project.id);
  if (!current || !receipt) throw new Error("fixture-project-missing");
  const next = mutate(structuredClone(current));
  return (await executeSaveTransaction(fixture.store, fixture.gitStore, {
    projectId: current.id,
    baseRevision: revision(receipt, current),
    project: { ...next, modifiedAt: current.modifiedAt + 1 },
    requiredMediaManifest: buildRequiredMediaManifest(next),
    saveIntent: "user",
  })).project;
}

async function cacheOutput(fixture: AdapterFixture, providerJobId = "provider-1", bytes = new Uint8Array([137, 80, 78, 71])): Promise<GenerationOutput> {
  const key = createHash("sha256").update(providerJobId).digest("hex");
  await Promise.all([
    writeFile(join(fixture.cacheDir, `${key}.bin`), bytes),
    writeFile(join(fixture.cacheDir, `${key}.json`), JSON.stringify({ mimeType: "image/png" }), "utf8"),
  ]);
  return { mediaId: "provider-output", versionId: "provider-version", mimeType: "image/png", byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), width: 1, height: 1 };
}

describe("GenerationProjectActionAdapter", () => {
  it("exports the production project-action adapter", () => {
    expect((generationServices as unknown as Record<string, unknown>).GenerationProjectActionAdapter).toBeTypeOf("function");
  });

  it("stages a new asset once and replays from its semantic receipt after restart", async () => {
    const fixture = await adapterFixture();
    expect((fixture.adapter as unknown as { finalize?: unknown }).finalize).toBeTypeOf("function");
    if (!("finalize" in fixture.adapter)) return;
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "placeholder-1" });
    const before = (await fixture.gitStore.getHistory(fixture.project.id)).length;

    const first = await fixture.adapter.finalize({ job, output, idempotencyKey: "placement-key-1" });
    const restarted = new GenerationProjectActionAdapter({ projectStore: fixture.store, gitStore: fixture.gitStore, downloadCacheDir: fixture.cacheDir, clock: () => 2_000, actionId: ({ jobId, kind }) => `${jobId}-${kind}` });
    const replay = await restarted.finalize({ job, output, idempotencyKey: "placement-key-1" });

    const project = await fixture.store.loadProject(fixture.project.id);
    expect(first).toMatchObject({ mediaId: "placeholder-1", versionId: "placeholder-1" });
    expect(replay).toEqual(first);
    expect(project?.mediaLibrary.items).toHaveLength(1);
    expect(project?.mediaLibrary.items[0]).toMatchObject({ id: "placeholder-1", assetGroupId: "placeholder-1", isCurrent: true });
    expect(project?.mediaLibrary.items[0]?.generationMeta?.generationProjectActions?.receipts["placement-key-1"]).toMatchObject({ kind: "finalize-placeholder", jobId: "job-1" });
    expect((await fixture.gitStore.getHistory(fixture.project.id)).length).toBe(before + 1);
  });

  it("adds one current version to the explicit source group and replays without duplication", async () => {
    const fixture = await adapterFixture();
    if (!("finalize" in fixture.adapter)) return;
    await seedMedia(fixture, imageItem("source-v1", "source-v1.png", "asset-group-1"));
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-version", sourceMediaId: "source-v1", placeholderMediaId: "source-v2" });

    await fixture.adapter.finalize({ job, output, idempotencyKey: "placement-key-version" });
    await fixture.adapter.finalize({ job, output, idempotencyKey: "placement-key-version" });

    const project = await fixture.store.loadProject(fixture.project.id);
    const group = project?.mediaLibrary.items.filter((item) => item.assetGroupId === "asset-group-1") ?? [];
    expect(group).toHaveLength(2);
    expect(group.filter((item) => item.isCurrent)).toHaveLength(1);
    expect(group.find((item) => item.id === "source-v1")?.isCurrent).toBe(false);
    expect(group.find((item) => item.id === "source-v2")).toMatchObject({ isCurrent: true, generationMeta: { generationProjectActions: { receipts: { "placement-key-version": { kind: "finalize-version" } } } } });
  });

  it("rejects the same idempotency key with a different semantic payload before mutation", async () => {
    const fixture = await adapterFixture();
    if (!("finalize" in fixture.adapter)) return;
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "placeholder-1" });
    await fixture.adapter.finalize({ job, output, idempotencyKey: "placement-key-conflict" });
    const before = await fixture.store.loadProject(fixture.project.id);

    await expect(fixture.adapter.finalize({ job, output: { ...output, sha256: "different-sha" }, idempotencyKey: "placement-key-conflict" })).rejects.toMatchObject({ code: "generation-idempotency-conflict" });
    expect(await fixture.store.loadProject(fixture.project.id)).toEqual(before);
  });

  it("exposes shot, placement, reconciliation, envelope, undo, and redo operations", () => {
    const prototype = GenerationProjectActionAdapter.prototype as unknown as Record<string, unknown>;
    for (const method of ["link", "place", "reconcile", "getActionEnvelope", "applyProjectAction"]) {
      expect(prototype[method], method).toBeTypeOf("function");
    }
  });

  it("retains both receipts when two jobs finalize the same project concurrently", async () => {
    const fixture = await adapterFixture();
    const firstBytes = new Uint8Array([137, 80, 78, 71]);
    const secondBytes = new Uint8Array([137, 80, 78, 72]);
    const firstOutput = await cacheOutput(fixture, "provider-1", firstBytes);
    const secondOutput = await cacheOutput(fixture, "provider-2", secondBytes);
    const firstJob = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "generated-1" });
    const secondJob = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "generated-2" }, {
      id: "job-2",
      providerJobId: "provider-2",
      attempts: [{ attemptNumber: 1, routing: route, providerJobId: "provider-2", startedAt: 1 }],
    });

    await Promise.all([
      fixture.adapter.finalize({ job: firstJob, output: firstOutput, idempotencyKey: "finalize-1" }),
      fixture.adapter.finalize({ job: secondJob, output: secondOutput, idempotencyKey: "finalize-2" }),
    ]);

    const project = await fixture.store.loadProject(fixture.project.id);
    expect(project?.mediaLibrary.items.map((item) => item.id).sort()).toEqual(["generated-1", "generated-2"]);
  });

  it("appends one typed shot attempt and receipt on replay", async () => {
    const fixture = await adapterFixture();
    if (!("link" in fixture.adapter)) return;
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "shot-output" }, {
      context: {
        projectId: fixture.project.id,
        entryContext: { kind: "unplaced-shot", shotId: "shot-1" },
        mode: route.requestedMode,
        placementPolicy: "none",
        prompt: "generate",
        references: [],
      },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "finalize-shot" });
    const output = { ...rawOutput, ...ids };

    await fixture.adapter.link({ job, output, idempotencyKey: "shot-link-key" });
    await fixture.adapter.link({ job, output, idempotencyKey: "shot-link-key" });

    const item = (await fixture.store.loadProject(fixture.project.id))?.mediaLibrary.items.find((candidate) => candidate.id === ids.versionId);
    expect(item?.generationMeta?.generationProjectActions?.shotAttempts?.["shot-1"]).toHaveLength(1);
    expect(item?.generationMeta?.generationProjectActions?.shotAttempts?.["shot-1"]?.[0]).toMatchObject({ jobId: job.id, providerJobId: "provider-1", mediaId: ids.mediaId, versionId: ids.versionId });
    expect(item?.generationMeta?.generationProjectActions?.receipts["shot-link-key"]).toMatchObject({ kind: "append-shot-attempt" });
  });

  it("creates one linked clip at the exact destination timing and reconciles its receipt", async () => {
    const fixture = await adapterFixture();
    if (!("place" in fixture.adapter) || !("reconcile" in fixture.adapter)) return;
    const rawOutput = await cacheOutput(fixture);
    const entryContext = { kind: "unlinked-range" as const, rangeId: "range-1", startTime: 2, endTime: 5, destinationTrackId: "image-track" };
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "clip-output" }, {
      context: { projectId: fixture.project.id, entryContext, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 2, endSeconds: 5, durationSeconds: 3 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "finalize-clip" });
    await saveProjectMutation(fixture, (project) => ({ ...project, timeline: { ...project.timeline, tracks: [...project.timeline.tracks, { id: "image-track", type: "image", name: "Image", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } }));
    const output = { ...rawOutput, ...ids };

    const first = await fixture.adapter.place({ job, output, idempotencyKey: "placement-key" });
    const replay = await fixture.adapter.place({ job, output, idempotencyKey: "placement-key" });
    const reconciled = await fixture.adapter.reconcile({ job, output, idempotencyKey: "placement-key" });

    const track = (await fixture.store.loadProject(fixture.project.id))?.timeline.tracks.find((candidate) => candidate.id === "image-track");
    expect(first).toEqual({ outcome: "applied" });
    expect(replay).toEqual({ outcome: "applied" });
    expect(reconciled).toEqual({ outcome: "applied" });
    expect(track?.clips).toHaveLength(1);
    expect(track?.clips[0]).toMatchObject({ mediaId: ids.versionId, startTime: 2, duration: 3, metadata: { assetGroupId: ids.mediaId, idempotencyKey: "placement-key", generationProjectActions: { receipts: { "placement-key": { kind: "create-linked-clip" } } } } });
  });

  it("replaces only clip media and receipt metadata for a linked projection", async () => {
    const fixture = await adapterFixture();
    if (!("place" in fixture.adapter)) return;
    await seedMedia(fixture, imageItem("source-v1", "source-v1.png", "asset-group-1"));
    const beforeClip = {
      id: "clip-1", type: "image" as const, mediaId: "source-v1", trackId: "image-track", startTime: 4, duration: 6, inPoint: 1, outPoint: 7,
      effects: [{ id: "effect-1", type: "blur", enabled: true, parameters: {} }], audioEffects: [],
      transform: { position: { x: 2, y: 3 }, scale: { x: 1.2, y: 0.8 }, rotation: 4, anchor: { x: 0.5, y: 0.5 }, opacity: 0.7, fitMode: "cover" as const },
      volume: 0.4, keyframes: [], speed: 1.5, muted: true, metadata: { shotId: "shot-1", keep: "exact" },
    };
    await saveProjectMutation(fixture, (project) => ({ ...project, timeline: { ...project.timeline, tracks: [...project.timeline.tracks, { id: "image-track", type: "image", name: "Image", clips: [beforeClip], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } }));
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-version", sourceMediaId: "source-v1", placeholderMediaId: "source-v2" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-1", startTime: 4, endTime: 10 }, mode: route.requestedMode, placementPolicy: "replace-selected-clip-media", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 4, endSeconds: 10, durationSeconds: 6 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "finalize-version" });
    const result = await fixture.adapter.place({ job, output: { ...rawOutput, ...ids }, idempotencyKey: "replace-key" });

    const after = (await fixture.store.loadProject(fixture.project.id))?.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === "clip-1");
    expect(result).toEqual({ outcome: "applied" });
    expect(after?.mediaId).toBe("source-v2");
    expect({ ...after, mediaId: beforeClip.mediaId, metadata: beforeClip.metadata }).toEqual(beforeClip);
    expect(after?.metadata).toMatchObject({ shotId: "shot-1", keep: "exact", idempotencyKey: "replace-key", generationProjectActions: { receipts: { "replace-key": { kind: "replace-clip-media" } } } });
  });

  it("classifies a known pre-commit failure and receipt-free reconciliation as replay-safe", async () => {
    const fixture = await adapterFixture();
    if (!("place" in fixture.adapter) || !("reconcile" in fixture.adapter)) return;
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "missing-track-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 0, endTime: 2, destinationTrackId: "missing-track" }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 0, endSeconds: 2, durationSeconds: 2 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "finalize-missing-track" });
    const output = { ...rawOutput, ...ids };

    const placed = await fixture.adapter.place({ job, output, idempotencyKey: "missing-track-key" });
    const reconciled = await fixture.adapter.reconcile({ job, output, idempotencyKey: "missing-track-key" });

    expect(placed).toMatchObject({ outcome: "not-applied", replaySafe: true, error: { code: "generation-placement-track-not-found" } });
    expect(reconciled).toEqual({ outcome: "not-applied", replaySafe: true });
  });

  it("retries a project action after a browser save conflict and preserves both changes", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "conflict-output" });
    let injected = false;
    const adapter = new GenerationProjectActionAdapter({
      projectStore: fixture.store,
      gitStore: fixture.gitStore,
      downloadCacheDir: fixture.cacheDir,
      clock: () => 3_000,
      actionId: ({ jobId, kind }) => `${jobId}-${kind}`,
      beforeTransaction: async () => {
        if (injected) return;
        injected = true;
        await saveProjectMutation(fixture, (project) => ({ ...project, name: "Browser edit" }));
      },
    });

    await adapter.finalize({ job, output: rawOutput, idempotencyKey: "browser-conflict-key" });

    const project = await fixture.store.loadProject(fixture.project.id);
    expect(project?.name).toBe("Browser edit");
    expect(project?.mediaLibrary.items.some((item) => item.id === "conflict-output")).toBe(true);
  });

  it("reconciles a committed placement as applied after its response is lost", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "lost-response-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 1, endTime: 3 }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 1, endSeconds: 3, durationSeconds: 2 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "lost-finalize" });
    let loseResponse = true;
    const adapter = new GenerationProjectActionAdapter({
      projectStore: fixture.store,
      gitStore: fixture.gitStore,
      downloadCacheDir: fixture.cacheDir,
      clock: () => 4_000,
      actionId: ({ jobId, kind }) => `${jobId}-${kind}`,
      afterCommit: () => {
        if (!loseResponse) return;
        loseResponse = false;
        throw new Error("connection-lost");
      },
    });
    const output = { ...rawOutput, ...ids };
    const before = (await fixture.gitStore.getHistory(fixture.project.id)).length;

    const placed = await adapter.place({ job, output, idempotencyKey: "lost-placement-key" });
    const reconciled = await adapter.reconcile({ job, output, idempotencyKey: "lost-placement-key" });

    expect(placed).toMatchObject({ outcome: "unknown", error: { code: "generation-project-commit-response-lost" } });
    expect(reconciled).toEqual({ outcome: "applied" });
    expect((await fixture.gitStore.getHistory(fixture.project.id)).length).toBe(before + 1);
  });

  it("converges delayed and recovery placement owners on one receipt and clip", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "race-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 0, endTime: 2 }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 0, endSeconds: 2, durationSeconds: 2 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "race-finalize" });
    const output = { ...rawOutput, ...ids };
    const recovery = new GenerationProjectActionAdapter({ projectStore: fixture.store, gitStore: fixture.gitStore, downloadCacheDir: fixture.cacheDir, clock: () => 5_000, actionId: ({ jobId, kind }) => `${jobId}-${kind}` });

    const results = await Promise.all([
      fixture.adapter.place({ job, output, idempotencyKey: "race-placement-key" }),
      recovery.place({ job, output, idempotencyKey: "race-placement-key" }),
    ]);

    const project = await fixture.store.loadProject(fixture.project.id);
    const clips = project?.timeline.tracks.flatMap((track) => track.clips).filter((clip) => (clip.metadata as { idempotencyKey?: string } | undefined)?.idempotencyKey === "race-placement-key") ?? [];
    expect(results).toEqual([{ outcome: "applied" }, { outcome: "applied" }]);
    expect(clips).toHaveLength(1);
  });

  it("undoes and redoes the exact Git-backed server action through its durable envelope", async () => {
    const fixture = await adapterFixture();
    if (!("getActionEnvelope" in fixture.adapter) || !("applyProjectAction" in fixture.adapter)) return;
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "undo-output" });
    const finalized = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "undo-finalize-key" });
    const envelope = finalized.projectAction;
    if (!envelope) throw new Error("action-envelope-missing");

    const undone = await fixture.adapter.applyProjectAction({ projectId: fixture.project.id, actionId: envelope.receipt.actionId, operation: "undo", expectedRevision: envelope.appliedRevision, envelope });
    expect((await fixture.store.loadProject(fixture.project.id))?.mediaLibrary.items.some((item) => item.id === "undo-output")).toBe(false);
    const redone = await fixture.adapter.applyProjectAction({ projectId: fixture.project.id, actionId: envelope.receipt.actionId, operation: "redo", expectedRevision: undone.revision, envelope });
    expect((await fixture.store.loadProject(fixture.project.id))?.mediaLibrary.items.some((item) => item.id === "undo-output")).toBe(true);
    expect(undone).toMatchObject({ operation: "undo", status: "applied" });
    expect(redone).toMatchObject({ operation: "redo", status: "applied" });
  });
});
