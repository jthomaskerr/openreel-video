import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import {
  hydrateGenerationJob,
  migrateGenerationJobPersistence,
  useGenerationJobStore,
} from "./generation-job-store";

const routing = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "wavespeed/model",
  requestedMode: "text-to-image" as const,
  providerSchemaId: "wavespeed-request",
  providerEndpointId: "wavespeed-submit",
  providerSchemaVersion: "2026-07",
};

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: "logical-1",
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: routing.providerInstanceId,
    modelId: routing.providerModelId,
    modelSchemaVersion: routing.providerSchemaVersion,
    routing,
    providerJobId: "provider-1",
    status: "running",
    attempt: 1,
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      placementPolicy: "none",
      prompt: "prompt",
      references: [],
    },
    providerInputs: {},
    attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-1", startedAt: 1 }],
    checkpoints: {},
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("authoritative generation job store", () => {
  beforeEach(() => {
    useGenerationJobStore.setState({ records: [], jobs: [], legacyAttention: [] });
  });

  it("hydrates one complete durable V2 record", () => {
    const authoritative = job();
    hydrateGenerationJob(authoritative);
    hydrateGenerationJob(authoritative);
    expect(useGenerationJobStore.getState().records).toEqual([{ kind: "v2", job: authoritative }]);
  });

  it("fences an older authoritative response", () => {
    const current = job({ updatedAt: 5, status: "canceled" });
    hydrateGenerationJob(current);
    expect(hydrateGenerationJob(job({ updatedAt: 4, status: "running" }))).toEqual(current);
    expect(useGenerationJobStore.getState().jobs[0]).toEqual(current);
  });

  it("rejects project and provider-attempt ownership changes", () => {
    hydrateGenerationJob(job());
    expect(() => hydrateGenerationJob(job({
      projectId: "project-2",
      context: { ...job().context, projectId: "project-2" },
    }))).toThrow("generation-status-ownership-mismatch");
    expect(() => hydrateGenerationJob(job({
      providerJobId: "provider-2",
      updatedAt: 3,
      attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-2", startedAt: 1 }],
    }))).toThrow("generation-provider-response-invalid");
  });

  it("returns jobs only for the requested project", () => {
    hydrateGenerationJob(job());
    hydrateGenerationJob(job({
      id: "logical-2",
      projectId: "project-2",
      context: { ...job().context, projectId: "project-2" },
    }));
    expect(useGenerationJobStore.getState().getJobsForProject("project-1").map((value) => value.id)).toEqual(["logical-1"]);
  });

  it("quarantines an unrecognized persisted row", () => {
    const migrated = migrateGenerationJobPersistence({ state: { records: [{ kind: "future", id: "future-1" }] } });
    expect(migrated.records).toEqual([{ kind: "legacy", storeKey: "future-1", projectId: "", payload: { kind: "future", id: "future-1" } }]);
  });
});
