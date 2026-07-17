import type { GenerationError, GenerationJob } from "@openreel/music-video-domain/generation";
import {
  allowedRecoveryActionsForJob,
  isPlacementReconciliationCandidate,
  isPlacementRetryCandidate,
  type RecoveryAction,
} from "../../../../../features/generation/recovery/state-machine";

export const CANONICAL_GENERATION_ERROR_CATEGORIES = [
  "validation",
  "configuration",
  "routing/schema",
  "reference",
  "audio",
  "provider",
  "transport",
  "cancellation",
  "download",
  "finalization",
  "placement",
  "persistence",
] as const;

export type CanonicalGenerationErrorCategory =
  (typeof CANONICAL_GENERATION_ERROR_CATEGORIES)[number];

export type GenerationRecoveryPresentationAction =
  | "edit"
  | "revalidate"
  | "retry-item"
  | RecoveryAction;

export interface GenerationRecoveryPresentation {
  category: CanonicalGenerationErrorCategory | "unknown";
  action?: GenerationRecoveryPresentationAction;
  actionLabel?: string;
  explanation: string;
}

const DEFAULT_RECOVERY_BY_CATEGORY = {
  validation: {
    action: "edit",
    actionLabel: "Edit request",
    explanation: "Edit the named field and revalidate before submitting.",
  },
  configuration: {
    action: "revalidate",
    actionLabel: "Revalidate configuration",
    explanation: "Refresh the authoritative provider configuration and revalidate.",
  },
  "routing/schema": {
    action: "revalidate",
    actionLabel: "Refresh routing and revalidate",
    explanation: "Refresh the authoritative route manifest and revalidate this draft.",
  },
  reference: {
    action: "retry-item",
    actionLabel: "Retry failed item",
    explanation: "Retry only the failed reference item; do not submit a provider job.",
  },
  audio: {
    action: "retry-item",
    actionLabel: "Retry failed item",
    explanation: "Retry only the failed audio preparation item.",
  },
  provider: {
    action: "retry-provider",
    actionLabel: "Retry provider",
    explanation: "Start a new provider attempt for this logical job.",
  },
  transport: {
    action: "revalidate",
    actionLabel: "Revalidate submission",
    explanation: "Reconcile the existing submission identity before any paid retry.",
  },
  cancellation: {
    action: "cancel",
    actionLabel: "Cancel generation",
    explanation: "Persist local cancellation and request provider cancellation when supported.",
  },
  download: {
    action: "retry-finalization",
    actionLabel: "Retry finalization",
    explanation: "Resume finalization from the recorded output checkpoint.",
  },
  finalization: {
    action: "retry-finalization",
    actionLabel: "Retry finalization",
    explanation: "Resume finalization without submitting the provider job again.",
  },
  placement: {
    action: "retry-placement",
    actionLabel: "Retry placement",
    explanation: "Retry only the replay-safe failed placement checkpoint.",
  },
  persistence: {
    action: "retry-finalization",
    actionLabel: "Retry finalization",
    explanation: "Resume the durable finalization checkpoint without provider resubmission.",
  },
} satisfies Record<
  CanonicalGenerationErrorCategory,
  {
    action: GenerationRecoveryPresentationAction;
    actionLabel: string;
    explanation: string;
  }
>;

const includesAny = (value: string, terms: readonly string[]) =>
  terms.some((term) => value.includes(term));

const INTEGRITY_ERROR_TERMS = [
  "local-url",
  "claim-corrupt",
  "lock-corrupt",
  "lock-type-unsupported",
  "legacy-lock-migration-required",
  "fencing",
  "identity-conflict",
  "provider-id-conflict",
  "provider-job-id-reused",
] as const;

const isIntegrityError = (code: string) =>
  includesAny(code.toLowerCase(), INTEGRITY_ERROR_TERMS);

const RECOVERY_ACTIONS: readonly RecoveryAction[] = [
  "regenerate",
  "variation",
  "retry-provider",
  "retry-finalization",
  "retry-placement",
  "reconcile-placement",
  "cancel",
];

const isRecoveryAction = (
  action: GenerationRecoveryPresentationAction,
): action is RecoveryAction => RECOVERY_ACTIONS.includes(action as RecoveryAction);

