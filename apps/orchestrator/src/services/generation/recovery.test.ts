import { strict as assert } from "node:assert";
import test from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationRecoveryService, GenerationPollingController } from "./recovery";

const job = (status: GenerationJob["status"] = "failed"): GenerationJob => ({ schemaVersion: 2, id: "job-1", provider: "wavespeed", modelId: "m", modelSchemaVersion: "s", status, createdAt: 1, updatedAt: 1, context: { projectId: "p", target: { kind: "new-asset", placeholderMediaId: "pm" }, references: [], placementPolicy: "create-linked-clip" }, providerInputs: {}, attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }], checkpoints: {} });

function repo(initial: GenerationJob) { let current = initial; return { get: async () => current, update: async (_id: string, mutate: (j: GenerationJob) => GenerationJob) => (current = mutate(current)), compareAndSetCheckpoint: async () => true, create: async () => current, findByProviderCompletion: async () => undefined, listActive: async () => [] } as any; }

test("retries provider with one new attempt and never rewrites history", async () => {
    const repository = repo(job()); let submits = 0; const provider = { submit: async () => { submits++; return { providerJobId: "provider-2" }; } }; const service = new GenerationRecoveryService(repository, provider, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    const result = await service.retryProvider("job-1");
    assert.equal(submits, 1); assert.equal(result.attempts.length, 2); assert.equal(result.attempts[0].providerJobId, "provider-1");
});
test("finalization and placement retries do not call provider", async () => {
    const repository = repo(job("completed")); let submits = 0; const provider = { submit: async () => { submits++; return { providerJobId: "never" }; } }; const service = new GenerationRecoveryService(repository, provider, { releaseUnreferenced: async () => {} }, { now: () => 9 });
    await service.retryFinalization("job-1"); await service.retryPlacement("job-1"); assert.equal(submits, 0);
});
test("cancel is local-authoritative and polling stop is explicit", async () => {
    const repository = repo(job("running")); let cancels = 0; let cleanups = 0; const provider = { submit: async () => ({ providerJobId: "never" }), cancel: async () => { cancels++; throw new Error("unsupported"); } }; const service = new GenerationRecoveryService(repository, provider, { releaseUnreferenced: async () => { cleanups++; } }, { now: () => 9 });
    assert.equal((await service.cancel("job-1")).status, "canceled"); assert.equal(cancels, 1); assert.equal(cleanups, 1);
    const polling = new GenerationPollingController(); polling.stop("job-1"); assert.equal(polling.isStopped("job-1"), true);
});
