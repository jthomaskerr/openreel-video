import type { GenerationRouteIdentity } from "@openreel/music-video-domain/generation";

export const GENERATION_OBSERVABILITY_STAGES = [
  "model-refresh",
  "route-selection",
  "validation",
  "reference-resolution",
  "reference-recovery",
  "audio-extraction",
  "audio-cache",
  "upload",
  "provider-submit",
  "provider-poll",
  "provider-cancel",
  "provider-retry",
  "output-download",
  "output-validation",
  "finalize-output",
  "finalize-media-version",
  "finalize-shot-link",
  "placement",
  "persistence",
  "idempotency-replay",
  "reload-resumption",
] as const;

export type GenerationObservabilityStage = (typeof GENERATION_OBSERVABILITY_STAGES)[number];
export type GenerationObservabilityStatus = "started" | "succeeded" | "failed" | "blocked" | "canceled" | "retried";
export type GenerationRetryKind = "provider" | "finalization" | "placement";
export type GenerationFailureKind = "reference-preparation" | "audio-preparation" | "local-save" | "finalization";
export type GenerationDuplicateKind = "provider-submit" | "output" | "media-version" | "shot-attempt" | "placement";

export interface GenerationObservabilityMetricSignals {
  readonly providerOutcome?: "success" | "failure";
  readonly retry?: { readonly kind: GenerationRetryKind; readonly success: boolean };
  readonly cancellation?: { readonly success: boolean; readonly latencyMs: number };
  readonly reloadResumption?: { readonly success: boolean };
  readonly failure?: GenerationFailureKind;
  readonly duplicate?: { readonly kind: GenerationDuplicateKind; readonly count: number };
}

export interface GenerationStructuredEventInput {
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly logicalJobId: string;
  readonly providerJobId?: string;
  readonly attempt: number;
  readonly provider: string;
  readonly model: string;
  readonly routing: GenerationRouteIdentity;
  readonly stage: GenerationObservabilityStage;
  readonly status: GenerationObservabilityStatus;
  readonly durationMs: number;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly action?: string;
  readonly checkpoint?: string;
  readonly placementPolicy?: string;
  readonly placementStatus?: string;
  readonly duplicateClaimResult?: string;
  readonly references?: readonly Record<string, unknown>[];
  readonly audio?: Readonly<Record<string, unknown>>;
  readonly outputs?: readonly Record<string, unknown>[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly metrics?: GenerationObservabilityMetricSignals;
}

export type GenerationStructuredEvent = Omit<GenerationStructuredEventInput, "metrics">;

interface LatencyMetric {
  count: number;
  total: number;
  min: number;
  max: number;
}

interface OutcomeMetric {
  successes: number;
  failures: number;
  successRate: number;
}

export interface GenerationObservabilityMetrics {
  readonly stageLatencyMs: Readonly<Record<string, LatencyMetric>>;
  readonly providerModelSchema: Readonly<Record<string, OutcomeMetric>>;
  readonly retry: Readonly<Record<GenerationRetryKind, OutcomeMetric>>;
  readonly cancellation: OutcomeMetric & { readonly latencyMs: LatencyMetric };
  readonly reloadResumption: OutcomeMetric;
  readonly failures: {
    readonly referencePreparation: number;
    readonly audioPreparation: number;
    readonly localSave: number;
    readonly finalization: number;
  };
  readonly duplicates: {
    readonly providerSubmit: number;
    readonly output: number;
    readonly mediaVersion: number;
    readonly shotAttempt: number;
    readonly placement: number;
  };
}

const SENSITIVE_KEY = /(?:authorization|api[-_]?key|credential|password|secret|signed[-_]?url|token|raw[-_]?prompt|prompt)/i;
const FORBIDDEN_VALUE = /^(?:blob:|local:|file:|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::|\/|$))|(?:[?&](?:x-amz-signature|signature|sig|token)=)/i;

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return undefined;
  if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const sanitized = Object.entries(value).flatMap(([entryKey, entryValue]) => {
      const clean = sanitizeValue(entryValue, entryKey);
      return clean === undefined ? [] : [[entryKey, clean] as const];
    });
    return Object.fromEntries(sanitized);
  }
  return value;
}

function latency(count = 0, total = 0, min = 0, max = 0): LatencyMetric {
  return { count, total, min, max };
}