export function classifyGenerationError(
  error: GenerationError,
): CanonicalGenerationErrorCategory | "unknown" {
  const code = error.code.toLowerCase();

  if (isIntegrityError(code)) return "persistence";
  if (
    includesAny(code, [
      "rollback",
      "not-configured",
      "configuration",
      "credential",
      "invalid-ttl",
    ])
  ) {
    return "configuration";
  }
  if (includesAny(code, ["routing", "route-", "schema"])) return "routing/schema";
  if (
    includesAny(code, [
      "validation",
      "invalid-draft",
      "invalid-input",
      "sanitize-failed",
      "timing-invalid",
      "timing-incomplete",
      "token-",
      "entry-context-invalid",
    ])
  ) {
    return "validation";
  }
  if (code.includes("reference")) return "reference";
  if (includesAny(code, ["audio", "projection"])) return "audio";
  if (includesAny(code, ["cancellation", "cancel-"])) return "cancellation";
  if (code.includes("placement")) return "placement";
  if (code.includes("finalization") || code.includes("finalize")) return "finalization";
  if (includesAny(code, ["download", "output-downloaded", "output-verified", "output-inspected"])) {
    return "download";
  }
  if (
    includesAny(code, [
      "transport",
      "network",
      "timeout",
      "submit-failed",
      "submission-ambiguous",
      "submission-reconciliation",
      "submission-identity",
      "provider-status",
      "provider-response-invalid",
    ])
  ) {
    return "transport";
  }
  if (
    includesAny(code, [
      "persistence",
      "repository",
      "cache-failed",
      "local-url",
      "claim-corrupt",
      "fencing",
      "identity-conflict",
      "provider-id-conflict",
      "provider-job-id-reused",
      "save-failed",
    ])
  ) {
    return "persistence";
  }
  if (code.includes("provider")) return "provider";
  if (error.field || includesAny(code, ["invalid", "mismatch", "required"])) {
    return "validation";
  }
  return "unknown";
}

const hasPriorProviderIdentity = (job: GenerationJob) => {
  if (
    !job.providerJobId ||
    job.providerInstanceId !== job.routing.providerInstanceId ||
    job.modelId !== job.routing.providerModelId ||
    job.modelSchemaVersion !== job.routing.providerSchemaVersion
  ) {
    return false;
  }
  return job.attempts.some(
    (attempt) =>
      attempt.attemptNumber === job.attempt &&
      attempt.providerJobId === job.providerJobId &&
      attempt.routing.providerInstanceId === job.routing.providerInstanceId &&
      attempt.routing.providerModelId === job.routing.providerModelId &&
      attempt.routing.requestedMode === job.routing.requestedMode &&
      attempt.routing.providerSchemaId === job.routing.providerSchemaId &&
      attempt.routing.providerEndpointId === job.routing.providerEndpointId &&
      attempt.routing.providerSchemaVersion === job.routing.providerSchemaVersion,
  );
};

const hasDurableFinalizationIdentity = (job: GenerationJob) =>
  hasPriorProviderIdentity(job) &&
  Boolean(job.output?.mediaId && job.output.versionId);

const hasMatchingProviderTerminalError = (
  job: GenerationJob,
  error: GenerationError,
) => {
  const currentAttempt = job.attempts.find(
    (attempt) => attempt.attemptNumber === job.attempt,
  );
  return (
    currentAttempt?.terminalError?.code === error.code &&
    currentAttempt.terminalError.message === error.message &&
    currentAttempt.terminalError.retryable === error.retryable
  );
};

const isAmbiguousPlacement = (error: GenerationError) =>
  includesAny(error.code, [
    "placement-outcome-unknown",
    "placement-reconciliation",
    "placement-retry-unsafe",
  ]);

const terminal = (
  category: GenerationRecoveryPresentation["category"],
  explanation: string,
): GenerationRecoveryPresentation => ({ category, explanation });

