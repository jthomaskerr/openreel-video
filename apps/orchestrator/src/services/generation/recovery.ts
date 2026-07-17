import type { GenerationError, GenerationJob } from "@openreel/music-video-domain/generation";
import type { GenerationJobRepository } from "./repository.js";

export interface RecoveryProvider {
  submit(input: { job: GenerationJob; attemptNumber: number }): Promise<{ providerJobId: string }>;
  cancel?(input: { provider: string; providerJobId: string }): Promise<void>;
}

const RECOVERY_CHECKPOINTS = ["output-claimed", "output-downloaded", "output-verified", "output-inspected", "placeholder-finalized", "shot-linked", "placement-applied"] as const;
export interface RecoveryCleanup { releaseUnreferenced(job: GenerationJob): Promise<void> }
export interface RecoveryClock { now(): number }
export interface PlacementReconciler { reconcilePlacement(jobId: string): Promise<GenerationJob> }

export function isPlacementReconciliationCandidate(job: GenerationJob) {
  return job.status === "needs-attention"
    && job.context.placementPolicy !== "none"
    && Boolean(job.output?.mediaId && job.output.versionId)
    && job.checkpoints["placement-applied"]?.status === "failed"
    && ["generation-placement-outcome-unknown", "generation-placement-reconciliation-failed", "generation-placement-retry-unsafe"].includes(job.error?.code ?? "");
}

function completedPlacementProjection(job: GenerationJob, timestamp: number): GenerationJob {
  if (job.status === "succeeded"
    && job.error === undefined
    && job.checkpoints["placement-applied"]?.status === "completed"
    && job.placement?.status === "applied") return job;
  const checkpointTimestamp = job.checkpoints["placement-applied"]?.status === "completed"
    ? job.checkpoints["placement-applied"].timestamp ?? timestamp
    : timestamp;
  const { error: _discardedError, ...withoutError } = job;
  return {
    ...withoutError,
    status: "succeeded",
    updatedAt: timestamp,
    checkpoints: { ...job.checkpoints, "placement-applied": { status: "completed", timestamp: checkpointTimestamp } },
    placement: { policy: job.context.placementPolicy, status: "applied", appliedAt: job.placement?.status === "applied" ? job.placement.appliedAt ?? checkpointTimestamp : checkpointTimestamp },
  };
}

export async function projectTerminalPlacementSuccess(repository: GenerationJobRepository, jobId: string, now: () => number): Promise<GenerationJob | undefined> {
  const job = await repository.get(jobId);
  if (!job) return undefined;
  const claim = await repository.getPlacementClaim(jobId);
  const checkpointCompleted = job.checkpoints["placement-applied"]?.status === "completed";
  const claimApplied = claim?.phase === "terminal" && claim.state === "completed" && claim.outcome === "applied";
  if (!checkpointCompleted && !claimApplied) return undefined;
  const timestamp = job.checkpoints["placement-applied"]?.status === "completed"
    ? job.checkpoints["placement-applied"].timestamp ?? claim?.terminalAt ?? now()
    : claim?.terminalAt ?? now();
  return repository.update(jobId, (current) => completedPlacementProjection(current, timestamp));
}

export class GenerationRecoveryService {
 constructor(private readonly repository: GenerationJobRepository, private readonly provider: RecoveryProvider, private readonly cleanup: RecoveryCleanup, private readonly clock: RecoveryClock = { now: () => Date.now() }, readonly polling = new GenerationPollingController(), private readonly placementReconciler?: PlacementReconciler) {}

