import assert from "node:assert/strict";
import test from "node:test";
import { resolveGitExecutable } from "./git-store";

test("uses the configured Git executable when the runtime PATH is restricted", () => {
  assert.equal(
    resolveGitExecutable(" /custom/bin/git ", ["/usr/bin/git"], () => true),
    "/custom/bin/git",
  );
});

test("falls back to an installed system Git when PATH lookup cannot be used", () => {
  assert.equal(
    resolveGitExecutable(
      undefined,
      ["/usr/bin/git", "/opt/homebrew/bin/git"],
      (candidate) => candidate === "/usr/bin/git",
    ),
    "/usr/bin/git",
  );
});

test("retains command lookup as the portable final fallback", () => {
  assert.equal(resolveGitExecutable(undefined, ["/missing/git"], () => false), "git");
});