export function resolveGenerationRecoveryPresentation(
  job: GenerationJob,
): GenerationRecoveryPresentation | undefined {
  const error = job.error;
  if (!error) return undefined;
  const category = classifyGenerationError(error);
  const allowedActions = new Set(allowedRecoveryActionsForJob(job));

  if (category === "unknown") {
    return terminal(
      category,
      "This error is not recognized, so no retry is safe. Revalidate or contact support with the stable error code.",
    );
  }

  if (error.code === "generation-v2-rollback-active") {
    return terminal(
      category,
      "New V2 submissions are disabled by release policy. Existing submitted V2 jobs may continue recovery.",
    );
  }

  if (job.status === "succeeded" || job.status === "canceled") {
    return terminal(
      category,
      job.status === "canceled" && category === "cancellation"
        ? "Generation is locally canceled. Provider cancellation may be uncertain, but no further mutation is safe."
        : `The job is already ${job.status}, so no further recovery mutation is safe.`,
    );
  }

  if (category === "routing/schema" && error.code.includes("route-unsupported")) {
    return {
      category,
      action: "edit",
      actionLabel: "Edit model or mode",
      explanation: "Choose a model and mode supported by the authoritative route manifest.",
    };
  }

  if (category === "reference") {
    if (includesAny(error.code, ["scope", "not-found", "mismatch"])) {
      return {
        category,
        action: "revalidate",
        actionLabel: "Reload reference identity",
        explanation: "Reload the exact reference identity and scope before any item retry.",
      };
    }
    if (error.code.includes("required")) {
      return {
        category,
        action: "edit",
        actionLabel: "Edit references",
        explanation: "Review the exact reference identity and required active-reference minimum.",
      };
    }
    if (!error.retryable) {
      return terminal(category, "This reference item is not retryable; edit or reload its exact identity.");
    }
  }

  if (category === "audio") {
    if (error.code.includes("capability-required")) {
      return {
        category,
        action: "revalidate",
        actionLabel: "Revalidate audio capability",
        explanation: "Refresh the selected model capability before any audio work.",
      };
    }
    if (includesAny(error.code, ["requires-", "projection", "unavailable", "coverage"])) {
      return {
        category,
        action: "edit",
        actionLabel: "Edit audio context",
        explanation: "Edit the model, projection, or range before retrying audio preparation.",
      };
    }
    if (!error.retryable) {
      return terminal(category, "Audio preparation is not safely retryable for this source and range.");
    }
  }

  if (category === "provider") {
    if (!allowedActions.has("retry-provider")) {
      return terminal(
        category,
        `The persisted ${job.status} state does not permit a safe provider retry.`,
      );
    }
    if (!hasPriorProviderIdentity(job)) {
      return terminal(
        category,
        "The durable prior provider identity is missing, so provider retry is unsafe.",
      );
    }
    if (!hasMatchingProviderTerminalError(job, error)) {
      return terminal(
        category,
        "The current attempt does not record this provider terminal error, so provider retry is unsafe.",
      );
    }
    if (!error.retryable) {
      return terminal(category, "The provider marked this failure terminal, so no paid retry is safe.");
    }
  }

  if (category === "cancellation") {
    if (includesAny(error.code, ["invalid-cancel-state", "cancel-state-invalid"])) {
      return terminal(
        category,
        "The persisted cancellation state is invalid, so another cancellation request is unsafe.",
      );
    }
    if (!allowedActions.has("cancel")) {
      return terminal(category, `A ${job.status} job cannot be canceled safely.`);
    }
  }

  if (category === "placement") {
    if (isAmbiguousPlacement(error)) {
      if (
        !allowedActions.has("reconcile-placement") ||
        !isPlacementReconciliationCandidate(job)
      ) {
        return terminal(
          category,
          "Placement outcome is ambiguous, but durable output identity and a failed placement checkpoint are required before reconciliation.",
        );
      }
      return {
        category,
        action: "reconcile-placement",
        actionLabel: "Check placement",
        explanation: "Reconcile whether placement was applied before any direct retry.",
      };
    }
    if (
      !allowedActions.has("retry-placement") ||
      !isPlacementRetryCandidate(job)
    ) {
      return terminal(
        category,
        "Direct placement retry is unsafe until a failed, replay-safe checkpoint is proven.",
      );
    }
  }

  if (
    category === "persistence" && isIntegrityError(error.code)
  ) {
    return terminal(
      category,
      "Durable identity integrity failed, so automated recovery is unsafe. Contact an operator with the stable error code.",
    );
  }

  if (
    (category === "download" || category === "finalization" || category === "persistence") &&
    !error.retryable
  ) {
    return terminal(
      category,
      "This durable finalization failure is marked terminal, so automated retry is unsafe.",
    );
  }

  if (
    (category === "download" || category === "finalization" || category === "persistence") &&
    !allowedActions.has("retry-finalization")
  ) {
    return terminal(
      category,
      `The canonical recovery state does not permit finalization retry from ${job.status}.`,
    );
  }

  if (
    (category === "download" || category === "finalization" || category === "persistence") &&
    !hasDurableFinalizationIdentity(job)
  ) {
    if (
      category === "persistence" &&
      (job.status === "queued" || job.status === "submitting")
    ) {
      return {
        category,
        action: "revalidate",
        actionLabel: "Revalidate persistence",
        explanation: "Revalidate durable submission state before any provider work.",
      };
    }
    return terminal(
      category,
      "Durable provider and output identity is incomplete, so finalization retry is unsafe.",
    );
  }

  const presentation = DEFAULT_RECOVERY_BY_CATEGORY[category];
  if (isRecoveryAction(presentation.action) && !allowedActions.has(presentation.action)) {
    return terminal(
      category,
      `The canonical recovery state does not permit ${presentation.action} from ${job.status}.`,
    );
  }
  return { category, ...presentation };
}
