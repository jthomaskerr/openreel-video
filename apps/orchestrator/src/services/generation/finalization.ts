import { createHash } from "node:crypto";
import type {
  GenerationCheckpointName,
  GenerationCheckpointState,
  GenerationError,
  GenerationJob,
  GenerationOutput,
} from "@openreel/music-video-domain/generation";
import { GenerationRepositoryError, type GenerationJobRepository, type PlacementClaim, type PlacementOutcome } from "./repository.js";
import { KeyedLock } from "./lock.js";

export interface DownloadedGenerationOutput {
  bytes: Uint8Array;
  mimeType: string;
}

export interface GenerationOutputDownloader {
  download(input: { provider: string; providerJobId: string }): Promise<DownloadedGenerationOutput>;
}

export interface GenerationOutputVerifier {
  verify(input: { bytes: Uint8Array; mimeType: string; maxBytes: number }): Promise<void>;
}

export interface GenerationOutputInspector {
  inspect(input: { bytes: Uint8Array; mimeType: string }): Promise<Pick<GenerationOutput, "width" | "height" | "durationSeconds">>;
}

export interface PlaceholderFinalizer {
  finalize(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<Pick<GenerationOutput, "mediaId" | "versionId">>;
}

export interface ShotLinker {
  link(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<void>;
}

export interface TimelinePlacer {
  /** The production action must classify the external request, never infer success from promise timing. */
  place(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<PlacementAttemptResult>;
  /** Authoritative lookup keyed by the same stable idempotency key. */
  reconcile(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<PlacementAttemptResult>;
}

export interface PlacementAttemptResult {
  outcome: PlacementOutcome;
  error?: GenerationError;
  /** A not-applied result permits replay only when the sink proves the prior
   * invocation is quiescent and cannot later commit. */
  replaySafe?: boolean;
}

export interface PlacementLeaseScheduler {
  start(input: { intervalMs: number; tick: () => Promise<void> }): { stop(): Promise<void> };
}

export interface FinalizationPorts {
  download: GenerationOutputDownloader;
  verify: GenerationOutputVerifier;
  inspect: GenerationOutputInspector;
  placeholder: PlaceholderFinalizer;
  shot?: ShotLinker;
  placement?: TimelinePlacer;
  maxOutputBytes?: number;
  clock?: () => number;
  placementLeaseScheduler?: PlacementLeaseScheduler;
}

export type CompletionSignal = { provider: string; providerJobId: string };

const CHECKPOINTS: GenerationCheckpointName[] = [
  "output-claimed",
  "output-downloaded",
  "output-verified",
  "output-inspected",
  "placeholder-finalized",
  "shot-linked",
  "placement-applied",
];
const FINALIZATION_LOCKS = new KeyedLock();
const DEFAULT_PLACEMENT_LEASE_SCHEDULER: PlacementLeaseScheduler = {
  start({ intervalMs, tick }) {
    let inFlight = Promise.resolve();
    let failure: unknown;
    const timer = setInterval(() => {
      inFlight = inFlight.then(tick).catch((error) => { failure ??= error; });
    }, intervalMs);
    timer.unref?.();
    return {
      async stop() {
        clearInterval(timer);
        await inFlight;
        if (failure) throw failure;
      },
    };
  },
};

function errorFrom(error: unknown, fallback = "generation-finalization-failed"): GenerationError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^generation-[a-z0-9-]+$/.test(message) ? message : fallback;
  return { code, message, retryable: true };
}

function completed(job: GenerationJob, checkpoint: GenerationCheckpointName) {
  return job.checkpoints[checkpoint]?.status === "completed";
}

function idempotencyKey(jobId: string, stage: string) {
  return `generation:${jobId}:${stage}`;
}

function outputMediaId(job: GenerationJob) {
  const candidate = job.providerInputs.placeholderMediaId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : job.output?.mediaId ?? `generated:${job.id}`;
}

function isLocalUrl(value: string) {
  return /^(?:blob:|local:|file:)/i.test(value);
}

function shotId(job: GenerationJob) {
  return job.context.entryContext.kind === "unplaced-shot" ? job.context.entryContext.shotId : undefined;
}

/** Resumable, idempotent finalization. Provider submission is deliberately not a port here. */
export class GenerationFinalizer {
  private readonly locks = FINALIZATION_LOCKS;
  constructor(private readonly repository: GenerationJobRepository, private readonly ports: FinalizationPorts) {}
  private now() { return this.ports.clock?.() ?? Date.now(); }

