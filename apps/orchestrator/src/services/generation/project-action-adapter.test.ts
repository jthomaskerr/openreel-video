import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { MediaItem, Project, ProjectBaseRevision } from "@openreel/core";
import {
  canonicalizeGenerationProjectActionPayload,
  type GenerationJob,
  type GenerationOutput,
  type GenerationProjectMutationReceipt,
  GenerationProjectMutationReceiptSchema,
  type GenerationTarget,
  type JsonValue,
} from "@openreel/music-video-domain/generation";
import { config } from "../../env.js";
import { GitStore, type GitCommitReceipt, type GitProjectTransaction } from "../../projects/git-store.js";
import { buildRequiredMediaManifest } from "../../projects/media-manifest.js";
import { ProjectStore } from "../../projects/project-store.js";
import { storePendingUpload } from "../../projects/pending-media.js";
import { executeSaveTransaction } from "../../projects/save-transaction.js";
import { ensureSafeTestProjectRoot } from "../../projects/test-project-root.js";
import * as generationServices from "./index.js";
import { findGenerationProjectReceipt, GenerationProjectActionAdapter, GenerationProjectActionError } from "./project-action-adapter.js";

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

function generationProjectActions(item: MediaItem | undefined): {
  readonly receipts?: Readonly<Record<string, unknown>>;
  readonly shotAttempts?: Readonly<Record<string, readonly unknown[]>>;
} | undefined {
  const actions = item?.generationMeta?.inputs?.["generationProjectActions"];
  return actions && typeof actions === "object" && !Array.isArray(actions)
    ? actions as {
      readonly receipts?: Readonly<Record<string, unknown>>;
      readonly shotAttempts?: Readonly<Record<string, readonly unknown[]>>;
    }
    : undefined;
}

