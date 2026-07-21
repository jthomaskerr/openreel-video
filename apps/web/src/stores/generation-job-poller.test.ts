import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { processGenerationJobOnce } from "../hooks/useGenerationJobPoller";

const routing = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "wavespeed/model",
  requestedMode: "text-to-image" as const,
  providerSchemaId: "wavespeed-request",
  providerEndpointId: "wavespeed-submit",
  providerSchemaVersion: "2026-07",
};

function job(status: GenerationJob["status"], overrides: Partial<GenerationJob> = {}): GenerationJob {
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
    status,
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

describe("generation job poller", () => {
  it.each(["needs-attention", "failed", "canceled", "succeeded"] as const)("does not poll %s", async (status) => {
    const synchronize = vi.fn();
    const current = job(status);
    await processGenerationJobOnce({ job: current, synchronize, current: () => current });
    expect(synchronize).not.toHaveBeenCalled();
  });

  it("consumes one authoritative active response", async () => {
    const current = job("running");
    const authoritative = job("completed", { updatedAt: 3 });
    const synchronize = vi.fn(async () => authoritative);
    await processGenerationJobOnce({ job: current, synchronize, current: () => current });
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("ignores a late response after local cancellation", async () => {
    const snapshot = job("running");
    const canceled = job("canceled", { updatedAt: 3 });
    const synchronize = vi.fn(async () => job("completed", { updatedAt: 4 }));
    await processGenerationJobOnce({ job: snapshot, synchronize, current: () => canceled });
    expect(synchronize).toHaveBeenCalledOnce();
  });
});
