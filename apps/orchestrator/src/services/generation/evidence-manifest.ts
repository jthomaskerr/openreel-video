export interface WaveSpeedEvidenceValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface WaveSpeedReleaseGateResult {
  readonly enableV2: boolean;
  readonly reasons: readonly string[];
}

type JsonRecord = Record<string, unknown>;

const ROUTING_FIELDS = [
  "providerInstanceId",
  "providerModelId",
  "requestedMode",
  "providerSchemaId",
  "providerEndpointId",
  "providerSchemaVersion",
] as const;
const ARTIFACT_COUNT_FIELDS = [
  "providerSubmits",
  "outputs",
  "mediaVersions",
  "shotAttempts",
  "placements",
  "placeholders",
] as const;
const FORBIDDEN_KEY = /(?:authorization|api[-_]?key|credential|password|secret|signed[-_]?url|token|raw[-_]?prompt|prompt)/i;
const FORBIDDEN_VALUE = /^(?:Bearer\s|blob:|local:|file:|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::|\/|$))|(?:[?&](?:x-amz-signature|signature|sig|token)=)/i;
const DATED_ARTIFACT = /\/(?:20\d{2})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\//;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isoTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function findForbidden(value: unknown, path = "manifest"): string[] {
  if (typeof value === "string") {
    return FORBIDDEN_VALUE.test(value) ? [`${path} contains a forbidden durable or secret value`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) => findForbidden(entry, `${path}[${index}]`));
  const object = record(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, child]) => {
    if (FORBIDDEN_KEY.test(key)) return [`${path}.${key} contains a forbidden durable or secret value`];
    return findForbidden(child, `${path}.${key}`);
  });
}

function validateRange(value: unknown, path: string, errors: string[]): void {
  if (value === null) return;
  const range = record(value);
  if (!range || !finite(range.startTime) || !finite(range.endTime) || range.endTime <= range.startTime) {
    errors.push(`${path} must be null or an exact positive startTime/endTime range`);
  }
}

function validateArtifactCounts(value: unknown, errors: string[]): void {
  const counts = record(value);
  const expected = record(counts?.expected);
  const actual = record(counts?.actual);
  if (!counts || !expected || !actual) {
    errors.push("artifactCounts must include expected and actual results");
    return;
  }
  for (const field of ARTIFACT_COUNT_FIELDS) {
    if (!integer(expected[field]) || !integer(actual[field])) {
      errors.push(`artifactCounts expected/actual ${field} must be non-negative integers`);
    }
  }
}

function validateFixtureMatrix(value: unknown, errors: string[]): void {
  const matrix = record(value);
  const dispositions = record(matrix?.dispositions);
  const rollback = record(matrix?.rollback);
  const newAsset = record(matrix?.newAssetNoSource);
  const boundaries = record(matrix?.durableLocalUrlBoundaries);
  if (!matrix || !dispositions || !rollback || !newAsset || !boundaries) {
    errors.push("fixtureMatrix must include dispositions, rollback, newAssetNoSource, and durableLocalUrlBoundaries");
    return;
  }
  if (!integer(dispositions.passed) || !integer(dispositions.total) || !integer(dispositions.illegalTransitions)) {
    errors.push("fixtureMatrix.dispositions must include integer passed/total/illegalTransitions");
  }
  if (typeof rollback.passed !== "boolean" || !integer(rollback.newSubmits) || !integer(rollback.existingContinuations)) {
    errors.push("fixtureMatrix.rollback must include passed/newSubmits/existingContinuations");
  }
  if (typeof newAsset.passed !== "boolean" || !integer(newAsset.sourceCalls) || !integer(newAsset.audioCalls) || !integer(newAsset.outputs)) {
    errors.push("fixtureMatrix.newAssetNoSource must include passed/sourceCalls/audioCalls/outputs");
  }
  if (typeof boundaries.passed !== "boolean" || !integer(boundaries.leaks) || !integer(boundaries.durableWrites)) {
    errors.push("fixtureMatrix.durableLocalUrlBoundaries must include passed/leaks/durableWrites");
  }
}

