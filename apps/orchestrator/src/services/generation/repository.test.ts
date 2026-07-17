import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileGenerationJobRepository } from "./repository.js";
const routing = { providerInstanceId: "wavespeed-prod", providerModelId: "m", requestedMode: "text-to-image" as const, providerSchemaId: "schema", providerEndpointId: "submit", providerSchemaVersion: "2026-01" };
const job = (id: string) => ({ schemaVersion: 2 as const, contractVersion: 2 as const, id, projectId: "p", provider: "wavespeed" as const, providerInstanceId: routing.providerInstanceId, modelId: "m", modelSchemaVersion: "s", routing, providerJobId: "provider-1", attempt: 1, status: "queued" as const, createdAt: 1, updatedAt: 1, context: { projectId: "p", entryContext: { kind: "new-asset" as const }, mode: "text-to-image" as const, prompt: "test", references: [], placementPolicy: "none" as const }, providerInputs: {}, attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-1", startedAt: 1 }], checkpoints: {} });
test("repository survives a second instance and writes valid JSON", async () => { const dir = await mkdtemp(join(tmpdir(), "generation-repo-")); const first = new FileGenerationJobRepository(dir); await first.create(job("j1")); const second = new FileGenerationJobRepository(dir); assert.equal((await second.get("j1"))?.id, "j1"); assert.deepEqual(JSON.parse(await readFile(join(dir, "j1.json"), "utf8")), job("j1")); });

test("repository mutex never steals an expired timestamp from a still-live process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-repository-live-lock-"));
  let now = 100;
  const repository = new FileGenerationJobRepository(dir, 10, () => now);
  const jobId = "live-lock";
  await repository.create(job(jobId));
  const lockPath = join(dir, ".locks", `placement-${jobId}.lock`);
  await writeFile(lockPath, JSON.stringify({ processToken: "other-live-owner", pid: process.pid, claimedAt: 0 }));

  await assert.rejects(repository.claimPlacement(jobId, "placement-key"), /generation-repository-lock-timeout/);
  const durableLock = JSON.parse(await readFile(lockPath, "utf8")) as { processToken: string };
  assert.equal(durableLock.processToken, "other-live-owner");
  await rm(lockPath, { force: true });
});

test("repository reclaims a stale legacy lock that crashed before writing its owner record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-repository-empty-lock-"));
  const repository = new FileGenerationJobRepository(dir, 10);
  const jobId = "empty-lock";
  await repository.create(job(jobId));
  const lockPath = join(dir, ".locks", `placement-${jobId}.lock`);
  await writeFile(lockPath, "");
  const stale = new Date(Date.now() - 1_000);
  await utimes(lockPath, stale, stale);

  const claimed = await repository.claimPlacement(jobId, "placement-key");

  assert.equal(claimed.acquired, true);
  assert.equal(claimed.claim.jobId, jobId);
});
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

test("placement reconciliation is explicit and fenced to the claimed owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-repair-"));
  const repo = new FileGenerationJobRepository(dir);
  await repo.create(job("placement-repair"));

  const claimed = await repo.claimPlacement("placement-repair", "placement-key");
  assert.equal(claimed.acquired, true);
  await assert.rejects(
    repo.reconcilePlacement("placement-repair", "placement-key", "wrong-owner", "not-applied"),
    /generation-placement-claim-fenced/,
  );
  assert.equal((await repo.getPlacementClaim("placement-repair"))?.state, "claimed");

  const repaired = await repo.reconcilePlacement("placement-repair", "placement-key", claimed.claim.ownerToken, "not-applied");
  assert.equal(repaired.state, "failed");
  assert.equal(repaired.outcome, "not-applied");
  const reacquired = await repo.claimPlacement("placement-repair", "placement-key");
  assert.equal(reacquired.acquired, true);
  assert.notEqual(reacquired.claim.ownerToken, claimed.claim.ownerToken);
});

test("placement lease renewal prevents a live owner from being recovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-lease-live-"));
  let now = 100;
  const repo = new FileGenerationJobRepository(dir, 10, () => now);
  await repo.create(job("placement-lease-live"));
  const claimed = await repo.claimPlacement("placement-lease-live", "placement-key");
  now = 105;
  const renewed = await repo.renewPlacement("placement-lease-live", "placement-key", claimed.claim.ownerToken);
  now = 111;
  const recovery = await repo.recoverPlacement("placement-lease-live", "placement-key");
  assert.equal(recovery.kind, "owner-live");
  assert.equal(recovery.claim.ownerToken, renewed.ownerToken);
  assert.equal((await repo.getPlacementClaim("placement-lease-live"))?.state, "claimed");
  const completed = await repo.reconcilePlacement("placement-lease-live", "placement-key", claimed.claim.ownerToken, "applied");
  assert.equal(completed.state, "completed");
});

test("opening a second repository instance does not make an unexpired placement owner stale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-lease-second-instance-"));
  let now = 100;
  const first = new FileGenerationJobRepository(dir, 10, () => now);
  await first.create(job("placement-lease-second-instance"));
  const claimed = await first.claimPlacement("placement-lease-second-instance", "placement-key");
  now = 109;
  const second = new FileGenerationJobRepository(dir, 10, () => now);
  const recovery = await second.recoverPlacement("placement-lease-second-instance", "placement-key");
  assert.equal(recovery.kind, "owner-live");
  assert.equal(recovery.claim.ownerToken, claimed.claim.ownerToken);
});