  async finalize(jobId: string, signal?: CompletionSignal): Promise<GenerationJob> {
    return this.locks.run(jobId, async () => {
      let job = await this.requireJob(jobId);
      const providerJobId = signal?.providerJobId ?? job.attempts.at(-1)?.providerJobId;
      if (!providerJobId) return this.rejectCompletion(job, "generation-provider-id-missing", "Provider completion did not include a provider job ID");
      const activeAttempt = job.attempts.at(-1);
      if (job.status === "canceled" || (signal && (signal.provider !== job.provider || providerJobId !== job.providerJobId || providerJobId !== activeAttempt?.providerJobId))) {
        return this.rejectCompletion(job, "generation-completion-not-owned", "Provider completion is no longer owned by this generation job");
      }
      let downloaded: DownloadedGenerationOutput | undefined;
      try {
        const durableMediaId = outputMediaId(job);
        if (isLocalUrl(durableMediaId)) return this.fail(job, "output-downloaded", { code: "generation-local-url-forbidden", message: "Local media identity cannot cross a durable generation boundary", retryable: false });
        if (!completed(job, "output-inspected")) {
          if (!completed(job, "output-downloaded")) {
            downloaded = await this.ports.download.download({ provider: job.provider, providerJobId });
            await this.mark(job.id, "output-downloaded", { status: "completed", timestamp: this.now() });
          }
          // A retry after restart has no in-memory bytes. The downloader is intentionally replay-safe.
          if (!downloaded) downloaded = await this.ports.download.download({ provider: job.provider, providerJobId });
          if (!completed(job, "output-verified")) {
            await this.ports.verify.verify({ bytes: downloaded.bytes, mimeType: downloaded.mimeType, maxBytes: this.ports.maxOutputBytes ?? 200 * 1024 * 1024 });
            await this.mark(job.id, "output-verified", { status: "completed", timestamp: this.now() });
          }
          if (!completed(job, "output-inspected")) {
            const metadata = await this.ports.inspect.inspect({ bytes: downloaded.bytes, mimeType: downloaded.mimeType });
            const output: GenerationOutput = { mediaId: outputMediaId(job), versionId: `pending:${job.id}`, mimeType: downloaded.mimeType, byteLength: downloaded.bytes.byteLength, sha256: createHash("sha256").update(downloaded.bytes).digest("hex"), ...metadata };
            await this.repository.update(job.id, (current) => ({ ...current, output }));
            await this.mark(job.id, "output-inspected", { status: "completed", timestamp: this.now() });
          }
        }
        job = await this.requireJob(job.id);
        const completionKey = idempotencyKey(job.id, "finalization");
      const claimResult = await this.repository.claimFinalization({
        jobId: job.id,
        providerInstanceId: job.providerInstanceId,
        providerJobId,
          outputIdentity: JSON.stringify({ providerJobId, outputMediaIds: [outputMediaId(job)] }),
          idempotencyKey: completionKey,
        });
        if (!claimResult.acquired) {
          if (claimResult.claim.state === "completed") return this.requireJob(job.id);
          const projected = await this.requireJob(job.id);
          if (await this.hasTerminalPlacementProjection(projected)) return this.completeRecoveredFinalization(projected);
          return this.waitForFinalization(job.id);
        }
        if (!completed(job, "placeholder-finalized")) {
          const output = job.output!;
          const ids = await this.ports.placeholder.finalize({ job, output, idempotencyKey: idempotencyKey(job.id, "placeholder-finalized") });
          if (isLocalUrl(ids.mediaId) || isLocalUrl(ids.versionId)) throw new Error("generation-local-url-forbidden");
          await this.repository.update(job.id, (current) => ({ ...current, output: { ...current.output!, ...ids } }));
          await this.mark(job.id, "placeholder-finalized", { status: "completed", timestamp: this.now() });
        }
        job = await this.requireJob(job.id);
        const currentShotId = shotId(job);
        if (currentShotId && this.ports.shot && !completed(job, "shot-linked")) {
          await this.ports.shot.link({ job, output: job.output!, idempotencyKey: idempotencyKey(job.id, "shot-linked") });
          await this.mark(job.id, "shot-linked", { status: "completed", timestamp: this.now() });
        }
        if (job.context.placementPolicy !== "none" && this.ports.placement && !completed(job, "placement-applied")) {
          job = await this.executePlacement(job);
        }
        if (job.placement?.status === "pending") return job;
        await this.repository.completeFinalization(job.id, completionKey, claimResult.claim.ownerToken);
        return this.repository.update(job.id, (current) => current.status === "needs-attention" ? current : ({ ...current, status: "succeeded", updatedAt: this.now() }));
      } catch (error) {
        const latest = await this.requireJob(job.id);
        if (await this.hasTerminalPlacementProjection(latest)) return this.completeRecoveredFinalization(latest);
        const checkpoint = CHECKPOINTS.find((name) => latest.checkpoints[name]?.status !== "completed") ?? "output-inspected";
        return this.fail(latest, checkpoint, errorFrom(error));
      }
    });
  }

