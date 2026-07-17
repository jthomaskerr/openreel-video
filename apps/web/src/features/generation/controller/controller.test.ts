import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { createGenerationSubmissionDraftCache } from "../drafts/cache";
import { type GenerationDraft, type SubmitGenerationPorts } from "../submit-generation";
import {
  createGenerationController,
  type GenerationControllerJobCache,
  type GenerationControllerPorts,
  type GenerationStoredRecord,
  resetGenerationControllerState,
} from "./index";

function draft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: "wavespeed-primary",
    routing: {
      providerInstanceId: "wavespeed-primary",
      providerModelId: "model-1",
      requestedMode: "text-to-image",
      providerSchemaId: "schema-1",
      providerEndpointId: "generate",
      providerSchemaVersion: "1",
    },
    modelId: "model-1",
    modelSchemaVersion: "1",
    target: { kind: "new-asset" },
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      placementPolicy: "none",
      prompt: "a lighthouse",
      references: [],
    },
    providerInputs: { prompt: "a lighthouse" },
    ...overrides,
  };
}

function submissionPorts(overrides: Partial<SubmitGenerationPorts> = {}): SubmitGenerationPorts {
  return {
    mutations: {
      createPlaceholder: vi.fn(async () => "placeholder-1"),
      markPlaceholderFailed: vi.fn(async () => undefined),
    },
    provider: { submit: vi.fn(async () => ({ providerJobId: "provider-1" })) },
    cache: { put: vi.fn(async () => undefined) },
    sanitizer: { sanitize: vi.fn(({ draft: value }) => ({ inputs: value.providerInputs })) },
    clock: { now: vi.fn(() => 1000) },
    ids: { next: vi.fn((prefix: string) => `${prefix}-1`) },
    draftCache: createGenerationSubmissionDraftCache(),
    ...overrides,
  };
}

