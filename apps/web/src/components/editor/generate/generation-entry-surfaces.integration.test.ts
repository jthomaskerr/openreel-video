import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("dialog and inspector use the one shared production generation runtime", async () => {
  const [dialog, inspector] = await Promise.all([
    readFile(new URL("./GenerateAssetDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../InspectorPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dialog, /getProductionGenerationRuntime/);
  assert.match(dialog, /prepareWaveSpeedGenerationDraft/);
  assert.match(dialog, /generationRuntime\.readCapabilities/);
  assert.match(dialog, /prepareWaveSpeedProjectionAudio/);
  assert.doesNotMatch(dialog, /submitGenerationJob/);
  assert.doesNotMatch(dialog, /fetchModelsCached/);
  assert.doesNotMatch(dialog, /supportsAudio:\s*Boolean\(schema/);
  assert.doesNotMatch(dialog, /enqueueJob/);
  assert.doesNotMatch(dialog, /linkedMediaIds/);
  assert.doesNotMatch(dialog, /VITE_ORCHESTRATOR_URL/);
  assert.match(dialog, /wsRoute:\s*route/);
  assert.match(dialog, /prepareWaveSpeedGenerationDraft\(\{[\s\S]*route,[\s\S]*entryContext/);

  assert.match(inspector, /getProductionGenerationRuntime/);
  assert.match(inspector, /prepareWaveSpeedGenerationDraft/);
  assert.match(inspector, /prepareWaveSpeedProjectionAudio/);
  assert.match(inspector, /audio:\s*generationAudio/);
  for (const prop of [
    "entryContextResult=",
    "destination=",
    "placementDefault=",
    "audioPresentation=",
    "referenceRecovery=",
    "onReferenceCommand=",
    "job=",
    "onSubmit=",
    "onRecoveryAction=",
    "onCancel=",
  ]) {
    assert.ok(inspector.includes(prop), `Inspector is missing live GenerateTab prop ${prop}`);
  }
  assert.match(inspector, /projectId:\s*project\.id,[\s\S]*body:\s*referenceMedia\.blob/);
  assert.match(inspector, /waveSpeedRouteKey\(candidate\)\s*===\s*draft\.modelId/);
  assert.match(inspector, /prepareWaveSpeedGenerationDraft\(\{[\s\S]*route,[\s\S]*entryContext/);
  assert.match(inspector, /saveReferenceRecovery/);
  assert.match(inspector, /referenceRecoveries/);
  assert.doesNotMatch(inspector, /\/api\/generate\/wavespeed\/models/);
});
