import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { UploadRepository } from "./uploads.js";

test("rejects empty upload bodies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-upload-"));
  const repo = new UploadRepository(dir);

  await assert.rejects(
    repo.create({
      ownerId: "user-1",
      projectId: "project-1",
      mimeType: "image/png",
      bytes: new Uint8Array(),
    }),
    /upload-empty/,
  );
});
