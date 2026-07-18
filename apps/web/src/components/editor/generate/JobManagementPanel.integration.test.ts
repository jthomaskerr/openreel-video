import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("job management dispatches canonical authenticated recovery commands", async () => {
  const source = await readFile(new URL("./JobManagementPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /getProductionGenerationRuntime/);
  assert.match(source, /allowedRecoveryActionsForJob/);
  assert.match(source, /generationRuntime\.command\(action, job\)/);
  assert.doesNotMatch(source, /state\.cancel/);
  assert.doesNotMatch(source, /state\.retry/);
  assert.doesNotMatch(source, /crypto\.randomUUID/);
  assert.doesNotMatch(source, /linkedMediaIds/);
  assert.doesNotMatch(source, /local cancel controls/i);
});
