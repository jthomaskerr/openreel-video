import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { createGenerationController } from "../features/generation/controller/index.js";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  },
});

const storeModule = await import("./generation-job-store.js");
const {
  generationControllerJobCache,
  hydrateGenerationJob,
  migrateGenerationJobPersistence,
  useGenerationJobStore,
} = storeModule;

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  const routing = {
    providerInstanceId: "wavespeed-production",
    providerModelId: "wavespeed/model",
    requestedMode: "text-to-image" as const,
    providerSchemaId: "schema",
    providerEndpointId: "submit",
    providerSchemaVersion: "2026-07",
  };
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: "logical-job-1",
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: routing.providerInstanceId,
    modelId: routing.providerModelId,
    modelSchemaVersion: routing.providerSchemaVersion,
    routing,
    providerJobId: "provider-job-9",
    status: "succeeded",
    attempt: 1,
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      placementPolicy: "none",
      prompt: "typed",
      references: [],
    },
    providerInputs: { seed: 0 },
    attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-job-9", startedAt: 1 }],
    checkpoints: Object.fromEntries([
      "output-claimed",
      "output-downloaded",
      "output-verified",
      "output-inspected",
      "placeholder-finalized",
      "shot-linked",
      "placement-applied",
    ].map((name) => [name, { status: "completed", timestamp: 2 }])) as GenerationJob["checkpoints"],
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "image/png", byteLength: 3, sha256: "abc" },
    outputMediaIds: ["provider-output:provider-job-9:0"],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test("hydrates and persists the complete authoritative V2 job without the release flag", () => {
  useGenerationJobStore.setState({ records: [], jobs: [], legacyAttention: [] });
  const authoritative = job();
  hydrateGenerationJob(authoritative);
  hydrateGenerationJob(authoritative);

  const state = useGenerationJobStore.getState();
  assert.equal(state.records.length, 1);
  assert.deepEqual(state.records[0], { kind: "v2", job: authoritative });
  assert.equal(state.jobs[0].id, "logical-job-1");
  assert.equal(state.jobs[0].providerJobId, "provider-job-9");
  assert.deepEqual(state.jobs[0].output, authoritative.output);
  assert.equal(JSON.stringify(state.records).includes("generationV2ReleaseEnabled"), false);
});

test("migrates unsafe legacy rows to controller needs-attention without inventing a source", async () => {
  const migrated = migrateGenerationJobPersistence({
    state: {
      jobs: [{
        id: "legacy-1",
        projectId: "project-1",
        provider: "wavespeed",
        providerJobId: "provider-legacy",
        linkedMediaIds: ["must-not-be-inferred"],
      }],
    },
    version: 0,
  }) as { records: Array<{ kind: string; storeKey: string; projectId: string; payload: Record<string, unknown> }> };
  useGenerationJobStore.setState({ records: migrated.records as any, jobs: [], legacyAttention: [] });

  const controller = createGenerationController({
    submission: {} as never,
    leases: { releaseUploadLease: async () => {} },
    jobs: generationControllerJobCache,
    status: { read: async () => { throw new Error("legacy must not poll"); } },
  }, { sessionId: "legacy-session" });
  const result = await controller.reconcile("project-1");
  assert.equal(result.length, 1);
  assert.equal("kind" in result[0] && result[0].kind, "legacy");
  assert.equal(result[0].status, "needs-attention");
  assert.equal(result[0].error?.code, "generation-legacy-job-unsupported");
  assert.equal("context" in result[0], false);
  assert.equal("sourceMediaId" in result[0], false);
});

test("quarantines invalid persisted V2 rows instead of silently dropping them", () => {
  const invalid = {
    kind: "v2",
    job: {
      ...job(),
      contractVersion: 1,
      linkedMediaIds: ["must-not-be-inferred"],
    },
  };

  const migrated = migrateGenerationJobPersistence({ state: { records: [invalid] }, version: 2 });

  assert.equal(migrated.records.length, 1);
  assert.equal(migrated.records[0]?.kind, "legacy");
  if (migrated.records[0]?.kind !== "legacy") throw new Error("invalid V2 row was not quarantined");
  assert.equal(migrated.records[0].storeKey, "logical-job-1");
  assert.equal(migrated.records[0].projectId, "project-1");
  assert.deepEqual(migrated.records[0].payload.linkedMediaIds, ["must-not-be-inferred"]);
});

test("quarantines every unrecognized persisted row instead of silently dropping it", () => {
  const migrated = migrateGenerationJobPersistence({
    state: {
      records: [null, "corrupt", { kind: "future-v3", projectId: "project-1", id: "future-1" }],
    },
    version: 2,
  });

  assert.equal(migrated.records.length, 3);
  assert.ok(migrated.records.every((record) => record.kind === "legacy"));
  assert.deepEqual(
    migrated.records.map((record) => record.kind === "legacy" ? record.storeKey : ""),
    ["invalid-record-0", "invalid-record-1", "future-1"],
  );
});

test("shares one reconciliation claim across two pollers and hydrates the returned durable job", async () => {
  useGenerationJobStore.setState({ records: [{ kind: "v2", job: job({ status: "running" }) }], jobs: [], legacyAttention: [] });
  const first = await generationControllerJobCache.claimReconciliation({ projectId: "project-1", jobId: "logical-job-1", sessionId: "poller-a" });
  const second = await generationControllerJobCache.claimReconciliation({ projectId: "project-1", jobId: "logical-job-1", sessionId: "poller-b" });
  assert.equal(first.status, "claimed");
  assert.equal(second.status, "pending");
  if (first.status !== "claimed" || second.status !== "pending") throw new Error("unexpected claims");

  const completed = job();
  await generationControllerJobCache.completeReconciliation({
    projectId: "project-1",
    jobId: "logical-job-1",
    sessionId: "poller-a",
    claimId: first.claimId,
    job: completed,
  });
  assert.deepEqual(await second.waitForCompletion, completed);
  assert.deepEqual(useGenerationJobStore.getState().records, [{ kind: "v2", job: completed }]);
});
