import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("dialog and inspector use the one shared production generation runtime", async () => {
  const [dialog, inspector, generateTab] = await Promise.all([
    readFile(new URL("./GenerateAssetDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../InspectorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../inspector/tabs/generation/GenerateTab.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dialog, /getProductionGenerationRuntime/);
  assert.match(dialog, /prepareProjectWaveSpeedSubmission/);
  assert.match(dialog, /generationRuntime\.readCapabilities/);
  assert.match(dialog, /prepareWaveSpeedGenerationDraft/);
  assert.match(dialog, /prepareWaveSpeedProjectionAudio/);
  assert.doesNotMatch(dialog, /submitGenerationJob/);
  assert.doesNotMatch(dialog, /fetchModelsCached/);
  assert.doesNotMatch(dialog, /supportsAudio:\s*Boolean\(schema/);
  assert.doesNotMatch(dialog, /enqueueJob/);
  assert.doesNotMatch(dialog, /linkedMediaIds/);
  assert.doesNotMatch(dialog, /VITE_ORCHESTRATOR_URL/);
  assert.match(dialog, /wsRoute:\s*route/);
  assert.match(dialog, /prepareProjectWaveSpeedSubmission\(\{[\s\S]*route,[\s\S]*entryContext/);
  assert.match(dialog, /resolveProjectGenerationReferences/);
  assert.match(dialog, /referenceResolution\.submissionReferences\.map/);

  assert.match(inspector, /getProductionGenerationRuntime/);
  assert.match(inspector, /prepareProjectWaveSpeedSubmission/);
  assert.doesNotMatch(inspector, /prepareWaveSpeedGenerationDraft/);
  assert.doesNotMatch(inspector, /prepareWaveSpeedProjectionAudio/);
  assert.match(inspector, /generationRuntime\.controller\.submit\(prepared\)/);
  for (const prop of [
    "entryContextResult=",
    "destination=",
    "placementDefault=",
    "audioPresentation=",
    "referenceRecovery=",
    "referenceResolutionInput=",
    "onReferenceCommand=",
    "job=",
    "onSubmit=",
    "onRecoveryAction=",
    "onCancel=",
  ]) {
    assert.ok(inspector.includes(prop), `Inspector is missing live GenerateTab prop ${prop}`);
  }
  assert.match(inspector, /prepareProjectWaveSpeedSubmission\(\{[\s\S]*route,[\s\S]*entryContext/);
  assert.match(inspector, /saveReferenceRecovery/);
  assert.match(inspector, /referenceRecoveries/);
  assert.doesNotMatch(inspector, /\/api\/generate\/wavespeed\/models/);

  assert.match(generateTab, /resolveProjectGenerationReferences/);
  assert.match(generateTab, /referenceIds:\s*\[\.\.\.resolution\.referenceIds\]/);
  assert.match(generateTab, /referenceTargets:\s*\{\s*\.\.\.resolution\.referenceTargets\s*\}/);
  assert.match(generateTab, /referenceResolution/);
});
