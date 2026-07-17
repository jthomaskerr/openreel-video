import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationFinalizer, type FinalizationPorts } from "./finalization.js";
import { isPlacementReconciliationCandidate } from "./recovery.js";
import { FileGenerationJobRepository, GenerationRepositoryError } from "./repository.js";

const makeJob = (id = "job-1", placementPolicy: GenerationJob["context"]["placementPolicy"] = "none"): GenerationJob => ({
  schemaVersion: 2,
  contractVersion: 2,
  id,
  projectId: "project",
  provider: "wavespeed",
  providerInstanceId: "wavespeed-prod",
  modelId: "model",
  modelSchemaVersion: "schema",
  routing: {
    providerInstanceId: "wavespeed-prod",
    providerModelId: "model",
    requestedMode: "text-to-image",
    providerSchemaId: "schema",
    providerEndpointId: "wavespeed-submit",
    providerSchemaVersion: "2026-01",
  },
  providerJobId: "provider-job-1",
  status: "queued",
  attempt: 1,
  createdAt: 1,
  updatedAt: 1,
  context: {
    projectId: "project",
    entryContext: { kind: "unplaced-shot", shotId: "shot-1" },
    mode: "text-to-image",
    prompt: "A test image",
    references: [],
    placementPolicy,
  },
  providerInputs: { placeholderMediaId: "placeholder-media" },
  attempts: [{ attemptNumber: 1, providerJobId: "provider-job-1", routing: {
    providerInstanceId: "wavespeed-prod",
    providerModelId: "model",
    requestedMode: "text-to-image",
    providerSchemaId: "schema",
    providerEndpointId: "wavespeed-submit",
    providerSchemaVersion: "2026-01",
  }, startedAt: 1 }],
  checkpoints: {},
});

function createPorts(options?: {
  jobId?: string;
  placement?: "success" | "fail" | "throw";
  reconcile?: "applied" | "not-applied" | "unknown" | "pending";
  verifyBytes?: number;
  verifyMime?: string;
}) {
  const log: string[] = [];
  const jobId = options?.jobId ?? "job-1";
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const placementOutcome = options?.placement ?? "success";
  const reconciliationOutcome = options?.reconcile ?? "applied";
  const verifyMime = options?.verifyMime ?? "image/png";
  const verifyBytes = options?.verifyBytes ?? 1024;
  const calls = { download: 0, verify: 0, inspect: 0, placeholder: 0, shot: 0, placement: 0 };

  const ports: FinalizationPorts = {
    download: {
      download: async () => {
        calls.download += 1;
        log.push("download");
        return { bytes, mimeType: verifyMime };
      },
    },
    verify: {
      verify: async ({ bytes: verifiedBytes, mimeType, maxBytes }) => {
        calls.verify += 1;
        log.push(`verify:${mimeType}:${maxBytes}`);
        assert.equal(verifiedBytes, bytes);
        assert.equal(mimeType, verifyMime);
        assert.equal(maxBytes, verifyBytes);
      },
    },
    inspect: {
      inspect: async ({ bytes: inspectedBytes, mimeType }) => {
        calls.inspect += 1;
        log.push(`inspect:${mimeType}`);
        assert.equal(inspectedBytes, bytes);
        assert.equal(mimeType, verifyMime);
        return { width: 100, height: 50, durationSeconds: 12 };
      },
    },
    placeholder: {
      finalize: async ({ idempotencyKey, output }) => {
        calls.placeholder += 1;
        log.push(`placeholder:${idempotencyKey}`);
        assert.equal(output.mediaId, "placeholder-media");
        assert.equal(output.mimeType, verifyMime);
        assert.equal(output.byteLength, bytes.byteLength);
        assert.equal(output.versionId, `pending:${jobId}`);
        assert.equal(idempotencyKey, `generation:${jobId}:placeholder-finalized`);
        return { mediaId: "asset-1", versionId: "version-1" };
      },
    },
    shot: {
      link: async ({ idempotencyKey, output }) => {
        calls.shot += 1;
        log.push(`shot:${idempotencyKey}`);
        assert.equal(output.mediaId, "asset-1");
        assert.equal(output.versionId, "version-1");
        assert.equal(idempotencyKey, `generation:${jobId}:shot-linked`);
      },
    },
    placement: {
      place: async ({ idempotencyKey, output }) => {
        calls.placement += 1;
        log.push(`placement:${idempotencyKey}`);
        assert.equal(output.mediaId, "asset-1");
        assert.equal(output.versionId, "version-1");
        assert.equal(idempotencyKey, `generation:${jobId}:placement-applied`);
        if (placementOutcome === "fail") return { outcome: "not-applied", replaySafe: true, error: { code: "generation-placement-failed", message: "timeline offline", retryable: true } };
        if (placementOutcome === "throw") throw new Error("timeline response lost");
        return { outcome: "applied" };
      },
      reconcile: async () => ({ outcome: reconciliationOutcome }),
    },
    maxOutputBytes: verifyBytes,
    clock: () => 123,
  };

  return { log, ports, calls };
}

