import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationOrchestrator, type GenerationProviderPort } from "./index.js";
import { FileGenerationJobRepository } from "./repository.js";

const route = { providerInstanceId: "wavespeed-prod", providerModelId: "model", requestedMode: "text-to-image" as const, providerSchemaId: "schema", providerEndpointId: "submit", providerSchemaVersion: "2026-01" };
function makeJob(id: string): GenerationJob {
  return { schemaVersion: 2, contractVersion: 2, id, projectId: "project", provider: "wavespeed", providerInstanceId: route.providerInstanceId, modelId: route.providerModelId, modelSchemaVersion: route.providerSchemaVersion, routing: route, status: "queued", attempt: 1, context: { projectId: "project", entryContext: { kind: "new-asset" }, mode: "text-to-image", placementPolicy: "none", prompt: id, references: [] }, providerInputs: {}, attempts: [{ attemptNumber: 1, routing: route, startedAt: 1 }], checkpoints: {}, createdAt: 1, updatedAt: 1 };
}

test("rollback preserves continuation for submitted V2 jobs while blocking new submits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-v2-rollback-continuation-"));
  const repository = new FileGenerationJobRepository(directory);
  const statuses = new Map<string, "running" | "completed">([
    ["poll-job", "running"],
    ["finalize-job", "completed"],
    ["recover-job", "completed"],
  ]);
  let providerSubmits = 0;
  let finalizerCalls = 0;
  let failFirstFinalization = true;
  const provider: GenerationProviderPort = {
    submit: async ({ job }) => { providerSubmits += 1; return { providerJobId: `provider-${job.id}` }; },
    status: async ({ providerJobId }) => ({ providerJobId, status: statuses.get(providerJobId.replace("provider-", "")) ?? "running", outputMediaIds: ["provider-output-1"] }),
    cancel: async () => {},
  };
  const makeOrchestrator = (releaseEnabled: boolean, finalizer = { finalize: async ({ idempotencyKey }: { idempotencyKey: string }) => { finalizerCalls += 1; if (idempotencyKey.includes("recover-job") && failFirstFinalization) { failFirstFinalization = false; throw new Error("finalizer retry"); } }, reconcilePlacement: async () => { throw new Error("generation-placement-reconciliation-unavailable"); } }) => new GenerationOrchestrator({
    repository, provider, releaseEnabled, owner: () => true, finalizer,
    routes: [{ identity: route, schemaFingerprint: "schema", clientSchemaFingerprint: "schema", serverSchemaFingerprint: "schema", clientAcceptance: true, serverAcceptance: true, configurationVersion: "v2" }],
    requestBoundary: { validate: () => {} }, clock: () => 2,
  });
  const submit = async (id: string) => makeOrchestrator(true).submit({ ownerId: "owner", job: makeJob(id), request: { contentType: "application/json", byteLength: 1, maxBytes: 10, timeoutMs: 1, maxTimeoutMs: 2 } });
  await submit("poll-job");
  await submit("cancel-job");
  await submit("finalize-job");
  await submit("recover-job");
  assert.equal(providerSubmits, 4);

  const rollback = makeOrchestrator(false);
  assert.equal((await rollback.status({ ownerId: "owner", projectId: "project", jobId: "poll-job" })).status, "running");
  assert.equal((await rollback.cancel({ ownerId: "owner", projectId: "project", jobId: "cancel-job" })).status, "canceled");
  assert.equal((await rollback.status({ ownerId: "owner", projectId: "project", jobId: "finalize-job" })).status, "succeeded");
  assert.equal((await rollback.status({ ownerId: "owner", projectId: "project", jobId: "recover-job" })).status, "needs-attention");
  assert.equal((await rollback.status({ ownerId: "owner", projectId: "project", jobId: "recover-job" })).status, "succeeded");
  assert.equal(finalizerCalls, 3);
  assert.equal(providerSubmits, 4);
  await assert.rejects(rollback.submit({ ownerId: "owner", job: makeJob("new-job"), request: { contentType: "application/json", byteLength: 1, maxBytes: 10, timeoutMs: 1, maxTimeoutMs: 2 } }), /generation-v2-rollback-active/);
  assert.equal(providerSubmits, 4);
});
