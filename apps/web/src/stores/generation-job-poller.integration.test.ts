import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import * as generationPoller from "../hooks/useGenerationJobPoller.js";

const { processGenerationJobOnce } = generationPoller;

function job(status: GenerationJob["status"], overrides: Partial<GenerationJob> = {}): GenerationJob {
  const routing = { providerInstanceId: "wavespeed-production", providerModelId: "model", requestedMode: "text-to-image" as const, providerSchemaId: "schema", providerEndpointId: "submit", providerSchemaVersion: "v1" };
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: "logical-job",
    projectId: "project",
    provider: "wavespeed",
    providerInstanceId: routing.providerInstanceId,
    modelId: routing.providerModelId,
    modelSchemaVersion: routing.providerSchemaVersion,
    routing,
    providerJobId: "provider-job",
    status,
    attempt: 1,
    context: { projectId: "project", entryContext: { kind: "new-asset" }, mode: "text-to-image", placementPolicy: "none", prompt: "prompt", references: [] },
    providerInputs: {},
    attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-job", startedAt: 1 }],
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("never polls needs-attention", async () => {
  let reads = 0;
  await processGenerationJobOnce({
    job: job("needs-attention"),
    synchronize: async () => { reads += 1; return job("running"); },
    current: () => job("needs-attention"),
  });
  assert.equal(reads, 0);
});

test("poller exposes no parallel claim-reset API", () => {
  assert.equal("resetGenerationPollerClaims" in generationPoller, false);
});

test("poller consumes the singleton runtime authoritative completion", async () => {
  let reads = 0;
  const completed = job("succeeded", {
    output: { mediaId: "media", versionId: "version", mimeType: "image/png", byteLength: 3, sha256: "abc" },
  });
  const deps = {
    job: job("running"),
    synchronize: async () => { reads += 1; return completed; },
    current: () => job("running"),
  };
  await processGenerationJobOnce(deps);
  assert.equal(reads, 1);
});

test("late authoritative reads cannot overwrite a canceled local attempt", async () => {
  let hydrations = 0;
  await processGenerationJobOnce({
    job: job("running"),
    synchronize: async () => job("running", { updatedAt: 2 }),
    current: () => job("canceled", { updatedAt: 3 }),
  });
  assert.equal(hydrations, 0);
});
