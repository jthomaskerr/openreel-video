import { strict as assert } from "node:assert";
import test from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationRecoveryService } from "./recovery";

const route = { providerInstanceId: "wavespeed-prod", providerModelId: "m", requestedMode: "text-to-video" as const, providerSchemaId: "schema", providerEndpointId: "submit", providerSchemaVersion: "2026-01" };
const job = (status: GenerationJob["status"] = "failed"): GenerationJob => ({ schemaVersion: 2, contractVersion: 2, id: "job-1", projectId: "p", provider: "wavespeed", providerInstanceId: route.providerInstanceId, modelId: "m", modelSchemaVersion: "s", routing: route, providerJobId: "provider-1", attempt: 1, status, createdAt: 1, updatedAt: 1, context: { projectId: "p", entryContext: { kind: "new-asset" }, mode: "text-to-video", prompt: "test", references: [], placementPolicy: "create-linked-clip" }, providerInputs: {}, attempts: [{ attemptNumber: 1, routing: route, providerJobId: "provider-1", startedAt: 1 }], checkpoints: {} });

function placementCandidate(): GenerationJob {
  const unknown = { code: "generation-placement-outcome-unknown", message: "placement response lost", retryable: false };
  return {
    ...job("needs-attention"),
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 4, sha256: "hash", width: 16, height: 9, durationSeconds: 1 },
    checkpoints: { "placement-applied": { status: "failed", timestamp: 8, error: unknown } },
    placement: { policy: "create-linked-clip", status: "failed", error: unknown },
    error: unknown,
  };
}

function repo(initial: GenerationJob) { let current = initial; return { get: async () => current, update: async (_id: string, mutate: (j: GenerationJob) => GenerationJob) => (current = mutate(current)), compareAndSetCheckpoint: async () => true, create: async () => current, findByProviderCompletion: async () => undefined, listActive: async () => [] } as any; }

