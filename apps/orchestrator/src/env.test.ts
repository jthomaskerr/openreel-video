import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBooleanFlag, parseProjectCommitDebounceMs } from "./env";

test("project commit debounce defaults to 120 seconds", () => {
  assert.equal(parseProjectCommitDebounceMs(undefined), 120_000);
});

test("project commit debounce accepts finite non-negative integers", () => {
  assert.equal(parseProjectCommitDebounceMs("0"), 0);
  assert.equal(parseProjectCommitDebounceMs("2500"), 2_500);
  assert.equal(parseProjectCommitDebounceMs("120000"), 120_000);
});

test("project commit debounce rejects invalid values", () => {
  for (const input of ["-1", "1.5", "NaN", "Infinity", ""]) {
    assert.throws(
      () => parseProjectCommitDebounceMs(input),
      /MV_PROJECT_COMMIT_DEBOUNCE_MS must be a finite non-negative integer/,
    );
  }
});

test("generation release flags fail closed unless explicitly true", () => {
  assert.equal(parseBooleanFlag(undefined), false);
  assert.equal(parseBooleanFlag(""), false);
  assert.equal(parseBooleanFlag("false"), false);
  assert.equal(parseBooleanFlag("1"), false);
  assert.equal(parseBooleanFlag("true"), true);
});
