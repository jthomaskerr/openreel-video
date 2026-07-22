import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateWaveSpeedReleaseGate,
  validateWaveSpeedEvidenceManifest,
} from "./evidence-manifest.js";

function validManifest(): Record<string, unknown> {
  const artifact = (scenario: number) => ({
    scenario,
    capturedAt: "2026-07-21T01:02:03.000Z",
    status: "PASS",
    expected: `scenario ${scenario} expected result`,
    actual: `scenario ${scenario} actual result`,
    screenshot: `docs/evidence/wavespeed-generation/2026-07-21/scenario-${String(scenario).padStart(2, "0")}.png`,
    network: `docs/evidence/wavespeed-generation/2026-07-21/scenario-${String(scenario).padStart(2, "0")}-network.json`,
    events: `docs/evidence/wavespeed-generation/2026-07-21/scenario-${String(scenario).padStart(2, "0")}-events.json`,
  });
  return {
    schemaVersion: "wavespeed-generation-evidence/v1",
    generatedAt: "2026-07-21T01:02:03.000Z",
    release: {
      requestedFlagEnabled: false,
      exactSolVerifier: "PENDING",
      paidProvider: "BLOCKED",
      technicalCases: { passed: 40, total: 40 },
      redactionLeaks: 0,
      evidenceSchemaValid: true,
    },
    routing: {
      providerInstanceId: "wavespeed-production",
      providerModelId: "wavespeed/wan",
      requestedMode: "text-to-video",
      providerSchemaId: "wan-text-video",
      providerEndpointId: "wavespeed-submit",
      providerSchemaVersion: "2026-01",
    },
    context: {
      kind: "linked-shot-projection",
      shotId: "shot-safe-001",
      clipId: "clip-safe-001",
      startTime: 3,
      endTime: 6,
      placementPolicy: "replace-source-clip",
    },
    references: [
      { id: "reference-safe-001", origin: "character", order: 0, active: true, status: "ready" },
    ],
    audio: {
      requestedRange: { startTime: 3, endTime: 6 },
      actualRange: { startTime: 3, endTime: 6 },
      sha256: "a".repeat(64),
    },
    provenance: {
      logicalJobId: "logical-safe-001",
      providerJobIds: ["provider-safe-001"],
      outputId: "output-safe-001",
      mediaId: "media-safe-001",
      versionId: "version-safe-001",
      shotId: "shot-safe-001",
      clipId: "clip-safe-001",
    },
    errorsActions: [
      { stage: "placement", errorCode: "placement-failed", retryable: true, action: "retry-placement" },
    ],
    artifactCounts: {
      expected: { providerSubmits: 1, outputs: 1, mediaVersions: 1, shotAttempts: 1, placements: 1, placeholders: 1 },
      actual: { providerSubmits: 1, outputs: 1, mediaVersions: 1, shotAttempts: 1, placements: 1, placeholders: 1 },
    },
    fixtureMatrix: {
      dispositions: { passed: 24, total: 24, illegalTransitions: 0 },
      rollback: { passed: true, newSubmits: 0, existingContinuations: 1 },
      newAssetNoSource: { passed: true, sourceCalls: 0, audioCalls: 0, outputs: 1 },
      durableLocalUrlBoundaries: { passed: true, leaks: 0, durableWrites: 0 },
    },
    browserArtifacts: Array.from({ length: 14 }, (_, index) => artifact(index + 1)),
    providerEvidence: {
      status: "BLOCKED",
      reason: "Joseph has not authorized a credential, model matrix, spend cap, or retention policy.",
      artifacts: [],
    },
  };
}

test("evidence schema requires exact sanitized routing, context, references, audio, provenance, recovery, counts, dated browser links, and expected-versus-actual", () => {
  const result = validateWaveSpeedEvidenceManifest(validManifest());
  assert.deepEqual(result, { valid: true, errors: [] });

  const missingScenario = structuredClone(validManifest()) as any;
  missingScenario.browserArtifacts = missingScenario.browserArtifacts.slice(0, 13);
  assert.match(validateWaveSpeedEvidenceManifest(missingScenario).errors.join("\n"), /browser scenario 14/);

  const leaked = structuredClone(validManifest()) as any;
  leaked.provenance.outputId = "blob:https://editor.invalid/secret";
  leaked.browserArtifacts[0].network = "docs/evidence/wavespeed-generation/2026-07-21/network.json?token=secret";
  const leakedResult = validateWaveSpeedEvidenceManifest(leaked);
  assert.equal(leakedResult.valid, false);
  assert.match(leakedResult.errors.join("\n"), /forbidden durable or secret value/);

  const undated = structuredClone(validManifest()) as any;
  undated.browserArtifacts[0].screenshot = "docs/evidence/wavespeed-generation/scenario-01.png";
  assert.match(validateWaveSpeedEvidenceManifest(undated).errors.join("\n"), /dated artifact path/);
});

test("release gate fails every canonical matrix invariant and remains disabled while exact-Sol or paid evidence is incomplete", () => {
  const pending = evaluateWaveSpeedReleaseGate(validManifest());
  assert.equal(pending.enableV2, false);
  assert.deepEqual(pending.reasons, [
    "exact gpt-5.6-sol verification is not PASS",
    "paid-provider evidence is BLOCKED",
  ]);

  const cases: readonly [string, (manifest: any) => void, RegExp][] = [
    ["illegal transition", (manifest) => { manifest.fixtureMatrix.dispositions.illegalTransitions = 1; }, /illegal persisted disposition transition/],
    ["rollback submit", (manifest) => { manifest.fixtureMatrix.rollback.newSubmits = 1; }, /new provider submit during rollback/],
    ["new asset source", (manifest) => { manifest.fixtureMatrix.newAssetNoSource.sourceCalls = 1; }, /source call for new asset/],
    ["new asset audio", (manifest) => { manifest.fixtureMatrix.newAssetNoSource.audioCalls = 1; }, /audio call for new asset/],
    ["boundary leak", (manifest) => { manifest.fixtureMatrix.durableLocalUrlBoundaries.leaks = 1; }, /durable local URL boundary leak/],
    ["duplicate provider", (manifest) => { manifest.artifactCounts.actual.providerSubmits = 2; }, /providerSubmits expected 1 actual 2/],
    ["duplicate artifact", (manifest) => { manifest.artifactCounts.actual.outputs = 2; }, /outputs expected 1 actual 2/],
  ];
  for (const [name, mutate, expected] of cases) {
    const manifest = structuredClone(validManifest()) as any;
    manifest.release.exactSolVerifier = "PASS";
    manifest.providerEvidence.status = "PASS";
    manifest.providerEvidence.reason = undefined;
    manifest.providerEvidence.artifacts = ["docs/evidence/wavespeed-generation/2026-07-21/provider-matrix.json"];
    manifest.release.paidProvider = "PASS";
    mutate(manifest);
    const gate = evaluateWaveSpeedReleaseGate(manifest);
    assert.equal(gate.enableV2, false, name);
    assert.match(gate.reasons.join("\n"), expected, name);
  }
});
