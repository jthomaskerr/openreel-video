import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { serializeGenerationEvidenceManifest, serializeGenerationFinalizationInput, serializeGenerationMutation, serializeGenerationOutput, serializeGenerationProject, serializeGenerationProvenance } from "@openreel/music-video-domain/generation";
import { GenerationFinalizer } from "./finalization.js";
import { GenerationOrchestrator, type GenerationProviderPort } from "./index.js";
import { FileGenerationJobRepository } from "./repository.js";

const route = { providerInstanceId: "wavespeed-prod", providerModelId: "model", requestedMode: "text-to-image" as const, providerSchemaId: "schema", providerEndpointId: "submit", providerSchemaVersion: "2026-01" };
const LOCAL_PREFIXES = ["blob:", "local:", "file:"] as const;
function makeJob(id: string, providerJobId: string, placeholderMediaId = "placeholder-no-source"): GenerationJob {
  return { schemaVersion: 2, contractVersion: 2, id, projectId: "project", provider: "wavespeed", providerInstanceId: route.providerInstanceId, modelId: route.providerModelId, modelSchemaVersion: route.providerSchemaVersion, routing: route, providerJobId, status: "queued", attempt: 1, context: { projectId: "project", entryContext: { kind: "new-asset" }, mode: "text-to-image", placementPolicy: "none", prompt: "a new image", references: [] }, providerInputs: { placeholderMediaId }, attempts: [{ attemptNumber: 1, routing: route, providerJobId, startedAt: 1 }], checkpoints: {}, createdAt: 1, updatedAt: 1 };
}

test("new-asset with no source finalizes once without shot or placement work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-no-source-"));
  const job = makeJob("job-no-source", "provider-no-source");
  const repository = new FileGenerationJobRepository(directory);
  let downloads = 0; let finalizations = 0; let shotLinks = 0; let placements = 0;
  const finalizer = new GenerationFinalizer(repository, {
    download: { download: async () => { downloads += 1; return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }; } },
    verify: { verify: async () => {} },
    inspect: { inspect: async () => ({ width: 10, height: 10, durationSeconds: 1 }) },
    placeholder: { finalize: async () => { finalizations += 1; return { mediaId: "media-no-source", versionId: "version-no-source" }; } },
    shot: { link: async () => { shotLinks += 1; } },
    placement: { place: async () => { placements += 1; } },
    clock: () => 10,
  });

  let providerSubmits = 0;
  const provider: GenerationProviderPort = {
    submit: async () => { providerSubmits += 1; return { providerJobId: "provider-no-source" }; },
    status: async () => ({ providerJobId: "provider-no-source", status: "running" as const }),
  };
  const orchestrator = new GenerationOrchestrator({
    repository,
    provider,
    routes: [{ identity: route, schemaFingerprint: "schema", clientSchemaFingerprint: "schema", serverSchemaFingerprint: "schema", clientAcceptance: true, serverAcceptance: true, configurationVersion: "v2" }],
    releaseEnabled: true,
    owner: () => true,
    finalizer: { finalize: async () => {} },
    requestBoundary: { validate: () => {} },
    clock: () => 2,
  });
  await orchestrator.submit({ ownerId: "owner", job: { ...job, providerJobId: undefined, attempts: [{ ...job.attempts[0], providerJobId: undefined }], status: "queued" }, request: { contentType: "application/json", byteLength: 1, maxBytes: 10, timeoutMs: 1, maxTimeoutMs: 2 } });
  const result = await finalizer.finalize(job.id, { provider: "wavespeed", providerJobId: "provider-no-source" });
  const replay = await finalizer.finalize(job.id, { provider: "wavespeed", providerJobId: "provider-no-source" });
  assert.equal(result.status, "succeeded");
  assert.equal(replay.status, "succeeded");
  assert.equal(downloads, 1);
  assert.equal(finalizations, 1);
  assert.equal(shotLinks, 0);
  assert.equal(placements, 0);
  assert.equal(providerSubmits, 1);
  assert.equal((await repository.get(job.id))?.output?.mediaId, "media-no-source");
  assert.equal((await repository.get(job.id))?.output?.versionId, "version-no-source");
});