  async retryPlacement(jobId: string): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.context.placementPolicy === "none" || !this.ports.placement) return job;
    const currentShotId = shotId(job);
    const requiredCheckpoints: GenerationCheckpointName[] = ["output-downloaded", "output-verified", "output-inspected", "placeholder-finalized"];
    if (currentShotId && this.ports.shot) requiredCheckpoints.push("shot-linked");
    if (!job.output?.mediaId || !job.output.versionId || requiredCheckpoints.some((checkpoint) => !completed(job, checkpoint))) {
      throw new Error("generation-placement-retry-precondition");
    }
    const placementKey = idempotencyKey(jobId, "placement-applied");
    const ownership = await this.acquirePlacement(jobId, placementKey);
    if (ownership.job) return ownership.job;
    const claim = ownership.claim!;
    let placeInvoked = false;
    let placementReturned = false;
    try {
      await this.repository.update(jobId, (current) => ({ ...current, checkpoints: { ...current.checkpoints, "placement-applied": { status: "pending" } }, placement: { policy: current.context.placementPolicy, status: "pending" } }));
      const current = await this.requireJob(jobId);
      await this.repository.markPlacementInvocationStarted(jobId, placementKey, claim.ownerToken);
      placeInvoked = true;
      const result = await this.withPlacementLease(jobId, placementKey, claim.ownerToken, () => this.ports.placement!.place({ job: current, output: current.output!, idempotencyKey: placementKey }));
      placementReturned = true;
      return await this.applyPlacementResult(jobId, result, claim.ownerToken);
    } catch (error) {
      if (this.isPlacementOwnerLost(error)) return this.requireJob(jobId);
      if (placementReturned) throw error;
      if (!placeInvoked) return this.applyPlacementResult(jobId, { outcome: "not-applied", replaySafe: true, error: { code: "generation-placement-failed", message: error instanceof Error ? error.message : "Placement did not start", retryable: true } }, claim.ownerToken);
      const unknown = { code: "generation-placement-outcome-unknown", message: error instanceof Error ? error.message : "Placement response was lost", retryable: false } satisfies GenerationError;
      try { return await this.applyPlacementResult(jobId, { outcome: "unknown", error: unknown }, claim.ownerToken); }
      catch (claimError) { if (this.isPlacementOwnerLost(claimError)) return this.requireJob(jobId); throw claimError; }
    }
  }