function createManualPlacementLeaseScheduler() {
  let heartbeat: (() => Promise<void>) | undefined;
  let active = false;
  let stops = 0;
  return {
    scheduler: {
      start(input: { tick: () => Promise<void> }) {
        heartbeat = input.tick;
        active = true;
        return {
          stop: async () => {
            active = false;
            stops += 1;
          },
        };
      },
    },
    tick: async () => {
      if (active) await heartbeat?.();
    },
    isActive: () => active,
    stopCount: () => stops,
  };
}

test("concurrent finalize calls share one run and do not resubmit work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob());
  const { log, ports } = createPorts();
  const finalizer = new GenerationFinalizer(repo, ports);

  const [first, second] = await Promise.all([finalizer.finalize("job-1", { provider: "wavespeed", providerJobId: "provider-job-1" }), finalizer.finalize("job-1", { provider: "wavespeed", providerJobId: "provider-job-1" })]);

  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "succeeded");
  assert.deepEqual(log, [
    "download",
    "verify:image/png:1024",
    "inspect:image/png",
    "placeholder:generation:job-1:placeholder-finalized",
    "shot:generation:job-1:shot-linked",
  ]);
  assert.equal((await repo.get("job-1"))?.output?.mediaId, "asset-1");
  assert.equal((await repo.get("job-1"))?.output?.versionId, "version-1");
});

test("separate finalizer instances claim one durable completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-durable-claim"));
  const first = createPorts({ jobId: "job-durable-claim" });
  const second = createPorts({ jobId: "job-durable-claim" });

  const [left, right] = await Promise.all([
    new GenerationFinalizer(repo, first.ports).finalize("job-durable-claim", { provider: "wavespeed", providerJobId: "provider-job-1" }),
    new GenerationFinalizer(repo, second.ports).finalize("job-durable-claim", { provider: "wavespeed", providerJobId: "provider-job-1" }),
  ]);

  assert.equal(left.status, "succeeded");
  assert.equal(right.status, "succeeded");
  assert.equal((await repo.getFinalizationClaim("job-durable-claim"))?.providerInstanceId, "wavespeed-prod");
  assert.equal(first.log.filter((entry) => entry.startsWith("placeholder:")).length + second.log.filter((entry) => entry.startsWith("placeholder:")).length, 1);
  assert.equal(first.log.filter((entry) => entry.startsWith("shot:")).length + second.log.filter((entry) => entry.startsWith("shot:")).length, 1);
});

test("finalize checkpoints survive restart and do not rerun completed steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const firstRepo = new FileGenerationJobRepository(dir);
  await firstRepo.create(makeJob("job-2"));
  const first = createPorts({ jobId: "job-2" });
  await new GenerationFinalizer(firstRepo, first.ports).finalize("job-2", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const second = createPorts({ jobId: "job-2" });
  const result = await new GenerationFinalizer(new FileGenerationJobRepository(dir), second.ports).finalize("job-2", { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(second.log, []);
});

test("placement failure is recorded separately from completed job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-3", "create-linked-clip"));
  const { log, ports } = createPorts({ jobId: "job-3", placement: "fail" });
  const finalizer = new GenerationFinalizer(repo, ports);

  const failed = await finalizer.finalize("job-3", { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(failed.status, "succeeded");
  assert.equal(failed.placement?.status, "failed");
  assert.equal(failed.checkpoints["placement-applied"]?.status, "failed");
  assert.equal(failed.error, undefined);
  assert.deepEqual(log, [
    "download",
    "verify:image/png:1024",
    "inspect:image/png",
    "placeholder:generation:job-3:placeholder-finalized",
    "shot:generation:job-3:shot-linked",
    "placement:generation:job-3:placement-applied",
  ]);
});

test("late completion after cancellation cannot download or mutate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create({ ...makeJob("job-canceled"), status: "canceled" });
  let calls = 0;
  const { ports } = createPorts({ jobId: "job-canceled" });
  ports.download.download = async () => { calls += 1; throw new Error("late download"); };
  const result = await new GenerationFinalizer(repo, ports).finalize("job-canceled", { provider: "wavespeed", providerJobId: "provider-job-1" });
  assert.equal(result.status, "canceled");
  assert.equal(result.error?.code, "generation-completion-not-owned");
  assert.equal(calls, 0);
});

test("checkpoint compare-and-set preserves concurrent stage transitions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-cas"));
  const results = await Promise.all([
    repo.compareAndSetCheckpoint("job-cas", "output-downloaded", { status: "completed", timestamp: 2 }),
    repo.compareAndSetCheckpoint("job-cas", "output-verified", { status: "completed", timestamp: 3 }),
  ]);
  const saved = await repo.get("job-cas");
  assert.deepEqual(results, [true, true]);
  assert.equal(saved?.checkpoints["output-downloaded"]?.status, "completed");
  assert.equal(saved?.checkpoints["output-verified"]?.status, "completed");
});