  async retryProvider(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["failed", "canceled"].includes(job.status)) return this.fail(job, "generation-invalid-retry-state");
    const attemptNumber = Math.max(0, ...job.attempts.map((a) => a.attemptNumber)) + 1;
    const startedAt = this.clock.now();
    try {
      const { providerJobId } = await this.provider.submit({ job, attemptNumber });
      if (job.attempts.some((attempt) => attempt.providerJobId === providerJobId)) {
        const error = this.error("generation-provider-retry-id-reused");
        return this.repository.update(jobId, (current) => ({ ...current, status: "failed", error, updatedAt: this.clock.now() }));
      }
 this.polling.clear(jobId);
 return this.repository.update(jobId, (current) => ({ ...current, status: "queued", providerJobId, error: undefined, updatedAt: this.clock.now(), attempts: [...current.attempts, { attemptNumber, providerJobId, routing: current.routing, startedAt }], checkpoints: Object.fromEntries(RECOVERY_CHECKPOINTS.map((name) => [name, { status: "pending" }])) }));
    } catch (cause) {
      const error = this.error("generation-provider-retry-failed", cause);
      return this.repository.update(jobId, (current) => ({ ...current, status: "failed", error, updatedAt: this.clock.now(), attempts: [...current.attempts, { attemptNumber, routing: current.routing, startedAt, endedAt: this.clock.now(), terminalError: error }] }));
    }
  }

  async retryFinalization(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["completed", "failed"].includes(job.status)) return this.fail(job, "generation-invalid-finalization-retry-state");
 const checkpoint = RECOVERY_CHECKPOINTS.slice(1, 6).find((name) => job.checkpoints[name]?.status !== "completed");
 if (!checkpoint) return job;
 return this.repository.update(jobId, (current) => ({ ...current, status: "running", error: undefined, updatedAt: this.clock.now(), checkpoints: Object.fromEntries(RECOVERY_CHECKPOINTS.map((name) => [name, { ...(current.checkpoints[name] ?? { status: "pending" }), ...(name === checkpoint ? { status: "pending" } : {}) }])) }));
  }

  async retryPlacement(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    const claim = await this.repository.getPlacementClaim(jobId);
    const recoveryProjectionKey = (candidate: GenerationJob) => {
      const checkpoint = candidate.checkpoints["placement-applied"];
      const placement = candidate.placement;
      return JSON.stringify([
        candidate.status,
        candidate.updatedAt,
        candidate.error?.code,
        candidate.context.placementPolicy,
        checkpoint?.status,
        checkpoint?.timestamp,
        checkpoint?.status === "failed" ? checkpoint.error?.code : undefined,
        placement?.status,
        placement?.status === "failed" ? placement.error?.code : undefined,
        placement?.status === "failed" ? placement.replaySafe : undefined,
        placement?.status === "applied" ? placement.appliedAt : undefined,
      ]);
    };
    const observedRecoveryProjection = recoveryProjectionKey(job);
    const isReplaySafeFailureProjection = (candidate: GenerationJob) => ["completed", "failed", "succeeded"].includes(candidate.status)
      && candidate.context.placementPolicy !== "none"
      && candidate.checkpoints["placement-applied"]?.status === "failed"
      && candidate.placement?.status === "failed"
      && candidate.placement.replaySafe === true;
    const replaySafeFailure = isReplaySafeFailureProjection(job)
      && claim?.phase === "terminal"
      && claim.state === "failed"
      && claim.outcome === "not-applied"
      && claim.replaySafe === true;
    if (!replaySafeFailure) {
      const terminalSuccess = await projectTerminalPlacementSuccess(this.repository, jobId, () => this.clock.now());
      if (terminalSuccess) return terminalSuccess;
      const error = this.error("generation-invalid-placement-retry-state");
      return this.repository.update(jobId, (current) => {
        const completedCheckpoint = current.checkpoints["placement-applied"]?.status === "completed"
          ? current.checkpoints["placement-applied"]
          : undefined;
        if (completedCheckpoint || current.placement?.status === "applied") {
          return completedPlacementProjection(current, completedCheckpoint?.timestamp ?? (current.placement?.status === "applied" ? current.placement.appliedAt : undefined) ?? this.clock.now());
        }
        if (recoveryProjectionKey(current) !== observedRecoveryProjection) return current;
        return { ...current, status: "failed", error, updatedAt: this.clock.now() };
      });
    }
    return this.repository.update(jobId, (current) => {
      if (!isReplaySafeFailureProjection(current)) return current;
      return {
        ...current,
        status: "running",
        error: undefined,
        updatedAt: this.clock.now(),
        checkpoints: Object.fromEntries(RECOVERY_CHECKPOINTS.map((name) => [name, { ...(current.checkpoints[name] ?? { status: "pending" }), ...(name === "placement-applied" ? { status: "pending" } : {}) }])),
        placement: { policy: current.context.placementPolicy, status: "pending" },
      };
    });
  }

  async reconcilePlacement(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!isPlacementReconciliationCandidate(job)) throw new Error("generation-invalid-placement-reconciliation-state");
    if (!this.placementReconciler) throw new Error("generation-placement-reconciliation-unavailable");
    await this.repository.update(jobId, (current) => {
      if (!isPlacementReconciliationCandidate(current)) throw new Error("generation-invalid-placement-reconciliation-state");
      return { ...current, status: "finalizing", updatedAt: this.clock.now() };
    });
    try {
      return await this.placementReconciler.reconcilePlacement(jobId);
    } catch (cause) {
      const terminal = await projectTerminalPlacementSuccess(this.repository, jobId, () => this.clock.now());
      if (terminal) return terminal;
      const latest = await this.require(jobId);
      if (latest.status !== "finalizing") return latest;
      const error: GenerationError = { code: "generation-placement-reconciliation-failed", message: cause instanceof Error ? cause.message : "Placement reconciliation failed", retryable: true };
      return this.repository.update(jobId, (current) => current.checkpoints["placement-applied"]?.status === "completed"
        ? completedPlacementProjection(current, current.checkpoints["placement-applied"].timestamp ?? this.clock.now())
        : current.status !== "finalizing" ? current : ({
        ...current,
        status: "needs-attention",
        error,
        updatedAt: this.clock.now(),
        checkpoints: { ...current.checkpoints, "placement-applied": { status: "failed", timestamp: this.clock.now(), error } },
        placement: { policy: current.context.placementPolicy, status: "failed", error },
      }));
    }
  }

  async cancel(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["preparing", "queued", "running"].includes(job.status)) return this.fail(job, "generation-invalid-cancel-state");
 this.polling.stop(jobId);
 const canceling = await this.repository.update(jobId, (current) => ({ ...current, status: "canceled", updatedAt: this.clock.now() }));
    const providerJobId = canceling.attempts.at(-1)?.providerJobId;
    let cancellationError: GenerationError | undefined;
    try { if (providerJobId) await this.provider.cancel?.({ provider: canceling.provider, providerJobId }); } catch (cause) { cancellationError = this.error("generation-provider-cancel-failed", cause); }
    await this.cleanup.releaseUnreferenced(canceling);
    return this.repository.update(jobId, (current) => ({ ...current, status: "canceled", ...(cancellationError ? { error: cancellationError } : {}), updatedAt: this.clock.now() }));
  }

  private async require(id: string) { const job = await this.repository.get(id); if (!job) throw new Error("generation-not-found"); return job; }
  private error(code: string, cause?: unknown): GenerationError { return { code, retryable: true, message: cause instanceof Error ? cause.message : String(cause ?? code) }; }
  private async fail(job: GenerationJob, code: string) { const error = this.error(code); return this.repository.update(job.id, (current) => ({ ...current, status: "failed", error, updatedAt: this.clock.now() })); }
}

/** Polling is owned by the caller; canceling marks this token stopped even if provider cancel is unsupported. */
export class GenerationPollingController {
  private readonly stopped = new Set<string>();
  stop(jobId: string) { this.stopped.add(jobId); }
  isStopped(jobId: string) { return this.stopped.has(jobId); }
  clear(jobId: string) { this.stopped.delete(jobId); }
}
