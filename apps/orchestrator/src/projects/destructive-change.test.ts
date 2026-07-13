import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import type { Project, ProjectSaveRequest } from "@openreel/core";
import { config } from "../env";
import {
  assessDestructiveChange,
  authorizeDestructiveChange,
  MAX_UNCONFIRMED_CLIP_COUNT_DROP,
  MAX_UNCONFIRMED_MEDIA_COUNT_DROP,
  MAX_UNCONFIRMED_SERIALIZED_STRUCTURAL_SIZE_DROP,
  MAX_UNCONFIRMED_TRACK_COUNT_DROP,
  type StructuralMetricDeltas,
} from "./destructive-change";
import { GitStore } from "./git-store";
import { buildRequiredMediaManifest } from "./media-manifest";
import { ProjectStore } from "./project-store";
import { executeSaveTransaction, SaveTransactionError } from "./save-transaction";
import { ensureSafeTestProjectRoot } from "./test-project-root";

const execFileAsync = promisify(execFile);

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

function project(mediaCount: number, clipCount: number, trackCount: number): Project {
  const tracks = Array.from({ length: trackCount }, (_, trackIndex) => ({
    id: `track-${trackIndex}`,
    type: "video" as const,
    name: `Track ${trackIndex}`,
    clips: Array.from({ length: trackIndex === 0 ? clipCount : 0 }, (_, clipIndex) => ({
      id: `clip-${clipIndex}`,
      type: "video" as const,
      mediaId: `media-${clipIndex % Math.max(mediaCount, 1)}`,
      trackId: `track-${trackIndex}`,
      startTime: clipIndex,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      effects: [],
      audioEffects: [],
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
      volume: 1,
      keyframes: [],
    })),
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  }));
  return {
    id: "destructive-test",
    name: "Destructive test",
    createdAt: 1,
    modifiedAt: 2,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
    mediaLibrary: {
      items: Array.from({ length: mediaCount }, (_, index) => ({
        id: `media-${index}`,
        name: `media-${index}.mp4`,
        type: "video" as const,
        fileHandle: null,
        blob: null,
        thumbnailUrl: null,
        metadata: { duration: 1, width: 1, height: 1, frameRate: 30, codec: "h264", sampleRate: 48_000, channels: 2, fileSize: 1 },
      })),
    },
    timeline: { tracks, subtitles: [], duration: clipCount, markers: [] },
  };
}

test("computes deterministic media, clip, track, and serialized structural metrics", () => {
  const current = project(7, 6, 3);
  const proposed = project(5, 2, 1);
  const first = assessDestructiveChange(current, proposed);
  const second = assessDestructiveChange(structuredClone(current), structuredClone(proposed));
  assert.deepEqual(first, second);
  assert.equal(first.current.mediaCount, 7);
  assert.equal(first.current.clipCount, 6);
  assert.equal(first.current.trackCount, 3);
  assert.equal(first.deltas.mediaCountDelta, -2);
  assert.equal(first.deltas.clipCountDelta, -4);
  assert.equal(first.deltas.trackCountDelta, -2);
  assert.equal(first.deltas.serializedStructuralSizeDelta, first.proposed.serializedStructuralSize - first.current.serializedStructuralSize);
});

test("protects only after each named destructive threshold is crossed", () => {
  const at = (overrides: Partial<StructuralMetricDeltas>): StructuralMetricDeltas => ({
    mediaCountDelta: 0,
    clipCountDelta: 0,
    trackCountDelta: 0,
    serializedStructuralSizeDelta: 0,
    ...overrides,
  });
  for (const [threshold, key] of [
    [MAX_UNCONFIRMED_MEDIA_COUNT_DROP, "mediaCountDelta"],
    [MAX_UNCONFIRMED_CLIP_COUNT_DROP, "clipCountDelta"],
    [MAX_UNCONFIRMED_TRACK_COUNT_DROP, "trackCountDelta"],
    [MAX_UNCONFIRMED_SERIALIZED_STRUCTURAL_SIZE_DROP, "serializedStructuralSizeDelta"],
  ] as const) {
    assert.equal(authorizeDestructiveChange({ protected: false, deltas: at({ [key]: -threshold }) }, {}), true, `${key} boundary`);
    assert.equal(authorizeDestructiveChange({ protected: true, deltas: at({ [key]: -(threshold + 1) }) }, {}), false, `${key} beyond boundary`);
  }
});

test("requires explicit intent and never infers it from autosave, retry, recovery, or test metadata", () => {
  const assessment = { protected: true, deltas: { mediaCountDelta: -10, clipCountDelta: 0, trackCountDelta: 0, serializedStructuralSizeDelta: 0 } };
  assert.equal(authorizeDestructiveChange(assessment, { saveIntent: "user", destructiveIntent: true }), true);
  assert.equal(authorizeDestructiveChange(assessment, { destructiveIntent: true }), false);
  for (const saveIntent of ["autosave", "retry", "recovery"] as const) {
    assert.equal(authorizeDestructiveChange(assessment, { saveIntent, destructiveIntent: true }), false);
  }
  assert.equal(authorizeDestructiveChange(assessment, { saveIntent: "user", test: true } as never), false);
});

