import type { GenerationError, GenerationJob } from "@openreel/music-video-domain/generation";
import type { GenerationJobRepository } from "./repository.js";

export interface RecoveryProvider {
  submit(input: { job: GenerationJob; attemptNumber: number }): Promise<{ providerJobId: string }>;
  cancel?(input: { provider: string; providerJobId: string }): Promise<void>;
}
export interface RecoveryCleanup { releaseUnreferenced(job: GenerationJob): Promise<void> }
export interface RecoveryClock { now(): number }

export class GenerationRecoveryService {
  constructor(private readonly repository: GenerationJobRepository, private readonly provider: RecoveryProvider, private readonly cleanup: RecoveryCleanup, private readonly clock: RecoveryClock = { now: () => Date.now() }) {}

  async retryProvider(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["failed", "canceled"].includes(job.status)) return this.fail(job, "generation-invalid-retry-state");
    const attemptNumber = Math.max(0, ...job.attempts.map((a) => a.attemptNumber)) + 1;
    const startedAt = this.clock.now();
    try {
      const { providerJobId } = await this.provider.submit({ job, attemptNumber });
      return this.repository.update(jobId, (current) => ({ ...current, status: "queued", error: undefined, updatedAt: this.clock.now(), attempts: [...current.attempts, { attemptNumber, providerJobId, startedAt }] }));
    } catch (cause) {
      const error = this.error("generation-provider-retry-failed", cause);
      return this.repository.update(jobId, (current) => ({ ...current, status: "failed", error, updatedAt: this.clock.now(), attempts: [...current.attempts, { attemptNumber, startedAt, endedAt: this.clock.now(), terminalError: error }] }));
    }
  }

  async retryFinalization(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["completed", "failed"].includes(job.status)) return this.fail(job, "generation-invalid-finalization-retry-state");
    return this.repository.update(jobId, (current) => ({ ...current, status: "running", error: undefined, updatedAt: this.clock.now(), checkpoints: { ...current.checkpoints, "placeholder-finalized": { status: "pending" } } }));
  }

  async retryPlacement(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["completed", "failed"].includes(job.status) || job.context.placementPolicy === "none") return this.fail(job, "generation-invalid-placement-retry-state");
    return this.repository.update(jobId, (current) => ({ ...current, status: "running", error: undefined, updatedAt: this.clock.now(), checkpoints: { ...current.checkpoints, "placement-applied": { status: "pending" } }, placement: { policy: current.context.placementPolicy, status: "pending" } }));
  }

  async cancel(jobId: string): Promise<GenerationJob> {
    const job = await this.require(jobId);
    if (!["preparing", "queued", "running"].includes(job.status)) return this.fail(job, "generation-invalid-cancel-state");
    const canceling = await this.repository.update(jobId, (current) => ({ ...current, status: "canceling", updatedAt: this.clock.now() }));
    const providerJobId = canceling.attempts.at(-1)?.providerJobId;
    try { if (providerJobId) await this.provider.cancel?.({ provider: canceling.provider, providerJobId }); } catch { /* local state remains authoritative */ }
    await this.cleanup.releaseUnreferenced(canceling);
    return this.repository.update(jobId, (current) => ({ ...current, status: "canceled", updatedAt: this.clock.now() }));
  }

  private async require(id: string) { const job = await this.repository.get(id); if (!job) throw new Error("generation-not-found"); return job; }
  private error(code: string, cause?: unknown): GenerationError { return { code, retryable: true, message: cause instanceof Error ? cause.message : undefined }; }
  private async fail(job: GenerationJob, code: string) { const error = this.error(code); return this.repository.update(job.id, (current) => ({ ...current, status: "failed", error, updatedAt: this.clock.now() })); }
}

/** Polling is owned by the caller; canceling marks this token stopped even if provider cancel is unsupported. */
export class GenerationPollingController {
  private readonly stopped = new Set<string>();
  stop(jobId: string) { this.stopped.add(jobId); }
  isStopped(jobId: string) { return this.stopped.has(jobId); }
  clear(jobId: string) { this.stopped.delete(jobId); }
}