  /** Authoritative placement reconciliation. Repository claim tokens stay inside this service. */
  async reconcilePlacement(jobId: string): Promise<GenerationJob> {
    let job = await this.requireJob(jobId);
    const claim = await this.repository.getPlacementClaim(jobId);
    if (!claim) throw new Error("generation-placement-reconciliation-unavailable");
    const placementKey = idempotencyKey(jobId, "placement-applied");
    const recovery = await this.repository.recoverPlacement(jobId, placementKey);
    if (recovery.kind === "owner-live") return this.requireJob(jobId);
    if (recovery.kind === "safe-retry") return this.completeRecoveredFinalization(await this.retryPlacement(jobId));
    if (recovery.kind === "resolved") return this.completeRecoveredFinalization(await this.projectPlacementClaim(jobId, recovery.claim));
    if (!this.ports.placement) throw new Error("generation-placement-reconciliation-unavailable");
    if (job.context.placementPolicy === "none" || !job.output?.mediaId || !job.output.versionId) throw new Error("generation-placement-reconciliation-unavailable");
    if (job.status === "needs-attention") job = await this.repository.update(jobId, (current) => ({ ...current, status: "finalizing", updatedAt: this.now() }));
    return this.reconcileOwnedPlacement(job, placementKey, recovery.claim);
  }

  private async applyPlacementResult(jobId: string, result: PlacementAttemptResult, ownerToken?: string): Promise<GenerationJob> {
    const placementKey = idempotencyKey(jobId, "placement-applied");
    const claim = ownerToken ? await this.repository.reconcilePlacement(jobId, placementKey, ownerToken, result.outcome, { replaySafe: result.replaySafe }) : undefined;
    if (result.outcome === "applied") {
      return this.commitPlacementProjection(jobId, claim, { status: "completed", timestamp: this.now() }, (currentJob) => ({ ...currentJob, status: "succeeded", error: undefined, placement: { policy: currentJob.context.placementPolicy, status: "applied", appliedAt: this.now() }, updatedAt: this.now() }));
    }
    if (result.outcome === "not-applied") {
      const replaySafe = claim?.replaySafe ?? result.replaySafe ?? false;
      const failure = (replaySafe
        ? result.error ?? { code: "generation-placement-failed", message: "Placement was not applied", retryable: true }
        : { code: "generation-placement-retry-unsafe", message: result.error?.message ?? "Placement was not observed, but the prior invocation may still commit; explicit reconciliation is required", retryable: false }) satisfies GenerationError;
      return this.commitPlacementProjection(jobId, claim, { status: "failed", timestamp: this.now(), error: failure }, (currentJob) => ({ ...currentJob, status: replaySafe ? "succeeded" : "needs-attention", error: replaySafe ? undefined : failure, placement: { policy: currentJob.context.placementPolicy, status: "failed", error: failure, replaySafe }, updatedAt: this.now() }));
    }
    if (result.outcome === "pending") {
      return this.commitPlacementProjection(jobId, claim, { status: "pending", timestamp: this.now() }, (currentJob) => ({ ...currentJob, placement: { policy: currentJob.context.placementPolicy, status: "pending" }, updatedAt: this.now() }));
    }
    const error = { code: "generation-placement-outcome-unknown", message: result.error?.message ?? "Placement outcome is unknown; explicit reconciliation is required before retry", retryable: false } satisfies GenerationError;
    return this.commitPlacementProjection(jobId, claim, { status: "failed", timestamp: this.now(), error }, (currentJob) => ({ ...currentJob, status: "needs-attention", placement: { policy: currentJob.context.placementPolicy, status: "failed", error }, error, updatedAt: this.now() }));
  }

  private async commitPlacementProjection(
    jobId: string,
    claim: PlacementClaim | undefined,
    checkpoint: GenerationCheckpointState,
    project: (job: GenerationJob) => GenerationJob,
  ): Promise<GenerationJob> {
    if (!(await this.isCurrentPlacementProjection(jobId, claim))) return this.requireJob(jobId);
    await this.mark(jobId, "placement-applied", checkpoint);
    if (!(await this.isCurrentPlacementProjection(jobId, claim))) return this.requireJob(jobId);
    return this.repository.update(jobId, (current) => checkpoint.status !== "completed" && current.checkpoints["placement-applied"]?.status === "completed" ? current : project(current));
  }

