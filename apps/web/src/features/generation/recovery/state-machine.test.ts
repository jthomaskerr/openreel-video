import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import {
  GenerationRecoveryController,
  RecoveryError,
  allowedRecoveryActions,
  assertRecoveryTransition,
} from "./state-machine";

const baseJob = (status: GenerationJob["status"] = "failed"): GenerationJob => ({
  schemaVersion: 2,
  id: "job-1",
  provider: "wavespeed",
  modelId: "m",
  modelSchemaVersion: "s",
  status,
  createdAt: 1,
  updatedAt: 1,
  context: {
    projectId: "p",
    target: { kind: "new-asset", placeholderMediaId: "pm" },
    references: [
      {
        mediaId: "ref-1",
        origins: ["source"],
        remoteInput: { kind: "upload-token", value: "token-1" },
      },
    ],
    audio: {
      sourceMediaId: "audio-1",
      sourceVersionId: "version-1",
      sourceClipId: "clip-1",
      projectStartSeconds: 0,
      projectEndSeconds: 1,
      sourceStartSeconds: 0,
      sourceEndSeconds: 1,
      mimeType: "audio/mpeg",
      sha256: "hash",
      remoteInput: { kind: "upload-token", value: "audio-token" },
    },
    placementPolicy: "none",
  },
  providerInputs: { prompt: "x" },
  attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }],
  checkpoints: {},
});

describe("generation recovery state machine", () => {
  it("enumerates every allowed transition and rejects invalid ones", () => {
    expect(allowedRecoveryActions("completed")).toEqual(["regenerate", "variation", "retry-finalization", "retry-placement"]);
    expect(allowedRecoveryActions("running")).toEqual(["cancel"]);
    expect(() => assertRecoveryTransition(baseJob("completed"), "cancel")).toThrow(RecoveryError);
  });

  it("regenerate copies recorded state then resolves live context", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const resolveContext = vi.fn(async ({ job }: { job: GenerationJob }) => ({
      ...job.context,
      projectId: "live-project",
    }));
    const controller = new GenerationRecoveryController({ now: () => 10, resolveContext, submit: vi.fn(), save });

    const result = await controller.regenerate(baseJob("failed"));

    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(resolveContext).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ id: "job-1", attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }] }) }));
    expect(result.status).toBe("preparing");
    expect(result.context.projectId).toBe("live-project");
    expect(result.attempts).toEqual(baseJob().attempts);
  });

  it("variation returns only an editable draft", () => {
    const submit = vi.fn();
    const controller = new GenerationRecoveryController({ now: () => 20, resolveContext: vi.fn(), submit, save: vi.fn() });

    const draft = controller.variation(baseJob("completed"));

    expect(draft.status).toBe("draft");
    expect(draft.sourceJobId).toBe("job-1");
    expect(draft.provider).toBe("wavespeed");
    expect(submit).not.toHaveBeenCalled();
  });

  it("provider retry increments attempt and submits exactly once", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const submit = vi.fn(async () => ({ providerJobId: "provider-2" }));
    const controller = new GenerationRecoveryController({ now: () => 30, resolveContext: vi.fn(), submit, save });

    const result = await controller.retryProvider(baseJob("failed"));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 2 }));
    expect(result.status).toBe("queued");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.at(-1)).toMatchObject({ attemptNumber: 2, providerJobId: "provider-2", startedAt: 30 });
  });

  it("finalization and placement retries never submit", async () => {
    const submit = vi.fn();
    const save = vi.fn(async (value: GenerationJob) => value);
    const controller = new GenerationRecoveryController({ now: () => 40, resolveContext: vi.fn(), submit, save });

    const finalized = await controller.retryFinalization(baseJob("completed"));
    const placed = await controller.retryPlacement({ ...baseJob("completed"), placement: { policy: "none", status: "failed" } });

    expect(submit).not.toHaveBeenCalled();
    expect(finalized.status).toBe("running");
    expect(finalized.checkpoints["placeholder-finalized"]).toEqual({ status: "pending" });
    expect(placed.status).toBe("running");
    expect(placed.checkpoints["placement-applied"]).toEqual({ status: "pending" });
  });

  it("cancel stops polling, calls provider cancel when available, and cleans once", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const stopPolling = vi.fn();
    const cleanupUploads = vi.fn(async () => {});
    const cancelProvider = vi.fn(async () => {});
    const controller = new GenerationRecoveryController({
      now: () => 50,
      resolveContext: vi.fn(),
      submit: vi.fn(),
      save,
      stopPolling,
      cleanupUploads,
      cancelProvider,
    });

    const result = await controller.cancel(baseJob("running"));

    expect(stopPolling).toHaveBeenCalledTimes(1);
    expect(stopPolling).toHaveBeenCalledWith("job-1");
    expect(cancelProvider).toHaveBeenCalledTimes(1);
    expect(cancelProvider).toHaveBeenCalledWith({ provider: "wavespeed", providerJobId: "provider-1" });
    expect(cleanupUploads).toHaveBeenCalledTimes(1);
    expect(cleanupUploads).toHaveBeenCalledWith(expect.objectContaining({ status: "canceling" }));
    expect(result.status).toBe("canceled");
  });
});
