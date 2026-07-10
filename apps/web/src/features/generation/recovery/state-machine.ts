import type { GenerationError, GenerationJob } from "@openreel/music-video-domain/generation";

export type RecoveryAction = "regenerate" | "variation" | "retry-provider" | "retry-finalization" | "retry-placement" | "cancel";
export type RecoveryTransition = { action: RecoveryAction; from: GenerationJob["status"][]; to: GenerationJob["status"] | "draft" };

const transitions: RecoveryTransition[] = [
  { action: "regenerate", from: ["completed", "failed", "canceled", "needs-attention"], to: "preparing" },
  { action: "variation", from: ["completed", "failed", "canceled"], to: "draft" },
  { action: "retry-provider", from: ["failed", "canceled"], to: "queued" },
  { action: "retry-finalization", from: ["completed", "failed"], to: "running" },
  { action: "retry-placement", from: ["completed", "failed"], to: "running" },
  { action: "cancel", from: ["preparing", "queued", "running"], to: "canceling" },
];

export function allowedRecoveryActions(status: GenerationJob["status"]): RecoveryAction[] {
  return transitions.filter((t) => t.from.includes(status)).map((t) => t.action);
}

export function assertRecoveryTransition(job: GenerationJob, action: RecoveryAction): RecoveryTransition {
  const transition = transitions.find((t) => t.action === action && t.from.includes(job.status));
  if (!transition) throw new RecoveryError("recovery-invalid-transition", { action, status: job.status });
  return transition;
}

export class RecoveryError extends Error {
  constructor(readonly code: string, readonly details?: Record<string, unknown>) { super(code); this.name = "RecoveryError"; }
}

export interface RecoveryDraft extends Omit<GenerationJob, "status" | "attempts" | "checkpoints" | "output" | "error" | "placement"> {
  status: "draft";
  sourceJobId: string;
}

export interface RecoveryPorts {
  now(): number;
  resolveContext(input: { job: GenerationJob }): Promise<GenerationJob["context"]>;
  submit(input: { job: GenerationJob; attemptNumber: number }): Promise<{ providerJobId: string }>;
  save(job: GenerationJob): Promise<GenerationJob>;
  cancelProvider?(input: { provider: string; providerJobId: string }): Promise<void>;
  cleanupUploads?(job: GenerationJob): Promise<void>;
  stopPolling?(jobId: string): void;
}

const stableError = (code: string, cause?: unknown): GenerationError => ({
  code, retryable: true, message: cause instanceof Error ? cause.message : undefined,
});

export class GenerationRecoveryController {
  constructor(private readonly ports: RecoveryPorts) {}

  async regenerate(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "regenerate");
    let context: GenerationJob["context"];
    try { context = await this.ports.resolveContext({ job }); }
    catch (cause) { return this.ports.save({ ...job, status: "failed", error: stableError("recovery-context-resolution-failed", cause), updatedAt: this.ports.now() }); }
    return this.ports.save({ ...job, context, status: "preparing", error: undefined, updatedAt: this.ports.now() });
  }

  variation(job: GenerationJob): RecoveryDraft {
    assertRecoveryTransition(job, "variation");
    return { ...job, status: "draft", sourceJobId: job.id, id: `${job.id}:variation`, createdAt: this.ports.now(), updatedAt: this.ports.now() };
  }

  async retryProvider(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "retry-provider");
    const attemptNumber = Math.max(0, ...job.attempts.map((a) => a.attemptNumber)) + 1;
    const startedAt = this.ports.now();
    try {
      const result = await this.ports.submit({ job, attemptNumber });
      return this.ports.save({ ...job, status: "queued", error: undefined, updatedAt: this.ports.now(), attempts: [...job.attempts, { attemptNumber, providerJobId: result.providerJobId, startedAt }] });
    } catch (cause) {
      return this.ports.save({ ...job, status: "failed", updatedAt: this.ports.now(), error: stableError("recovery-provider-submit-failed", cause), attempts: [...job.attempts, { attemptNumber, startedAt, endedAt: this.ports.now(), terminalError: stableError("recovery-provider-submit-failed", cause) }] });
    }
  }

  async retryFinalization(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "retry-finalization");
    return this.ports.save({ ...job, status: "running", error: undefined, updatedAt: this.ports.now(), checkpoints: { ...job.checkpoints, "placeholder-finalized": { status: "pending" } } });
  }

  async retryPlacement(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "retry-placement");
    return this.ports.save({ ...job, status: "running", error: undefined, updatedAt: this.ports.now(), checkpoints: { ...job.checkpoints, "placement-applied": { status: "pending" } }, placement: job.placement ? { ...job.placement, status: "pending", error: undefined } : undefined });
  }

  async cancel(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "cancel");
    this.ports.stopPolling?.(job.id);
    const providerJobId = job.attempts.at(-1)?.providerJobId;
    const canceling = await this.ports.save({ ...job, status: "canceling", updatedAt: this.ports.now() });
    try { if (providerJobId) await this.ports.cancelProvider?.({ provider: job.provider, providerJobId }); }
    catch { /* provider cancellation is best effort; local cancellation is authoritative */ }
    await this.ports.cleanupUploads?.(canceling);
    return this.ports.save({ ...canceling, status: "canceled", updatedAt: this.ports.now() });
  }
}