  private async isCurrentPlacementProjection(jobId: string, claim: PlacementClaim | undefined) {
    if (!claim) return true;
    const current = await this.repository.getPlacementClaim(jobId);
    return current?.ownerToken === claim.ownerToken
      && current.ownerEpoch === claim.ownerEpoch
      && current.phase === claim.phase
      && current.outcome === claim.outcome;
  }

  private async executePlacement(job: GenerationJob): Promise<GenerationJob> {
    const placementKey = idempotencyKey(job.id, "placement-applied");
    const ownership = await this.acquirePlacement(job.id, placementKey);
    if (ownership.job) return ownership.job;
    const claim = ownership.claim!;
    let placeInvoked = false;
    let placementReturned = false;
    try {
      await this.repository.update(job.id, (current) => ({ ...current, checkpoints: { ...current.checkpoints, "placement-applied": { status: "pending" } }, placement: { policy: current.context.placementPolicy, status: "pending" } }));
      const current = await this.requireJob(job.id);
      await this.repository.markPlacementInvocationStarted(job.id, placementKey, claim.ownerToken);
      placeInvoked = true;
      const result = await this.withPlacementLease(job.id, placementKey, claim.ownerToken, () => this.ports.placement!.place({ job: current, output: current.output!, idempotencyKey: placementKey }));
      placementReturned = true;
      return await this.applyPlacementResult(job.id, result, claim.ownerToken);
    } catch (error) {
      if (this.isPlacementOwnerLost(error)) return this.requireJob(job.id);
      if (placementReturned) throw error;
      if (!placeInvoked) return this.applyPlacementResult(job.id, { outcome: "not-applied", replaySafe: true, error: { code: "generation-placement-failed", message: error instanceof Error ? error.message : "Placement did not start", retryable: true } }, claim.ownerToken);
      try { return await this.applyPlacementResult(job.id, { outcome: "unknown", error: { code: "generation-placement-outcome-unknown", message: error instanceof Error ? error.message : "Placement response was lost", retryable: false } }, claim.ownerToken); }
      catch (claimError) { if (this.isPlacementOwnerLost(claimError)) return this.requireJob(job.id); throw claimError; }
    }
  }