test("retryPlacement reruns only placement and does not call provider work again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-4", "create-linked-clip"));
  const first = createPorts({ jobId: "job-4", placement: "fail" });
  const finalizer = new GenerationFinalizer(repo, first.ports);
  await finalizer.finalize("job-4", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const retry = createPorts({ jobId: "job-4" });
  const retried = await new GenerationFinalizer(repo, retry.ports).retryPlacement("job-4");

  assert.equal(retried.status, "succeeded");
  assert.equal(retried.placement?.status, "applied");
  assert.deepEqual(retry.log, ["placement:generation:job-4:placement-applied"]);
});

test("stage-only placement recovery executes only placement and preserves earlier artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-stage-only", "create-linked-clip"));
  const first = createPorts({ jobId: "job-stage-only", placement: "fail" });
  await new GenerationFinalizer(repo, first.ports).finalize("job-stage-only", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const retry = createPorts({ jobId: "job-stage-only" });
  const persistence: string[] = [];
  const compareAndSetCheckpoint = repo.compareAndSetCheckpoint.bind(repo);
  repo.compareAndSetCheckpoint = async (id, checkpoint, state) => {
    persistence.push(checkpoint);
    return compareAndSetCheckpoint(id, checkpoint, state);
  };
  const retried = await new GenerationFinalizer(repo, retry.ports).retryPlacement("job-stage-only");

  assert.equal(retried.status, "succeeded");
  assert.deepEqual(retry.log, ["placement:generation:job-stage-only:placement-applied"]);
  assert.deepEqual(retry.calls, { download: 0, verify: 0, inspect: 0, placeholder: 0, shot: 0, placement: 1 });
  assert.deepEqual(persistence, ["placement-applied"]);
  assert.equal(retried.checkpoints["output-downloaded"]?.status, "completed");
  assert.equal(retried.checkpoints["output-verified"]?.status, "completed");
  assert.equal(retried.checkpoints["output-inspected"]?.status, "completed");
  assert.equal(retried.checkpoints["placeholder-finalized"]?.status, "completed");
  assert.equal(retried.checkpoints["shot-linked"]?.status, "completed");
});

test("concurrent placement retries across finalizer instances place exactly once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-placement-claim-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-concurrent", "create-linked-clip"));
  const failed = createPorts({ jobId: "job-placement-concurrent", placement: "fail" });
  await new GenerationFinalizer(repo, failed.ports).finalize("job-placement-concurrent", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const left = createPorts({ jobId: "job-placement-concurrent" });
  const right = createPorts({ jobId: "job-placement-concurrent" });
  const [leftResult, rightResult] = await Promise.all([
    new GenerationFinalizer(new FileGenerationJobRepository(dir), left.ports).retryPlacement("job-placement-concurrent"),
    new GenerationFinalizer(new FileGenerationJobRepository(dir), right.ports).retryPlacement("job-placement-concurrent"),
  ]);

  assert.equal(leftResult.status, "succeeded");
  assert.equal(rightResult.status, "succeeded");
  assert.equal(left.calls.placement + right.calls.placement, 1);
});

test("placement retry rejects before output and prior checkpoints exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-placement-precondition-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-premature", "create-linked-clip"));
  const ports = createPorts({ jobId: "job-placement-premature" });

  await assert.rejects(
    new GenerationFinalizer(repo, ports.ports).retryPlacement("job-placement-premature"),
    /generation-placement-retry-precondition/,
  );
  assert.deepEqual(ports.calls, { download: 0, verify: 0, inspect: 0, placeholder: 0, shot: 0, placement: 0 });
  const saved = await repo.get("job-placement-premature");
  assert.equal(saved?.status, "queued");
  assert.equal(saved?.output, undefined);
  assert.equal(saved?.checkpoints["placement-applied"], undefined);
});

test("placement retry releases its claim when the pending checkpoint update fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-guard-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-update-fails", "create-linked-clip"));
  const first = createPorts({ jobId: "job-placement-update-fails", placement: "fail" });
  await new GenerationFinalizer(repo, first.ports).finalize("job-placement-update-fails", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const originalUpdate = repo.update.bind(repo);
  let failed = true;
  repo.update = async (...args) => {
    if (failed) {
      failed = false;
      throw new Error("pending update unavailable");
    }
    return originalUpdate(...args);
  };
  const result = await new GenerationFinalizer(repo, createPorts({ jobId: "job-placement-update-fails" }).ports).retryPlacement("job-placement-update-fails");
  assert.equal(result.placement?.status, "failed");
  assert.equal((await repo.getPlacementClaim("job-placement-update-fails"))?.state, "failed");
});

test("placement completion persistence failure is repaired with the same idempotency key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-reconcile-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-reconcile", "create-linked-clip"));
  const first = createPorts({ jobId: "job-placement-reconcile", placement: "fail" });
  await new GenerationFinalizer(repo, first.ports).finalize("job-placement-reconcile", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const originalReconcile = repo.reconcilePlacement.bind(repo);
  let completionWriteFailed = true;
  repo.reconcilePlacement = async (...args) => {
    const result = await originalReconcile(...args);
    if (completionWriteFailed && args[3] === "applied") {
      completionWriteFailed = false;
      throw new Error("claim completion unavailable");
    }
    return result;
  };
  const retryPorts = createPorts({ jobId: "job-placement-reconcile" });
  const retryFinalizer = new GenerationFinalizer(repo, retryPorts.ports);
  await assert.rejects(retryFinalizer.retryPlacement("job-placement-reconcile"), /claim completion unavailable/);
  const reconciled = await new GenerationFinalizer(new FileGenerationJobRepository(dir), retryPorts.ports).retryPlacement("job-placement-reconcile");
  assert.equal(reconciled.placement?.status, "applied");
  assert.equal(retryPorts.calls.placement, 1);
});

