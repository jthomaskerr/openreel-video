import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileGenerationJobRepository } from "./repository.js";
const routing = { providerInstanceId: "wavespeed-prod", providerModelId: "m", requestedMode: "text-to-image" as const, providerSchemaId: "schema", providerEndpointId: "submit", providerSchemaVersion: "2026-01" };
const job = (id: string) => ({ schemaVersion: 2 as const, contractVersion: 2 as const, id, projectId: "p", provider: "wavespeed" as const, providerInstanceId: routing.providerInstanceId, modelId: "m", modelSchemaVersion: "s", routing, providerJobId: "provider-1", attempt: 1, status: "queued" as const, createdAt: 1, updatedAt: 1, context: { projectId: "p", entryContext: { kind: "new-asset" as const }, mode: "text-to-image" as const, prompt: "test", references: [], placementPolicy: "none" as const }, providerInputs: {}, attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-1", startedAt: 1 }], checkpoints: {} });
test("repository survives a second instance and writes valid JSON", async () => { const dir = await mkdtemp(join(tmpdir(), "generation-repo-")); const first = new FileGenerationJobRepository(dir); await first.create(job("j1")); const second = new FileGenerationJobRepository(dir); assert.equal((await second.get("j1"))?.id, "j1"); assert.deepEqual(JSON.parse(await readFile(join(dir, "j1.json"), "utf8")), job("j1")); });
test("provider completion identity is unique per provider instance", async () => { const dir = await mkdtemp(join(tmpdir(), "generation-repo-")); const repo = new FileGenerationJobRepository(dir); await repo.create(job("j1")); await assert.rejects(repo.create({ ...job("j2"), attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-1", startedAt: 1 }] }), /generation-provider-id-conflict/); const staging = { ...job("j3"), providerInstanceId: "wavespeed-staging", routing: { ...routing, providerInstanceId: "wavespeed-staging" }, attempts: [{ attemptNumber: 1, routing: { ...routing, providerInstanceId: "wavespeed-staging" }, providerJobId: "provider-1", startedAt: 1 }] }; await repo.create(staging); assert.equal((await repo.findByProviderCompletion("wavespeed", "provider-1", "wavespeed-staging"))?.id, "j3"); });
test("provider completion lookup requires provider instance identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-repo-instance-required-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(job("prod-lookup"));
  await assert.rejects(
    (repo.findByProviderCompletion as unknown as (provider: string, providerJobId: string) => Promise<unknown>)("wavespeed", "provider-1"),
    /generation-provider-instance-required/,
  );
  assert.equal((await repo.findByProviderCompletion("wavespeed", "provider-1", "wavespeed-prod"))?.id, "prod-lookup");
});

test("placement claim repair is explicit and fenced to the claimed owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-repair-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(job("placement-repair"));

  const claimed = await repo.claimPlacement("placement-repair", "placement-key");
  assert.equal(claimed.acquired, true);
  await assert.rejects(
    repo.repairPlacement("placement-repair", "wrong-owner"),
    /generation-placement-claim-fenced/,
  );
  assert.equal((await repo.getPlacementClaim("placement-repair"))?.state, "claimed");

  const repaired = await repo.repairPlacement("placement-repair", claimed.claim.ownerToken);
  assert.equal(repaired.state, "failed");
  const reacquired = await repo.claimPlacement("placement-repair", "placement-key");
  assert.equal(reacquired.acquired, true);
  assert.notEqual(reacquired.claim.ownerToken, claimed.claim.ownerToken);
});
