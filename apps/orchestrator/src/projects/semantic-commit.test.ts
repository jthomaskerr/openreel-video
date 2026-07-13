import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "@openreel/core";
import { buildSemanticCommitPrompt, deterministicCommitMessage, semanticProjectChanges } from "./semantic-commit";

const project = (modifiedAt: number): Project => ({
  id: "vintage-tokyo", name: "Vintage Tokyo", createdAt: 1, modifiedAt,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
});

test("modifiedAt is excluded from semantic project changes", () => {
  assert.deepEqual(semanticProjectChanges(project(1), project(2)), []);
});

test("commit message has a substantive subject and lists every semantic change", () => {
  const before = project(1);
  const after = { ...project(2), name: "Tokyo Nights", settings: { ...before.settings, width: 3840 } };
  const changes = semanticProjectChanges(before, after);
  assert.deepEqual(changes.map((change) => change.path), ["name", "settings.width"]);
  assert.equal(
    deterministicCommitMessage(changes),
    "update project with 2 semantic changes\n\n- Update name\n- Update settings.width\n\nFiles changed: 1",
  );
});

test("LLM prompt requires all semantic changes across the exact file count", () => {
  assert.match(buildSemanticCommitPrompt("diff", 3), /ALL semantic changes across ALL 3 changed files/);
});
