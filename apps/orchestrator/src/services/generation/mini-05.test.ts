import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationJob, GenerationRouteIdentity } from "@openreel/music-video-domain/generation";
import { FileGenerationJobRepository } from "./repository.js";
import { GenerationOrchestrator, validateGenerationRequestBoundary, type GenerationFinalizerPort, type GenerationProviderPort } from "./index.js";

const route: GenerationRouteIdentity = {
  providerInstanceId: "wavespeed-prod",
  providerModelId: "wavespeed/wan",
  requestedMode: "text-to-video",
  providerSchemaId: "wan-video",
  providerEndpointId: "wavespeed-submit",
  providerSchemaVersion: "2026-01",
};

const manifestRoute = {
  identity: route,
  schemaFingerprint: "schema-fingerprint-v1",
  clientSchemaFingerprint: "schema-fingerprint-v1",
  serverSchemaFingerprint: "schema-fingerprint-v1",
  clientAcceptance: true,
  serverAcceptance: true,
  configurationVersion: "config-v1",
};

const requestBoundary = { validate: validateGenerationRequestBoundary };
const finalizer: GenerationFinalizerPort = { finalize: async () => {}, reconcilePlacement: async () => { throw new Error("generation-placement-reconciliation-unavailable"); } };
const request = { contentType: "application/json", byteLength: 100, maxBytes: 1024, timeoutMs: 1000, maxTimeoutMs: 1000 };

function job(id = "job-1"): GenerationJob {
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id,
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: route.providerInstanceId,
    modelId: route.providerModelId,
    modelSchemaVersion: route.providerSchemaVersion,
    routing: route,
    status: "queued",
    attempt: 1,
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-video",
      placementPolicy: "none",
      prompt: "a test",
      references: [],
    },
    providerInputs: { prompt: "a test" },
    attempts: [{ attemptNumber: 1, routing: route, startedAt: 1000 }],
    checkpoints: {},
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function provider(log: string[]): GenerationProviderPort {
  let sequence = 0;
  return {
    submit: async ({ job: reserved }) => {
      log.push(`submit:${reserved.id}`);
      sequence += 1;
      return { providerJobId: `provider-${reserved.id}-${sequence}` };
    },
    status: async ({ providerJobId }) => ({ providerJobId, status: "running" }),
    cancel: async ({ providerJobId }) => { log.push(`cancel:${providerJobId}`); },
  };
}

test("reserves durably before submit and a fresh service does not duplicate it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-"));
  const log: string[] = [];
  const first = new GenerationOrchestrator({
    repository: new FileGenerationJobRepository(directory),
    provider: provider(log),
    owner: ({ ownerId, projectId }) => ownerId === "owner-1" && projectId === "project-1",
    routes: [manifestRoute], requestBoundary, finalizer,
    releaseEnabled: true,
    clock: () => 1000,
  });

  const submitted = await first.submit({ ownerId: "owner-1", job: job(), request });
  assert.equal(submitted.providerJobId, "provider-job-1-1");
  assert.deepEqual(log, ["submit:job-1"]);

  const second = new GenerationOrchestrator({
    repository: new FileGenerationJobRepository(directory),
    provider: provider(log),
    owner: ({ ownerId, projectId }) => ownerId === "owner-1" && projectId === "project-1",
    routes: [manifestRoute], requestBoundary, finalizer,
    releaseEnabled: true,
    clock: () => 1000,
  });
  const replay = await second.submit({ ownerId: "owner-1", job: job(), request });
  assert.equal(replay.providerJobId, "provider-job-1-1");
  assert.deepEqual(log, ["submit:job-1"]);
});

test("fails closed for rollback, ownership, and incomplete routing before writes or provider calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-"));
  const log: string[] = [];
  const make = (releaseEnabled: boolean, routes = [manifestRoute]) => new GenerationOrchestrator({
    repository: new FileGenerationJobRepository(directory), provider: provider(log),
    owner: ({ ownerId, projectId }) => ownerId === "owner-1" && projectId === "project-1",
    routes, releaseEnabled, clock: () => 1000, requestBoundary, finalizer,
  });
  await assert.rejects(make(false).submit({ ownerId: "owner-1", job: job("rollback"), request }), /generation-v2-rollback-active/);
  await assert.rejects(make(true).submit({ ownerId: "other", job: job("owner"), request }), /generation-forbidden/);
  await assert.rejects(make(true, [{ ...manifestRoute, identity: { ...route, providerEndpointId: "" } }]).submit({ ownerId: "owner-1", job: job("route"), request }), /generation-route-unsupported/);
  assert.deepEqual(log, []);
  assert.equal(await new FileGenerationJobRepository(directory).get("rollback"), undefined);
});