function addLatency(current: LatencyMetric | undefined, value: number): LatencyMetric {
  if (!current || current.count === 0) return latency(1, value, value, value);
  return latency(current.count + 1, current.total + value, Math.min(current.min, value), Math.max(current.max, value));
}

function outcome(successes = 0, failures = 0): OutcomeMetric {
  const total = successes + failures;
  return { successes, failures, successRate: total === 0 ? 0 : successes / total };
}

function addOutcome(current: OutcomeMetric | undefined, success: boolean): OutcomeMetric {
  return outcome((current?.successes ?? 0) + (success ? 1 : 0), (current?.failures ?? 0) + (success ? 0 : 1));
}

function providerMetricKey(input: GenerationStructuredEventInput): string {
  return [input.provider, input.model, input.routing.providerSchemaId, input.routing.providerSchemaVersion].join("|");
}

export class GenerationObservability {
  private readonly recordedEvents: GenerationStructuredEvent[] = [];
  private readonly stageLatency: Record<string, LatencyMetric> = {};
  private readonly providerOutcomes: Record<string, OutcomeMetric> = {};
  private readonly retryOutcomes: Record<GenerationRetryKind, OutcomeMetric> = {
    provider: outcome(),
    finalization: outcome(),
    placement: outcome(),
  };
  private cancellationOutcome = outcome();
  private cancellationLatency = latency();
  private reloadOutcome = outcome();
  private readonly failureCounts = {
    referencePreparation: 0,
    audioPreparation: 0,
    localSave: 0,
    finalization: 0,
  };
  private readonly duplicateCounts = {
    providerSubmit: 0,
    output: 0,
    mediaVersion: 0,
    shotAttempt: 0,
    placement: 0,
  };

  record(input: GenerationStructuredEventInput): GenerationStructuredEvent {
    const { metrics, ...eventInput } = input;
    const sanitized = sanitizeValue(eventInput) as GenerationStructuredEvent;
    this.recordedEvents.push(sanitized);
    this.stageLatency[input.stage] = addLatency(this.stageLatency[input.stage], input.durationMs);

    if (metrics?.providerOutcome) {
      const key = providerMetricKey(input);
      this.providerOutcomes[key] = addOutcome(this.providerOutcomes[key], metrics.providerOutcome === "success");
    }
    if (metrics?.retry) {
      this.retryOutcomes[metrics.retry.kind] = addOutcome(this.retryOutcomes[metrics.retry.kind], metrics.retry.success);
    }
    if (metrics?.cancellation) {
      this.cancellationOutcome = addOutcome(this.cancellationOutcome, metrics.cancellation.success);
      this.cancellationLatency = addLatency(this.cancellationLatency, metrics.cancellation.latencyMs);
    }
    if (metrics?.reloadResumption) {
      this.reloadOutcome = addOutcome(this.reloadOutcome, metrics.reloadResumption.success);
    }
    if (metrics?.failure) {
      const key = ({
        "reference-preparation": "referencePreparation",
        "audio-preparation": "audioPreparation",
        "local-save": "localSave",
        finalization: "finalization",
      } as const)[metrics.failure];
      this.failureCounts[key] += 1;
    }
    if (metrics?.duplicate) {
      const key = ({
        "provider-submit": "providerSubmit",
        output: "output",
        "media-version": "mediaVersion",
        "shot-attempt": "shotAttempt",
        placement: "placement",
      } as const)[metrics.duplicate.kind];
      this.duplicateCounts[key] += metrics.duplicate.count;
    }
    return sanitized;
  }

  events(): readonly GenerationStructuredEvent[] {
    return structuredClone(this.recordedEvents);
  }

  metrics(): GenerationObservabilityMetrics {
    return {
      stageLatencyMs: structuredClone(this.stageLatency),
      providerModelSchema: structuredClone(this.providerOutcomes),
      retry: structuredClone(this.retryOutcomes),
      cancellation: { ...structuredClone(this.cancellationOutcome), latencyMs: structuredClone(this.cancellationLatency) },
      reloadResumption: structuredClone(this.reloadOutcome),
      failures: structuredClone(this.failureCounts),
      duplicates: structuredClone(this.duplicateCounts),
    };
  }
}