test("concurrent live-owner renewal and recovery decision preserve the same owner token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-lease-race-"));
  let now = 100;
  const owner = new FileGenerationJobRepository(dir, 10, () => now);
  const recoveryRepository = new FileGenerationJobRepository(dir, 10, () => now);
  await owner.create(job("placement-lease-race"));
  const claimed = await owner.claimPlacement("placement-lease-race", "placement-key");
  now = 105;
  const [renewed, recovery] = await Promise.all([
    owner.renewPlacement("placement-lease-race", "placement-key", claimed.claim.ownerToken),
    recoveryRepository.recoverPlacement("placement-lease-race", "placement-key"),
  ]);
  assert.equal(renewed.ownerToken, claimed.claim.ownerToken);
  assert.equal(recovery.kind, "owner-live");
  assert.equal(recovery.claim.ownerToken, claimed.claim.ownerToken);
});

test("expired placement owner before invocation becomes safely retryable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-lease-pre-"));
  let now = 100;
  const first = new FileGenerationJobRepository(dir, 10, () => now);
  await first.create(job("placement-lease-pre"));
  const claimed = await first.claimPlacement("placement-lease-pre", "placement-key");
  now = 111;
  const fresh = new FileGenerationJobRepository(dir, 10, () => now);
  const recovery = await fresh.recoverPlacement("placement-lease-pre", "placement-key");
  assert.equal(recovery.kind, "safe-retry");
  assert.equal(recovery.claim.outcome, "not-applied");
  await assert.rejects(
    first.markPlacementInvocationStarted("placement-lease-pre", "placement-key", claimed.claim.ownerToken),
    /generation-placement-claim-fenced/,
  );
  assert.equal((await fresh.claimPlacement("placement-lease-pre", "placement-key")).acquired, true);
});

test("placement lease is stale at the exact expiry boundary and a backward clock remains conservative", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-lease-boundary-"));
  let now = 100;
  const repository = new FileGenerationJobRepository(dir, 10, () => now);
  await repository.create(job("placement-lease-boundary"));
  const claimed = await repository.claimPlacement("placement-lease-boundary", "placement-key");
  now = 90;
  const renewed = await repository.renewPlacement("placement-lease-boundary", "placement-key", claimed.claim.ownerToken);
  assert.equal(renewed.lastRenewedAt, 100);
  assert.equal(renewed.leaseExpiresAt, 110);
  now = 105;
  const rollback = await repository.recoverPlacement("placement-lease-boundary", "placement-key");
  assert.equal(rollback.kind, "owner-live");
  assert.equal(rollback.claim.ownerToken, claimed.claim.ownerToken);
  now = 110;
  const boundary = await repository.recoverPlacement("placement-lease-boundary", "placement-key");
  assert.equal(boundary.kind, "safe-retry");
});

test("expired placement owner after invocation requires stable-key reconciliation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-lease-post-"));
  let now = 100;
  const first = new FileGenerationJobRepository(dir, 10, () => now);
  await first.create(job("placement-lease-post"));
  const claimed = await first.claimPlacement("placement-lease-post", "placement-key");
  await first.markPlacementInvocationStarted("placement-lease-post", "placement-key", claimed.claim.ownerToken);
  now = 111;
  const fresh = new FileGenerationJobRepository(dir, 10, () => now);
  const recovery = await fresh.recoverPlacement("placement-lease-post", "placement-key");
  assert.equal(recovery.kind, "reconcile");
  assert.equal(recovery.claim.outcome, "pending");
  assert.notEqual(recovery.claim.ownerToken, claimed.claim.ownerToken);
  const completed = await fresh.reconcilePlacement("placement-lease-post", "placement-key", recovery.claim.ownerToken, "applied");
  assert.equal(completed.state, "completed");
});

test("applied, not-applied, and unknown reconciliation outcomes survive a repository restart", async () => {
  const cases = [
    { outcome: "applied" as const, state: "completed" as const },
    { outcome: "not-applied" as const, state: "needs-attention" as const },
    { outcome: "unknown" as const, state: "needs-attention" as const },
  ];

  for (const testCase of cases) {
    const dir = await mkdtemp(join(tmpdir(), `generation-placement-outcome-${testCase.outcome}-`));
    const repository = new FileGenerationJobRepository(dir);
    const jobId = `placement-outcome-${testCase.outcome}`;
    await repository.create(job(jobId));
    const claimed = await repository.claimPlacement(jobId, "placement-key");
    await repository.markPlacementInvocationStarted(jobId, "placement-key", claimed.claim.ownerToken);
    await repository.reconcilePlacement(jobId, "placement-key", claimed.claim.ownerToken, testCase.outcome);

    const durable = await new FileGenerationJobRepository(dir).getPlacementClaim(jobId);
    assert.equal(durable?.outcome, testCase.outcome);
    assert.equal(durable?.state, testCase.state);
    assert.equal(durable?.ownerToken, claimed.claim.ownerToken);
    assert.equal(durable?.schemaVersion, 2);
    assert.equal(durable?.phase, "terminal");
  }
});

test("legacy not-applied claims without quiescence proof migrate to reconciliation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "generation-placement-legacy-not-applied-"));
  const repository = new FileGenerationJobRepository(dir);
  const jobId = "placement-legacy-not-applied";
  await repository.create(job(jobId));
  await writeFile(join(dir, `placement-${jobId}.json`), JSON.stringify({
    jobId,
    idempotencyKey: "placement-key",
    state: "failed",
    outcome: "not-applied",
    ownerToken: "legacy-owner",
    claimedAt: 100,
  }));

  const migrated = await repository.getPlacementClaim(jobId);
  assert.equal(migrated?.schemaVersion, 2);
  assert.equal(migrated?.phase, "terminal");
  assert.equal(migrated?.replaySafe, false);
  assert.equal((await repository.claimPlacement(jobId, "placement-key")).acquired, false);
  assert.equal((await repository.recoverPlacement(jobId, "placement-key")).kind, "reconcile");
});
