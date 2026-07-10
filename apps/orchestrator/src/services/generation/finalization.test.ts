import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileGenerationJobRepository } from "./repository.js";
import { GenerationFinalizer, type FinalizationPorts } from "./finalization.js";
import type { GenerationJob } from "@openreel/music-video-domain/generation";

const makeJob = (id = "job-1", placementPolicy: GenerationJob["context"]["placementPolicy"] = "none"): GenerationJob => ({
  schemaVersion: 2, id, provider: "wavespeed", modelId: "model", modelSchemaVersion: "schema", status: "queued", createdAt: 1, updatedAt: 1,
  context: { projectId: "project", shotId: "shot", target: { kind: "new-asset", placeholderMediaId: "placeholder" }, references: [], placementPolicy },
  providerInputs: {}, attempts: [{ attemptNumber: 1, providerJobId: "provider-job-1", startedAt: 1 }], checkpoints: {},
});

function ports(log: string[], failPlacement = false): FinalizationPorts {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    download: { download: async () => { log.push("download"); return { bytes, mimeType: "image/png" }; } },
    verify: { verify: async () => { log.push("verify"); } },
    inspect: { inspect: async () => { log.push("inspect"); return { width: 1, height: 1 }; } },
    placeholder: { finalize: async () => { log.push("placeholder"); return { mediaId: "media-1", versionId: "version-1" }; } },
    shot: { link: async () => { log.push("shot"); } },
    placement: { place: async () => { log.push("placement"); if (failPlacement) throw new Error("timeline offline"); } },
  };
}

test("two concurrent completion signals finalize one output and never resubmit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir); await repo.create(makeJob());
  const log: string[] = []; const finalizer = new GenerationFinalizer(repo, ports(log));
  const [a, b] = await Promise.all([finalizer.finalize("job-1", { provider: "wavespeed", providerJobId: "provider-job-1" }), finalizer.finalize("job-1", { provider: "wavespeed", providerJobId: "provider-job-1" })]);
  assert.equal(a.status, "completed"); assert.equal(b.status, "completed");
  assert.equal(log.filter((x) => x === "placeholder").length, 1);
  assert.equal((await repo.get("job-1"))?.output?.versionId, "version-1");
});

test("placement failure does not undo completed provider finalization and retry resumes placement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const repo = new FileGenerationJobRepository(dir); await repo.create(makeJob("job-2", "create-linked-clip"));
  const log: string[] = []; const first = new GenerationFinalizer(repo, ports(log, true));
  const failed = await first.finalize("job-2");
  assert.equal(failed.status, "completed"); assert.equal(failed.placement?.status, "failed");
  const retry = new GenerationFinalizer(repo, ports(log));
  const complete = await retry.retryPlacement("job-2");
  assert.equal(complete.status, "completed"); assert.equal(complete.placement?.status, "applied");
  assert.equal(log.filter((x) => x === "placeholder").length, 1);
});

test("a checkpointed job can be recovered by a new repository/finalizer instance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-finalize-"));
  const firstRepo = new FileGenerationJobRepository(dir); await firstRepo.create(makeJob("job-3"));
  const firstLog: string[] = []; const first = new GenerationFinalizer(firstRepo, ports(firstLog)); await first.finalize("job-3");
  const secondRepo = new FileGenerationJobRepository(dir); const secondLog: string[] = [];
  const result = await new GenerationFinalizer(secondRepo, ports(secondLog)).finalize("job-3");
  assert.equal(result.status, "completed"); assert.deepEqual(secondLog, []);
});

