import type { GenerationProviderPort, GenerationProviderStatus } from "../services/generation/index.js";

export interface WaveSpeedFakeFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

type FailureSchedule = Readonly<Record<number, WaveSpeedFakeFailure>>;

export interface WaveSpeedFakeProviderOptions {
  readonly statusSequences?: readonly (readonly Omit<GenerationProviderStatus, "providerJobId">[])[];
  readonly outputBytes?: Uint8Array;
  readonly outputMimeType?: string;
  readonly failures?: {
    readonly submit?: FailureSchedule;
    readonly status?: FailureSchedule;
    readonly cancel?: FailureSchedule;
    readonly download?: FailureSchedule;
  };
}

export interface WaveSpeedFakeProviderSnapshot {
  readonly submitCalls: number;
  readonly providerReservations: number;
  readonly duplicateSubmitCalls: number;
  readonly statusReads: number;
  readonly cancelCalls: number;
  readonly downloadCalls: number;
  readonly submissionsByIdempotencyKey: Readonly<Record<string, number>>;
}

export class WaveSpeedFakeProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(failure: WaveSpeedFakeFailure) {
    super(failure.message);
    this.name = "WaveSpeedFakeProviderError";
    this.code = failure.code;
    this.retryable = failure.retryable;
  }
}

const DEFAULT_SEQUENCE: readonly Omit<GenerationProviderStatus, "providerJobId">[] = [
  { status: "running" },
  { status: "completed", outputMediaIds: ["fake-output-0001"] },
];

function fixedId(sequence: number): string {
  return `fake-wavespeed-job-${String(sequence).padStart(4, "0")}`;
}

export class WaveSpeedFakeProvider implements GenerationProviderPort {
  private readonly options: WaveSpeedFakeProviderOptions;
  private readonly providerIdsByIdempotencyKey = new Map<string, string>();
  private readonly sequencesByProviderId = new Map<string, readonly Omit<GenerationProviderStatus, "providerJobId">[]>();
  private readonly sequenceIndexes = new Map<string, number>();
  private readonly canceledProviderIds = new Set<string>();
  private readonly submissionsByIdempotencyKey = new Map<string, number>();
  private submitCalls = 0;
  private providerReservations = 0;
  private duplicateSubmitCalls = 0;
  private statusReads = 0;
  private cancelCalls = 0;
  private downloadCalls = 0;

  constructor(options: WaveSpeedFakeProviderOptions = {}) {
    this.options = options;
  }

  async submit(input: Parameters<GenerationProviderPort["submit"]>[0]): Promise<{ providerJobId: string }> {
    this.submitCalls += 1;
    this.throwScheduled("submit", this.submitCalls);
    this.submissionsByIdempotencyKey.set(
      input.idempotencyKey,
      (this.submissionsByIdempotencyKey.get(input.idempotencyKey) ?? 0) + 1,
    );

    const existingProviderJobId = this.providerIdsByIdempotencyKey.get(input.idempotencyKey);
    if (existingProviderJobId) {
      this.duplicateSubmitCalls += 1;
      return { providerJobId: existingProviderJobId };
    }

    this.providerReservations += 1;
    const providerJobId = fixedId(this.providerReservations);
    const sequence = this.options.statusSequences?.[this.providerReservations - 1] ?? DEFAULT_SEQUENCE;
    this.providerIdsByIdempotencyKey.set(input.idempotencyKey, providerJobId);
    this.sequencesByProviderId.set(providerJobId, sequence);
    this.sequenceIndexes.set(providerJobId, 0);
    return { providerJobId };
  }

  async reconcileSubmission(input: Parameters<NonNullable<GenerationProviderPort["reconcileSubmission"]>>[0]) {
    const providerJobId = this.providerIdsByIdempotencyKey.get(input.idempotencyKey);
    return providerJobId
      ? { status: "submitted" as const, providerJobId }
      : { status: "unknown" as const };
  }

  async status(input: Parameters<GenerationProviderPort["status"]>[0]): Promise<GenerationProviderStatus> {
    this.statusReads += 1;
    this.throwScheduled("status", this.statusReads);
    if (this.canceledProviderIds.has(input.providerJobId)) {
      return { providerJobId: input.providerJobId, status: "canceled" };
    }

    const sequence = this.sequencesByProviderId.get(input.providerJobId);
    if (!sequence) {
      return { providerJobId: input.providerJobId, status: "unknown" };
    }
    const index = this.sequenceIndexes.get(input.providerJobId) ?? 0;
    const step = sequence[Math.min(index, sequence.length - 1)] ?? { status: "unknown" as const };
    this.sequenceIndexes.set(input.providerJobId, Math.min(index + 1, sequence.length));
    return { providerJobId: input.providerJobId, ...step };
  }

  async cancel(input: Parameters<NonNullable<GenerationProviderPort["cancel"]>>[0]): Promise<void> {
    this.cancelCalls += 1;
    this.throwScheduled("cancel", this.cancelCalls);
    this.canceledProviderIds.add(input.providerJobId);
  }

  async downloadOutput(input: { readonly providerJobId: string }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.downloadCalls += 1;
    this.throwScheduled("download", this.downloadCalls);
    if (!this.sequencesByProviderId.has(input.providerJobId)) {
      throw new WaveSpeedFakeProviderError({
        code: "fake-provider-job-not-found",
        message: `Unknown fake provider job ${input.providerJobId}`,
        retryable: false,
      });
    }
    return {
      bytes: new Uint8Array(this.options.outputBytes ?? [0x89, 0x50, 0x4e, 0x47]),
      mimeType: this.options.outputMimeType ?? "image/png",
    };
  }

  snapshot(): WaveSpeedFakeProviderSnapshot {
    return {
      submitCalls: this.submitCalls,
      providerReservations: this.providerReservations,
      duplicateSubmitCalls: this.duplicateSubmitCalls,
      statusReads: this.statusReads,
      cancelCalls: this.cancelCalls,
      downloadCalls: this.downloadCalls,
      submissionsByIdempotencyKey: Object.fromEntries(
        [...this.submissionsByIdempotencyKey.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
    };
  }

  private throwScheduled(stage: keyof NonNullable<WaveSpeedFakeProviderOptions["failures"]>, call: number): void {
    const failure = this.options.failures?.[stage]?.[call];
    if (failure) throw new WaveSpeedFakeProviderError(failure);
  }
}
