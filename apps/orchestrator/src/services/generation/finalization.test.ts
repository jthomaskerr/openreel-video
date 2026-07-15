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
  id,
  provider: "wavespeed",
  modelId: "model",
  modelSchemaVersion: "schema",
  status: "queued",
  createdAt: 1,
  updatedAt: 1,
  context: {
    projectId: "project",
    shotId: "shot-1",
    target: { kind: "new-asset", placeholderMediaId: "placeholder-media" },
    references: [],
    placementPolicy,
  },
  providerInputs: {},
  attempts: [{ attemptNumber: 1, providerJobId: "provider-job-1", startedAt: 1 }],
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

  const ports: FinalizationPorts = {
    download: {
      download: async () => {
        log.push("download");
        return { bytes, mimeType: verifyMime };
      },
    },
    verify: {
      verify: async ({ bytes: verifiedBytes, mimeType, maxBytes }) => {
        log.push(`verify:${mimeType}:${maxBytes}`);
        assert.equal(verifiedBytes, bytes);
        assert.equal(mimeType, verifyMime);
        assert.equal(maxBytes, verifyBytes);
      },
    },
    inspect: {
      inspect: async ({ bytes: inspectedBytes, mimeType }) => {
        log.push(`inspect:${mimeType}`);
        assert.equal(inspectedBytes, bytes);
        assert.equal(mimeType, verifyMime);
        return { width: 100, height: 50, durationSeconds: 12 };
      },
    },
    placeholder: {
      finalize: async ({ idempotencyKey, output }) => {
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
        log.push(`shot:${idempotencyKey}`);
        assert.equal(output.mediaId, "asset-1");
        assert.equal(output.versionId, "version-1");
        assert.equal(idempotencyKey, `generation:${jobId}:shot-linked`);
      },
    },
    placement: {
      place: async ({ idempotencyKey, output }) => {
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

  return { log, ports };
}

test("concurrent finalize calls share one run and do not resubmit work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob());
  const { log, ports } = createPorts();
  const finalizer = new GenerationFinalizer(repo, ports);

  const [first, second] = await Promise.all([finalizer.finalize("job-1", { provider: "wavespeed", providerJobId: "provider-job-1" }), finalizer.finalize("job-1", { provider: "wavespeed", providerJobId: "provider-job-1" })]);

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
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

test("finalize checkpoints survive restart and do not rerun completed steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const firstRepo = new FileGenerationJobRepository(dir);
  await firstRepo.create(makeJob("job-2"));
  const first = createPorts({ jobId: "job-2" });
  await new GenerationFinalizer(firstRepo, first.ports).finalize("job-2", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const second = createPorts({ jobId: "job-2" });
  const result = await new GenerationFinalizer(new FileGenerationJobRepository(dir), second.ports).finalize("job-2", { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(result.status, "completed");
  assert.deepEqual(second.log, []);
});

test("placement failure is recorded separately from completed job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-3", "create-linked-clip"));
  const { log, ports } = createPorts({ jobId: "job-3", placement: "fail" });
  const finalizer = new GenerationFinalizer(repo, ports);

  const failed = await finalizer.finalize("job-3", { provider: "wavespeed", providerJobId: "provider-job-1" });

  assert.equal(failed.status, "completed");
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

test("retryPlacement reruns only placement and does not call provider work again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(makeJob("job-4", "create-linked-clip"));
  const first = createPorts({ jobId: "job-4", placement: "fail" });
  const finalizer = new GenerationFinalizer(repo, first.ports);
  await finalizer.finalize("job-4", { provider: "wavespeed", providerJobId: "provider-job-1" });

  const retry = createPorts({ jobId: "job-4" });
  const retried = await new GenerationFinalizer(repo, retry.ports).retryPlacement("job-4");

  assert.equal(retried.status, "completed");
  assert.equal(retried.placement?.status, "applied");
  assert.deepEqual(retry.log, ["placement:generation:job-4:placement-applied"]);
});