test("outer finalization completion failure repairs from the terminal placement projection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalization-completion-repair-"));
  const repo = new FileGenerationJobRepository(dir);
  const jobId = "job-finalization-completion-repair";
  await repo.create(makeJob(jobId, "create-linked-clip"));
  const completeFinalization = repo.completeFinalization.bind(repo);
  let failCompletion = true;
  repo.completeFinalization = async (...args) => {
    if (failCompletion) {
      failCompletion = false;
      throw new Error("finalization completion unavailable");
    }
    return completeFinalization(...args);
  };

  const result = await new GenerationFinalizer(repo, createPorts({ jobId }).ports)
    .finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(result.status, "succeeded");
  assert.equal(result.placement?.status, "applied");
  assert.equal(result.checkpoints["placement-applied"]?.status, "completed");
  const completedClaim = await repo.getFinalizationClaim(jobId);
  assert.equal(completedClaim?.state, "completed");
  assert.ok(completedClaim);

  await writeFile(join(dir, `finalization-${jobId}.json`), JSON.stringify({ ...completedClaim, state: "claimed" }));
  const restartedRepository = new FileGenerationJobRepository(dir);
  const restartedPorts = createPorts({ jobId });
  const restarted = await new GenerationFinalizer(restartedRepository, restartedPorts.ports)
    .finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });
  assert.equal(restarted.status, "succeeded");
  assert.equal(restarted.placement?.status, "applied");
  assert.equal(restartedPorts.calls.placement, 0);
  assert.equal((await restartedRepository.getFinalizationClaim(jobId))?.state, "completed");
});

test("public placement reconciliation requires no repository token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-owner-fence-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-owner-fence", "create-linked-clip"));
  const first = createPorts({ jobId: "job-placement-owner-fence", placement: "fail" });
  await new GenerationFinalizer(repo, first.ports).finalize("job-placement-owner-fence", { provider: "wavespeed", providerJobId: "provider-job-1" });
  const retryPorts = createPorts({ jobId: "job-placement-owner-fence", placement: "throw", reconcile: "applied" });
  const finalizer = new GenerationFinalizer(repo, retryPorts.ports);
  const result = await finalizer.retryPlacement("job-placement-owner-fence");
  assert.equal(result.status, "needs-attention");
  const reconciled = await finalizer.reconcilePlacement("job-placement-owner-fence");
  assert.equal(reconciled.status, "succeeded");
  assert.equal(retryPorts.calls.placement, 1);
});

test("live placement owner plus service reconciliation remains pending without lookup, fencing, or duplication", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-live-owner-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-live-owner", "create-linked-clip"));
  const failed = createPorts({ jobId: "job-placement-live-owner", placement: "fail" });
  await new GenerationFinalizer(repo, failed.ports).finalize("job-placement-live-owner", { provider: "wavespeed", providerJobId: "provider-job-1" });

  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const live = createPorts({ jobId: "job-placement-live-owner", reconcile: "not-applied" });
  let reconciliationCalls = 0;
  live.ports.placement!.reconcile = async () => {
    reconciliationCalls += 1;
    return { outcome: "not-applied" };
  };
  live.ports.placement!.place = async () => {
    live.calls.placement += 1;
    entered();
    await releasePromise;
    return { outcome: "applied" };
  };
  const liveFinalizer = new GenerationFinalizer(repo, live.ports);
  const liveRun = liveFinalizer.retryPlacement("job-placement-live-owner");
  await enteredPromise;
  const beforeReconciliation = await repo.get("job-placement-live-owner");
  assert.equal(beforeReconciliation?.placement?.status, "pending");
  assert.equal(beforeReconciliation?.checkpoints["placement-applied"]?.status, "pending");

  const pending = await liveFinalizer.reconcilePlacement("job-placement-live-owner");
  assert.equal(pending.status, "succeeded");
  assert.equal(pending.placement?.status, "pending");
  assert.equal(pending.error, undefined);
  assert.equal(pending.checkpoints["placement-applied"]?.status, "pending");
  assert.equal(pending.checkpoints["placement-applied"]?.error, undefined);
  assert.equal(reconciliationCalls, 0);
  assert.equal((await repo.getPlacementClaim("job-placement-live-owner"))?.outcome, "pending");
  release();
  const result = await liveRun;
  assert.equal(result.placement?.status, "applied");
  assert.equal(live.calls.placement, 1);
});