test("retries provider with one new attempt and never rewrites history", async () => {
    const repository = repo(job()); let submits = 0; const provider = { submit: async () => { submits++; return { providerJobId: "provider-2" }; } }; const service = new GenerationRecoveryService(repository, provider, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    const result = await service.retryProvider("job-1");
    assert.equal(submits, 1); assert.equal(result.attempts.length, 2); assert.equal(result.attempts[0].providerJobId, "provider-1");
    assert.equal(result.attempts[1].providerJobId, "provider-2"); assert.equal(result.providerJobId, "provider-2");
});
test("rejects a provider retry that reuses an earlier provider job ID", async () => {
    const repository = repo(job()); let submits = 0; const service = new GenerationRecoveryService(repository, { submit: async () => { submits++; return { providerJobId: "provider-1" }; } }, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    const result = await service.retryProvider("job-1");
    assert.equal(submits, 1); assert.equal(result.status, "failed"); assert.equal(result.error?.code, "generation-provider-retry-id-reused"); assert.equal(result.attempts.length, 1);
});
test("finalization and placement retries do not call provider", async () => {
    const repository = repo(job("completed")); let submits = 0; const provider = { submit: async () => { submits++; return { providerJobId: "never" }; } }; const service = new GenerationRecoveryService(repository, provider, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    const before = await repository.get("job-1");
    await service.retryFinalization("job-1"); await service.retryPlacement("job-1"); assert.equal(submits, 0);
    assert.equal((await repository.get("job-1"))?.checkpoints["placeholder-finalized"]?.status, before?.checkpoints["placeholder-finalized"]?.status ?? "pending");
});
test("finalization retry rewinds only the failed finalization stage", async () => {
    const initial = job("failed");
    initial.checkpoints = {
      "output-claimed": { status: "completed" }, "output-downloaded": { status: "completed" }, "output-verified": { status: "completed" },
      "output-inspected": { status: "completed" }, "placeholder-finalized": { status: "failed" }, "shot-linked": { status: "pending" }, "placement-applied": { status: "pending" },
    };
    const repository = repo(initial); const service = new GenerationRecoveryService(repository, { submit: async () => ({ providerJobId: "never" }) }, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    const result = await service.retryFinalization("job-1");
    assert.equal(result.checkpoints["output-downloaded"]?.status, "completed"); assert.equal(result.checkpoints["output-verified"]?.status, "completed");
    assert.equal(result.checkpoints["output-inspected"]?.status, "completed"); assert.equal(result.checkpoints["placeholder-finalized"]?.status, "pending");
    assert.equal(result.checkpoints["shot-linked"]?.status, "pending");
});
test("cancel is local-authoritative and polling stop is explicit", async () => {
    const repository = repo(job("running")); let cancels = 0; let cleanups = 0; const provider = { submit: async () => ({ providerJobId: "never" }), cancel: async () => { cancels++; throw new Error("unsupported"); } }; const service = new GenerationRecoveryService(repository, provider, { releaseUnreferenced: async () => { cleanups++; } }, { now: () => 9 });
    assert.equal((await service.cancel("job-1")).status, "canceled"); assert.equal(cancels, 1); assert.equal(cleanups, 1);
    assert.equal(service.polling.isStopped("job-1"), true);
});

test("needs-attention placement recovery delegates typed reconciliation and preserves unknown", async () => {
    const repository = repo(placementCandidate());
    let reconciliations = 0;
    let submits = 0;
    const service = new GenerationRecoveryService(
      repository,
      { submit: async () => { submits += 1; return { providerJobId: "never" }; } },
      { releaseUnreferenced: async () => {} },
      { now: () => 9 },
      undefined,
      { reconcilePlacement: async () => {
        reconciliations += 1;
        assert.equal((await repository.get("job-1"))?.status, "finalizing");
        return repository.update("job-1", (current: GenerationJob) => ({ ...current, status: "needs-attention", error: { code: "generation-placement-outcome-unknown", message: "still unknown", retryable: false } }));
      } },
    );
    const result = await service.reconcilePlacement("job-1");
    assert.equal(reconciliations, 1);
    assert.equal(submits, 0);
    assert.equal(result.status, "needs-attention");
    assert.equal(result.error?.code, "generation-placement-outcome-unknown");
});

test("placement reconciliation rejects invalid candidates and an unavailable port without mutation", async () => {
    const invalidJobs: GenerationJob[] = [
      { ...placementCandidate(), status: "failed" },
      { ...placementCandidate(), context: { ...placementCandidate().context, placementPolicy: "none" } },
      { ...placementCandidate(), checkpoints: { "placement-applied": { status: "pending" } } },
      { ...placementCandidate(), error: { code: "generation-output-missing", message: "missing", retryable: true } },
    ];

    for (const invalid of invalidJobs) {
      const repository = repo(invalid);
      let mutations = 0;
      let reconciliations = 0;
      const originalUpdate = repository.update.bind(repository);
      repository.update = async (...args: Parameters<typeof originalUpdate>) => {
        mutations += 1;
        return originalUpdate(...args);
      };
      const service = new GenerationRecoveryService(
        repository,
        { submit: async () => ({ providerJobId: "never" }) },
        { releaseUnreferenced: async () => {} },
        { now: () => 9 },
        undefined,
        { reconcilePlacement: async () => { reconciliations += 1; return invalid; } },
      );
      await assert.rejects(service.reconcilePlacement("job-1"), /generation-invalid-placement-reconciliation-state/);
      assert.equal(mutations, 0);
      assert.equal(reconciliations, 0);
    }

    const repository = repo(placementCandidate());
    let mutations = 0;
    const originalUpdate = repository.update.bind(repository);
    repository.update = async (...args: Parameters<typeof originalUpdate>) => {
      mutations += 1;
      return originalUpdate(...args);
    };
    const unavailable = new GenerationRecoveryService(repository, { submit: async () => ({ providerJobId: "never" }) }, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    await assert.rejects(unavailable.reconcilePlacement("job-1"), /generation-placement-reconciliation-unavailable/);
    assert.equal(mutations, 0);
});

test("a thrown placement reconciler returns to explicit recoverable needs-attention", async () => {
    const repository = repo(placementCandidate());
    const service = new GenerationRecoveryService(
      repository,
      { submit: async () => ({ providerJobId: "never" }) },
      { releaseUnreferenced: async () => {} },
      { now: () => 9 },
      undefined,
      { reconcilePlacement: async () => {
        assert.equal((await repository.get("job-1"))?.status, "finalizing");
        throw new Error("reconciliation transport unavailable");
      } },
    );

    const result = await service.reconcilePlacement("job-1");
    assert.equal(result.status, "needs-attention");
    assert.equal(result.error?.code, "generation-placement-reconciliation-failed");
    assert.match(result.error?.message ?? "", /transport unavailable/);
    assert.equal(result.checkpoints["placement-applied"]?.status, "failed");
});
