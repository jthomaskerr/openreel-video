import { describe, expect, it } from "vitest";
import {
  GenerationContextSchema, GenerationEntryContextSchema, GenerationJobSchema, GenerationRouteErrorSchema, GenerationStatusRequestSchema,
  GenerationSubmitRequestSchema, SanitizedGenerationProvenanceSchema, acceptGenerationProviderResponse, migratePersistedGenerationJob, parseGenerationJob,
} from "./index.js";
import { makeJob, route } from "./generation-job-dispositions.fixture.js";

describe("generation contracts", () => {
  it.each([
    [{ kind: "new-asset" }],
    [{ kind: "unplaced-shot", shotId: "shot-1" }],
    [{ kind: "unlinked-range", rangeId: "range-1", startTime: 2, endTime: 5, destinationTrackId: "track-1" }],
    [{ kind: "linked-projection", shotId: "shot-1", clipId: "clip-1", startTime: 2, endTime: 5 }],
  ])("accepts exact entry context %o", (entryContext) => expect(GenerationEntryContextSchema.parse(entryContext)).toEqual(entryContext));

  it("rejects inferred or ambiguous entry identity", () => {
    expect(() => GenerationEntryContextSchema.parse({ kind: "new-asset", shotId: "shot-1" })).toThrow();
    expect(() => GenerationEntryContextSchema.parse({ kind: "unlinked-range", rangeId: "r", startTime: 5, endTime: 2 })).toThrow();
  });

  it("persists literal contractVersion 2 and exact placement values", () => {
    const job = makeJob("queued");
    expect(GenerationJobSchema.parse(job)).toMatchObject({ contractVersion: 2, context: { entryContext: { kind: "new-asset" } } });
    expect(GenerationJobSchema.parse({
      ...job,
      placement: {
        policy: "create-linked-clip",
        status: "failed",
        error: { code: "generation-placement-failed", message: "not applied", retryable: true },
        replaySafe: true,
      },
    }).placement).toMatchObject({ status: "failed", replaySafe: true });
    expect(() => GenerationJobSchema.parse({ ...job, contractVersion: 3 })).toThrow();
    expect(() => GenerationContextSchema.parse({ ...job.context, placementPolicy: "library-only" })).toThrow();
  });

  it("rejects local/blob values before durable parsing", () => {
    expect(() => GenerationJobSchema.parse({ ...makeJob("queued"), providerInputs: { image: "blob:https://example.test/image" } })).toThrow();
    expect(() => SanitizedGenerationProvenanceSchema.parse({ provider: "wavespeed", modelId: "m", modelSchemaVersion: "v1", jobId: "j", routing: route, output: { mediaId: "local:media", versionId: "v", mimeType: "video/mp4", byteLength: 0, sha256: "sha" }, checkpoints: [], references: [] })).toThrow();
  });

  it("requires ready, active, contiguous references before submit", () => {
    const job = makeJob("queued");
    const context = { ...job.context, references: [{ id: "r", order: 1, mediaId: "m", origins: ["source" as const], state: "active" as const, preparationStatus: "preparing" as const, errorHistory: [] }] };
    expect(() => GenerationSubmitRequestSchema.parse({ projectId: "project-1", jobId: job.id, routing: route, context, providerInputs: {} })).toThrow();
  });

  it("keeps route errors and unknown keys strict", () => {
    expect(GenerationRouteErrorSchema.parse({ code: "generation-v2-rollback-active", message: "rollback", retryable: false })).toMatchObject({ code: "generation-v2-rollback-active" });
    expect(() => GenerationRouteErrorSchema.parse({ code: "generation-route-unsupported", message: "x", retryable: false, secret: "no" })).toThrow();
  });

  it("migrates unsafe legacy jobs to needs-attention without guessed source identity", () => {
    const job = migratePersistedGenerationJob({ id: "legacy-1", provider: "wavespeed", projectId: "p", status: "running", createdAt: 10 });
    expect(job.status).toBe("needs-attention");
    expect("kind" in job && job.kind).toBe("legacy-recovery");
    expect("entryContext" in job).toBe(false);
    expect("routing" in job).toBe(false);
  });

  it("rejects audio context for every non-linked entry variant", () => {
    for (const entryContext of [{ kind: "new-asset" }, { kind: "unplaced-shot", shotId: "shot-1" }, { kind: "unlinked-range", rangeId: "range-1", startTime: 0, endTime: 3 }] as const) {
      expect(() => GenerationContextSchema.parse({ projectId: "project-1", entryContext, mode: "text-to-video", placementPolicy: "none", prompt: "", references: [], audioAssetId: "audio-1" })).toThrow();
    }
  });

  it.each(["failed", "needs-attention", "canceled", "succeeded", "completed", "finalizing"] as const)("rejects provider response ownership after %s", (status) => {
    const job = makeJob(status);
    expect(acceptGenerationProviderResponse(job, "project-1", 1, "provider-1")).toBe(false);
  });

  it.each([
    ["wrong project", "other-project", 1, "provider-1"],
    ["wrong attempt", "project-1", 2, "provider-1"],
    ["wrong provider id", "project-1", 1, "provider-2"],
  ] as const)("rejects %s provider ownership", (_label, projectId, attempt, providerJobId) => {
    expect(acceptGenerationProviderResponse(makeJob("running"), projectId, attempt, providerJobId)).toBe(false);
  });

  it("does not invent identity for missing or unknown legacy providers", () => {
    for (const legacy of [{ id: "legacy-missing-provider" }, { id: "legacy-unknown-provider", provider: "unknown" }]) {
      const migrated = migratePersistedGenerationJob(legacy);
      expect(migrated.status).toBe("needs-attention");
      expect("kind" in migrated && migrated.kind).toBe("legacy-recovery");
      expect("entryContext" in migrated).toBe(false);
      expect("routing" in migrated).toBe(false);
    }
  });

  it("preserves explicitly stored entry and route identity during migration", () => {
    const source = makeJob("queued");
    const migrated = migratePersistedGenerationJob({ ...source, schemaVersion: 1, contractVersion: 1 });
    expect("kind" in migrated).toBe(false);
    if ("kind" in migrated) return;
    expect(migrated.context.entryContext).toEqual(source.context.entryContext);
    expect(migrated.routing).toEqual(source.routing);
  });

  it.each(["submitting", "running", "completed", "finalizing"] as const)("rejects %s jobs without a matching provider ID and route", (status) => {
    const job = makeJob(status);
    expect(() => GenerationJobSchema.parse({ ...job, providerJobId: undefined })).toThrow();
    expect(() => GenerationJobSchema.parse({ ...job, attempts: [{ ...job.attempts[0], routing: { ...route, providerEndpointId: "other-endpoint" } }] })).toThrow();
    expect(() => GenerationJobSchema.parse({ ...job, routing: { ...route, providerEndpointId: "other-endpoint" } })).toThrow();
    expect(() => GenerationJobSchema.parse({ ...job, providerInstanceId: "other-instance" })).toThrow();
    expect(() => GenerationJobSchema.parse({ ...job, modelId: "other-model" })).toThrow();
  });

  it.each([
    ["status", { projectId: "project-1", jobId: "job-1" }, { unexpected: true }],
    ["route error", { code: "generation-route-unsupported", message: "", retryable: false }, { unexpected: true }],
  ] as const)("keeps strict unknown/falsy matrix for %s", (_label, value, extra) => {
    expect(() => GenerationRouteErrorSchema.parse(value)).toThrow();
    expect(() => GenerationRouteErrorSchema.parse({ ...(value as object), ...extra })).toThrow();
  });

  it("accepts falsy JSON values while rejecting unknown keys across strict request boundaries", () => {
    const job = makeJob("queued");
    const submit = { projectId: "project-1", jobId: job.id, routing: route, context: job.context, providerInputs: { zero: 0, falseValue: false, empty: "" } };
    expect(GenerationSubmitRequestSchema.parse(submit).providerInputs).toEqual(submit.providerInputs);
    const status = { projectId: "project-1", jobId: "job-1" };
    expect(GenerationStatusRequestSchema.parse(status)).toEqual(status);
    expect(() => GenerationStatusRequestSchema.parse({ ...status, unknown: false })).toThrow();
    expect(() => GenerationSubmitRequestSchema.parse({ ...submit, unknown: 0 })).toThrow();
  });

  it("round-trips a strict job", () => expect(parseGenerationJob(makeJob("queued"))).toEqual(makeJob("queued")));
});