  private async acquirePlacement(jobId: string, placementKey: string): Promise<{ claim?: PlacementClaim; job?: GenerationJob }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = await this.repository.claimPlacement(jobId, placementKey);
      if (claimed.acquired) return { claim: claimed.claim };
      if (claimed.claim.outcome !== "pending") return { job: await this.projectPlacementClaim(jobId, claimed.claim) };
      const recovery = await this.repository.recoverPlacement(jobId, placementKey);
      if (recovery.kind === "owner-live") return { job: await this.requireJob(jobId) };
      if (recovery.kind === "reconcile") return { job: await this.reconcileOwnedPlacement(await this.requireJob(jobId), placementKey, recovery.claim) };
      await this.projectPlacementClaim(jobId, recovery.claim);
    }
    throw new Error("generation-placement-claim-contention");
  }

  private projectPlacementClaim(jobId: string, claim: PlacementClaim) {
    if (claim.outcome === "applied") return this.applyPlacementResult(jobId, { outcome: "applied" }, claim.ownerToken);
    if (claim.outcome === "not-applied") return this.applyPlacementResult(jobId, {
      outcome: "not-applied",
      replaySafe: claim.replaySafe,
      error: claim.replaySafe === false ? { code: "generation-placement-retry-unsafe", message: "Placement was not observed, but the prior invocation may still commit; explicit reconciliation is required", retryable: false } : undefined,
    }, claim.ownerToken);
    if (claim.outcome === "unknown") return this.applyPlacementResult(jobId, { outcome: "unknown", error: { code: "generation-placement-outcome-unknown", message: "Placement outcome is unknown; explicit reconciliation is required before retry", retryable: false } }, claim.ownerToken);
    return this.requireJob(jobId);
  }

  private async reconcileOwnedPlacement(job: GenerationJob, placementKey: string, claim: PlacementClaim) {
    if (!this.ports.placement || !job.output) throw new Error("generation-placement-reconciliation-unavailable");
    let result: PlacementAttemptResult;
    try {
      result = await this.withPlacementLease(job.id, placementKey, claim.ownerToken, () => this.ports.placement!.reconcile({ job, output: job.output!, idempotencyKey: placementKey }));
    } catch (error) {
      if (this.isPlacementOwnerLost(error)) return this.requireJob(job.id);
      result = { outcome: "unknown", error: { code: "generation-placement-outcome-unknown", message: error instanceof Error ? error.message : "Placement reconciliation response was lost", retryable: false } };
    }
    try { return await this.completeRecoveredFinalization(await this.applyPlacementResult(job.id, result, claim.ownerToken)); }
    catch (error) { if (this.isPlacementOwnerLost(error)) return this.requireJob(job.id); throw error; }
  }

  private async completeRecoveredFinalization(job: GenerationJob) {
    if (job.placement?.status === "pending") return job;
    const finalization = await this.repository.getFinalizationClaim(job.id);
    if (finalization?.state === "claimed") await this.repository.completeFinalization(job.id, finalization.idempotencyKey, finalization.ownerToken);
    return job;
  }

  private async hasTerminalPlacementProjection(job: GenerationJob) {
    if (job.context.placementPolicy === "none") return false;
    const claim = await this.repository.getPlacementClaim(job.id);
    if (!claim || claim.phase !== "terminal") return false;
    if (claim.outcome === "applied") return job.status === "succeeded" && job.placement?.status === "applied" && completed(job, "placement-applied");
    if (claim.outcome === "not-applied") {
      const expectedStatus = claim.replaySafe ? "succeeded" : "needs-attention";
      return job.status === expectedStatus && job.placement?.status === "failed" && job.checkpoints["placement-applied"]?.status === "failed";
    }
    return claim.outcome === "unknown" && job.status === "needs-attention" && job.placement?.status === "failed" && job.checkpoints["placement-applied"]?.status === "failed";
  }

  private async withPlacementLease<T>(jobId: string, placementKey: string, ownerToken: string, task: () => Promise<T>) {
    const scheduler = this.ports.placementLeaseScheduler ?? DEFAULT_PLACEMENT_LEASE_SCHEDULER;
    const heartbeat = scheduler.start({
      intervalMs: Math.max(1, Math.floor(this.repository.placementLeaseTtlMs / 3)),
      tick: async () => { await this.repository.renewPlacement(jobId, placementKey, ownerToken); },
    });
    try { return await task(); }
    finally { await heartbeat.stop(); }
  }

  private isPlacementOwnerLost(error: unknown) {
    return error instanceof GenerationRepositoryError && error.code === "generation-placement-claim-fenced";
  }

  private async mark(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState) {
    await this.repository.compareAndSetCheckpoint(id, checkpoint, state);
  }
  private async requireJob(id: string) { const job = await this.repository.get(id); if (!job) throw new Error("generation-not-found"); return job; }
  private async waitForFinalization(id: string) {
    for (let attempt = 0; attempt < 100_000; attempt += 1) {
      const claim = await this.repository.getFinalizationClaim(id);
      if (claim?.state === "completed") {
        const completedJob = await this.requireJob(id);
        if (["completed", "succeeded"].includes(completedJob.status)) return completedJob;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return this.fail(await this.requireJob(id), "placeholder-finalized", { code: "generation-finalization-claim-timeout", message: "Finalization claim did not complete", retryable: true });
  }
  private rejectCompletion(job: GenerationJob, code: string, message: string) { return { ...job, error: { code, message, retryable: false } }; }
  private async fail(job: GenerationJob, checkpoint: GenerationCheckpointName, error: GenerationError) {
    await this.repository.compareAndSetCheckpoint(job.id, checkpoint, { status: "failed", timestamp: this.now(), error });
    return this.repository.update(job.id, (current) => ({ ...current, status: "failed", error }));
  }
}
