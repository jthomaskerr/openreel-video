import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@openreel/core";
import type { GitStore } from "./git-store";
import { ProjectStore } from "./project-store";

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