test("placement heartbeat keeps a live external call owned beyond its original lease", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-live-heartbeat-"));
  let now = 100;
  const repository = new FileGenerationJobRepository(dir, 30, () => now);
  await repository.create(makeJob("job-placement-live-heartbeat", "create-linked-clip"));
  const failed = createPorts({ jobId: "job-placement-live-heartbeat", placement: "fail" });
  await new GenerationFinalizer(repository, failed.ports).finalize("job-placement-live-heartbeat", { provider: "wavespeed", providerJobId: "provider-job-1" });

  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const live = createPorts({ jobId: "job-placement-live-heartbeat" });
  const heartbeat = createManualPlacementLeaseScheduler();
  live.ports.placementLeaseScheduler = heartbeat.scheduler;
  live.ports.placement!.place = async () => {
    live.calls.placement += 1;
    entered();
    await releasePromise;
    return { outcome: "applied" };
  };
  const liveRun = new GenerationFinalizer(repository, live.ports).retryPlacement("job-placement-live-heartbeat");
  await enteredPromise;

  const initialClaim = await repository.getPlacementClaim("job-placement-live-heartbeat");
  assert.equal(initialClaim?.phase, "invocation-armed");
  assert.equal(typeof initialClaim?.leaseExpiresAt, "number");
  const originalLeaseExpiry = initialClaim!.leaseExpiresAt;
  now = originalLeaseExpiry - 5;
  await heartbeat.tick();
  now = originalLeaseExpiry + 1;

  const recoveryRepository = new FileGenerationJobRepository(dir, 30, () => now);
  const firstRecovery = await recoveryRepository.recoverPlacement("job-placement-live-heartbeat", "generation:job-placement-live-heartbeat:placement-applied");
  assert.equal(firstRecovery.kind, "owner-live");
  assert.equal(firstRecovery.claim.ownerToken, initialClaim?.ownerToken);
  now = originalLeaseExpiry + 20;
  await heartbeat.tick();
  now = originalLeaseExpiry + 31;
  const secondRecovery = await recoveryRepository.recoverPlacement("job-placement-live-heartbeat", "generation:job-placement-live-heartbeat:placement-applied");
  assert.equal(secondRecovery.kind, "owner-live");
  assert.equal(secondRecovery.claim.ownerToken, initialClaim?.ownerToken);
  let reconciliationCalls = 0;
  const observer = createPorts({ jobId: "job-placement-live-heartbeat" });
  observer.ports.placement!.reconcile = async () => {
    reconciliationCalls += 1;
    return { outcome: "not-applied" };
  };
  const pending = await new GenerationFinalizer(recoveryRepository, observer.ports).reconcilePlacement("job-placement-live-heartbeat");
  assert.equal(pending.placement?.status, "pending");
  assert.equal(reconciliationCalls, 0);

  release();
  const completed = await liveRun;
  assert.equal(completed.placement?.status, "applied");
  assert.equal(live.calls.placement, 1);
  assert.equal((await recoveryRepository.getPlacementClaim("job-placement-live-heartbeat"))?.state, "completed");
  assert.equal(heartbeat.isActive(), false);
  assert.equal(heartbeat.stopCount(), 1);
  const completedLease = (await recoveryRepository.getPlacementClaim("job-placement-live-heartbeat"))?.leaseExpiresAt;
  now += 100;
  await heartbeat.tick();
  assert.equal((await recoveryRepository.getPlacementClaim("job-placement-live-heartbeat"))?.leaseExpiresAt, completedLease);
});

test("fresh finalizer reconciliation safely retries a stale owner that crashed before placement invocation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-restart-before-invoke-"));
  let now = 100;
  const firstRepository = new FileGenerationJobRepository(dir, 10, () => now);
  await firstRepository.create(makeJob("job-placement-restart-before-invoke", "create-linked-clip"));
  const failed = createPorts({ jobId: "job-placement-restart-before-invoke", placement: "fail" });
  await new GenerationFinalizer(firstRepository, failed.ports).finalize("job-placement-restart-before-invoke", { provider: "wavespeed", providerJobId: "provider-job-1" });
  const completedFinalization = await firstRepository.getFinalizationClaim("job-placement-restart-before-invoke");
  assert.ok(completedFinalization);
  await writeFile(join(dir, "finalization-job-placement-restart-before-invoke.json"), JSON.stringify({ ...completedFinalization, state: "claimed" }));
  const abandoned = await firstRepository.claimPlacement("job-placement-restart-before-invoke", "generation:job-placement-restart-before-invoke:placement-applied");
  assert.equal(abandoned.claim.phase, "reserved");

  now = 111;
  const restartedRepository = new FileGenerationJobRepository(dir, 10, () => now);
  const restartedPorts = createPorts({ jobId: "job-placement-restart-before-invoke" });
  const result = await new GenerationFinalizer(restartedRepository, restartedPorts.ports).reconcilePlacement("job-placement-restart-before-invoke");
  assert.equal(result.placement?.status, "applied");
  assert.equal(restartedPorts.calls.placement, 1);
  const durable = await new FileGenerationJobRepository(dir, 10, () => now).getPlacementClaim("job-placement-restart-before-invoke");
  assert.equal(durable?.state, "completed");
  assert.notEqual(durable?.ownerToken, abandoned.claim.ownerToken);
  assert.equal((await restartedRepository.getFinalizationClaim("job-placement-restart-before-invoke"))?.state, "completed");
});

