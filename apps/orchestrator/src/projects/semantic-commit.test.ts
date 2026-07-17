import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "@openreel/core";
import type { GitStagedNameStatusEntry } from "./git-store";
import { buildSemanticCommitPrompt, deterministicCommitMessage, semanticProjectChanges } from "./semantic-commit";

const project = (modifiedAt: number): Project => ({
  id: "vintage-tokyo", name: "Vintage Tokyo", createdAt: 1, modifiedAt,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
  mediaLibrary: { items: [] },
  generatedImageDefinitions: [],
  timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
});

const stagedEntry = (
  status: GitStagedNameStatusEntry["status"],
  path: string,
  fromPath?: string,
): GitStagedNameStatusEntry => ({
  status,
  path,
  ...(fromPath ? { fromPath } : {}),
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
    deterministicCommitMessage(changes, [stagedEntry("M", "project.json")]),
    "update project with 2 semantic changes\n\n- Update name\n- Update settings.width\n\nFiles staged:\n- Update project.json\n\nFiles changed: 1",
  );
});

test("commit message renders rename and copy staged paths exactly once", () => {
  assert.equal(
    deterministicCommitMessage([], [
      stagedEntry("R", "media/clip-final.mp4", "media/clip.mp4"),
      stagedEntry("C", "media/clip-dup.mp4", "media/clip-final.mp4"),
    ]),
    "update project with 2 staged changes\n\nFiles staged:\n- Rename media/clip.mp4 → media/clip-final.mp4\n- Copy media/clip-final.mp4 → media/clip-dup.mp4\n\nFiles changed: 3",
  );
});

test("LLM prompt requires all semantic changes across the exact staged file count", () => {
  assert.match(
    buildSemanticCommitPrompt("diff", [
      stagedEntry("M", "project.json"),
      stagedEntry("R", "media/clip-final.mp4", "media/clip.mp4"),
      stagedEntry("C", "media/clip-dup.mp4", "media/clip-final.mp4"),
    ]),
    /ALL semantic changes across ALL 4 changed files/,
  );
});