test("every local prefix is rejected before repository creation", async () => {
  for (const prefix of LOCAL_PREFIXES) {
    const directory = await mkdtemp(join(tmpdir(), "generation-local-url-"));
    const job = makeJob(`job-local-${prefix.slice(0, -1)}`, "provider-local-id", `${prefix}http://localhost/unsafe`);
    const repository = new FileGenerationJobRepository(directory);
    await assert.rejects(repository.create(job), /generation-local-url-forbidden/);
    assert.equal(await repository.get(job.id), undefined);
  }
});

test("every local prefix is rejected without output, checkpoint, or claim writes", async () => {
  for (const [index, prefix] of LOCAL_PREFIXES.entries()) {
    const directory = await mkdtemp(join(tmpdir(), "generation-local-boundaries-"));
    const repository = new FileGenerationJobRepository(directory);
    const valid = makeJob(`job-boundaries-${index}`, "provider-boundaries");
    await repository.create(valid);
    await assert.rejects(repository.update(valid.id, (current) => ({ ...current, output: { mediaId: `${prefix}output`, versionId: "version", mimeType: "image/png", byteLength: 1, sha256: "sha" } })), /generation-local-url-forbidden/);
    await assert.rejects(repository.compareAndSetCheckpoint(valid.id, "output-inspected", { status: "failed", error: { code: "x", message: `${prefix}checkpoint`, retryable: false } }), /generation-local-url-forbidden/);
    await assert.rejects(repository.claimFinalization({ jobId: valid.id, providerInstanceId: valid.providerInstanceId, providerJobId: "provider-boundaries", outputIdentity: JSON.stringify({ providerJobId: "provider-boundaries", outputMediaIds: [`${prefix}output`] }), idempotencyKey: "generation:job-boundaries:finalization" }), /generation-local-url-forbidden/);
    const saved = await repository.get(valid.id);
    assert.equal(saved?.output, undefined);
    assert.equal(saved?.checkpoints["output-inspected"], undefined);
    assert.equal(await repository.getFinalizationClaim(valid.id), undefined);
  }
});

test("all owned durable serializers reject every local prefix before emitting bytes", () => {
  const base = { provider: "wavespeed" as const, modelId: "model", modelSchemaVersion: "schema", jobId: "job-serializer", routing: route, checkpoints: [], references: [] };
  for (const prefix of LOCAL_PREFIXES) {
    assert.throws(() => serializeGenerationOutput({ mediaId: `${prefix}media`, versionId: "version", mimeType: "image/png", byteLength: 1, sha256: "sha" }), /generation-local-url-forbidden/);
    assert.throws(() => serializeGenerationProvenance({ ...base, output: { mediaId: "media", versionId: `${prefix}version`, mimeType: "image/png", byteLength: 1, sha256: "sha" } }), /generation-local-url-forbidden/);
    assert.throws(() => serializeGenerationProject({ projectId: "project", generationJobIds: [`${prefix}job`], mediaIds: [] }), /generation-local-url-forbidden/);
    assert.throws(() => serializeGenerationMutation({ projectId: "project", mutationId: "mutation", kind: "generation", payload: { output: `${prefix}output` } }), /generation-local-url-forbidden/);
    assert.throws(() => serializeGenerationEvidenceManifest({ projectId: "project", jobId: "job", artifacts: [{ id: "artifact", uri: `${prefix}artifact` }] }), /generation-local-url-forbidden/);
    assert.throws(() => serializeGenerationFinalizationInput({ projectId: "project", jobId: "job", providerJobId: "provider", output: { mediaId: "media", versionId: "version", mimeType: "image/png", byteLength: 1, sha256: `${prefix}sha` } }), /generation-local-url-forbidden/);
  }
});