test("cancel stops local polling and retry uses a new provider identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-"));
  const log: string[] = [];
  const repository = new FileGenerationJobRepository(directory);
  const service = new GenerationOrchestrator({ repository, provider: provider(log), owner: () => true, routes: [manifestRoute], releaseEnabled: true, requestBoundary, finalizer, clock: () => 1000 });
  await service.submit({ ownerId: "owner-1", job: job(), request });
  const canceled = await service.cancel({ ownerId: "owner-1", projectId: "project-1", jobId: "job-1" });
  assert.equal(canceled.status, "canceled");
  assert.equal(service.polling.isStopped("job-1"), true);
  await repository.update("job-1", (current) => ({ ...current, status: "failed", providerJobId: "provider-job-1-1", error: { code: "failed", message: "x", retryable: true } }));
  const retried = await service.retryProvider({ ownerId: "owner-1", projectId: "project-1", jobId: "job-1" });
  assert.equal(retried.attempt, 2);
  assert.notEqual(retried.providerJobId, "provider-job-1-1");
});

test("needs-attention placement reconciliation delegates through the owned finalizer port", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-08-placement-reconcile-"));
  const repository = new FileGenerationJobRepository(directory);
  const unknown = { code: "generation-placement-outcome-unknown", message: "placement response lost", retryable: false };
  const unresolved: GenerationJob = {
    ...job("placement-reconcile"),
    status: "needs-attention",
    providerJobId: "provider-placement-reconcile-1",
    attempts: [{ ...job("placement-reconcile").attempts[0], providerJobId: "provider-placement-reconcile-1" }],
    context: { ...job("placement-reconcile").context, placementPolicy: "create-linked-clip" },
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 4, sha256: "hash", width: 16, height: 9, durationSeconds: 1 },
    checkpoints: {
      "output-claimed": { status: "completed", timestamp: 993 },
      "output-downloaded": { status: "completed", timestamp: 994 },
      "output-verified": { status: "completed", timestamp: 995 },
      "output-inspected": { status: "completed", timestamp: 996 },
      "placeholder-finalized": { status: "completed", timestamp: 997 },
      "shot-linked": { status: "completed", timestamp: 998 },
      "placement-applied": { status: "failed", timestamp: 999, error: unknown },
    },
    placement: {
      policy: "create-linked-clip",
      status: "failed",
      error: unknown,
    },
    error: unknown,
  };
  await repository.create(unresolved);
  const reconciliations: string[] = [];
  const placementFinalizer = {
    finalize: async () => {},
    reconcilePlacement: async (jobId: string) => {
      reconciliations.push(jobId);
      assert.equal((await repository.get(jobId))?.status, "finalizing");
      return repository.update(jobId, (current) => ({
        ...current,
        status: "succeeded",
        error: undefined,
        placement: { policy: current.context.placementPolicy, status: "applied", appliedAt: 1000 },
      }));
    },
  };
  const service = new GenerationOrchestrator({
    repository,
    provider: provider([]),
    owner: ({ ownerId, projectId }) => ownerId === "owner-1" && projectId === "project-1",
    routes: [manifestRoute],
    releaseEnabled: true,
    requestBoundary,
    finalizer: placementFinalizer,
    clock: () => 1000,
  });

  const result = await service.reconcilePlacement({ ownerId: "owner-1", projectId: "project-1", jobId: unresolved.id });
  assert.deepEqual(reconciliations, [unresolved.id]);
  assert.equal(result.status, "succeeded");
  assert.equal(result.placement?.status, "applied");
});