test("fresh finalizer reconciles a stale invoked placement by stable key and durably stores every outcome", async () => {
  const cases = [
    { outcome: "applied" as const, claimState: "completed" as const, jobStatus: "succeeded" as const, placementStatus: "applied" as const },
    { outcome: "not-applied" as const, claimState: "needs-attention" as const, jobStatus: "needs-attention" as const, placementStatus: "failed" as const },
    { outcome: "unknown" as const, claimState: "needs-attention" as const, jobStatus: "needs-attention" as const, placementStatus: "failed" as const },
  ];

  for (const testCase of cases) {
    const jobId = `job-placement-restart-${testCase.outcome}`;
    const dir = await mkdtemp(join(tmpdir(), `generation-placement-restart-${testCase.outcome}-`));
    let now = 100;
    const firstRepository = new FileGenerationJobRepository(dir, 10, () => now);
    await firstRepository.create(makeJob(jobId, "create-linked-clip"));
    const failed = createPorts({ jobId, placement: "fail" });
    await new GenerationFinalizer(firstRepository, failed.ports).finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });
    const abandoned = await firstRepository.claimPlacement(jobId, `generation:${jobId}:placement-applied`);
    await firstRepository.markPlacementInvocationStarted(jobId, `generation:${jobId}:placement-applied`, abandoned.claim.ownerToken);
    now = 111;

    const reconciliationKeys: string[] = [];
    let reconciliationCalls = 0;
    const restartedPorts = createPorts({ jobId });
    restartedPorts.ports.placement!.reconcile = async ({ idempotencyKey }) => {
      reconciliationCalls += 1;
      reconciliationKeys.push(idempotencyKey);
      return { outcome: testCase.outcome };
    };
    const restartedRepository = new FileGenerationJobRepository(dir, 10, () => now);
    const result = await new GenerationFinalizer(restartedRepository, restartedPorts.ports).reconcilePlacement(jobId);
    assert.equal(restartedPorts.calls.placement, 0);
    assert.equal(reconciliationCalls, 1);
    assert.deepEqual(reconciliationKeys, [`generation:${jobId}:placement-applied`]);
    assert.equal(result.status, testCase.jobStatus);
    assert.equal(result.placement?.status, testCase.placementStatus);

    const durableRepository = new FileGenerationJobRepository(dir, 10, () => now);
    const durableClaim = await durableRepository.getPlacementClaim(jobId);
    assert.equal(durableClaim?.state, testCase.claimState);
    assert.equal(durableClaim?.outcome, testCase.outcome);
    assert.notEqual(durableClaim?.ownerToken, abandoned.claim.ownerToken);
    const durableJob = await durableRepository.get(jobId);
    assert.equal(durableJob?.status, testCase.jobStatus);
    assert.equal(durableJob?.placement?.status, testCase.placementStatus);
    if (testCase.outcome !== "applied") {
      const replayPorts = createPorts({ jobId });
      const replay = await new GenerationFinalizer(durableRepository, replayPorts.ports).retryPlacement(jobId);
      assert.equal(replay.status, "needs-attention");
      assert.equal(replayPorts.calls.placement, 0);
    }
  }
});

test("legacy pending claims migrate conservatively to reconciliation and never blind replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-legacy-"));
  let now = 100;
  const firstRepository = new FileGenerationJobRepository(dir, 10, () => now);
  const jobId = "job-placement-legacy";
  await firstRepository.create(makeJob(jobId, "create-linked-clip"));
  const failed = createPorts({ jobId, placement: "fail" });
  await new GenerationFinalizer(firstRepository, failed.ports).finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });
  await writeFile(join(dir, `placement-${jobId}.json`), JSON.stringify({
    jobId,
    idempotencyKey: `generation:${jobId}:placement-applied`,
    state: "claimed",
    outcome: "pending",
    ownerToken: "legacy-owner",
    claimedAt: 100,
  }));
  now = 111;

  let reconciliationCalls = 0;
  const ports = createPorts({ jobId });
  ports.ports.placement!.reconcile = async ({ idempotencyKey }) => {
    reconciliationCalls += 1;
    assert.equal(idempotencyKey, `generation:${jobId}:placement-applied`);
    return { outcome: "unknown" };
  };
  const restartedRepository = new FileGenerationJobRepository(dir, 10, () => now);
  const result = await new GenerationFinalizer(restartedRepository, ports.ports).retryPlacement(jobId);

  assert.equal(reconciliationCalls, 1);
  assert.equal(ports.calls.placement, 0);
  assert.equal(result.status, "needs-attention");
  const durable = await restartedRepository.getPlacementClaim(jobId);
  assert.equal(durable?.schemaVersion, 2);
  assert.equal(durable?.phase, "terminal");
  assert.equal(durable?.outcome, "unknown");
});

test("a failed durable invocation arm makes zero external placement calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-arm-failure-"));
  const repository = new FileGenerationJobRepository(dir);
  const jobId = "job-placement-arm-failure";
  await repository.create(makeJob(jobId, "create-linked-clip"));
  const failed = createPorts({ jobId, placement: "fail" });
  await new GenerationFinalizer(repository, failed.ports).finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });
  repository.markPlacementInvocationStarted = async () => {
    throw new GenerationRepositoryError("generation-placement-claim-fenced");
  };
  const ports = createPorts({ jobId });

  const result = await new GenerationFinalizer(repository, ports.ports).retryPlacement(jobId);

  assert.equal(ports.calls.placement, 0);
  assert.notEqual(result.status, "failed");
  assert.equal(result.placement?.status, "pending");
});