function withGenerationReceipt(
  item: MediaItem,
  idempotencyKey: string,
  receipt: GenerationProjectMutationReceipt,
): MediaItem {
  const generationMeta = item.generationMeta ?? {
    provider: "wavespeed",
    model: "wavespeed/model",
    jobId: receipt.jobId,
    status: "succeeded" as const,
  };
  const actions = generationProjectActions(item);
  return {
    ...item,
    generationMeta: {
      ...generationMeta,
      inputs: {
        ...generationMeta.inputs,
        generationProjectActions: {
          ...actions,
          receipts: { ...actions?.receipts, [idempotencyKey]: receipt },
        },
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

function revision(receipt: GitCommitReceipt, project: Project): ProjectBaseRevision {
  assert.ok(receipt.commitSha && receipt.treeSha && receipt.projectBlobSha, "Expected a complete confirmed Git receipt");
  return {
    commitSha: receipt.commitSha,
    treeSha: receipt.treeSha,
    projectBlobSha: receipt.projectBlobSha,
    sourceModifiedAt: project.modifiedAt,
  };
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
    assert.equal(typeof (generationServices as unknown as Record<string, unknown>).GenerationProjectActionAdapter, "function");
  });

  it("stages a new asset once and replays from its semantic receipt after restart", async () => {
    const fixture = await adapterFixture();
    assert.equal(typeof (fixture.adapter as unknown as { finalize?: unknown }).finalize, "function");
    if (!("finalize" in fixture.adapter)) return;
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "placeholder-1" });
    const before = (await fixture.gitStore.getHistory(fixture.project.id)).length;

    const first = await fixture.adapter.finalize({ job, output, idempotencyKey: "placement-key-1" });
    const restarted = new GenerationProjectActionAdapter({ projectStore: fixture.store, gitStore: fixture.gitStore, downloadCacheDir: fixture.cacheDir, clock: () => 2_000, actionId: ({ jobId, kind }) => `${jobId}-${kind}` });
    const replay = await restarted.finalize({ job, output, idempotencyKey: "placement-key-1" });

    const project = await fixture.store.loadProject(fixture.project.id);
    assert.equal(first.mediaId, "placeholder-1");
    assert.equal(first.versionId, "placeholder-1");
    assert.deepEqual(replay, first);
    assert.equal(project?.mediaLibrary.items.length, 1);
    assert.equal(project?.mediaLibrary.items[0]?.id, "placeholder-1");
    assert.equal(project?.mediaLibrary.items[0]?.assetGroupId, "placeholder-1");
    assert.equal(project?.mediaLibrary.items[0]?.isCurrent, true);
    const receipt = generationProjectActions(project?.mediaLibrary.items[0])?.receipts?.["placement-key-1"] as { kind?: unknown; jobId?: unknown } | undefined;
    assert.equal(receipt?.kind, "finalize-placeholder");
    assert.equal(receipt?.jobId, "job-1");
    assert.equal((await fixture.gitStore.getHistory(fixture.project.id)).length, before + 1);
  });

  it("persists and replays the production default action identifier through the strict receipt schema", async () => {
    const fixture = await adapterFixture();
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "default-action-output" }, { id: "job-default-action" });
    const adapter = new GenerationProjectActionAdapter({
      projectStore: fixture.store,
      gitStore: fixture.gitStore,
      downloadCacheDir: fixture.cacheDir,
      clock: () => 8_000,
    });

    const first = await adapter.finalize({ job, output, idempotencyKey: "default-action-key" });
    const afterFirstHistory = (await fixture.gitStore.getHistory(fixture.project.id)).length;
    const persisted = await fixture.store.loadProject(fixture.project.id);
    const receipt = persisted ? findGenerationProjectReceipt(persisted, "default-action-key") : undefined;
    assert.ok(receipt);
    assert.equal(GenerationProjectMutationReceiptSchema.safeParse(receipt).success, true);
    assert.match(receipt.actionId, /^generation-action-[a-f0-9]{64}$/u);

    const restarted = new GenerationProjectActionAdapter({
      projectStore: fixture.store,
      gitStore: fixture.gitStore,
      downloadCacheDir: fixture.cacheDir,
      clock: () => 9_000,
    });
    const replayed = await restarted.finalize({ job, output, idempotencyKey: "default-action-key" });
    const envelope = await restarted.getActionEnvelope(fixture.project.id, "default-action-key");
    const afterReplay = await fixture.store.loadProject(fixture.project.id);

    assert.deepEqual(replayed, first);
    assert.deepEqual(envelope, first.projectAction);
    assert.equal((await fixture.gitStore.getHistory(fixture.project.id)).length, afterFirstHistory);
    assert.equal(afterReplay?.mediaLibrary.items.filter((item) => item.id === "default-action-output").length, 1);
  });

  it("rejects an incomplete confirmed revision before mutating the project", async () => {
    const fixture = await adapterFixture();
    const job = generationJob(
      fixture.project.id,
      { kind: "new-asset", placeholderMediaId: "incomplete-revision-output" },
      { id: "job-incomplete-revision" },
    );
    const output = await cacheOutput(fixture);
    fixture.gitStore.readConfirmedReceipt = async () => ({
      commitSha: null,
      treeSha: null,
      projectBlobSha: null,
      mediaManifestDigest: null,
    });

    const error = await fixture.adapter.finalize({ job, output, idempotencyKey: "incomplete-revision-key" })
      .catch((cause: unknown) => cause);
    assert.equal((error as { code?: unknown }).code, "generation-project-revision-unavailable");
    assert.equal((await fixture.store.loadProject(fixture.project.id))?.mediaLibrary.items.length, 0);
  });

  it("preserves non-ENOENT project read failures with an actionable typed cause", async () => {
    const fixture = await adapterFixture();
    const ioFailure = Object.assign(new Error("injected permission failure"), { code: "EACCES" });
    let readPath: string | undefined;
    const adapter = new GenerationProjectActionAdapter({
      projectStore: fixture.store,
      gitStore: fixture.gitStore,
      downloadCacheDir: fixture.cacheDir,
      readProjectFile: async (path) => {
        readPath = path;
        throw ioFailure;
      },
    });

    const error = await adapter.getActionEnvelope(fixture.project.id, "read-failure-key")
      .catch((cause: unknown) => cause);

    assert.ok(error instanceof GenerationProjectActionError);
    assert.equal(error.code, "generation-project-read-failed");
    assert.equal(error.cause, ioFailure);
    assert.equal(readPath, join(fixture.store.projectDir(fixture.project.id), "project.json"));
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
    assert.equal(group.length, 2);
    assert.equal(group.filter((item) => item.isCurrent).length, 1);
    assert.equal(group.find((item) => item.id === "source-v1")?.isCurrent, false);
    const current = group.find((item) => item.id === "source-v2");
    assert.equal(current?.isCurrent, true);
    assert.equal((generationProjectActions(current)?.receipts?.["placement-key-version"] as { kind?: unknown } | undefined)?.kind, "finalize-version");
  });

  it("rejects the same idempotency key with a different semantic payload before mutation", async () => {
    const fixture = await adapterFixture();
    if (!("finalize" in fixture.adapter)) return;
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "placeholder-1" });
    await fixture.adapter.finalize({ job, output, idempotencyKey: "placement-key-conflict" });
    const before = await fixture.store.loadProject(fixture.project.id);

    await assert.rejects(
      fixture.adapter.finalize({ job, output: { ...output, sha256: "different-sha" }, idempotencyKey: "placement-key-conflict" }),
      (error: unknown) => (error as { code?: unknown }).code === "generation-idempotency-conflict",
    );
    assert.deepEqual(await fixture.store.loadProject(fixture.project.id), before);
  });

  it("ignores a malformed persisted receipt instead of suppressing the real mutation", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "validated-output" });
    const semanticPayload = canonicalizeGenerationProjectActionPayload({
      jobId: job.id,
      projectId: job.projectId,
      target: job.target,
      output: rawOutput,
    } as unknown as JsonValue);
    const forged = {
      ...imageItem("malformed-receipt-holder"),
      generationMeta: {
        provider: "wavespeed",
        model: "wavespeed/model",
        jobId: "forged-job",
        status: "succeeded" as const,
        inputs: {
          generationProjectActions: {
            receipts: {
              "malformed-receipt-key": {
                schemaVersion: 1,
                actionId: "forged-action",
                jobId: job.id,
                idempotencyKey: "malformed-receipt-key",
                kind: "finalize-placeholder",
                semanticPayload,
                baseRevision: { commitSha: "incomplete" },
                appliedAt: "not-a-timestamp",
              },
            },
          },
        },
      },
    } as MediaItem;
    await seedMedia(fixture, forged);

    const finalized = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "malformed-receipt-key" });

    const project = await fixture.store.loadProject(fixture.project.id);
    assert.equal(finalized.versionId, "validated-output");
    assert.equal(project?.mediaLibrary.items.some((item) => item.id === "validated-output"), true);
    assert.equal(
      (generationProjectActions(project?.mediaLibrary.items.find((item) => item.id === "validated-output"))
        ?.receipts?.["malformed-receipt-key"] as { appliedAt?: unknown } | undefined)?.appliedAt,
      1_000,
    );
  });

  it("exposes shot, placement, reconciliation, envelope, undo, and redo operations", () => {
    const prototype = GenerationProjectActionAdapter.prototype as unknown as Record<string, unknown>;
    for (const method of ["link", "place", "reconcile", "getActionEnvelope", "applyProjectAction"]) {
      assert.equal(typeof prototype[method], "function", method);
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
    assert.deepEqual(project?.mediaLibrary.items.map((item) => item.id).sort(), ["generated-1", "generated-2"]);
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
    const actions = generationProjectActions(item);
    assert.equal(actions?.shotAttempts?.["shot-1"]?.length, 1);
    assert.deepEqual(
      Object.fromEntries(Object.entries(actions?.shotAttempts?.["shot-1"]?.[0] as Record<string, unknown>).filter(([key]) => ["jobId", "providerJobId", "mediaId", "versionId"].includes(key))),
      { jobId: job.id, providerJobId: "provider-1", mediaId: ids.mediaId, versionId: ids.versionId },
    );
    assert.equal((actions?.receipts?.["shot-link-key"] as { kind?: unknown } | undefined)?.kind, "append-shot-attempt");
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
    assert.deepEqual(first, { outcome: "applied" });
    assert.deepEqual(replay, { outcome: "applied" });
    assert.deepEqual(reconciled, { outcome: "applied" });
    assert.equal(track?.clips.length, 1);
    const clip = track?.clips[0];
    const metadata = clip?.metadata as Record<string, unknown> | undefined;
    const projectActions = metadata?.["generationProjectActions"] as { receipts?: Record<string, { kind?: unknown }> } | undefined;
    assert.equal(clip?.mediaId, ids.versionId);
    assert.equal(clip?.startTime, 2);
    assert.equal(clip?.duration, 3);
    assert.equal(metadata?.["assetGroupId"], ids.mediaId);
    assert.equal(metadata?.["idempotencyKey"], "placement-key");
    assert.equal(projectActions?.receipts?.["placement-key"]?.kind, "create-linked-clip");
  });

  it("replaces only clip media and receipt metadata for a linked projection", async () => {
    const fixture = await adapterFixture();
    if (!("place" in fixture.adapter)) return;
    await seedMedia(fixture, imageItem("source-v1", "source-v1.png", "asset-group-1"));
    const beforeClip = {
      id: "clip-1", type: "image" as const, mediaId: "source-v1", trackId: "image-track", startTime: 4, duration: 6, inPoint: 1, outPoint: 7,
      effects: [{ id: "effect-1", type: "blur", enabled: true, params: {} }], audioEffects: [],
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
    assert.deepEqual(result, { outcome: "applied" });
    assert.equal(after?.mediaId, "source-v2");
    assert.deepEqual({ ...after, mediaId: beforeClip.mediaId, metadata: beforeClip.metadata }, beforeClip);
    const metadata = after?.metadata as Record<string, unknown> | undefined;
    const projectActions = metadata?.["generationProjectActions"] as { receipts?: Record<string, { kind?: unknown }> } | undefined;
    assert.equal(metadata?.["shotId"], "shot-1");
    assert.equal(metadata?.["keep"], "exact");
    assert.equal(metadata?.["idempotencyKey"], "replace-key");
    assert.equal(projectActions?.receipts?.["replace-key"]?.kind, "replace-clip-media");
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

    assert.equal(placed.outcome, "not-applied");
    assert.equal(placed.replaySafe, true);
    assert.equal(placed.error?.code, "generation-placement-track-not-found");
    assert.deepEqual(reconciled, { outcome: "not-applied", replaySafe: true });
  });

  it("does not reconcile forged flat clip metadata without a canonical durable receipt", async () => {
    const fixture = await adapterFixture();
    if (!("reconcile" in fixture.adapter)) return;
    await seedMedia(fixture, imageItem("forged-placement-media"));
    await saveProjectMutation(fixture, (project) => ({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [...project.timeline.tracks, {
          id: "forged-track",
          type: "image",
          name: "Forged",
          clips: [{
            id: "forged-clip",
            type: "image",
            mediaId: "forged-placement-media",
            trackId: "forged-track",
            startTime: 0,
            duration: 2,
            inPoint: 0,
            outPoint: 2,
            effects: [],
            audioEffects: [],
            transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "contain" },
            volume: 1,
            keyframes: [],
            speed: 1,
            muted: false,
            metadata: { idempotencyKey: "forged-placement-key" },
          }],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        }],
      },
    }));
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "forged-placement-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 0, endTime: 2, destinationTrackId: "forged-track" }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 0, endSeconds: 2, durationSeconds: 2 } },
    });

    const reconciled = await fixture.adapter.reconcile({ job, output, idempotencyKey: "forged-placement-key" });

    assert.deepEqual(reconciled, { outcome: "not-applied", replaySafe: true });
  });

  it("classifies conflicting canonical reconciliation receipts as non-retryable", async () => {
    const fixture = await adapterFixture();
    const output = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "conflicting-reconcile-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 0, endTime: 2 }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 0, endSeconds: 2, durationSeconds: 2 } },
    });
    const current = await fixture.store.loadProject(fixture.project.id);
    const gitReceipt = await fixture.gitStore.readConfirmedReceipt(fixture.project.id);
    if (!current || !gitReceipt) throw new Error("fixture-project-missing");
    const semanticPayload = canonicalizeGenerationProjectActionPayload({
      jobId: job.id,
      projectId: job.projectId,
      policy: job.context.placementPolicy,
      entryContext: job.context.entryContext,
      timing: job.context.timing ?? null,
      output,
    } as unknown as JsonValue);
    const firstReceipt: GenerationProjectMutationReceipt = {
      schemaVersion: 1,
      actionId: "reconcile-action-one",
      jobId: job.id,
      idempotencyKey: "conflicting-reconcile-key",
      kind: "create-linked-clip",
      semanticPayload,
      baseRevision: revision(gitReceipt, current),
      appliedAt: 1_000,
    };
    const secondReceipt = { ...firstReceipt, actionId: "reconcile-action-two" };
    await seedMedia(fixture, withGenerationReceipt(imageItem("reconcile-holder-one"), "conflicting-reconcile-key", firstReceipt));
    await seedMedia(fixture, withGenerationReceipt(imageItem("reconcile-holder-two"), "conflicting-reconcile-key", secondReceipt));

    const reconciled = await fixture.adapter.reconcile({ job, output, idempotencyKey: "conflicting-reconcile-key" });

    assert.equal(reconciled.outcome, "unknown");
    assert.equal(reconciled.error?.code, "generation-idempotency-conflict");
    assert.equal(reconciled.error?.retryable, false);
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
    assert.equal(project?.name, "Browser edit");
    assert.equal(project?.mediaLibrary.items.some((item) => item.id === "conflict-output"), true);
  });

  it("returns the canonical retryable conflict when optimistic save retries are exhausted", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "retry-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 0, endTime: 2 }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 0, endSeconds: 2, durationSeconds: 2 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "retry-finalize" });
    let conflicts = 0;
    const adapter = new GenerationProjectActionAdapter({
      projectStore: fixture.store,
      gitStore: fixture.gitStore,
      downloadCacheDir: fixture.cacheDir,
      maxConflictRetries: 2,
      clock: () => 6_000,
      actionId: ({ jobId, kind }) => `${jobId}-${kind}`,
      beforeTransaction: async () => {
        conflicts += 1;
        await saveProjectMutation(fixture, (project) => ({ ...project, name: `Browser edit ${conflicts}` }));
      },
    });

    const placed = await adapter.place({ job, output: { ...rawOutput, ...ids }, idempotencyKey: "retry-placement" });

    assert.equal(conflicts, 2);
    assert.deepEqual(placed, {
      outcome: "not-applied",
      replaySafe: true,
      error: {
        code: "generation-project-conflict-retry-exhausted",
        message: "generation-project-conflict-retry-exhausted",
        retryable: true,
      },
    });
  });

  it("waits for an in-flight writer rollback before accepting a replay receipt", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "rollback-output" }, {
      context: { projectId: fixture.project.id, entryContext: { kind: "unlinked-range", rangeId: "range", startTime: 0, endTime: 2 }, mode: route.requestedMode, placementPolicy: "create-linked-clip", prompt: "generate", references: [], timing: { source: "timeline", startSeconds: 0, endSeconds: 2, durationSeconds: 2 } },
    });
    const ids = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "rollback-finalize" });
    const output = { ...rawOutput, ...ids };
    const current = await fixture.store.loadProject(fixture.project.id);
    const gitReceipt = await fixture.gitStore.readConfirmedReceipt(fixture.project.id);
    if (!current || !gitReceipt) throw new Error("fixture-project-missing");
    const semanticPayload = canonicalizeGenerationProjectActionPayload({
      jobId: job.id,
      projectId: job.projectId,
      policy: job.context.placementPolicy,
      entryContext: job.context.entryContext,
      timing: job.context.timing ?? null,
      output,
    } as unknown as JsonValue);
    const transientReceipt: GenerationProjectMutationReceipt = {
      schemaVersion: 1,
      actionId: `${job.id}-create-linked-clip`,
      jobId: job.id,
      idempotencyKey: "rollback-placement",
      kind: "create-linked-clip",
      semanticPayload,
      baseRevision: revision(gitReceipt, current),
      appliedAt: 7_000,
    };
    const transientProject: Project = {
      ...current,
      modifiedAt: current.modifiedAt + 1,
      mediaLibrary: {
        ...current.mediaLibrary,
        items: current.mediaLibrary.items.map((item) => item.id === ids.versionId
          ? withGenerationReceipt(item, "rollback-placement", transientReceipt)
          : item),
      },
    };
    const writerPaused = deferred<void>();
    const allowRollback = deferred<void>();
    const atomicReadAttempted = deferred<void>();
    const originalWithProjectTransaction = fixture.gitStore.withProjectTransaction.bind(fixture.gitStore) as <T>(
      projectId: string,
      operation: (transaction: GitProjectTransaction) => Promise<T>,
    ) => Promise<T>;
    let unlockedTransactionCalls = 0;
    let writerInjected = false;
    let writerStarting = false;
    let writerIsPaused = false;
    let writerPromise: Promise<unknown> | undefined;
    fixture.gitStore.withProjectTransaction = async <T>(
      projectId: string,
      operation: (transaction: GitProjectTransaction) => Promise<T>,
    ): Promise<T> => {
      const isWriterTransaction = writerStarting;
      if (writerIsPaused && !isWriterTransaction) atomicReadAttempted.resolve(undefined);
      if (!isWriterTransaction) unlockedTransactionCalls += 1;
      const result = await originalWithProjectTransaction(projectId, operation);
      if (!isWriterTransaction && !writerInjected && unlockedTransactionCalls === 2) {
        writerInjected = true;
        writerStarting = true;
        writerPromise = executeSaveTransaction(fixture.store, fixture.gitStore, {
          projectId,
          baseRevision: revision(gitReceipt, current),
          project: transientProject,
          requiredMediaManifest: buildRequiredMediaManifest(transientProject),
        }, {
          beforeCommit: async () => {
            writerIsPaused = true;
            writerPaused.resolve(undefined);
            await allowRollback.promise;
            throw new Error("forced writer rollback");
          },
        });
        writerStarting = false;
        await writerPaused.promise;
      }
      return result;
    };

    const placementPromise = fixture.adapter.place({ job, output, idempotencyKey: "rollback-placement" });
    const readMode = await Promise.race([
      atomicReadAttempted.promise.then(() => "atomic" as const),
      placementPromise.then(() => "returned-before-rollback" as const),
    ]);
    allowRollback.resolve(undefined);
    if (!writerPromise) throw new Error("writer-did-not-start");
    await assert.rejects(writerPromise, /forced writer rollback/);
    writerIsPaused = false;
    const placed = await placementPromise;
    const reconciled = await fixture.adapter.reconcile({ job, output, idempotencyKey: "rollback-placement" });

    assert.equal(readMode, "atomic");
    assert.deepEqual(placed, { outcome: "applied" });
    assert.deepEqual(reconciled, { outcome: "applied" });
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

    assert.equal(placed.outcome, "unknown");
    assert.equal(placed.error?.code, "generation-project-commit-response-lost");
    assert.deepEqual(reconciled, { outcome: "applied" });
    assert.equal((await fixture.gitStore.getHistory(fixture.project.id)).length, before + 1);
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
    assert.deepEqual(results, [{ outcome: "applied" }, { outcome: "applied" }]);
    assert.equal(clips.length, 1);
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
    assert.equal((await fixture.store.loadProject(fixture.project.id))?.mediaLibrary.items.some((item) => item.id === "undo-output"), false);
    const redone = await fixture.adapter.applyProjectAction({ projectId: fixture.project.id, actionId: envelope.receipt.actionId, operation: "redo", expectedRevision: undone.revision, envelope });
    assert.equal((await fixture.store.loadProject(fixture.project.id))?.mediaLibrary.items.some((item) => item.id === "undo-output"), true);
    assert.equal(undone.operation, "undo");
    assert.equal(undone.status, "applied");
    assert.equal(redone.operation, "redo");
    assert.equal(redone.status, "applied");
  });

  it("normalizes a concurrent undo writer to the canonical project-action conflict", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "concurrent-undo-output" });
    const finalized = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "concurrent-undo-key" });
    const envelope = finalized.projectAction;
    if (!envelope) throw new Error("action-envelope-missing");
    const originalWithProjectTransaction = fixture.gitStore.withProjectTransaction.bind(fixture.gitStore) as <T>(
      projectId: string,
      operation: (transaction: GitProjectTransaction) => Promise<T>,
    ) => Promise<T>;
    let adapterTransactionCalls = 0;
    let writerRunning = false;
    fixture.gitStore.withProjectTransaction = async <T>(
      projectId: string,
      operation: (transaction: GitProjectTransaction) => Promise<T>,
    ): Promise<T> => {
      const isWriterTransaction = writerRunning;
      if (!isWriterTransaction) adapterTransactionCalls += 1;
      if (!isWriterTransaction && adapterTransactionCalls === 3) {
        writerRunning = true;
        await saveProjectMutation(fixture, (project) => ({ ...project, name: "Concurrent undo winner" }));
        writerRunning = false;
      }
      return originalWithProjectTransaction(projectId, operation);
    };

    const error = await fixture.adapter.applyProjectAction({
      projectId: fixture.project.id,
      actionId: envelope.receipt.actionId,
      operation: "undo",
      expectedRevision: envelope.appliedRevision,
      envelope,
    }).catch((cause: unknown) => cause);

    assert.ok(error instanceof GenerationProjectActionError);
    assert.equal(error.code, "generation-project-action-conflict");
    const afterConflict = await fixture.store.loadProject(fixture.project.id);
    assert.equal(afterConflict?.name, "Concurrent undo winner");
    assert.equal(afterConflict?.mediaLibrary.items.some((item) => item.id === "concurrent-undo-output"), true);
  });

  it("keeps a replay envelope bound to the receipt-introducing revision after unrelated saves", async () => {
    const fixture = await adapterFixture();
    const rawOutput = await cacheOutput(fixture);
    const job = generationJob(fixture.project.id, { kind: "new-asset", placeholderMediaId: "replay-envelope-output" });
    const finalized = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "replay-envelope-key" });
    const originalEnvelope = finalized.projectAction;
    if (!originalEnvelope) throw new Error("action-envelope-missing");
    const afterUnrelatedSave = await saveProjectMutation(fixture, (project) => ({ ...project, name: "Preserve after replay" }));
    const afterUnrelatedReceipt = await fixture.gitStore.readConfirmedReceipt(fixture.project.id);
    if (!afterUnrelatedReceipt) throw new Error("fixture-revision-missing");

    const replayed = await fixture.adapter.finalize({ job, output: rawOutput, idempotencyKey: "replay-envelope-key" });
    const replayEnvelope = replayed.projectAction;
    if (!replayEnvelope) throw new Error("action-envelope-missing");

    await assert.rejects(
      fixture.adapter.applyProjectAction({
        projectId: fixture.project.id,
        actionId: replayEnvelope.receipt.actionId,
        operation: "undo",
        expectedRevision: revision(afterUnrelatedReceipt, afterUnrelatedSave),
        envelope: replayEnvelope,
      }),
      (cause: unknown) => cause instanceof GenerationProjectActionError && cause.code === "generation-project-action-conflict",
    );
    const afterRejectedUndo = await fixture.store.loadProject(fixture.project.id);
    assert.deepEqual(replayEnvelope.appliedRevision, originalEnvelope.appliedRevision);
    assert.equal(afterRejectedUndo?.name, "Preserve after replay");
    assert.equal(afterRejectedUndo?.mediaLibrary.items.some((item) => item.id === "replay-envelope-output"), true);
  });

  it("rejects undo and redo before they can overwrite unrelated intervening saves", async () => {
    const undoFixture = await adapterFixture();
    const undoOutput = await cacheOutput(undoFixture);
    const undoJob = generationJob(undoFixture.project.id, { kind: "new-asset", placeholderMediaId: "unsafe-undo-output" });
    const undoFinalized = await undoFixture.adapter.finalize({ job: undoJob, output: undoOutput, idempotencyKey: "unsafe-undo-key" });
    const undoEnvelope = undoFinalized.projectAction;
    if (!undoEnvelope) throw new Error("action-envelope-missing");
    const afterBrowserUndoEdit = await saveProjectMutation(undoFixture, (project) => ({ ...project, name: "Preserve before undo" }));
    const afterBrowserUndoReceipt = await undoFixture.gitStore.readConfirmedReceipt(undoFixture.project.id);
    if (!afterBrowserUndoReceipt) throw new Error("fixture-revision-missing");

    await assert.rejects(
      undoFixture.adapter.applyProjectAction({
        projectId: undoFixture.project.id,
        actionId: undoEnvelope.receipt.actionId,
        operation: "undo",
        expectedRevision: revision(afterBrowserUndoReceipt, afterBrowserUndoEdit),
        envelope: undoEnvelope,
      }),
      (cause: unknown) => cause instanceof GenerationProjectActionError && cause.code === "generation-project-action-conflict",
    );
    const afterRejectedUndo = await undoFixture.store.loadProject(undoFixture.project.id);
    assert.equal(afterRejectedUndo?.name, "Preserve before undo");
    assert.equal(afterRejectedUndo?.mediaLibrary.items.some((item) => item.id === "unsafe-undo-output"), true);

    const redoFixture = await adapterFixture();
    const redoOutput = await cacheOutput(redoFixture);
    const redoJob = generationJob(redoFixture.project.id, { kind: "new-asset", placeholderMediaId: "unsafe-redo-output" });
    const redoFinalized = await redoFixture.adapter.finalize({ job: redoJob, output: redoOutput, idempotencyKey: "unsafe-redo-key" });
    const redoEnvelope = redoFinalized.projectAction;
    if (!redoEnvelope) throw new Error("action-envelope-missing");
    const undone = await redoFixture.adapter.applyProjectAction({
      projectId: redoFixture.project.id,
      actionId: redoEnvelope.receipt.actionId,
      operation: "undo",
      expectedRevision: redoEnvelope.appliedRevision,
      envelope: redoEnvelope,
    });
    assert.equal(undone.status, "applied");
    const afterBrowserRedoEdit = await saveProjectMutation(redoFixture, (project) => ({ ...project, name: "Preserve before redo" }));
    const afterBrowserRedoReceipt = await redoFixture.gitStore.readConfirmedReceipt(redoFixture.project.id);
    if (!afterBrowserRedoReceipt) throw new Error("fixture-revision-missing");

    await assert.rejects(
      redoFixture.adapter.applyProjectAction({
        projectId: redoFixture.project.id,
        actionId: redoEnvelope.receipt.actionId,
        operation: "redo",
        expectedRevision: revision(afterBrowserRedoReceipt, afterBrowserRedoEdit),
        envelope: redoEnvelope,
      }),
      (cause: unknown) => cause instanceof GenerationProjectActionError && cause.code === "generation-project-action-conflict",
    );
    const afterRejectedRedo = await redoFixture.store.loadProject(redoFixture.project.id);
    assert.equal(afterRejectedRedo?.name, "Preserve before redo");
    assert.equal(afterRejectedRedo?.mediaLibrary.items.some((item) => item.id === "unsafe-redo-output"), false);
  });
});