test("status resumes a crashed finalizing placement through reconciliation instead of false success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-08-placement-resume-"));
  const repository = new FileGenerationJobRepository(directory);
  const jobId = "placement-resume";
  const providerJobId = "provider-placement-resume-1";
  const placementKey = `generation:${jobId}:placement-applied`;
  const unknown = { code: "generation-placement-outcome-unknown", message: "placement response lost", retryable: false };
  const finalizing: GenerationJob = {
    ...job(jobId),
    status: "finalizing",
    providerJobId,
    outputMediaIds: ["media-1"],
    attempts: [{ ...job(jobId).attempts[0], providerJobId }],
    context: { ...job(jobId).context, placementPolicy: "create-linked-clip" },
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 4, sha256: "hash", width: 16, height: 9, durationSeconds: 1 },
    checkpoints: {
      "output-claimed": { status: "completed", timestamp: 993 },
      "output-downloaded": { status: "completed", timestamp: 994 },
      "output-verified": { status: "completed", timestamp: 995 },
      "output-inspected": { status: "completed", timestamp: 996 },
      "placeholder-finalized": { status: "completed", timestamp: 997 },
      "shot-linked": { status: "completed", timestamp: 998 },
      "placement-applied": { status: "failed", timestamp: 999, error: unknown },
    },
    placement: { policy: "create-linked-clip", status: "failed", error: unknown },
    error: unknown,
  };
  await repository.create(finalizing);
  const placement = await repository.claimPlacement(jobId, placementKey);
  await repository.markPlacementInvocationStarted(jobId, placementKey, placement.claim.ownerToken);
  await repository.reconcilePlacement(jobId, placementKey, placement.claim.ownerToken, "unknown");
  const finalizationKey = `generation:${jobId}:finalization:${providerJobId}`;
  const finalization = await repository.claimFinalization({
    jobId,
    providerInstanceId: finalizing.providerInstanceId,
    providerJobId,
    outputIdentity: JSON.stringify({ providerJobId, outputMediaIds: ["media-1"] }),
    idempotencyKey: finalizationKey,
  });
  await repository.completeFinalization(jobId, finalizationKey, finalization.claim.ownerToken);
  let finalizations = 0;
  let reconciliations = 0;
  const placementFinalizer: GenerationFinalizerPort = {
    finalize: async () => { finalizations += 1; },
    reconcilePlacement: async (id) => {
      reconciliations += 1;
      const recovery = await repository.recoverPlacement(id, placementKey);
      assert.equal(recovery.kind, "reconcile");
      if (recovery.kind !== "reconcile") throw new Error("expected placement reconciliation ownership");
      await repository.reconcilePlacement(id, placementKey, recovery.claim.ownerToken, "applied");
      return repository.update(id, (current) => ({
        ...current,
        status: "succeeded",
        error: undefined,
        checkpoints: { ...current.checkpoints, "placement-applied": { status: "completed", timestamp: 1000 } },
        placement: { policy: current.context.placementPolicy, status: "applied", appliedAt: 1000 },
      }));
    },
  };
  const completedProvider: GenerationProviderPort = {
    ...provider([]),
    status: async ({ providerJobId: id }) => ({ providerJobId: id, status: "completed", outputMediaIds: ["media-1"] }),
  };
  const service = new GenerationOrchestrator({
    repository,
    provider: completedProvider,
    owner: () => true,
    routes: [manifestRoute],
    releaseEnabled: true,
    requestBoundary,
    finalizer: placementFinalizer,
    clock: () => 1000,
  });

  const result = await service.status({ ownerId: "owner-1", projectId: "project-1", jobId });

  assert.equal(result.status, "succeeded");
  assert.equal(result.placement?.status, "applied");
  assert.equal(reconciliations, 1);
  assert.equal(finalizations, 0);
});

