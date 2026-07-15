import assert from "node:assert/strict";
import test from "node:test";
import { isValidMediaFilename } from "./storage-validation";
import {
  allocateMediaFilename,
  sanitizeProjectFilename,
  type MediaFilenamePolicy,
} from "./media-filename";

const NFC_CASE_SENSITIVE: MediaFilenamePolicy = {
  caseSensitive: true,
  unicodeNormalization: "NFC",
};

const NFC_CASE_INSENSITIVE: MediaFilenamePolicy = {
  caseSensitive: false,
  unicodeNormalization: "NFC",
};

function expectSanitized(
  desired: string,
  policy: MediaFilenamePolicy,
  expectedPersistedBasename: string,
  expectedComparisonKey = expectedPersistedBasename,
): void {
  const actual = sanitizeProjectFilename(desired, policy);
  assert.deepEqual(actual, {
    persistedBasename: expectedPersistedBasename,
    comparisonKey: expectedComparisonKey,
  });
  assert.equal(isValidMediaFilename(actual.persistedBasename), true);
}

function expectAllocation(
  desired: string,
  occupied: Iterable<string>,
  policy: MediaFilenamePolicy,
  expectedPersistedBasename: string,
  expectedComparisonKey = expectedPersistedBasename,
): void {
  const actual = allocateMediaFilename(desired, occupied, policy);
  assert.deepEqual(actual, {
    persistedBasename: expectedPersistedBasename,
    comparisonKey: expectedComparisonKey,
  });
  assert.equal(isValidMediaFilename(actual.persistedBasename), true);
}

test("sanitizes semantic filenames and strips separators or traversal forms", () => {
  const cases: Array<{
    desired: string;
    expectedPersistedBasename: string;
  }> = [
    { desired: "clip.mp4", expectedPersistedBasename: "clip.mp4" },
    { desired: "clip 1.mp4", expectedPersistedBasename: "clip 1.mp4" },
    { desired: "archive.tar.gz", expectedPersistedBasename: "archive.tar.gz" },
    { desired: "clip", expectedPersistedBasename: "clip" },
    { desired: ".clip.mp4", expectedPersistedBasename: "clip.mp4" },
    { desired: ".profile", expectedPersistedBasename: "profile" },
    { desired: "../clip.mp4", expectedPersistedBasename: "clip.mp4" },
    { desired: "nested/path/clip.mp4", expectedPersistedBasename: "clip.mp4" },
    { desired: "nested\\path\\clip.mp4", expectedPersistedBasename: "clip.mp4" },
    { desired: ".", expectedPersistedBasename: "untitled" },
    { desired: "..", expectedPersistedBasename: "untitled" },
    { desired: "../../..", expectedPersistedBasename: "untitled" },
    { desired: "clip.", expectedPersistedBasename: "clip" },
    { desired: "clip..", expectedPersistedBasename: "clip" },
  ];

  for (const testCase of cases) {
    expectSanitized(testCase.desired, NFC_CASE_SENSITIVE, testCase.expectedPersistedBasename);
  }
});

test("allocates the lowest free suffix without overwriting occupied entries", () => {
  const cases: Array<{
    desired: string;
    occupied: string[];
    expectedPersistedBasename: string;
  }> = [
    {
      desired: "clip.mp4",
      occupied: [],
      expectedPersistedBasename: "clip.mp4",
    },
    {
      desired: "clip 1.mp4",
      occupied: [],
      expectedPersistedBasename: "clip 1.mp4",
    },
    {
      desired: "clip.mp4",
      occupied: ["clip.mp4", "clip 2.mp4"],
      expectedPersistedBasename: "clip 1.mp4",
    },
    {
      desired: "clip.mp4",
      occupied: ["clip.mp4", "clip 1.mp4", "clip 3.mp4"],
      expectedPersistedBasename: "clip 2.mp4",
    },
    {
      desired: "archive.tar.gz",
      occupied: ["archive.tar.gz"],
      expectedPersistedBasename: "archive.tar 1.gz",
    },
    {
      desired: "clip",
      occupied: ["clip", "clip 1"],
      expectedPersistedBasename: "clip 2",
    },
    {
      desired: "clip 1.mp4",
      occupied: ["clip 1.mp4", "clip 2.mp4"],
      expectedPersistedBasename: "clip 3.mp4",
    },
    {
      desired: "archive.tar 1.gz",
      occupied: ["archive.tar 1.gz"],
      expectedPersistedBasename: "archive.tar 2.gz",
    },
  ];

  for (const testCase of cases) {
    expectAllocation(
      testCase.desired,
      testCase.occupied,
      NFC_CASE_SENSITIVE,
      testCase.expectedPersistedBasename,
    );
  }
});

test("treats Unicode normalization equivalents as occupied on the chosen persisted form", () => {
  const desired = "cafe\u0301.mp4";
  const occupied = ["café.mp4"];
  expectAllocation(desired, occupied, NFC_CASE_SENSITIVE, "café 1.mp4");
  expectSanitized(desired, NFC_CASE_SENSITIVE, "café.mp4");
});

test("applies case sensitivity when comparing occupied names", () => {
  expectAllocation("Clip.mp4", ["clip.mp4"], NFC_CASE_INSENSITIVE, "Clip 1.mp4", "clip 1.mp4");
  expectAllocation("Clip.mp4", ["clip.mp4"], NFC_CASE_SENSITIVE, "Clip.mp4");
});

test("caps persisted basenames by UTF-8 bytes while preserving extensions and collision suffixes", () => {
  const desired = `${"solo ".repeat(80)}.mp4`;
  const first = allocateMediaFilename(desired, [], NFC_CASE_SENSITIVE);
  const second = allocateMediaFilename(desired, [first.persistedBasename], NFC_CASE_SENSITIVE);
  const unicode = sanitizeProjectFilename(`${"🎬".repeat(100)}.mp4`, NFC_CASE_SENSITIVE);

  assert.ok(Buffer.byteLength(first.persistedBasename, "utf8") <= 255);
  assert.ok(Buffer.byteLength(second.persistedBasename, "utf8") <= 255);
  assert.ok(Buffer.byteLength(unicode.persistedBasename, "utf8") <= 255);
  assert.match(first.persistedBasename, /\.mp4$/);
  assert.match(second.persistedBasename, / 1\.mp4$/);
  assert.match(unicode.persistedBasename, /\.mp4$/);
});
