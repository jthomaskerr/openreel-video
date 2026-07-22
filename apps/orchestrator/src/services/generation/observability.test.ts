import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATION_OBSERVABILITY_STAGES,
  GenerationObservability,
} from "./observability.js";

const routing = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "wavespeed/wan",
  requestedMode: "text-to-video" as const,
  providerSchemaId: "wan-text-video",
  providerEndpointId: "wavespeed-submit",
  providerSchemaVersion: "2026-01",
};

test("structured generation events keep canonical evidence while removing the complete leak corpus", () => {
  const observability = new GenerationObservability();
  const event = observability.record({
    occurredAt: "2026-07-21T00:00:00.000Z",
    correlationId: "correlation-safe-001",
    logicalJobId: "logical-safe-001",
    providerJobId: "provider-safe-001",
    attempt: 1,
    provider: "wavespeed",
    model: "wavespeed/wan",
    routing,
    stage: "provider-submit",
    status: "succeeded",
    durationMs: 12,
    checkpoint: "provider-submitted",
    placementPolicy: "append-after-source",
    placementStatus: "pending",
    duplicateClaimResult: "owner",
    references: [{ id: "reference-safe-001", origin: "character", order: 0, active: true }],
    audio: {
      requestedRange: { startTime: 3, endTime: 6 },
      actualRange: { startTime: 3, endTime: 6 },
      sha256: "a".repeat(64),
    },
    outputs: [{ outputId: "output-safe-001", mediaId: "media-safe-001", versionId: "version-safe-001" }],
    details: {
      authorization: "Bearer secret-authorization",
      apiKey: "secret-api-key",
      credentials: "secret-credential",
      signedUrl: "https://provider.invalid/out?X-Amz-Signature=secret-signature",
      uploadToken: "secret-upload-token",
      prompt: "raw prompt must not survive",
      rawPrompt: "second raw prompt must not survive",
      localUrl: "local:asset-1",
      blobValue: "blob:https://editor.invalid/secret",
      fileValue: "file:///Users/joseph/private.mov",
      loopback: "http://127.0.0.1:5173/private",
      nested: [{ safe: "retained", token: "secret-nested-token" }],
    },
  });

  assert.equal(event.routing.providerSchemaVersion, "2026-01");
  assert.deepEqual(event.references, [{ id: "reference-safe-001", origin: "character", order: 0, active: true }]);
  assert.equal(event.audio?.sha256, "a".repeat(64));
  assert.equal(event.outputs?.[0]?.outputId, "output-safe-001");
  assert.deepEqual(event.details, { nested: [{ safe: "retained" }] });

  const serialized = JSON.stringify(event);
  for (const leak of [
    "secret-authorization",
    "secret-api-key",
    "secret-credential",
    "secret-signature",
    "secret-upload-token",
    "raw prompt must not survive",
    "second raw prompt must not survive",
    "local:asset-1",
    "blob:https://editor.invalid/secret",
    "file:///Users/joseph/private.mov",
    "http://127.0.0.1:5173/private",
    "secret-nested-token",
  ]) {
    assert.equal(serialized.includes(leak), false, `event leaked ${leak}`);
  }
});

test("observability exposes every canonical stage and complete latency/success/retry/cancel/reload/failure/duplicate metrics", () => {
  assert.deepEqual(GENERATION_OBSERVABILITY_STAGES, [
    "model-refresh",
    "route-selection",
    "validation",
    "reference-resolution",
    "reference-recovery",
    "audio-extraction",
    "audio-cache",
    "upload",
    "provider-submit",
    "provider-poll",
    "provider-cancel",
    "provider-retry",
    "output-download",
    "output-validation",
    "finalize-output",
    "finalize-media-version",
    "finalize-shot-link",
    "placement",
    "persistence",
    "idempotency-replay",
    "reload-resumption",
  ]);

  const observability = new GenerationObservability();
  const base = {
    occurredAt: "2026-07-21T00:00:00.000Z",
    correlationId: "correlation-safe-001",
    logicalJobId: "logical-safe-001",
    attempt: 1,
    provider: "wavespeed",
    model: "wavespeed/wan",
    routing,
  } as const;
  observability.record({
    ...base,
    stage: "provider-submit",
    status: "succeeded",
    durationMs: 10,
    metrics: { providerOutcome: "success" },
  });
  observability.record({
    ...base,
    stage: "provider-submit",
    status: "failed",
    durationMs: 30,
    errorCode: "provider-failed",
    retryable: true,
    action: "retry-provider",
    metrics: { providerOutcome: "failure", retry: { kind: "provider", success: true } },
  });
  observability.record({
    ...base,
    stage: "finalize-output",
    status: "succeeded",
    durationMs: 20,
    metrics: {
      retry: { kind: "finalization", success: true },
      failure: "finalization",
    },
  });
  observability.record({
    ...base,
    stage: "placement",
    status: "succeeded",
    durationMs: 4,
    metrics: { retry: { kind: "placement", success: false }, duplicate: { kind: "placement", count: 0 } },
  });
  observability.record({
    ...base,
    stage: "provider-cancel",
    status: "canceled",
    durationMs: 7,
    metrics: { cancellation: { success: true, latencyMs: 7 } },
  });
  observability.record({
    ...base,
    stage: "reload-resumption",
    status: "succeeded",
    durationMs: 2,
    metrics: { reloadResumption: { success: true } },
  });
  for (const failure of ["reference-preparation", "audio-preparation", "local-save"] as const) {
    observability.record({
      ...base,
      stage: failure === "reference-preparation" ? "reference-resolution" : failure === "audio-preparation" ? "audio-extraction" : "persistence",
      status: "failed",
      durationMs: 1,
      metrics: { failure },
    });
  }
  for (const duplicate of ["provider-submit", "output", "media-version", "shot-attempt"] as const) {
    observability.record({
      ...base,
      stage: "idempotency-replay",
      status: "succeeded",
      durationMs: 0,
      metrics: { duplicate: { kind: duplicate, count: 0 } },
    });
  }

  const metrics = observability.metrics();
  assert.deepEqual(metrics.stageLatencyMs["provider-submit"], { count: 2, total: 40, min: 10, max: 30 });
  assert.deepEqual(metrics.providerModelSchema["wavespeed|wavespeed/wan|wan-text-video|2026-01"], {
    successes: 1,
    failures: 1,
    successRate: 0.5,
  });
  assert.deepEqual(metrics.retry, {
    provider: { successes: 1, failures: 0, successRate: 1 },
    finalization: { successes: 1, failures: 0, successRate: 1 },
    placement: { successes: 0, failures: 1, successRate: 0 },
  });
  assert.deepEqual(metrics.cancellation, { successes: 1, failures: 0, successRate: 1, latencyMs: { count: 1, total: 7, min: 7, max: 7 } });
  assert.deepEqual(metrics.reloadResumption, { successes: 1, failures: 0, successRate: 1 });
  assert.deepEqual(metrics.failures, {
    referencePreparation: 1,
    audioPreparation: 1,
    localSave: 1,
    finalization: 1,
  });
  assert.deepEqual(metrics.duplicates, {
    providerSubmit: 0,
    output: 0,
    mediaVersion: 0,
    shotAttempt: 0,
    placement: 0,
  });
});