test("status fails closed when placement reconciliation intent survives but its claim is missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-08-placement-intent-missing-claim-"));
  const repository = new FileGenerationJobRepository(directory);
  const jobId = "placement-intent-missing-claim";
  const providerJobId = "provider-placement-intent-missing-claim-1";
  const unknown = { code: "generation-placement-outcome-unknown", message: "placement response lost", retryable: false };
  const finalizing: GenerationJob = {
    ...job(jobId),
    status: "finalizing",
    providerJobId,
    outputMediaIds: ["media-1"],
    attempts: [{ ...job(jobId).attempts[0], providerJobId }],
    context: { ...job(jobId).context, placementPolicy: "create-linked-clip" },
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 4, sha256: "hash", width: 16, height: 9, durationSeconds: 1 },
    checkpoints: {
      "output-claimed": { status: "completed", timestamp: 993 },
      "output-downloaded": { status: "completed", timestamp: 994 },
      "output-verified": { status: "completed", timestamp: 995 },
      "output-inspected": { status: "completed", timestamp: 996 },
      "placeholder-finalized": { status: "completed", timestamp: 997 },
      "shot-linked": { status: "completed", timestamp: 998 },
      "placement-applied": { status: "failed", timestamp: 999, error: unknown },
    },
    placement: { policy: "create-linked-clip", status: "failed", error: unknown },
    error: unknown,
  };
  await repository.create(finalizing);
  const finalizationKey = `generation:${jobId}:finalization:${providerJobId}`;
  const finalization = await repository.claimFinalization({
    jobId,
    providerInstanceId: finalizing.providerInstanceId,
    providerJobId,
    outputIdentity: JSON.stringify({ providerJobId, outputMediaIds: ["media-1"] }),
    idempotencyKey: finalizationKey,
  });
  await repository.completeFinalization(jobId, finalizationKey, finalization.claim.ownerToken);
  let finalizations = 0;
  let reconciliations = 0;
  const placementFinalizer: GenerationFinalizerPort = {
    finalize: async () => { finalizations += 1; },
    reconcilePlacement: async () => {
      reconciliations += 1;
      throw new Error("generation-placement-reconciliation-unavailable");
    },
  };
  const completedProvider: GenerationProviderPort = {
    ...provider([]),
    status: async ({ providerJobId: id }) => ({ providerJobId: id, status: "completed", outputMediaIds: ["media-1"] }),
  };
  const service = new GenerationOrchestrator({
    repository,
    provider: completedProvider,
    owner: () => true,
    routes: [manifestRoute],
    releaseEnabled: true,
    requestBoundary,
    finalizer: placementFinalizer,
    clock: () => 1000,
  });

  const result = await service.status({ ownerId: "owner-1", projectId: "project-1", jobId });

  assert.equal(result.status, "needs-attention");
  assert.equal(result.error?.code, "generation-placement-reconciliation-failed");
  assert.equal(reconciliations, 1);
  assert.equal(finalizations, 0);
});

test("two service instances share one durable submission claim", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-claim-"));
  let submits = 0;
  let release!: () => void;
  const provider: GenerationProviderPort = {
    submit: async ({ idempotencyKey }) => { submits += 1; await new Promise<void>((resolve) => { release = resolve; }); return { providerJobId: idempotencyKey }; },
    status: async ({ providerJobId }) => ({ providerJobId, status: "running" }),
  };
  const options = { provider, routes: [manifestRoute], releaseEnabled: true, owner: () => true, requestBoundary, finalizer, clock: () => 1000 };
  const first = new GenerationOrchestrator({ ...options, repository: new FileGenerationJobRepository(directory) });
  const second = new GenerationOrchestrator({ ...options, repository: new FileGenerationJobRepository(directory) });
  const firstRun = first.submit({ ownerId: "owner-1", job: job("claim"), request });
  while (submits === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  const secondRun = second.submit({ ownerId: "owner-1", job: job("claim"), request });
  release();
  await Promise.all([firstRun, secondRun]);
  assert.equal(submits, 1);
});

test("reconciles a provider success when the job write fails after the provider call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-reconcile-"));
  const log: string[] = [];
  const repository = new FileGenerationJobRepository(directory);
  const originalUpdate = repository.update.bind(repository);
  let failJobWrite = true;
  (repository as any).update = async (...args: unknown[]) => { if (failJobWrite) { failJobWrite = false; throw new Error("disk-full"); } return originalUpdate(...args as [string, (job: GenerationJob) => GenerationJob]); };
  const first = new GenerationOrchestrator({ repository, provider: provider(log), routes: [manifestRoute], releaseEnabled: true, requestBoundary, finalizer, owner: () => true, clock: () => 1000 });
  await assert.rejects(first.submit({ ownerId: "owner-1", job: job("reconcile"), request }), /generation-submission-ambiguous/);
  const second = new GenerationOrchestrator({ repository: new FileGenerationJobRepository(directory), provider: provider(log), routes: [manifestRoute], releaseEnabled: true, requestBoundary, finalizer, owner: () => true, clock: () => 1000 });
  assert.equal((await second.submit({ ownerId: "owner-1", job: job("reconcile"), request })).providerJobId, "provider-reconcile-1");
  assert.deepEqual(log, ["submit:reconcile"]);
});

