import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanupExpiredPendingMedia,
  pendingMediaRoot,
  pendingUploadTempDirectory,
  readPendingMedia,
  storePendingUpload,
} from "./pending-media";

test("duplicate pending ids preserve the validated original and stale partials are cleanable", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "openreel-pending-media-"));
  try {
    const firstTemp = join(projectDir, "first.tmp");
    await writeFile(firstTemp, "first-media");
    await storePendingUpload(projectDir, "media-1", firstTemp, "First.mp4", "video/mp4", 11);

    const replacementTemp = join(projectDir, "replacement.tmp");
    await writeFile(replacementTemp, "replacement-media");
    await assert.rejects(
      storePendingUpload(projectDir, "media-1", replacementTemp, "Replacement.mp4", "video/mp4", 17),
      /already exists/,
    );
    const original = await readPendingMedia(projectDir, "media-1");
    assert.ok(original);
    assert.equal(await readFile(original.contentPath, "utf8"), "first-media");
    assert.equal(original.originalFilename, "First.mp4");

    const staleReplacement = join(pendingMediaRoot(projectDir), ".replacement-media-2-abandoned");
    const legacyReplacement = join(pendingMediaRoot(projectDir), "media-3.01234567-89ab-cdef-0123-456789abcdef.replacement");
    const uploading = pendingUploadTempDirectory(projectDir);
    const staleUpload = join(uploading, "media-2-abandoned.upload");
    await mkdir(staleReplacement, { recursive: true });
    await writeFile(join(staleReplacement, "content"), "partial");
    await mkdir(legacyReplacement, { recursive: true });
    await writeFile(join(legacyReplacement, "content"), "legacy-partial");
    await mkdir(uploading, { recursive: true });
    await writeFile(staleUpload, "partial");
    const old = new Date(1_000);
    await utimes(staleReplacement, old, old);
    await utimes(legacyReplacement, old, old);
    await utimes(staleUpload, old, old);

    await cleanupExpiredPendingMedia(projectDir, 10_000, 1_000);
    await assert.rejects(readFile(join(staleReplacement, "content")), { code: "ENOENT" });
    await assert.rejects(readFile(join(legacyReplacement, "content")), { code: "ENOENT" });
    await assert.rejects(readFile(staleUpload), { code: "ENOENT" });
    assert.equal(await readFile(original.contentPath, "utf8"), "first-media");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
