import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import {
  GenerationRecoveryController,
  RecoveryError,
  allowedRecoveryActions,
  allowedRecoveryActionsForJob,
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

const placementCandidate = (): GenerationJob => {
  const unknown = { code: "generation-placement-outcome-unknown", message: "response lost", retryable: false };
  return {
    ...baseJob("needs-attention"),
    context: { ...baseJob("needs-attention").context, placementPolicy: "create-linked-clip" },
    output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 4, sha256: "hash", width: 16, height: 9, durationSeconds: 1 },
    checkpoints: { "placement-applied": { status: "failed", timestamp: 8, error: unknown } },
    placement: { policy: "create-linked-clip", status: "failed", error: unknown },
    error: unknown,
  };
};

describe("generation recovery state machine", () => {
  it("enumerates every allowed transition and rejects invalid ones", () => {
    expect(allowedRecoveryActions("completed")).toEqual(["regenerate", "variation", "retry-finalization", "retry-placement"]);
    expect(allowedRecoveryActions("needs-attention")).toContain("reconcile-placement");
    expect(allowedRecoveryActionsForJob(placementCandidate())).toContain("reconcile-placement");
    expect(allowedRecoveryActionsForJob(baseJob("needs-attention"))).not.toContain("reconcile-placement");
    expect(allowedRecoveryActionsForJob(placementCandidate())).not.toContain("retry-placement");
    expect(allowedRecoveryActions("running")).toEqual(["cancel"]);
    expect(() => assertRecoveryTransition(baseJob("completed"), "cancel")).toThrow(RecoveryError);
  });

  it("regenerate copies recorded state then resolves live context", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const resolveContext = vi.fn(async ({ job }: { job: GenerationJob }) => ({
      ...job.context,
      projectId: "live-project",
    }));
    const controller = new GenerationRecoveryController({ now: () => 10, resolveContext, submit: vi.fn(), save, reconcilePlacement: vi.fn() });

    const result = await controller.regenerate(baseJob("failed"));

    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(resolveContext).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ id: "job-1", attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }] }) }));
    expect(result.status).toBe("preparing");
    expect(result.context.projectId).toBe("live-project");
    expect(result.attempts).toEqual(baseJob().attempts);
  });

  it("variation returns only an editable draft", () => {
    const submit = vi.fn();
    const controller = new GenerationRecoveryController({ now: () => 20, resolveContext: vi.fn(), submit, save: vi.fn(), reconcilePlacement: vi.fn() });

    const draft = controller.variation(baseJob("completed"));

    expect(draft.status).toBe("draft");
    expect(draft.sourceJobId).toBe("job-1");
    expect(draft.provider).toBe("wavespeed");
    expect(submit).not.toHaveBeenCalled();
  });

  it("provider retry increments attempt and submits exactly once", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const submit = vi.fn(async () => ({ providerJobId: "provider-2" }));
    const controller = new GenerationRecoveryController({ now: () => 30, resolveContext: vi.fn(), submit, save, reconcilePlacement: vi.fn() });

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
    const controller = new GenerationRecoveryController({ now: () => 40, resolveContext: vi.fn(), submit, save, reconcilePlacement: vi.fn() });

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
      reconcilePlacement: vi.fn(),
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

  it("delegates needs-attention placement reconciliation without an optimistic local rewrite", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const reconcilePlacement = vi.fn(async ({ jobId }: { jobId: string }) => ({
      ...baseJob("succeeded"),
      id: jobId,
      placement: { policy: "create-linked-clip" as const, status: "applied" as const, appliedAt: 60 },
    }));
    const controller = new GenerationRecoveryController({
      now: () => 60,
      resolveContext: vi.fn(),
      submit: vi.fn(),
      save,
      reconcilePlacement,
    });
    const unresolved = placementCandidate();

    const result = await controller.reconcilePlacement(unresolved);

    expect(reconcilePlacement).toHaveBeenCalledTimes(1);
    expect(reconcilePlacement).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(save).not.toHaveBeenCalled();
    expect(result.status).toBe("succeeded");
    expect(result.placement?.status).toBe("applied");
  });

  it("preserves an authoritative unknown result and rejects non-candidates without side effects", async () => {
    const save = vi.fn(async (value: GenerationJob) => value);
    const reconcilePlacement = vi.fn(async () => ({
      ...placementCandidate(),
      error: { code: "generation-placement-outcome-unknown", message: "still unknown", retryable: false },
    }));
    const controller = new GenerationRecoveryController({ now: () => 70, resolveContext: vi.fn(), submit: vi.fn(), save, reconcilePlacement });

    const unknown = await controller.reconcilePlacement(placementCandidate());
    expect(unknown.status).toBe("needs-attention");
    expect(unknown.error?.code).toBe("generation-placement-outcome-unknown");
    expect(save).not.toHaveBeenCalled();

    await expect(controller.reconcilePlacement(baseJob("needs-attention"))).rejects.toMatchObject({ code: "recovery-invalid-placement-reconciliation-candidate" });
    expect(reconcilePlacement).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