function validateBrowserArtifacts(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("browserArtifacts must contain browser scenarios 1 through 14");
    return;
  }
  const byScenario = new Map<number, JsonRecord>();
  for (const candidate of value) {
    const artifact = record(candidate);
    if (artifact && integer(artifact.scenario)) byScenario.set(artifact.scenario, artifact);
  }
  for (let scenario = 1; scenario <= 14; scenario += 1) {
    const artifact = byScenario.get(scenario);
    if (!artifact) {
      errors.push(`browser scenario ${scenario} evidence is required`);
      continue;
    }
    if (!isoTimestamp(artifact.capturedAt)) errors.push(`browser scenario ${scenario} capturedAt must be an ISO timestamp`);
    if (artifact.status !== "PASS") errors.push(`browser scenario ${scenario} status must be PASS`);
    if (!nonEmptyString(artifact.expected) || !nonEmptyString(artifact.actual)) {
      errors.push(`browser scenario ${scenario} must include expected-versus-actual results`);
    }
    for (const field of ["screenshot", "network", "events"] as const) {
      if (!nonEmptyString(artifact[field]) || !DATED_ARTIFACT.test(artifact[field])) {
        errors.push(`browser scenario ${scenario} ${field} must be a dated artifact path`);
      }
    }
  }
  if (byScenario.size !== 14) errors.push("browserArtifacts must contain exactly one artifact for each scenario 1 through 14");
}

export function validateWaveSpeedEvidenceManifest(value: unknown): WaveSpeedEvidenceValidationResult {
  const errors: string[] = [];
  const manifest = record(value);
  if (!manifest) return { valid: false, errors: ["evidence manifest must be an object"] };
  if (manifest.schemaVersion !== "wavespeed-generation-evidence/v1") errors.push("schemaVersion must be wavespeed-generation-evidence/v1");
  if (!isoTimestamp(manifest.generatedAt)) errors.push("generatedAt must be an ISO timestamp");

  const release = record(manifest.release);
  const technicalCases = record(release?.technicalCases);
  if (!release
    || typeof release.requestedFlagEnabled !== "boolean"
    || !["PENDING", "PASS", "FAIL"].includes(String(release.exactSolVerifier))
    || !["BLOCKED", "PASS", "FAIL"].includes(String(release.paidProvider))
    || !technicalCases
    || !integer(technicalCases.passed)
    || !integer(technicalCases.total)
    || !integer(release.redactionLeaks)
    || typeof release.evidenceSchemaValid !== "boolean") {
    errors.push("release must include flag, exact-Sol, paid-provider, technical, schema, and redaction gates");
  }

  const routing = record(manifest.routing);
  if (!routing || ROUTING_FIELDS.some((field) => !nonEmptyString(routing[field]))) {
    errors.push("routing must include the exact six-field provider identity");
  }

  const context = record(manifest.context);
  if (!context || !nonEmptyString(context.kind) || !nonEmptyString(context.placementPolicy)) {
    errors.push("context must include entry kind and explicit placement policy");
  }
  if (context && ("startTime" in context || "endTime" in context)) {
    validateRange({ startTime: context.startTime, endTime: context.endTime }, "context timing", errors);
  }

  if (!Array.isArray(manifest.references)) {
    errors.push("references must be an ordered array");
  } else {
    manifest.references.forEach((candidate, index) => {
      const reference = record(candidate);
      if (!reference
        || !nonEmptyString(reference.id)
        || !nonEmptyString(reference.origin)
        || reference.order !== index
        || typeof reference.active !== "boolean"
        || !nonEmptyString(reference.status)) {
        errors.push(`reference ${index} must include sanitized identity, origin, exact order, active state, and status`);
      }
    });
  }

  const audio = record(manifest.audio);
  if (!audio) {
    errors.push("audio evidence is required even when requested/actual are null");
  } else {
    validateRange(audio.requestedRange, "audio.requestedRange", errors);
    validateRange(audio.actualRange, "audio.actualRange", errors);
    if (audio.sha256 !== null && !(typeof audio.sha256 === "string" && /^[a-f0-9]{64}$/.test(audio.sha256))) {
      errors.push("audio.sha256 must be null or a lowercase SHA-256 hash");
    }
  }

  const provenance = record(manifest.provenance);
  if (!provenance
    || !nonEmptyString(provenance.logicalJobId)
    || !Array.isArray(provenance.providerJobIds)
    || provenance.providerJobIds.length === 0
    || provenance.providerJobIds.some((id) => !nonEmptyString(id))
    || !nonEmptyString(provenance.outputId)
    || !nonEmptyString(provenance.mediaId)
    || !nonEmptyString(provenance.versionId)) {
    errors.push("provenance must include sanitized logical/provider/output/media/version identities");
  }

  if (!Array.isArray(manifest.errorsActions)) {
    errors.push("errorsActions must be an array");
  } else {
    manifest.errorsActions.forEach((candidate, index) => {
      const item = record(candidate);
      if (!item || !nonEmptyString(item.stage) || !nonEmptyString(item.errorCode) || typeof item.retryable !== "boolean" || !nonEmptyString(item.action)) {
        errors.push(`errorsActions ${index} must include stage, stable error, retryability, and action`);
      }
    });
  }

  validateArtifactCounts(manifest.artifactCounts, errors);
  validateFixtureMatrix(manifest.fixtureMatrix, errors);
  validateBrowserArtifacts(manifest.browserArtifacts, errors);

  const providerEvidence = record(manifest.providerEvidence);
  if (!providerEvidence || !["BLOCKED", "PASS", "FAIL"].includes(String(providerEvidence.status)) || !Array.isArray(providerEvidence.artifacts)) {
    errors.push("providerEvidence must include status and artifacts");
  } else if (providerEvidence.status === "BLOCKED" && !nonEmptyString(providerEvidence.reason)) {
    errors.push("blocked provider evidence requires an authorization reason");
  } else if (providerEvidence.status === "PASS") {
    if (providerEvidence.artifacts.length === 0) errors.push("passing provider evidence requires artifacts");
    for (const artifact of providerEvidence.artifacts) {
      if (!nonEmptyString(artifact) || !DATED_ARTIFACT.test(artifact)) errors.push("provider evidence must use dated artifact paths");
    }
  }

  errors.push(...findForbidden(manifest));
  return { valid: errors.length === 0, errors };
}