function controllerPorts(
  submit: SubmitGenerationPorts,
  jobs: Partial<GenerationControllerJobCache> = {},
  status: GenerationControllerPorts["status"] = { read: vi.fn(async (job: GenerationJob) => job) },
): GenerationControllerPorts {
  return {
    submission: submit,
    leases: { releaseUploadLease: vi.fn(async () => undefined) },
    jobs: {
      claimSubmission: vi.fn(async () => ({ status: "claimed" as const, claimId: "claim-1" })),
      completeSubmission: vi.fn(async () => undefined),
      failSubmission: vi.fn(async () => undefined),
      claimReconciliation: vi.fn(async () => ({ status: "claimed" as const, claimId: "poll-claim-1" })),
      completeReconciliation: vi.fn(async () => undefined),
      invalidateReconciliation: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      save: vi.fn(async (job) => job),
      ...jobs,
    },
    status,
  };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function v2Record(job: GenerationJob): GenerationStoredRecord {
  return { kind: "v2", job };
}

describe("GenerationController", () => {
  beforeEach(() => resetGenerationControllerState());

  it("uses an atomic durable claim across independent controllers", async () => {
    const firstClaimBarrier = barrier();
    let claimCount = 0;
    let claimed = false;
    let completedJob: GenerationJob | undefined;
    let complete!: (job: GenerationJob) => void;
    const completion = new Promise<GenerationJob>((resolve) => { complete = resolve; });
    const submit = submissionPorts();
    const claimSubmission = vi.fn(async () => {
      claimCount += 1;
      if (claimCount === 2) firstClaimBarrier.release();
      await firstClaimBarrier.promise;
      if (!claimed) {
        claimed = true;
        return { status: "claimed" as const, claimId: "claim-winner" };
      }
      if (completedJob) return { status: "existing" as const, job: completedJob };
      return { status: "pending" as const, waitForCompletion: completion };
    });
    const completeSubmission = vi.fn(async ({ job }: { job: GenerationJob }) => {
      completedJob = job;
      complete(job);
    });
    const firstPorts = controllerPorts(submit, { claimSubmission, completeSubmission });
    const secondPorts = controllerPorts(submit, { claimSubmission, completeSubmission });
    const first = createGenerationController(firstPorts);
    const second = createGenerationController(secondPorts);

    const [firstJob, secondJob] = await Promise.all([first.submit(draft()), second.submit(draft())]);

    expect(firstJob).toEqual(secondJob);
    expect(claimSubmission).toHaveBeenCalledTimes(2);
    expect(submit.mutations.createPlaceholder).toHaveBeenCalledTimes(1);
    expect(submit.provider.submit).toHaveBeenCalledTimes(1);
    expect(completeSubmission).toHaveBeenCalledTimes(1);
  });

  it("passes the exact entry context and placement policy in the serialized manifest", async () => {
    const submit = submissionPorts();
    const claimSubmission = vi.fn(async () => ({ status: "claimed" as const, claimId: "claim-1" }));
    const controller = createGenerationController(controllerPorts(submit, { claimSubmission }));
    const entryContext = { kind: "unlinked-range" as const, rangeId: "range-1", startTime: 2, endTime: 5, destinationTrackId: "track-1" };

    await controller.submit(draft({ context: { ...draft().context, entryContext, placementPolicy: "create-linked-clip" } }));

    expect(submit.provider.submit).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ entryContext, placementPolicy: "create-linked-clip" }),
    }));
    expect(claimSubmission).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        projectId: "project-1",
        context: expect.objectContaining({ entryContext, placementPolicy: "create-linked-clip" }),
        target: { kind: "new-asset" },
      }),
    }));
  });

  it("reconciles active jobs once through a two-controller barrier in one session", async () => {
    const submit = submissionPorts();
    const job = await createGenerationController(controllerPorts(submit)).submit(draft());
    const pollBarrier = barrier();
    let claimCount = 0;
    let claimed = false;
    let savedJob: GenerationJob | undefined;
    let complete!: (job: GenerationJob) => void;
    const completion = new Promise<GenerationJob>((resolve) => { complete = resolve; });
    const claimReconciliation = vi.fn(async () => {
      claimCount += 1;
      if (claimCount === 2) pollBarrier.release();
      await pollBarrier.promise;
      if (!claimed) {
        claimed = true;
        return { status: "claimed" as const, claimId: "poll-winner" };
      }
      return savedJob
        ? { status: "existing" as const, job: savedJob }
        : { status: "pending" as const, waitForCompletion: completion };
    });
    const statusRead = vi.fn(async (value: GenerationJob) => ({ ...value, status: "running" as const, updatedAt: 2000 }));
    const completeReconciliation = vi.fn(async ({ job: next }: { job: GenerationJob }) => {
      savedJob = next;
      complete(next);
    });
    const first = createGenerationController(controllerPorts(submit, {
      list: vi.fn(async () => [v2Record(job)]), claimReconciliation, completeReconciliation,
      save: vi.fn(async (next) => next),
    }, { read: statusRead }), { sessionId: "reload-1" });
    const second = createGenerationController(controllerPorts(submit, {
      list: vi.fn(async () => [v2Record(job)]), claimReconciliation, completeReconciliation,
      save: vi.fn(async (next) => next),
    }, { read: statusRead }), { sessionId: "reload-1" });

    const [firstResult, secondResult] = await Promise.all([first.reconcile("project-1"), second.reconcile("project-1")]);

    expect(firstResult).toEqual([expect.objectContaining({ status: "running" })]);
    expect(secondResult).toEqual(firstResult);
    expect(claimReconciliation).toHaveBeenCalledTimes(2);
    expect(statusRead).toHaveBeenCalledTimes(1);
    expect(completeReconciliation).toHaveBeenCalledTimes(1);
  });

  it("invalidates session reconciliation so a later authoritative change is read", async () => {
    const submit = submissionPorts();
    const job = await createGenerationController(controllerPorts(submit)).submit(draft());
    let current: GenerationJob = { ...job, status: "running", updatedAt: 2000 };
    const statusRead = vi.fn(async () => current);
    let claimNumber = 0;
    const claimReconciliation = vi.fn(async () => {
      claimNumber += 1;
      return { status: "claimed" as const, claimId: `poll-${claimNumber}` };
    });
    const controller = createGenerationController(controllerPorts(submit, {
      list: vi.fn(async () => [v2Record(job)]), claimReconciliation, completeReconciliation: vi.fn(async () => undefined),
    }, { read: statusRead }), { sessionId: "reload-1" });

    await controller.reconcile("project-1");
    current = { ...current, status: "completed", updatedAt: 3000 };
    await controller.invalidateReconciliation({ projectId: "project-1", jobId: job.id });
    const secondResult = await controller.reconcile("project-1");

    expect(statusRead).toHaveBeenCalledTimes(2);
    expect(secondResult).toEqual([expect.objectContaining({ status: "completed" })]);
  });

  it("does not repopulate the reconciliation cache after invalidation during an in-flight read", async () => {
    const submit = submissionPorts();
    const job = await createGenerationController(controllerPorts(submit)).submit(draft());
    let releaseRead!: () => void;
    const readRelease = new Promise<void>((resolve) => { releaseRead = resolve; });
    let readCount = 0;
    let signalReadStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalReadStarted = resolve; });
    const statusRead = vi.fn(async (value: GenerationJob) => {
      readCount += 1;
      signalReadStarted();
      if (readCount === 1) await readRelease;
      return { ...value, status: "running" as const, updatedAt: 2000 + readCount };
    });
    const controller = createGenerationController(controllerPorts(submit, {
      list: vi.fn(async () => [v2Record(job)]),
      claimReconciliation: vi.fn(async () => ({ status: "claimed" as const, claimId: `claim-${readCount + 1}` })),
      completeReconciliation: vi.fn(async () => undefined),
    }, { read: statusRead }), { sessionId: "reload-epoch" });

    const inFlight = controller.reconcile("project-1");
    await started;
    await controller.invalidateReconciliation({ projectId: "project-1", jobId: job.id });
    releaseRead();
    await inFlight;
    await controller.reconcile("project-1");

    expect(readCount).toBe(2);
  });

  it("rejects a listed job whose project or context project is not owned", async () => {
    const submit = submissionPorts();
    const job = await createGenerationController(controllerPorts(submit)).submit(draft());
    const mismatchedJob = { ...job, projectId: "other-project" };
    const mismatchedContext = { ...job, context: { ...job.context, projectId: "other-project" } };
    const controller = createGenerationController(controllerPorts(submit, {
      list: vi.fn(async () => [v2Record(mismatchedJob), v2Record(mismatchedContext)]),
    }));

    await expect(controller.reconcile("project-1")).rejects.toMatchObject({ code: "generation-job-project-mismatch" });
  });

  it("reports a stable context ownership error when the job project is correct", async () => {
    const submit = submissionPorts();
    const job = await createGenerationController(controllerPorts(submit)).submit(draft());
    const mismatchedContext = { ...job, context: { ...job.context, projectId: "other-project" } };
    const controller = createGenerationController(controllerPorts(submit, {
      list: vi.fn(async () => [v2Record(mismatchedContext)]),
    }));

    await expect(controller.reconcile("project-1")).rejects.toMatchObject({ code: "generation-context-project-mismatch" });
  });

  it("migrates typed legacy records using their stable store keys", async () => {
    const save = vi.fn(async (job) => job);
    const controller = createGenerationController(controllerPorts(submissionPorts(), {
      list: vi.fn(async () => [{ kind: "legacy" as const, storeKey: "store-row-1", projectId: "project-1", payload: { linkedMediaIds: ["must-not-be-used"] } }]),
      save,
    }));

    const [migrated] = await controller.reconcile("project-1");

    expect(migrated).toMatchObject({ kind: "legacy", storeKey: "store-row-1", status: "needs-attention" });
    expect(JSON.stringify(migrated)).not.toContain("must-not-be-used");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("releases leases through the typed controller lease port", async () => {
    const release = vi.fn(async () => undefined);
    const submit = submissionPorts({
      references: {
        uploadReference: vi.fn(async ({ mediaId }: { mediaId: string }) => ({ tokenId: `lease-${mediaId}` })),
      },
      provider: { submit: vi.fn(async () => { throw new Error("provider down"); }) },
    });
    const controller = createGenerationController({
      ...controllerPorts(submit),
      leases: { releaseUploadLease: release },
    });

    await expect(controller.submit(draft({ references: [{ mediaId: "ref-1" }, { mediaId: "ref-2" }] }))).rejects.toMatchObject({ code: "generation-submit-failed" });
    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith({ tokenId: "lease-ref-1" });
    expect(release).toHaveBeenCalledWith({ tokenId: "lease-ref-2" });
  });

  it("preserves every affected token id when lease cleanup aggregates failures", async () => {
    const release = vi.fn(async () => { throw new Error("release down"); });
    const submit = submissionPorts({
      references: {
        uploadReference: vi.fn(async ({ mediaId }: { mediaId: string }) => ({ tokenId: `lease-${mediaId}` })),
      },
      provider: { submit: vi.fn(async () => { throw new Error("provider down"); }) },
    });
    const controller = createGenerationController({ ...controllerPorts(submit), leases: { releaseUploadLease: release } });

    await expect(controller.submit(draft({ references: [{ mediaId: "ref-1" }, { mediaId: "ref-2" }] }))).rejects.toMatchObject({
      code: "generation-reference-release-failed",
      tokenIds: ["lease-ref-1", "lease-ref-2"],
    });
  });

  it("transfers lease ownership on success", async () => {
    const release = vi.fn(async () => undefined);
    const submit = submissionPorts({ references: { uploadReference: vi.fn(async () => ({ tokenId: "lease-ref-1" })) } });
    const controller = createGenerationController({ ...controllerPorts(submit), leases: { releaseUploadLease: release } });

    await controller.submit(draft({ references: [{ mediaId: "ref-1" }] }));

    expect(release).not.toHaveBeenCalled();
  });

  it("releases the claim lock after failure so a retry can start", async () => {
    const provider = vi.fn().mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValueOnce({ providerJobId: "provider-2" });
    const submit = submissionPorts({ provider: { submit: provider } });
    const failSubmission = vi.fn(async () => undefined);
    const controller = createGenerationController(controllerPorts(submit, { failSubmission }));

    await expect(controller.submit(draft())).rejects.toMatchObject({ code: "generation-submit-failed" });
    await expect(controller.submit(draft())).resolves.toMatchObject({ providerJobId: "provider-2" });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(failSubmission).toHaveBeenCalledTimes(1);
  });
});
