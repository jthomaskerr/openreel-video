import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { Clip, MediaItem, Project } from "@openreel/core";
import { ProjectStore } from "./project-store";
import { GitStore } from "./git-store";
import {
  ProjectMediaManifestAuditError,
  type ProjectMediaManifestSnapshot,
} from "./media-manifest";

function makeMediaItem(
  id: string,
  name: string,
  fileSize: number,
  type: MediaItem["type"] = "video",
): MediaItem {
  return {
    id,
    name,
    type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize,
    },
    thumbnailUrl: null,
  };
}

function makeClip(
  id: string,
  mediaId: string,
  trackId: string,
  type: Clip["type"] = "video",
): Clip {
  return {
    id,
    type,
    mediaId,
    trackId,
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0, y: 0 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}

function makeProject(
  id: string,
  items: MediaItem[],
  clips: Clip[],
): Project {
  return {
    id,
    name: "Audit Fixture",
    createdAt: 1,
    modifiedAt: 2,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items },
    generatedImageDefinitions: [],
    timeline: {
      tracks: [
        {
          id: "track-1",
          type: "video",
          name: "Track 1",
          clips,
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      markers: [],
      duration: 1,
    },
  };
}

async function makeProjectStore() {
  const repoDir = await mkdtemp(join(tmpdir(), "openreel-media-manifest-"));
  const gitStore = new GitStore(repoDir);
  await gitStore.ensureSharedRepo();
  const store = new ProjectStore(gitStore);
  return { repoDir, gitStore, store };
}

function gitHead(repoDir: string): string {
  return execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function gitStatus(repoDir: string): string {
  return execFileSync("git", ["-C", repoDir, "status", "--porcelain=v1"], {
    encoding: "utf8",
  });
}

async function writeMediaFile(
  mediaDir: string,
  filename: string,
  byteSize: number,
): Promise<void> {
  await mkdir(mediaDir, { recursive: true });
  await writeFile(join(mediaDir, filename), Buffer.alloc(byteSize, 7));
}

async function captureSnapshot(
  store: ProjectStore,
  repoDir: string,
  projectId: string,
): Promise<{ bytes: string; status: string; head: string }> {
  return {
    bytes: readFileSync(join(store.projectDir(projectId), "project.json"), "utf8"),
    status: gitStatus(repoDir),
    head: gitHead(repoDir),
  };
}

function expectAuditError(
  promise: Promise<ProjectMediaManifestSnapshot>,
): Promise<ProjectMediaManifestAuditError> {
  return promise.then(
    () => {
      throw new assert.AssertionError({
        message: "Expected audit to fail",
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ProjectMediaManifestAuditError);
      return error;
    },
  );
}

test("auditSnapshot accepts a complete project and ignores virtual media ids", async () => {
  const { store } = await makeProjectStore();
  const project = makeProject(
    "audit-complete",
    [
      makeMediaItem("media-1", "media-1.mp4", 4),
      makeMediaItem("media-2", "media-2.mp4", 6),
    ],
    [
      makeClip("clip-1", "media-1", "track-1"),
      makeClip("clip-2", "text-1", "track-1", "text"),
    ],
  );

  await store.saveProject(project);
  await writeMediaFile(store.mediaDir(project.id), "media-1.mp4", 4);
  await writeMediaFile(store.mediaDir(project.id), "media-2.mp4", 6);

  const snapshot = await store.auditSnapshot(project, { verifyLfs: false });

  assert.equal(snapshot.missingEntries.length, 0);
  assert.equal(snapshot.duplicateIssues.length, 0);
  assert.equal(snapshot.filenameMismatches.length, 0);
  assert.equal(snapshot.byteSizeMismatches.length, 0);
  assert.equal(snapshot.danglingClips.length, 0);
  assert.equal(snapshot.mediaManifestDigest?.length, 64);
});

test("auditSnapshot reports an absent original without mutating project state", async () => {
  const { repoDir, store } = await makeProjectStore();
  const project = makeProject(
    "audit-missing-original",
    [makeMediaItem("media-1", "media-1.mp4", 4)],
    [makeClip("clip-1", "media-1", "track-1")],
  );

  await store.saveProject(project);
  const before = await captureSnapshot(store, repoDir, project.id);

  const error = await expectAuditError(store.auditSnapshot(project, { verifyLfs: false }));

  assert.equal(error.snapshot.missingEntries.length, 1);
  assert.deepEqual(error.snapshot.missingEntries[0], {
    mediaId: "media-1",
    semanticFilename: "media-1.mp4",
    relativePhysicalPath: "media/media-1.mp4",
    expectedByteSize: 4,
    actualFilename: null,
  });

  const after = await captureSnapshot(store, repoDir, project.id);
  assert.equal(after.bytes, before.bytes);
  assert.equal(after.status, before.status);
  assert.equal(after.head, before.head);
});

test("auditSnapshot reports duplicate physical paths", async () => {
  const { store } = await makeProjectStore();
  const project = makeProject(
    "audit-duplicate-path",
    [
      makeMediaItem("media-1", "shared.mp4", 4),
      makeMediaItem("media-2", "shared.mp4", 4),
    ],
    [makeClip("clip-1", "media-1", "track-1")],
  );

  await store.saveProject(project);
  const error = await expectAuditError(store.auditSnapshot(project, { verifyLfs: false }));

  assert.equal(error.snapshot.duplicateIssues.length, 1);
  assert.deepEqual(error.snapshot.duplicateIssues[0], {
    field: "relativePhysicalPath",
    value: "media/shared.mp4",
    mediaIds: ["media-1", "media-2"],
    semanticFilenames: ["shared.mp4", "shared.mp4"],
  });
});

test("auditSnapshot reports filename and project-field mismatches", async () => {
  const { store } = await makeProjectStore();
  const project = makeProject(
    "audit-filename-mismatch",
    [makeMediaItem("media-1", "project-name.mp4", 4)],
    [makeClip("clip-1", "media-1", "track-1")],
  );

  await store.saveProject(project);
  await writeMediaFile(store.mediaDir(project.id), "media-1.mp4", 4);

  const error = await expectAuditError(store.auditSnapshot(project, { verifyLfs: false }));

  assert.equal(error.snapshot.filenameMismatches.length, 1);
  assert.deepEqual(error.snapshot.filenameMismatches[0], {
    mediaId: "media-1",
    semanticFilename: "project-name.mp4",
    actualFilename: "media-1.mp4",
    relativePhysicalPath: "media/media-1.mp4",
  });
});

test("auditSnapshot reports wrong byte size for an existing original", async () => {
  const { store } = await makeProjectStore();
  const project = makeProject(
    "audit-byte-size",
    [makeMediaItem("media-1", "media-1.mp4", 8)],
    [makeClip("clip-1", "media-1", "track-1")],
  );

  await store.saveProject(project);
  await writeMediaFile(store.mediaDir(project.id), "media-1.mp4", 4);

  const error = await expectAuditError(store.auditSnapshot(project, { verifyLfs: false }));

  assert.equal(error.snapshot.byteSizeMismatches.length, 1);
  assert.deepEqual(error.snapshot.byteSizeMismatches[0], {
    mediaId: "media-1",
    semanticFilename: "media-1.mp4",
    relativePhysicalPath: "media/media-1.mp4",
    expectedByteSize: 8,
    actualByteSize: 4,
  });
});

test("auditSnapshot reports dangling clips separately from file scan misses", async () => {
  const { store } = await makeProjectStore();
  const project = makeProject(
    "audit-dangling-clip",
    [makeMediaItem("media-1", "media-1.mp4", 4)],
    [makeClip("clip-1", "missing-media", "track-1")],
  );

  await store.saveProject(project);
  await writeMediaFile(store.mediaDir(project.id), "media-1.mp4", 4);

  const error = await expectAuditError(store.auditSnapshot(project, { verifyLfs: false }));

  assert.equal(error.snapshot.missingEntries.length, 0);
  assert.equal(error.snapshot.danglingClips.length, 1);
  assert.deepEqual(error.snapshot.danglingClips[0], {
    clipId: "clip-1",
    mediaId: "missing-media",
    trackId: "track-1",
    clipType: "video",
  });
});

test("load-only audit can report a dangling clip without rejecting the confirmed snapshot", async () => {
  const { store } = await makeProjectStore();
  const project = makeProject(
    "audit-load-dangling-clip",
    [makeMediaItem("media-1", "media-1.mp4", 4)],
    [makeClip("clip-1", "missing-media", "track-1")],
  );

  await store.saveProject(project);
  await writeMediaFile(store.mediaDir(project.id), "media-1.mp4", 4);

  const snapshot = await store.auditSnapshot(project, {
    verifyLfs: false,
    allowDanglingClips: true,
  });

  assert.equal(snapshot.missingEntries.length, 0);
  assert.equal(snapshot.danglingClips.length, 1);
  assert.equal(snapshot.danglingClips[0]?.mediaId, "missing-media");
});

test("auditSnapshot digest is stable regardless of media-library input order", async () => {
  const { store } = await makeProjectStore();
  const clips = [makeClip("clip-1", "media-1", "track-1")];
  const projectA = makeProject(
    "audit-stable-digest",
    [
      makeMediaItem("media-1", "media-1.mp4", 4),
      makeMediaItem("media-2", "media-2.mp4", 6),
    ],
    clips,
  );
  const projectB = makeProject(
    "audit-stable-digest",
    [
      makeMediaItem("media-2", "media-2.mp4", 6),
      makeMediaItem("media-1", "media-1.mp4", 4),
    ],
    clips,
  );

  await store.saveProject(projectA);
  await writeMediaFile(store.mediaDir(projectA.id), "media-1.mp4", 4);
  await writeMediaFile(store.mediaDir(projectA.id), "media-2.mp4", 6);

  const snapshotA = await store.auditSnapshot(projectA, { verifyLfs: false });
  const snapshotB = await store.auditSnapshot(projectB, { verifyLfs: false });

  assert.equal(snapshotA.mediaManifestDigest, snapshotB.mediaManifestDigest);
  assert.deepEqual(
    snapshotA.requiredMediaManifest.map((entry) => entry.mediaId),
    ["media-1", "media-2"],
  );
});

test("ProjectStore audit includes verified LFS evidence without changing the canonical digest", async () => {
  const { repoDir, gitStore, store } = await makeProjectStore();
  try {
    const project = await store.createProject("LFS Evidence");
    const payload = Buffer.from("archived-video-payload");
    project.mediaLibrary.items.push(makeMediaItem("media-1", "media-1.mp4", payload.length));
    await writeFile(join(store.mediaDir(project.id), "media-1.mp4"), payload);
    await store.saveProject(project);
    await gitStore.commit(project.id, "test: archive media", {
      allowlist: ["project.json", "media/media-1.mp4"],
      expectedEntries: [
        { status: "A", path: "media/media-1.mp4" },
        { status: "A", path: "project.json" },
      ],
    });

    const semanticOnly = await store.auditSnapshot(project, { verifyLfs: false });
    const audited = await store.auditSnapshot(project);

    assert.equal(audited.mediaManifestDigest, semanticOnly.mediaManifestDigest);
    assert.equal(audited.lfsPayloads.length, 1);
    assert.equal(audited.lfsPayloads[0]?.mediaId, "media-1");
    assert.equal(audited.lfsPayloads[0]?.semanticFilename, "media-1.mp4");
    assert.match(audited.lfsPayloads[0]?.oid ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(audited.lfsPayloads[0]?.local, {
      state: "verified",
      actualSize: payload.length,
    });
    assert.deepEqual(audited.lfsPayloads[0]?.remote, {
      state: "local-only",
      remote: null,
    });

    await writeFile(join(repoDir, "config.json"), JSON.stringify({ remote: "configured" }));
    const durable = await store.auditSnapshot(project, {
      checkRemoteObject: async () => "durable",
    });
    assert.equal(durable.mediaManifestDigest, semanticOnly.mediaManifestDigest);
    assert.deepEqual(durable.lfsPayloads[0]?.remote, {
      state: "durable",
      remote: "origin",
    });

    const uploadRequired = await expectAuditError(
      store.auditSnapshot(project, {
        checkRemoteObject: async () => "upload-required",
      }),
    );
    assert.deepEqual(uploadRequired.snapshot.lfsPayloads[0]?.remote, {
      state: "upload-required",
      remote: "origin",
    });
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});
