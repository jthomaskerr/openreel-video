import type { GenerationError, GenerationJob } from "@openreel/music-video-domain/generation";

export type RecoveryAction =
  | "regenerate"
  | "variation"
  | "retry-provider"
  | "retry-finalization"
  | "retry-placement"
  | "cancel";

export type RecoveryTransition = {
  action: RecoveryAction;
  from: readonly GenerationJob["status"][];
  to: GenerationJob["status"] | "draft";
  submitsProvider?: boolean;
  resolvesContext?: boolean;
  createsEditableDraft?: boolean;
  incrementsAttempt?: boolean;
  stopsPolling?: boolean;
  cancelsProvider?: boolean;
  cleansUploads?: boolean;
};

const recoveryTransitions: RecoveryTransition[] = [
  {
    action: "regenerate",
    from: ["completed", "failed", "canceled", "needs-attention"],
    to: "preparing",
    resolvesContext: true,
  },
  {
    action: "variation",
    from: ["completed", "failed", "canceled"],
    to: "draft",
    createsEditableDraft: true,
  },
  {
    action: "retry-provider",
    from: ["failed", "canceled"],
    to: "queued",
    submitsProvider: true,
    incrementsAttempt: true,
  },
  {
    action: "retry-finalization",
    from: ["completed", "failed"],
    to: "running",
  },
  {
    action: "retry-placement",
    from: ["completed", "failed"],
    to: "running",
  },
  {
    action: "cancel",
    from: ["preparing", "queued", "running"],
    to: "canceling",
    stopsPolling: true,
    cancelsProvider: true,
    cleansUploads: true,
  },
] ;

export function allowedRecoveryActions(status: GenerationJob["status"]): RecoveryAction[] {
  return recoveryTransitions.filter((transition) => transition.from.includes(status)).map((transition) => transition.action);
}

export function assertRecoveryTransition(job: GenerationJob, action: RecoveryAction): RecoveryTransition {
  const transition = recoveryTransitions.find((candidate) => candidate.action === action && candidate.from.includes(job.status));
  if (!transition) throw new RecoveryError("recovery-invalid-transition", { action, status: job.status });
  return transition;
}

export class RecoveryError extends Error {
  constructor(readonly code: string, readonly details?: Record<string, unknown>) {
    super(code);
    this.name = "RecoveryError";
  }
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
  code,
  retryable: true,
  message: cause instanceof Error ? cause.message : undefined,
});

function nextAttemptNumber(job: GenerationJob): number {
  return Math.max(0, ...job.attempts.map((attempt) => attempt.attemptNumber)) + 1;
}

function copyRecordedJob(job: GenerationJob): GenerationJob {
  return {
    ...job,
    attempts: job.attempts.map((attempt) => ({ ...attempt })),
    checkpoints: { ...job.checkpoints },
    output: job.output ? { ...job.output } : undefined,
    error: job.error ? { ...job.error } : undefined,
    placement: job.placement ? { ...job.placement, error: job.placement.error ? { ...job.placement.error } : undefined } : undefined,
    context: {
      ...job.context,
      references: job.context.references.map((reference) => ({
        ...reference,
        origins: [...reference.origins],
        remoteInput: { ...reference.remoteInput },
      })),
      audio: job.context.audio ? { ...job.context.audio, remoteInput: { ...job.context.audio.remoteInput } } : undefined,
    },
  };
}

export class GenerationRecoveryController {
  constructor(private readonly ports: RecoveryPorts) {}

  async regenerate(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "regenerate");
    const recorded = copyRecordedJob(job);
    try {
      recorded.context = await this.ports.resolveContext({ job: recorded });
    } catch (cause) {
      return this.ports.save({
        ...recorded,
        status: "failed",
        error: stableError("recovery-context-resolution-failed", cause),
        updatedAt: this.ports.now(),
      });
    }

    return this.ports.save({
      ...recorded,
      status: "preparing",
      error: undefined,
      updatedAt: this.ports.now(),
    });
  }

  variation(job: GenerationJob): RecoveryDraft {
    assertRecoveryTransition(job, "variation");
    const recorded = copyRecordedJob(job);
    return {
      ...recorded,
      status: "draft",
      sourceJobId: job.id,
      id: `${job.id}:variation`,
      createdAt: this.ports.now(),
      updatedAt: this.ports.now(),
    };
  }

  async retryProvider(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "retry-provider");
    const attemptNumber = nextAttemptNumber(job);
    const startedAt = this.ports.now();
    try {
      const result = await this.ports.submit({ job, attemptNumber });
      return this.ports.save({
        ...job,
        status: "queued",
        error: undefined,
        updatedAt: this.ports.now(),
        attempts: [
          ...job.attempts,
          {
            attemptNumber,
            providerJobId: result.providerJobId,
            startedAt,
          },
        ],
      });
    } catch (cause) {
      const endedAt = this.ports.now();
      const error = stableError("recovery-provider-submit-failed", cause);
      return this.ports.save({
        ...job,
        status: "failed",
        updatedAt: endedAt,
        error,
        attempts: [
          ...job.attempts,
          {
            attemptNumber,
            startedAt,
            endedAt,
            terminalError: error,
          },
        ],
      });
    }
  }

  async retryFinalization(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "retry-finalization");
    return this.ports.save({
      ...job,
      status: "running",
      error: undefined,
      updatedAt: this.ports.now(),
      checkpoints: {
        ...job.checkpoints,
        "placeholder-finalized": { status: "pending" },
      },
    });
  }

  async retryPlacement(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "retry-placement");
    return this.ports.save({
      ...job,
      status: "running",
      error: undefined,
      updatedAt: this.ports.now(),
      checkpoints: {
        ...job.checkpoints,
        "placement-applied": { status: "pending" },
      },
      placement: job.placement
        ? {
            ...job.placement,
            status: "pending",
            error: undefined,
          }
        : undefined,
    });
  }

  async cancel(job: GenerationJob): Promise<GenerationJob> {
    assertRecoveryTransition(job, "cancel");
    this.ports.stopPolling?.(job.id);

    const providerJobId = job.attempts.at(-1)?.providerJobId;
    const canceling = await this.ports.save({
      ...job,
      status: "canceling",
      updatedAt: this.ports.now(),
    });

    try {
      if (providerJobId) await this.ports.cancelProvider?.({ provider: job.provider, providerJobId });
    } catch {
      // Provider cancellation is best effort; the local cancel is authoritative.
    }

    await this.ports.cleanupUploads?.(canceling);
    return this.ports.save({
      ...canceling,
      status: "canceled",
      updatedAt: this.ports.now(),
    });
  }
}
