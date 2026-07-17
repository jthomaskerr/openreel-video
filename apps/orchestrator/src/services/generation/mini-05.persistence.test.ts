import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileGenerationJobRepository } from "./repository.js";
import { UploadRepository, UploadRepositoryError } from "./uploads.js";

const route = { providerInstanceId: "instance", providerModelId: "model", requestedMode: "text-to-video" as const, providerSchemaId: "schema", providerEndpointId: "endpoint", providerSchemaVersion: "v1" };
const job = { schemaVersion: 2 as const, contractVersion: 2 as const, id: "job", projectId: "project", provider: "wavespeed" as const, providerInstanceId: "instance", modelId: "model", modelSchemaVersion: "v1", routing: route, status: "queued" as const, attempt: 1, context: { projectId: "project", entryContext: { kind: "new-asset" as const }, mode: "text-to-video" as const, placementPolicy: "none" as const, prompt: "test", references: [] }, providerInputs: {}, attempts: [{ attemptNumber: 1, routing: route, startedAt: 1 }], checkpoints: {}, createdAt: 1, updatedAt: 1 };

test("rebuilds a missing provider index from durable attempts and classifies corrupt jobs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-repo-"));
  const repository = new FileGenerationJobRepository(directory);
  await repository.create(job);
  await repository.update("job", (current) => ({ ...current, status: "submitting", providerJobId: "provider-1", attempts: [{ ...current.attempts[0], providerJobId: "provider-1" }] }));
  await rm(join(directory, "provider-index.json"));
  assert.equal((await new FileGenerationJobRepository(directory).findByProviderCompletion("wavespeed", "provider-1", "instance"))?.id, "job");
  await writeFile(join(directory, "broken.json"), "not-json");
  await assert.rejects(new FileGenerationJobRepository(directory).get("broken"), /generation-corrupt/);
});

test("upload leases preserve distinct errors and survive a failed release write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-upload-"));
  let now = 100;
  const repository = new UploadRepository(directory, 100, () => now);
  const created = await repository.create({ ownerId: "owner", projectId: "project", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(await repository.get("missing", "owner", "project"), undefined);
  await assert.rejects(repository.get(created.id, "other", "project"), (error: UploadRepositoryError) => error.code === "upload-forbidden");
  now = created.expiresAt;
  await assert.rejects(repository.get(created.id, "owner", "project"), (error: UploadRepositoryError) => error.code === "upload-expired");
  now = 100;
  const lease = await repository.lease(created.id, "owner", "project");
  const originalAtomic = (repository as any).atomic;
  let fail = true;
  (repository as any).atomic = async (...args: unknown[]) => { if (fail) { fail = false; throw new Error("disk-full"); } return originalAtomic.apply(repository, args); };
  await assert.rejects(repository.releaseLease(lease.id), /disk-full/);
  (repository as any).atomic = originalAtomic;
  await repository.releaseLease(lease.id);
  assert.equal((await repository.get(created.id, "owner", "project"))?.references, 0);
  await writeFile(join(directory, `${created.id}.json`), "broken");
  await assert.rejects(repository.get(created.id, "owner", "project"), (error: UploadRepositoryError) => error.code === "upload-corrupt");
});

test("finalization claim never auto-reclaims and requires explicit fenced repair", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-finalization-"));
  let now = 100;
  const first = new FileGenerationJobRepository(directory, 10, () => now);
  const input = { jobId: "job", providerInstanceId: "instance", providerJobId: "provider", outputIdentity: JSON.stringify({ providerJobId: "provider", outputMediaIds: ["provider-output:0"] }), idempotencyKey: "generation:job:finalization:provider" };
  assert.equal((await first.claimFinalization(input)).acquired, true);
  assert.equal((await new FileGenerationJobRepository(directory, 10, () => now).claimFinalization(input)).acquired, false);
  now = 111;
  assert.equal((await new FileGenerationJobRepository(directory, 10, () => now).claimFinalization(input)).acquired, false);
  const current = await new FileGenerationJobRepository(directory).getFinalizationClaim(input.jobId);
  const failed = await new FileGenerationJobRepository(directory).repairFinalization(input.jobId, current!.ownerToken);
  assert.equal(failed.state, "failed");
  const recovered = await new FileGenerationJobRepository(directory, 10, () => now).claimFinalization(input);
  assert.equal(recovered.acquired, true);
  await assert.rejects(first.completeFinalization(input.jobId, input.idempotencyKey, current!.ownerToken), /generation-finalization-claim-fenced/);
  await new FileGenerationJobRepository(directory).completeFinalization(input.jobId, input.idempotencyKey, recovered.claim.ownerToken);
  assert.equal((await new FileGenerationJobRepository(directory).claimFinalization(input)).claim.state, "completed");
});

test("finalization recovery fences the crashed owner and preserves output identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-finalization-recovery-"));
  let now = 100;
  const first = new FileGenerationJobRepository(directory, 10, () => now);
  const input = { jobId: "job", providerInstanceId: "instance", providerJobId: "provider", outputIdentity: JSON.stringify({ providerJobId: "provider", outputMediaIds: ["provider-output:provider:0"] }), idempotencyKey: "generation:job:finalization:provider" };
  const initial = await first.claimFinalization(input);
  assert.equal(initial.acquired, true);
  now = 111;
  assert.equal((await new FileGenerationJobRepository(directory, 10, () => now).claimFinalization(input)).acquired, false);
  await new FileGenerationJobRepository(directory).repairFinalization(input.jobId, initial.claim.ownerToken);
  const recovered = await new FileGenerationJobRepository(directory, 10, () => now).claimFinalization(input);
  assert.equal(recovered.acquired, true);
  assert.notEqual(recovered.claim.ownerToken, initial.claim.ownerToken);
  await assert.rejects(first.completeFinalization(input.jobId, input.idempotencyKey, initial.claim.ownerToken), /generation-finalization-claim-fenced/);
  await new FileGenerationJobRepository(directory, 10, () => now).completeFinalization(input.jobId, input.idempotencyKey, recovered.claim.ownerToken!);
  assert.equal((await new FileGenerationJobRepository(directory).claimFinalization(input)).claim.state, "completed");
});

test("finalization claim rejects changed durable output identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generation-mini-05-output-conflict-"));
  const repository = new FileGenerationJobRepository(directory);
  const input = { jobId: "job", providerInstanceId: "instance", providerJobId: "provider", outputIdentity: JSON.stringify({ providerJobId: "provider", outputMediaIds: ["output-one"] }), idempotencyKey: "generation:job:finalization:provider" };
  await repository.claimFinalization(input);
  await assert.rejects(repository.claimFinalization({ ...input, outputIdentity: JSON.stringify({ providerJobId: "provider", outputMediaIds: ["output-two"] }) }), /generation-output-identity-conflict/);
});
