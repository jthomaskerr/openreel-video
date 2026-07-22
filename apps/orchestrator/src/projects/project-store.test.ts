import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@openreel/core";
import type { GitStore } from "./git-store";
import { ProjectStore, ProjectSummaryLoadError } from "./project-store";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function projectWithMedia(overrides: Record<string, unknown> = {}): Project {
  return {
    id: "vintage-tokyo",
    name: "Vintage Tokyo",
    createdAt: 1,
    modifiedAt: 2,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: {
      items: [{
        id: "media-1",
        name: "interview.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        thumbnailUrl: null,
        externallyReferenced: true,
        title: "Original",
        metadata: {
          duration: 1,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 0,
          channels: 0,
          fileSize: 42,
        },
        ...overrides,
      }],
    },
    generatedImageDefinitions: [],
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  } as unknown as Project;
}

async function withStore(run: (store: ProjectStore) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openreel-external-media-"));
  const projectDir = join(root, "vintage-tokyo");
  await mkdir(projectDir, { recursive: true });
  const gitStore = {
    worktreePath: () => projectDir,
    ensureWorktree: async () => undefined,
    deleteWorktree: async () => undefined,
    withProjectTransaction: async (_projectId: string, operation: (transaction: unknown) => Promise<unknown>) =>
      operation({}),
  } as unknown as GitStore;

  try {
    await run(new ProjectStore(gitStore));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("project summaries expose picker metadata from persisted projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-project-summary-"));
  const project = {
    ...projectWithMedia(),
    description: "A summer edit",
    timeline: {
      duration: 3,
      markers: [],
      subtitles: [{ id: "subtitle-1", text: "Tokyo", startTime: 1, endTime: 2 }],
      tracks: [{
        id: "video-track",
        name: "Video",
        type: "video",
        clips: [{ id: "clip-1" }, { id: "clip-2" }],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      }],
    },
  } as unknown as Project;
  await mkdir(join(root, project.id), { recursive: true });
  await writeFile(join(root, project.id, "project.json"), JSON.stringify(project));
  const gitStore = {
    repoDir: root,
    ensureSharedRepo: async () => undefined,
    worktreePath: (id: string) => join(root, id),
    withProjectTransaction: async (_projectId: string, operation: (transaction: unknown) => Promise<unknown>) =>
      operation({}),
  } as unknown as GitStore;

  try {
    const summaries = await new ProjectStore(gitStore).listProjects();

    assert.deepEqual(summaries, [{
      id: "vintage-tokyo",
      name: "Vintage Tokyo",
      description: "A summer edit",
      createdAt: 1,
      modifiedAt: 2,
      duration: 3,
      frameRate: 30,
      trackCount: 1,
      clipCount: 3,
      representativeMediaId: "media-1",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project summaries normalize a compatible legacy project shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-legacy-project-summary-"));
  const project = projectWithMedia();
  const legacy = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  delete legacy.description;
  delete (legacy.timeline as Record<string, unknown>).subtitles;
  await mkdir(join(root, project.id), { recursive: true });
  await writeFile(join(root, project.id, "project.json"), JSON.stringify(legacy));
  const gitStore = {
    repoDir: root,
    ensureSharedRepo: async () => undefined,
    worktreePath: (id: string) => join(root, id),
    withProjectTransaction: async (_projectId: string, operation: (transaction: unknown) => Promise<unknown>) => operation({}),
  } as unknown as GitStore;

  try {
    const [summary] = await new ProjectStore(gitStore).listProjects();

    assert.equal(summary!.description, "");
    assert.equal(summary!.duration, 0);
    assert.equal(summary!.clipCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project summaries surface malformed persisted projects with their project ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-malformed-project-summary-"));
  await mkdir(join(root, "vintage-tokyo"), { recursive: true });
  await writeFile(join(root, "vintage-tokyo", "project.json"), "{not-json");
  const gitStore = {
    repoDir: root,
    ensureSharedRepo: async () => undefined,
    worktreePath: (id: string) => join(root, id),
    withProjectTransaction: async (_projectId: string, operation: (transaction: unknown) => Promise<unknown>) => operation({}),
  } as unknown as GitStore;

  try {
    await assert.rejects(new ProjectStore(gitStore).listProjects(), (error: unknown) => {
      assert.ok(error instanceof ProjectSummaryLoadError);
      assert.equal(error.code, "PROJECT_SUMMARY_UNAVAILABLE");
      assert.equal(error.projectId, "vintage-tokyo");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backend rejects a saved project that omits externally referenced media", async () => {
  await withStore(async (store) => {
    const original = projectWithMedia();
    await store.saveProject(original);
    const withoutMedia = {
      ...original,
      mediaLibrary: { ...original.mediaLibrary, items: [] },
    };

    await assert.rejects(
      store.saveProject(withoutMedia),
      { code: "EXTERNAL_MEDIA_DELETE_BLOCKED", mediaId: "media-1" },
    );
  });
});

test("backend permits metadata and binary metadata updates to externally referenced media", async () => {
  await withStore(async (store) => {
    const original = projectWithMedia();
    await store.saveProject(original);
    const updated = projectWithMedia({
      title: "Updated",
      metadata: { ...original.mediaLibrary.items[0]!.metadata, fileSize: 84 },
    });

    const saved = await store.saveProject(updated);

    assert.equal(saved.mediaLibrary.items[0]!.title, "Updated");
    assert.equal(saved.mediaLibrary.items[0]!.metadata.fileSize, 84);
    assert.equal(saved.mediaLibrary.items[0]!.name, "interview.mp4");
  });
});

test("backend keeps the external-reference marker sticky", async () => {
  await withStore(async (store) => {
    const original = projectWithMedia();
    await store.saveProject(original);

    await assert.rejects(
      store.saveProject(projectWithMedia({ externallyReferenced: false })),
      { code: "EXTERNAL_MEDIA_DELETE_BLOCKED", mediaId: "media-1" },
    );
  });
});

test("backend rejects changing the canonical path of externally referenced media", async () => {
  await withStore(async (store) => {
    const original = projectWithMedia();
    await store.saveProject(original);

    await assert.rejects(
      store.saveProject(projectWithMedia({ name: "renamed.mp4" })),
      { code: "EXTERNAL_MEDIA_DELETE_BLOCKED", mediaId: "media-1" },
    );
  });
});

test("concurrent stale deletion rechecks external references inside the project lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-external-media-race-"));
  const projectDir = join(root, "vintage-tokyo");
  await mkdir(projectDir, { recursive: true });

  const firstEntered = deferred();
  const resumeFirst = deferred();
  const secondQueued = deferred();
  let transactionCalls = 0;
  let transactionTail = Promise.resolve();
  const gitStore = {
    worktreePath: () => projectDir,
    ensureWorktree: async () => undefined,
    deleteWorktree: async () => undefined,
    withProjectTransaction: async (
      _projectId: string,
      operation: (transaction: unknown) => Promise<unknown>,
    ) => {
      const call = ++transactionCalls;
      if (call === 2) secondQueued.resolve();
      const predecessor = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((complete) => {
        release = complete;
      });
      await predecessor;
      if (call === 1) {
        firstEntered.resolve();
        await resumeFirst.promise;
      }
      try {
        return await operation({});
      } finally {
        release();
      }
    },
  } as unknown as GitStore;

  try {
    const original = projectWithMedia({ externallyReferenced: false });
    await writeFile(join(projectDir, "project.json"), JSON.stringify(original, null, 2));
    const store = new ProjectStore(gitStore);
    const protectedByA = projectWithMedia({ externallyReferenced: true, title: "Protected by A" });
    const staleDeletionByB = {
      ...original,
      mediaLibrary: { ...original.mediaLibrary, items: [] },
    };

    const saveA = store.saveProject(protectedByA);
    await firstEntered.promise;
    const saveB = store.saveProject(staleDeletionByB);
    await secondQueued.promise;
    resumeFirst.resolve();

    const [resultA, resultB] = await Promise.allSettled([saveA, saveB]);

    assert.equal(resultA.status, "fulfilled");
    assert.equal(resultB.status, "rejected");
    if (resultB.status === "rejected") {
      assert.equal(resultB.reason.code, "EXTERNAL_MEDIA_DELETE_BLOCKED");
      assert.equal(resultB.reason.mediaId, "media-1");
    }
    const persisted = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8")) as Project;
    assert.equal(persisted.mediaLibrary.items[0]!.id, "media-1");
    assert.equal(persisted.mediaLibrary.items[0]!.externallyReferenced, true);
    assert.equal(persisted.mediaLibrary.items[0]!.title, "Protected by A");
  } finally {
    resumeFirst.resolve();
    await rm(root, { recursive: true, force: true });
  }
});