test("a delayed original owner cannot downgrade recovery whether it returns before or after recovery commits", async () => {
  for (const recoveryFirst of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), `generation-placement-owner-loss-${recoveryFirst ? "recovery" : "owner"}-`));
    let now = 100;
    const ownerRepository = new FileGenerationJobRepository(dir, 10, () => now);
    const jobId = `job-placement-owner-loss-${recoveryFirst ? "recovery" : "owner"}`;
    await ownerRepository.create(makeJob(jobId, "create-linked-clip"));
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const ownerPorts = createPorts({ jobId });
    const heartbeat = createManualPlacementLeaseScheduler();
    ownerPorts.ports.placementLeaseScheduler = heartbeat.scheduler;
    ownerPorts.ports.placement!.place = async () => {
      ownerPorts.calls.placement += 1;
      entered();
      await releasePromise;
      return { outcome: "applied" };
    };
    const ownerRun = new GenerationFinalizer(ownerRepository, ownerPorts.ports).finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });
    await enteredPromise;
    now = 111;

    const recoveryRepository = new FileGenerationJobRepository(dir, 10, () => now);
    let reconciliationCalls = 0;
    const recoveryPorts = createPorts({ jobId });
    recoveryPorts.ports.placement!.reconcile = async () => {
      reconciliationCalls += 1;
      return { outcome: "applied" };
    };
    const recover = () => new GenerationFinalizer(recoveryRepository, recoveryPorts.ports).reconcilePlacement(jobId);

    let recovered: GenerationJob;
    if (recoveryFirst) {
      recovered = await recover();
      release();
      await ownerRun;
    } else {
      release();
      const ownerResult = await ownerRun;
      assert.notEqual(ownerResult.status, "failed");
      recovered = await recover();
    }

    assert.equal(recovered.status, "succeeded");
    assert.equal(reconciliationCalls, 1);
    assert.equal(ownerPorts.calls.placement, 1);
    const durableJob = await recoveryRepository.get(jobId);
    const durableClaim = await recoveryRepository.getPlacementClaim(jobId);
    assert.equal(durableJob?.status, "succeeded");
    assert.equal(durableJob?.placement?.status, "applied");
    assert.equal(durableClaim?.state, "completed");
    assert.equal(durableClaim?.outcome, "applied");
  }
});

test("a stale terminal projection cannot downgrade a newer applied reconciliation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-projection-race-"));
  const ownerRepository = new FileGenerationJobRepository(dir);
  const jobId = "job-placement-projection-race";
  await ownerRepository.create(makeJob(jobId, "create-linked-clip"));
  await new GenerationFinalizer(ownerRepository, createPorts({ jobId, placement: "fail" }).ports)
    .finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });

  let projectionEntered!: () => void;
  let releaseProjection!: () => void;
  const projectionEnteredPromise = new Promise<void>((resolve) => { projectionEntered = resolve; });
  const releaseProjectionPromise = new Promise<void>((resolve) => { releaseProjection = resolve; });
  const compareAndSetCheckpoint = ownerRepository.compareAndSetCheckpoint.bind(ownerRepository);
  let pauseUnknownProjection = true;
  ownerRepository.compareAndSetCheckpoint = async (id, checkpoint, state) => {
    if (pauseUnknownProjection && checkpoint === "placement-applied" && state.status === "failed") {
      pauseUnknownProjection = false;
      projectionEntered();
      await releaseProjectionPromise;
    }
    return compareAndSetCheckpoint(id, checkpoint, state);
  };
  const ownerPorts = createPorts({ jobId });
  ownerPorts.ports.placement!.place = async () => {
    ownerPorts.calls.placement += 1;
    return { outcome: "unknown" };
  };
  const ownerRun = new GenerationFinalizer(ownerRepository, ownerPorts.ports).retryPlacement(jobId);
  await projectionEnteredPromise;

  const recoveryRepository = new FileGenerationJobRepository(dir);
  const recoveryPorts = createPorts({ jobId, reconcile: "applied" });
  const recovered = await new GenerationFinalizer(recoveryRepository, recoveryPorts.ports).reconcilePlacement(jobId);
  releaseProjection();
  const staleResult = await ownerRun;

  assert.equal(recovered.status, "succeeded");
  assert.equal(staleResult.status, "succeeded");
  assert.equal(staleResult.placement?.status, "applied");
  assert.equal(ownerPorts.calls.placement, 1);
  const durable = await recoveryRepository.get(jobId);
  assert.equal(durable?.status, "succeeded");
  assert.equal(durable?.placement?.status, "applied");
  assert.equal(durable?.checkpoints["placement-applied"]?.status, "completed");
  assert.equal((await recoveryRepository.getPlacementClaim(jobId))?.outcome, "applied");
});

