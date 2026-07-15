import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidMediaFilename,
  isValidMediaId,
  isValidProjectId,
  resolveContainedPath,
} from "./storage-validation";

test("validates safe project ids", () => {
  assert.equal(isValidProjectId("my-project"), true);
  assert.equal(isValidProjectId("a74ae794-eb05-4989-9ac0-d166e1e38ae6"), true);
});

test("rejects project id traversal and path separators", () => {
  for (const value of ["", "../outside", "x/y", "x\\y", "..%2foutside", "project..old"]) {
    assert.equal(isValidProjectId(value), false, value);
  }
});

test("validates safe media ids", () => {
  assert.equal(isValidMediaId("media-1"), true);
  assert.equal(isValidMediaId("generated_media_1"), true);
  assert.equal(isValidMediaId("a74ae794-eb05-4989-9ac0-d166e1e38ae6"), true);
});

test("rejects media id traversal and path separators", () => {
  for (const value of ["", "../media", "media/1", "media\\1", "media..1", "media%2f1"]) {
    assert.equal(isValidMediaId(value), false, value);
  }
});

test("validates served media filenames", () => {
  assert.equal(isValidMediaFilename("media-1.mp4"), true);
  assert.equal(isValidMediaFilename("generated_media_1.wav"), true);
  assert.equal(isValidMediaFilename("a74ae794-eb05-4989-9ac0-d166e1e38ae6.mov"), true);
});

test("rejects media filename traversal and path separators", () => {
  for (const value of ["", "../media.mp4", "media/1.mp4", "media\\1.mp4", "media..1.mp4", "media%2f1.mp4", `${"x".repeat(252)}.mp4`]) {
    assert.equal(isValidMediaFilename(value), false, value);
  }
});

test("resolves child paths inside the base directory only", () => {
  const base = mkdtempSync(join(tmpdir(), "openreel-storage-validation-"));
  assert.equal(resolveContainedPath(base, "media-1.mp4"), join(base, "media-1.mp4"));
  assert.throws(() => resolveContainedPath(base, "../outside.mp4"), /escapes base/);
});