test("reconciles an existing claimed submission before any retry and persists the provider identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-claimed-reconcile-"));
  const repository = new FileGenerationJobRepository(directory);
  await repository.create(job("claimed-reconcile"));
  await repository.beginSubmission("claimed-reconcile", 1, "generation:claimed-reconcile:attempt:1");
  let submits = 0;
  const service = new GenerationOrchestrator({
    repository,
    provider: {
      ...provider([]),
      submit: async () => { submits += 1; return { providerJobId: "unsafe-retry" }; },
      reconcileSubmission: async () => ({ status: "submitted", providerJobId: "provider-reconciled" }),
    },
    routes: [manifestRoute], requestBoundary, finalizer, releaseEnabled: true, owner: () => true,
  });
  const recovered = await service.submit({ ownerId: "owner-1", job: job("claimed-reconcile"), request });
  assert.equal(recovered.providerJobId, "provider-reconciled");
  assert.equal(submits, 0);
  assert.equal((await repository.getSubmissionClaim("claimed-reconcile", 1))?.providerJobId, "provider-reconciled");
});

test("authorized submission identity repair verifies and attaches a provider ID without submitting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-submission-repair-"));
  const repository = new FileGenerationJobRepository(directory);
  await repository.create(job("submission-repair"));
  await repository.beginSubmission("submission-repair", 1, "generation:submission-repair:attempt:1");
  let submits = 0;
  const service = new GenerationOrchestrator({
    repository,
    provider: { ...provider([]), submit: async () => { submits += 1; return { providerJobId: "must-not-submit" }; }, status: async ({ providerJobId }) => ({ providerJobId, status: "running" }) },
    routes: [manifestRoute], requestBoundary, finalizer, releaseEnabled: true, owner: () => true,
  });
  const repaired = await service.repairSubmissionIdentity({ ownerId: "owner-1", projectId: "project-1", jobId: "submission-repair", providerJobId: "verified-provider" });
  assert.equal(repaired.providerJobId, "verified-provider");
  assert.equal(submits, 0);
});

test("rollback cannot be bypassed by a caller-controlled property", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-rollback-"));
  let submits = 0;
  const service = new GenerationOrchestrator({ repository: new FileGenerationJobRepository(directory), provider: { ...provider([]), submit: async () => { submits += 1; return { providerJobId: "provider-1" }; } }, routes: [manifestRoute], requestBoundary, finalizer, releaseEnabled: false, owner: () => true, clock: () => 1000 });
  const legacyInput: unknown = { ownerId: "owner-1", job: job("new-v2"), request, allowRollbackRecovery: true };
  await assert.rejects(service.submit(legacyInput as Parameters<typeof service.submit>[0]), /generation-v2-rollback-active/);
  assert.equal(submits, 0);
});

test("completion claims valid output and invokes the finalizer once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-finalize-"));
  let finalizations = 0;
  const finalizer: GenerationFinalizerPort = { finalize: async ({ output }) => { finalizations += 1; assert.deepEqual(output.outputUrls, ["https://cdn.example/output.mp4"]); }, reconcilePlacement: async () => { throw new Error("generation-placement-reconciliation-unavailable"); } };
  const repository = new FileGenerationJobRepository(directory);
  const service = new GenerationOrchestrator({ repository, provider: { ...provider([]), status: async ({ providerJobId }) => ({ providerJobId, status: "completed", outputUrls: ["https://cdn.example/output.mp4"] }) }, finalizer, requestBoundary, routes: [manifestRoute], releaseEnabled: true, owner: () => true, clock: () => 1000 });
  await service.submit({ ownerId: "owner-1", job: job("finalize"), request });
  const first = await service.status({ ownerId: "owner-1", projectId: "project-1", jobId: "finalize" });
  const second = await service.status({ ownerId: "owner-1", projectId: "project-1", jobId: "finalize" });
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "succeeded");
  assert.equal(finalizations, 1);
  const durableClaim = await readFile(join(directory, "finalization-finalize.json"), "utf8");
  assert.equal(durableClaim.includes("https://cdn.example/output.mp4"), false);
});