export function evaluateWaveSpeedReleaseGate(value: unknown): WaveSpeedReleaseGateResult {
  const validation = validateWaveSpeedEvidenceManifest(value);
  const reasons = validation.errors.map((error) => `evidence manifest invalid: ${error}`);
  const manifest = record(value);
  if (!manifest) return { enableV2: false, reasons };
  const release = record(manifest.release);
  const technical = record(release?.technicalCases);
  const matrix = record(manifest.fixtureMatrix);
  const dispositions = record(matrix?.dispositions);
  const rollback = record(matrix?.rollback);
  const newAsset = record(matrix?.newAssetNoSource);
  const boundaries = record(matrix?.durableLocalUrlBoundaries);
  const counts = record(manifest.artifactCounts);
  const expected = record(counts?.expected);
  const actual = record(counts?.actual);
  const providerEvidence = record(manifest.providerEvidence);

  if (technical && technical.passed !== technical.total) reasons.push(`technical matrix is ${technical.passed}/${technical.total}, not 100%`);
  if (release?.evidenceSchemaValid !== true) reasons.push("evidence schema gate is not valid");
  if (release?.redactionLeaks !== 0) reasons.push(`redaction corpus contains ${release?.redactionLeaks} leaks`);
  if (dispositions && dispositions.passed !== dispositions.total) reasons.push(`disposition matrix is ${dispositions.passed}/${dispositions.total}`);
  if (dispositions?.illegalTransitions !== 0) reasons.push("illegal persisted disposition transition detected");
  if (rollback?.passed !== true) reasons.push("rollback fixture failed");
  if (rollback?.newSubmits !== 0) reasons.push("new provider submit during rollback detected");
  if (!integer(rollback?.existingContinuations) || rollback.existingContinuations < 1) reasons.push("existing V2 rollback continuation was not proven");
  if (newAsset?.passed !== true) reasons.push("new-asset/no-source fixture failed");
  if (newAsset?.sourceCalls !== 0) reasons.push("source call for new asset detected");
  if (newAsset?.audioCalls !== 0) reasons.push("audio call for new asset detected");
  if (newAsset?.outputs !== 1) reasons.push("new asset did not finalize exactly one output");
  if (boundaries?.passed !== true) reasons.push("durable local URL boundary fixture failed");
  if (boundaries?.leaks !== 0) reasons.push("durable local URL boundary leak detected");
  if (boundaries?.durableWrites !== 0) reasons.push("durable local URL boundary write detected");
  if (expected && actual) {
    for (const field of ARTIFACT_COUNT_FIELDS) {
      if (expected[field] !== actual[field]) reasons.push(`${field} expected ${expected[field]} actual ${actual[field]}`);
    }
  }
  if (release?.exactSolVerifier !== "PASS") reasons.push("exact gpt-5.6-sol verification is not PASS");
  if (release?.paidProvider !== "PASS" || providerEvidence?.status !== "PASS") {
    reasons.push(providerEvidence?.status === "BLOCKED" || release?.paidProvider === "BLOCKED"
      ? "paid-provider evidence is BLOCKED"
      : "paid-provider evidence is not PASS");
  }
  return { enableV2: reasons.length === 0, reasons };
}
