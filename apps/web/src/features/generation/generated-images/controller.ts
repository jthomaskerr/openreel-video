import type {
  GeneratedImageDefinition,
  GeneratedImageDraft,
  PromptReferenceDiagnostic,
  ResolvedGenerationReference,
} from "@openreel/core";
import type { GenerationModelCapability } from "../../../services/wavespeed/model-capabilities";
import {
  resolveGenerationReferences,
  type ResolveReferencesInput,
} from "../references/resolve";
import { reconcileReferenceRoles } from "../references/roles";

export interface GeneratedImageControllerProject {
  readonly id: string;
  readonly generatedImageDefinitions: readonly GeneratedImageDefinition[];
}

export interface GeneratedImageControllerInputField {
  readonly key: string;
  readonly label: string;
  readonly type: "text" | "number" | "boolean" | "select";
  readonly required?: boolean;
  readonly description?: string;
  readonly options?: readonly { readonly label: string; readonly value: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface GeneratedImageControllerModel {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly capability: GenerationModelCapability;
  readonly schemaVersion: string;
  readonly inputFields: readonly GeneratedImageControllerInputField[];
  readonly basePrice?: number;
  readonly priceFormula?: string;
  readonly limits?: readonly string[];
}

export type GeneratedImageControllerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface GeneratedImageControllerJob {
  readonly id: string;
  readonly definitionId: string;
  readonly providerJobId: string;
  readonly status: GeneratedImageControllerJobStatus;
  readonly message?: string;
  readonly error?: string;
  readonly progress?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface GeneratedImageControllerSubmission {
  readonly definition: GeneratedImageDefinition;
  readonly model: GeneratedImageControllerModel;
  readonly references: readonly (ResolvedGenerationReference & { readonly status: "active" })[];
}

export interface GeneratedImageControllerPorts {
  readonly getProject: () => GeneratedImageControllerProject;
  readonly updateDraft: (
    definitionId: string,
    patch: Partial<GeneratedImageDraft>,
  ) => Promise<{ readonly success: boolean; readonly error?: unknown }>;
  readonly getJobs: (definitionId: string) => readonly GeneratedImageControllerJob[];
  readonly submit: (input: GeneratedImageControllerSubmission) => Promise<GeneratedImageControllerJob>;
  readonly cancel: (
    job: GeneratedImageControllerJob,
  ) => Promise<GeneratedImageControllerJob | void>;
  readonly retry: (
    job: GeneratedImageControllerJob,
    input: GeneratedImageControllerSubmission,
  ) => Promise<GeneratedImageControllerJob>;
}

export type GeneratedImageReferenceContext = Omit<
  ResolveReferencesInput,
  "prompt" | "roleByReferenceKey"
>;

export interface GeneratedImageValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface GeneratedImageControllerState {
  readonly definition?: GeneratedImageDefinition;
  readonly model?: GeneratedImageControllerModel;
  readonly models: readonly GeneratedImageControllerModel[];
  readonly references: readonly ResolvedGenerationReference[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
  readonly validation: {
    readonly valid: boolean;
    readonly issues: readonly GeneratedImageValidationIssue[];
  };
  readonly cost?: {
    readonly amount: number;
    readonly currency: "USD";
    readonly formula?: string;
  };
  readonly limits: readonly string[];
  readonly activeJob?: GeneratedImageControllerJob;
  readonly latestJob?: GeneratedImageControllerJob;
  readonly versionHistory: readonly {
    readonly attemptId: string;
    readonly index: number;
  }[];
}

export type GeneratedImageControllerResult =
  | { readonly ok: true; readonly job?: GeneratedImageControllerJob }
  | {
      readonly ok: false;
      readonly code:
        | "DEFINITION_NOT_FOUND"
        | "MODEL_NOT_FOUND"
        | "PERSIST_FAILED"
        | "VALIDATION_FAILED"
        | "DUPLICATE_SUBMISSION"
        | "NO_ACTIVE_JOB"
        | "NO_RETRYABLE_JOB";
      readonly message: string;
      readonly issues?: readonly GeneratedImageValidationIssue[];
    };

export interface GeneratedImageController {
  read(definitionId: string): GeneratedImageControllerState;
  patchDraft(
    definitionId: string,
    patch: Partial<GeneratedImageDraft>,
  ): Promise<GeneratedImageControllerResult>;
  changeModel(
    definitionId: string,
    modelId: string,
  ): Promise<
    | { readonly ok: true; readonly resetFields: readonly string[] }
    | Exclude<GeneratedImageControllerResult, { readonly ok: true }>
  >;
  submit(definitionId: string): Promise<GeneratedImageControllerResult>;
  cancel(definitionId: string): Promise<GeneratedImageControllerResult>;
  retry(definitionId: string): Promise<GeneratedImageControllerResult>;
}

export interface CreateGeneratedImageControllerInput {
  readonly models: readonly GeneratedImageControllerModel[];
  readonly referenceContext?: GeneratedImageReferenceContext;
  readonly ports: GeneratedImageControllerPorts;
}

const activeStatuses = new Set<GeneratedImageControllerJobStatus>([
  "queued",
  "running",
]);

function sortJobs(jobs: readonly GeneratedImageControllerJob[]) {
  return [...jobs].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
  );
}

function cloneDefinition(definition: GeneratedImageDefinition): GeneratedImageDefinition {
  return {
    ...definition,
    draft: {
      ...definition.draft,
      roleByReferenceKey: { ...definition.draft.roleByReferenceKey },
      inputs: { ...definition.draft.inputs },
    },
    attemptIds: [...definition.attemptIds],
  };
}

function isMissingRequiredValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function referenceLimitLabel(model: GeneratedImageControllerModel): string | undefined {
  const limits = model.capability.accepts.referenceImages;
  if (!limits) return undefined;
  return `Up to ${limits.max} reference image${limits.max === 1 ? "" : "s"}`;
}

function resolveReferences(
  definition: GeneratedImageDefinition,
  model: GeneratedImageControllerModel | undefined,
  context: GeneratedImageReferenceContext | undefined,
): {
  readonly references: readonly ResolvedGenerationReference[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
} {
  if (!context) return { references: [], diagnostics: [] };

  const resolved = resolveGenerationReferences({
    ...context,
    prompt: definition.draft.prompt,
    roleByReferenceKey: definition.draft.roleByReferenceKey,
  });
  if (!model) return resolved;

  const reconciled = reconcileReferenceRoles({
    rolesByKey: definition.draft.roleByReferenceKey,
    references: resolved.references,
    capability: model.capability,
  });
  return { references: reconciled.references, diagnostics: resolved.diagnostics };
}

function validate(
  definition: GeneratedImageDefinition | undefined,
  model: GeneratedImageControllerModel | undefined,
  diagnostics: readonly PromptReferenceDiagnostic[],
): readonly GeneratedImageValidationIssue[] {
  if (!definition) {
    return [{ field: "definition", message: "Generated image definition was not found." }];
  }

  const issues: GeneratedImageValidationIssue[] = [];
  if (!definition.title.trim()) {
    issues.push({ field: "title", message: "Title is required." });
  }
  if (!model) {
    issues.push({ field: "model", message: "Select a supported generation model." });
    return issues;
  }
  if (model.capability.accepts.prompt && !definition.draft.prompt.trim()) {
    issues.push({ field: "prompt", message: "Prompt is required." });
  }
  for (const field of model.inputFields) {
    if (field.required && isMissingRequiredValue(definition.draft.inputs[field.key])) {
      issues.push({ field: `inputs.${field.key}`, message: `${field.label} is required.` });
    }
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.blocking) {
      issues.push({ field: "prompt", message: diagnostic.message });
    }
  }
  return issues;
}

function selectModel(
  definition: GeneratedImageDefinition | undefined,
  models: readonly GeneratedImageControllerModel[],
): GeneratedImageControllerModel | undefined {
  if (!definition?.draft.modelId) return undefined;
  return models.find(
    (candidate) =>
      candidate.id === definition.draft.modelId &&
      (!definition.draft.provider || candidate.provider === definition.draft.provider),
  );
}

function submissionForState(
  state: GeneratedImageControllerState,
): GeneratedImageControllerSubmission | undefined {
  if (!state.definition || !state.model) return undefined;
  return {
    definition: cloneDefinition(state.definition),
    model: state.model,
    references: state.references.filter(
      (reference): reference is ResolvedGenerationReference & { readonly status: "active" } =>
        reference.status === "active",
    ),
  };
}

export function createGeneratedImageController(
  input: CreateGeneratedImageControllerInput,
): GeneratedImageController {
  const inFlightDefinitions = new Set<string>();

  const read = (definitionId: string): GeneratedImageControllerState => {
    const definition = input.ports
      .getProject()
      .generatedImageDefinitions.find((candidate) => candidate.id === definitionId);
    const model = selectModel(definition, input.models);
    const resolved = definition
      ? resolveReferences(definition, model, input.referenceContext)
      : { references: [], diagnostics: [] };
    const issues = validate(definition, model, resolved.diagnostics);
    const jobs = sortJobs(input.ports.getJobs(definitionId));
    const latestJob = jobs[0];
    const activeJob = jobs.find((job) => activeStatuses.has(job.status));
    const referenceLimit = model ? referenceLimitLabel(model) : undefined;

    return {
      ...(definition ? { definition } : {}),
      ...(model ? { model } : {}),
      models: input.models,
      references: resolved.references,
      diagnostics: resolved.diagnostics,
      validation: { valid: issues.length === 0, issues },
      ...(model?.basePrice !== undefined
        ? {
            cost: {
              amount: model.basePrice,
              currency: "USD" as const,
              ...(model.priceFormula ? { formula: model.priceFormula } : {}),
            },
          }
        : {}),
      limits: [referenceLimit, ...(model?.limits ?? [])].filter(
        (limit): limit is string => Boolean(limit),
      ),
      ...(activeJob ? { activeJob } : {}),
      ...(latestJob ? { latestJob } : {}),
      versionHistory:
        definition?.attemptIds.map((attemptId, index) => ({
          attemptId,
          index: index + 1,
        })) ?? [],
    };
  };

  const patchDraft = async (
    definitionId: string,
    patch: Partial<GeneratedImageDraft>,
  ): Promise<GeneratedImageControllerResult> => {
    if (!read(definitionId).definition) {
      return {
        ok: false,
        code: "DEFINITION_NOT_FOUND",
        message: "Generated image definition was not found.",
      };
    }
    const result = await input.ports.updateDraft(definitionId, patch);
    if (!result.success) {
      return {
        ok: false,
        code: "PERSIST_FAILED",
        message: "The generated image draft could not be saved.",
      };
    }
    return { ok: true };
  };

  const changeModel: GeneratedImageController["changeModel"] = async (
    definitionId,
    modelId,
  ) => {
    const state = read(definitionId);
    if (!state.definition) {
      return {
        ok: false,
        code: "DEFINITION_NOT_FOUND",
        message: "Generated image definition was not found.",
      };
    }
    const model = input.models.find((candidate) => candidate.id === modelId);
    if (!model) {
      return {
        ok: false,
        code: "MODEL_NOT_FOUND",
        message: "The selected generation model is unavailable.",
      };
    }

    const allowedInputKeys = new Set(model.inputFields.map((field) => field.key));
    const resetFields = Object.keys(state.definition.draft.inputs).filter(
      (key) => !allowedInputKeys.has(key),
    );
    const inputs = Object.fromEntries(
      Object.entries(state.definition.draft.inputs).filter(([key]) => allowedInputKeys.has(key)),
    );
    const resolved = resolveReferences(state.definition, model, input.referenceContext);
    const reconciled = reconcileReferenceRoles({
      rolesByKey: state.definition.draft.roleByReferenceKey,
      references: resolved.references,
      capability: model.capability,
    });
    const persisted = await patchDraft(definitionId, {
      provider: model.provider,
      modelId: model.id,
      inputs,
      roleByReferenceKey: reconciled.rolesByKey,
    });
    if (!persisted.ok) return persisted;
    return { ok: true, resetFields };
  };

  const submit = async (definitionId: string): Promise<GeneratedImageControllerResult> => {
    const state = read(definitionId);
    if (state.activeJob || inFlightDefinitions.has(definitionId)) {
      return {
        ok: false,
        code: "DUPLICATE_SUBMISSION",
        message: "Generation is already active.",
      };
    }
    if (!state.validation.valid) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Fix the highlighted fields before generating.",
        issues: state.validation.issues,
      };
    }
    const submission = submissionForState(state);
    if (!submission) {
      return {
        ok: false,
        code: state.definition ? "MODEL_NOT_FOUND" : "DEFINITION_NOT_FOUND",
        message: state.definition
          ? "The selected generation model is unavailable."
          : "Generated image definition was not found.",
      };
    }

    inFlightDefinitions.add(definitionId);
    try {
      const job = await input.ports.submit(submission);
      return { ok: true, job };
    } finally {
      inFlightDefinitions.delete(definitionId);
    }
  };

  const cancel = async (definitionId: string): Promise<GeneratedImageControllerResult> => {
    const state = read(definitionId);
    if (!state.activeJob) {
      return { ok: false, code: "NO_ACTIVE_JOB", message: "There is no active generation to cancel." };
    }
    const canceled = await input.ports.cancel(state.activeJob);
    return { ok: true, job: canceled ?? state.activeJob };
  };

  const retry = async (definitionId: string): Promise<GeneratedImageControllerResult> => {
    const state = read(definitionId);
    const job = sortJobs(input.ports.getJobs(definitionId)).find(
      (candidate) => candidate.status === "failed" || candidate.status === "canceled",
    );
    const submission = submissionForState(state);
    if (!job || !submission) {
      return {
        ok: false,
        code: "NO_RETRYABLE_JOB",
        message: "There is no failed or canceled generation to retry.",
      };
    }
    const retried = await input.ports.retry(job, submission);
    return { ok: true, job: retried };
  };

  return { read, patchDraft, changeModel, submit, cancel, retry };
}