test("main finalization projects pending before the placement port completes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-pending-main-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-pending-main", "create-linked-clip"));
  const live = createPorts({ jobId: "job-placement-pending-main" });
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  let reconciliationCalls = 0;
  live.ports.placement!.reconcile = async () => {
    reconciliationCalls += 1;
    return { outcome: "unknown" };
  };
  live.ports.placement!.place = async () => {
    live.calls.placement += 1;
    entered();
    await releasePromise;
    return { outcome: "applied" };
  };

  const finalizer = new GenerationFinalizer(repo, live.ports);
  const finalizing = finalizer.finalize("job-placement-pending-main", { provider: "wavespeed", providerJobId: "provider-job-1" });
  await enteredPromise;
  const pending = await repo.get("job-placement-pending-main");
  assert.equal(pending?.placement?.status, "pending");
  assert.equal(pending?.checkpoints["placement-applied"]?.status, "pending");
  release();
  const result = await finalizing;

  assert.equal(result.placement?.status, "applied");
  assert.equal(live.calls.placement, 1);
  assert.equal(reconciliationCalls, 0);
  assert.equal((await repo.getPlacementClaim("job-placement-pending-main"))?.outcome, "applied");
  const durable = await repo.get("job-placement-pending-main");
  assert.equal(durable?.checkpoints["placement-applied"]?.status, "completed");
});

test("unknown placement outcome becomes needs-attention and blocks automatic replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-unknown-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-unknown", "create-linked-clip"));
  const failed = createPorts({ jobId: "job-placement-unknown", placement: "fail" });
  await new GenerationFinalizer(repo, failed.ports).finalize("job-placement-unknown", { provider: "wavespeed", providerJobId: "provider-job-1" });
  const ports = createPorts({ jobId: "job-placement-unknown", placement: "throw", reconcile: "unknown" });
  const finalizer = new GenerationFinalizer(repo, ports.ports);

  const recovered = await finalizer.retryPlacement("job-placement-unknown");
  assert.equal(recovered.status, "needs-attention");
  assert.equal(recovered.error?.code, "generation-placement-outcome-unknown");
  assert.equal(ports.calls.placement, 1);
  const stillBlocked = await finalizer.retryPlacement("job-placement-unknown");
  assert.equal(stillBlocked.status, "needs-attention");
  assert.equal(ports.calls.placement, 1);
});

test("post-invocation not-applied requires explicit replay-safe proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-not-applied-unsafe-"));
  const repo = new FileGenerationJobRepository(dir);
  const jobId = "job-placement-not-applied-unsafe";
  await repo.create(makeJob(jobId, "create-linked-clip"));
  const ports = createPorts({ jobId });
  ports.ports.placement!.place = async () => {
    ports.calls.placement += 1;
    return { outcome: "not-applied", error: { code: "MEDIA_NOT_FOUND", message: "timeline media was unavailable", retryable: true } };
  };

  const result = await new GenerationFinalizer(repo, ports.ports).finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(result.status, "needs-attention");
  assert.equal(result.error?.code, "generation-placement-retry-unsafe");
  assert.equal(result.placement?.status, "failed");
  assert.equal((await repo.getPlacementClaim(jobId))?.replaySafe, false);
  assert.equal(ports.calls.placement, 1);
});

test("adapter-specific unknown errors project a canonical recoverable disposition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-unknown-canonical-"));
  const repo = new FileGenerationJobRepository(dir);
  const jobId = "job-placement-unknown-canonical";
  await repo.create(makeJob(jobId, "create-linked-clip"));
  const ports = createPorts({ jobId });
  ports.ports.placement!.place = async () => ({
    outcome: "unknown",
    error: { code: "MEDIA_NOT_FOUND", message: "timeline media was unavailable", retryable: true },
  });

  const result = await new GenerationFinalizer(repo, ports.ports).finalize(jobId, { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(result.status, "needs-attention");
  assert.equal(result.error?.code, "generation-placement-outcome-unknown");
  assert.equal(result.error?.message, "timeline media was unavailable");
  assert.equal(isPlacementReconciliationCandidate(result), true);
});

test("completed placement claim repairs stale job and checkpoint without placing again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-job-repair-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-placement-job-repair", "create-linked-clip"));
  const failed = createPorts({ jobId: "job-placement-job-repair", placement: "fail" });
  await new GenerationFinalizer(repo, failed.ports).finalize("job-placement-job-repair", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const ports = createPorts({ jobId: "job-placement-job-repair" });
  const originalUpdate = repo.update.bind(repo);
  let updateCalls = 0;
  repo.update = async (...args) => {
    updateCalls += 1;
    if (updateCalls === 2) throw new Error("job write unavailable");
    return originalUpdate(...args);
  };
  const finalizer = new GenerationFinalizer(repo, ports.ports);
  await assert.rejects(finalizer.retryPlacement("job-placement-job-repair"), /job write unavailable/);
  const repaired = await finalizer.retryPlacement("job-placement-job-repair");
  assert.equal(repaired.status, "succeeded");
  assert.equal(repaired.checkpoints["placement-applied"]?.status, "completed");
  assert.equal(ports.calls.placement, 1);
});