test("allows a server transaction only when every removal and dependent clip reference is enumerated", () => {
  const assessment = assessDestructiveChange(project(8, 6, 2), project(1, 0, 1));
  assert.equal(assessment.protected, true);
  const manifest = assessment.removals;
  assert.equal(authorizeDestructiveChange(assessment, { serverRemovalManifest: manifest }), true);
  assert.equal(authorizeDestructiveChange(assessment, {
    serverRemovalManifest: { ...manifest, removedMediaIds: manifest.removedMediaIds.slice(1) },
  }), false);
  assert.equal(authorizeDestructiveChange(assessment, {
    serverRemovalManifest: { ...manifest, dependentClipReferences: manifest.dependentClipReferences.slice(1) },
  }), false);
});

test("rejects the incident-shaped 28-media/13-clip autosave with 409 and no mutation", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openreel-destructive-change-"));
  const repoDir = await mkdtemp(join(fixtureRoot, "repo-"));
  try {
    await ensureSafeTestProjectRoot(repoDir, { assignedTempRoot: fixtureRoot, userProjectsRoot: config.projectsRepo });
    const gitStore = new GitStore(repoDir);
    const store = new ProjectStore(gitStore);
    const created = await store.createProject("Incident full project");
    const full = { ...project(28, 13, 5), id: created.id, name: created.name, createdAt: created.createdAt, modifiedAt: created.modifiedAt };
    const projectPath = join(store.projectDir(created.id), "project.json");
    await writeFile(projectPath, JSON.stringify(full, null, 2));
    const receipt = await gitStore.commit(created.id, "test: establish incident snapshot", {
      allowlist: ["project.json"], expectedEntries: [{ status: "A", path: "project.json" }],
    });
    assert.ok(receipt.commitSha && receipt.treeSha && receipt.projectBlobSha);
    const before = {
      bytes: await readFile(projectPath),
      head: (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: store.projectDir(created.id) })).stdout.trim(),
      status: (await execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: store.projectDir(created.id) })).stdout,
      index: await store.listProjects(),
    };
    const testShaped = { ...project(0, 0, 1), id: created.id, name: "test", createdAt: full.createdAt, modifiedAt: full.modifiedAt + 1 };
    const request: ProjectSaveRequest = {
      projectId: created.id,
      baseRevision: { commitSha: receipt.commitSha, treeSha: receipt.treeSha, projectBlobSha: receipt.projectBlobSha, sourceModifiedAt: full.modifiedAt },
      project: testShaped,
      saveIntent: "autosave",
      requiredMediaManifest: buildRequiredMediaManifest(testShaped),
    };
    await assert.rejects(executeSaveTransaction(store, gitStore, request), (error: unknown) => {
      assert.ok(error instanceof SaveTransactionError);
      assert.equal(error.status, 409);
      assert.equal(error.body.code, "DESTRUCTIVE_CHANGE_REQUIRES_INTENT");
      if (error.body.code === "DESTRUCTIVE_CHANGE_REQUIRES_INTENT") {
        assert.equal(error.body.mediaCountDelta, -28);
        assert.equal(error.body.clipCountDelta, -13);
        assert.equal(error.body.trackCountDelta, -4);
        assert.ok(error.body.serializedStructuralSizeDelta < 0);
      }
      return true;
    });
    assert.deepEqual(await readFile(projectPath), before.bytes);
    assert.equal((await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: store.projectDir(created.id) })).stdout.trim(), before.head);
    assert.equal((await execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: store.projectDir(created.id) })).stdout, before.status);
    assert.deepEqual(await store.listProjects(), before.index);

    const accepted = await executeSaveTransaction(store, gitStore, {
      ...request,
      saveIntent: "user",
      destructiveIntent: true,
    });
    assert.equal(accepted.saved, true);
    assert.deepEqual(JSON.parse((await readFile(projectPath)).toString("utf8")), testShaped);
    const acceptedBytes = await readFile(projectPath);
    const acceptedHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: store.projectDir(created.id) })).stdout.trim();
    await assert.rejects(executeSaveTransaction(store, gitStore, {
      ...request,
      saveIntent: "user",
      destructiveIntent: true,
    }), (error: unknown) => {
      assert.ok(error instanceof SaveTransactionError);
      assert.equal(error.body.code, "PROJECT_CONFLICT");
      return true;
    });
    assert.deepEqual(await readFile(projectPath), acceptedBytes);
    assert.equal((await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: store.projectDir(created.id) })).stdout.trim(), acceptedHead);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
