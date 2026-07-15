import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { createRecoveryCommandModule } from "./commands";
import { GenerationRecoveryController } from "./state-machine";

const job = (status: GenerationJob["status"] = "failed"): GenerationJob => ({
  schemaVersion: 2,
  id: "job-1",
  provider: "wavespeed",
  modelId: "m",
  modelSchemaVersion: "s",
  status,
  createdAt: 1,
  updatedAt: 1,
  context: { projectId: "p", target: { kind: "new-asset", placeholderMediaId: "pm" }, references: [], placementPolicy: "none" },
  providerInputs: { prompt: "x" },
  attempts: [{ attemptNumber: 1, startedAt: 1 }],
  checkpoints: {},
});

describe("recovery command module", () => {
  it("routes command names to controller methods", async () => {
    const controller = new GenerationRecoveryController({
      now: () => 1,
      resolveContext: vi.fn(async ({ job: value }) => value.context),
      submit: vi.fn(async () => ({ providerJobId: "provider-2" })),
      save: vi.fn(async (value: GenerationJob) => value),
    });
    const module = createRecoveryCommandModule(controller);

    await expect(module.execute("regenerate", { job: job("failed") })).resolves.toMatchObject({ status: "preparing" });
    await expect(module.execute("variation", { job: job("completed") })).resolves.toMatchObject({ status: "draft" });
  });
});
