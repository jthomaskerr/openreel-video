import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationRecoveryController, allowedRecoveryActions, RecoveryError } from "./state-machine";

const job = (status: GenerationJob["status"] = "failed"): GenerationJob => ({ schemaVersion: 2, id: "job-1", provider: "wavespeed", modelId: "m", modelSchemaVersion: "s", status, createdAt: 1, updatedAt: 1, context: { projectId: "p", target: { kind: "new-asset", placeholderMediaId: "pm" }, references: [], placementPolicy: "none" }, providerInputs: { prompt: "x" }, attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }], checkpoints: {} });

describe("generation recovery state machine", () => {
  it("enumerates only actions valid for a state", () => {
    expect(allowedRecoveryActions("running")).toEqual(["cancel"]);
    expect(() => allowedRecoveryActions("completed")).not.toThrow();
    expect(() => new GenerationRecoveryController({} as never).retryProvider(job("completed"))).rejects.toBeInstanceOf(RecoveryError);
  });
  it("variation is draft-only and provider retry creates a new attempt", async () => {
    const save = vi.fn(async (x: GenerationJob) => x);
    const submit = vi.fn(async () => ({ providerJobId: "provider-2" }));
    const c = new GenerationRecoveryController({ now: () => 10, resolveContext: async (x) => x.job.context, submit, save });
    const draft = c.variation(job("completed"));
    expect(draft.status).toBe("draft");
    expect(submit).not.toHaveBeenCalled();
    const retried = await c.retryProvider(job());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(retried.attempts.at(-1)?.providerJobId).toBe("provider-2");
  });
  it("cancel stops polling and cleans after best-effort provider cancel", async () => {
    const save = vi.fn(async (x: GenerationJob) => x);
    const stopPolling = vi.fn(); const cleanupUploads = vi.fn(async () => {}); const cancelProvider = vi.fn(async () => { throw new Error("unsupported"); });
    const c = new GenerationRecoveryController({ now: () => 2, resolveContext: async (x) => x.job.context, submit: async () => ({ providerJobId: "x" }), save, stopPolling, cleanupUploads, cancelProvider });
    const canceled = await c.cancel(job("running"));
    expect(canceled.status).toBe("canceled"); expect(stopPolling).toHaveBeenCalledWith("job-1"); expect(cleanupUploads).toHaveBeenCalledTimes(1);
  });
});