test("completion without a valid output becomes needs-attention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-output-"));
  const repository = new FileGenerationJobRepository(directory);
  const service = new GenerationOrchestrator({ repository, provider: { ...provider([]), status: async ({ providerJobId }) => ({ providerJobId, status: "completed" }) }, routes: [manifestRoute], requestBoundary, finalizer, releaseEnabled: true, owner: () => true, clock: () => 1000 });
  await service.submit({ ownerId: "owner-1", job: job("missing-output"), request });
  assert.equal((await service.status({ ownerId: "owner-1", projectId: "project-1", jobId: "missing-output" })).status, "needs-attention");
});

test("request boundary accepts exact size and rejects wrong content type and larger bodies", () => {
  assert.doesNotThrow(() => validateGenerationRequestBoundary({ contentType: "application/json; charset=utf-8", byteLength: 100, maxBytes: 100, timeoutMs: 10, maxTimeoutMs: 10 }));
  assert.throws(() => validateGenerationRequestBoundary({ contentType: "text/plain", byteLength: 100, maxBytes: 100, timeoutMs: 10, maxTimeoutMs: 10 }), /content-type-required/);
  assert.throws(() => validateGenerationRequestBoundary({ contentType: "application/json", byteLength: 101, maxBytes: 100, timeoutMs: 10, maxTimeoutMs: 10 }), /request-too-large/);
  assert.throws(() => validateGenerationRequestBoundary({ contentType: "application/json", byteLength: 100, maxBytes: 100, timeoutMs: 11, maxTimeoutMs: 10 }), /request-timeout-invalid/);
});

test("routing parity fails closed for ambiguous, stale, and client/server schema drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-routing-"));
  const make = (routes: any[]) => new GenerationOrchestrator({ repository: new FileGenerationJobRepository(directory), provider: provider([]), routes, requestBoundary, finalizer, releaseEnabled: true, owner: () => true, clock: () => 1000 });
  await assert.rejects(make([manifestRoute, manifestRoute]).submit({ ownerId: "owner-1", job: job("ambiguous"), request }), /generation-route-ambiguous/);
  await assert.rejects(make([{ ...manifestRoute, identity: { ...route, providerSchemaVersion: "old" } }]).submit({ ownerId: "owner-1", job: job("stale"), request }), /generation-route-stale/);
  await assert.rejects(make([{ ...manifestRoute, serverAcceptance: false }]).submit({ ownerId: "owner-1", job: job("drift"), request }), /generation-schema-drift/);
  await assert.rejects(make([{ identity: route }]).submit({ ownerId: "owner-1", job: job("incomplete-manifest"), request }), /generation-route-unsupported/);
  await assert.rejects(make([{ schemaFingerprint: "x", clientSchemaFingerprint: "x", serverSchemaFingerprint: "x", clientAcceptance: true, serverAcceptance: true, configurationVersion: "v1" }]).submit({ ownerId: "owner-1", job: job("missing-identity"), request }), /generation-route-unsupported/);
  await assert.rejects(make([{ ...manifestRoute, identity: ["not", "a", "route"] }]).submit({ ownerId: "owner-1", job: job("array-identity"), request }), /generation-route-unsupported/);
  await assert.rejects(make([{ ...manifestRoute, identity: { ...route, extra: "forbidden" } }]).submit({ ownerId: "owner-1", job: job("extra-identity"), request }), /generation-route-unsupported/);
});

test("provider status exceptions and unknown statuses are durably needs-attention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-status-"));
  const make = (status: any) => new GenerationOrchestrator({ repository: new FileGenerationJobRepository(directory), provider: { ...provider([]), status }, routes: [manifestRoute], requestBoundary, finalizer, releaseEnabled: true, owner: () => true, clock: () => 1000 });
  const failed = make(async () => { throw new Error("provider unavailable"); });
  await failed.submit({ ownerId: "owner-1", job: job("status-failed"), request });
  assert.equal((await failed.status({ ownerId: "owner-1", projectId: "project-1", jobId: "status-failed" })).status, "needs-attention");
  const unknown = make(async ({ providerJobId }: { providerJobId: string }) => ({ providerJobId, status: "unknown" }));
  await unknown.submit({ ownerId: "owner-1", job: job("status-unknown"), request });
  assert.equal((await unknown.status({ ownerId: "owner-1", projectId: "project-1", jobId: "status-unknown" })).status, "needs-attention");
});
