import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { createRecoveryCommandModule } from "./commands";
import { GenerationRecoveryController } from "./state-machine";

const routing = {
  providerInstanceId: "wavespeed-prod",
  providerModelId: "m",
  requestedMode: "text-to-image",
  providerSchemaId: "provider-schema",
  providerEndpointId: "generate-image",
  providerSchemaVersion: "s",
} as const;

const job = (status: GenerationJob["status"] = "failed"): GenerationJob => ({
  schemaVersion: 2,
  contractVersion: 2,
  id: "job-1",
  projectId: "p",
  provider: "wavespeed",
  providerInstanceId: routing.providerInstanceId,
  modelId: "m",
  modelSchemaVersion: "s",
  routing,
  status,
  attempt: 1,
  target: { kind: "new-asset", placeholderMediaId: "pm" },
  createdAt: 1,
  updatedAt: 1,
  context: {
    projectId: "p",
    entryContext: { kind: "new-asset" },
    mode: "text-to-image",
    prompt: "x",
    references: [],
    placementPolicy: "none",
  },
  providerInputs: { prompt: "x" },
  attempts: [{ attemptNumber: 1, routing, startedAt: 1 }],
  checkpoints: {},
});

const placementCandidate = (): GenerationJob => {
  const unknown = { code: "generation-placement-outcome-unknown", message: "response lost", retryable: false };
  return {
    ...job("needs-attention"),
    context: { ...job("needs-attention").context, placementPolicy: "create-linked-clip" },
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 4, sha256: "hash", width: 16, height: 9, durationSeconds: 1 },
    checkpoints: { "placement-applied": { status: "failed", timestamp: 8, error: unknown } },
    placement: { policy: "create-linked-clip", status: "failed", error: unknown },
    error: unknown,
  };
};

describe("recovery command module", () => {
  it("routes command names to controller methods", async () => {
    const reconcilePlacement = vi.fn(async ({ jobId }: { jobId: string }) => ({ ...job("succeeded"), id: jobId }));
    const controller = new GenerationRecoveryController({
      now: () => 1,
      resolveContext: vi.fn(async ({ job: value }) => value.context),
      submit: vi.fn(async () => ({ providerJobId: "provider-2" })),
      save: vi.fn(async (value: GenerationJob) => value),
      reconcilePlacement,
    });
    const module = createRecoveryCommandModule(controller);

    await expect(module.execute("regenerate", { job: job("failed") })).resolves.toMatchObject({ status: "queued" });
    await expect(module.execute("variation", { job: job("completed") })).resolves.toMatchObject({ status: "draft" });
    await expect(module.execute("reconcile-placement", { job: placementCandidate() })).resolves.toMatchObject({ status: "succeeded" });
    expect(reconcilePlacement).toHaveBeenCalledWith({ jobId: "job-1" });
  });
});
