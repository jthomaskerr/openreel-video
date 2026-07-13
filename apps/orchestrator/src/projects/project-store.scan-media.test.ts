import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Project } from "@openreel/core";
import type { GitStore } from "./git-store";
import { ProjectStore } from "./project-store";

test("scanMedia maps semantic filenames back to stable media ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-scan-media-"));
  const projectDir = join(root, "semantic-media");
  try {
    await mkdir(join(projectDir, "media"), { recursive: true });
    await writeFile(join(projectDir, "media", "j gets out.mp4"), "video");
    await writeFile(join(projectDir, "media", "unreferenced.mp4"), "other");
    const store = new ProjectStore({ worktreePath: () => projectDir } as unknown as GitStore);
    const project = {
      id: "semantic-media",
      mediaLibrary: {
        items: [{ id: "3494b97c-2324-442e-a8a0-9d1756dadd99", name: "j gets out.mp4" }],
      },
    } as Project;

    assert.deepEqual(await store.scanMedia(project), {
      "3494b97c-2324-442e-a8a0-9d1756dadd99": "j gets out.mp4",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
