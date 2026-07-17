import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationFinalizer, type FinalizationPorts } from "./finalization.js";
import { FileGenerationJobRepository } from "./repository.js";

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
  placement?: "success" | "fail";
  verifyBytes?: number;
  verifyMime?: string;
}) {
  const log: string[] = [];
  const jobId = options?.jobId ?? "job-1";
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const placementOutcome = options?.placement ?? "success";
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
        if (placementOutcome === "fail") throw new Error("timeline offline");
      },
    },
    maxOutputBytes: verifyBytes,
    clock: () => 123,
  };

  return { log, ports, calls };
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
