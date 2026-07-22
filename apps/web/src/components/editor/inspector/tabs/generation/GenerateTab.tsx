import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReferenceTarget } from "@openreel/core";
import type {
  GenerationJob,
  GenerationPlacementPolicy,
} from "@openreel/music-video-domain/generation";
import type { GenerationEntryContextResult } from "../../../../../features/generation/context/scene-generation";
import {
  generationDraftKey,
  useGenerationDraftStore,
  type GenerationDraftScope,
  type GenerationDraftState,
} from "../../../../../features/generation/drafts";
import type {
  GenerationReferenceCommand,
  GenerationReferenceRecoveryState,
} from "../../../../../features/generation/drafts/v2";
import type { RecoveryAction } from "../../../../../features/generation/recovery/state-machine";
import {
  resolveProjectGenerationReferences,
  type ProjectGenerationReferenceResolution,
  type ResolveProjectGenerationReferencesInput,
} from "../../../../../features/generation/references/project-resolution";
import {
  GenerateActionsSection,
  type GenerateAudioPresentation,
  GenerateContextSection,
  GenerateDestinationSection,
  GenerateHeaderSection,
  GenerateJobSection,
  GenerateModelSection,
  GeneratePromptSection,
  GenerateReferenceSection,
  GenerateValidationSummary,
  type GenerateValidationError,
} from "./GenerateTabSections";

export interface GenerateModel {
  id: string;
  label: string;
  provider?: string;
  modes?: Array<"image" | "video">;
  capabilities?: string[];
}

export interface GenerateReference {
  id: string;
  label: string;
  origins: string[];
  excluded?: boolean;
  target?: ReferenceTarget;
}

export interface GenerateJob {
  id: string;
  status: string;
  message?: string;
  progress?: number;
  error?: string;
}

export interface GenerateTabProps {
  projectId?: string;
  shotId?: string;
  draftId?: string;
  context?: "shot" | "clip" | "asset" | "empty" | "unsupported";
  mode?: "image" | "video";
  models?: GenerateModel[];
  compatibleModelIds?: string[];
  modelId?: string;
  onModelChange?: (id: string) => void;
  prompt?: string;
  onPromptChange?: (value: string) => void;
  characterSlugs?: string[];
  promptErrors?: Record<string, string>;
  timing?: { start: number; end: number; source: string; reason?: string };
  audioReason?: string;
  destination?: GenerationPlacementPolicy;
  placementDefault?: GenerationPlacementPolicy;
  entryContextResult?: GenerationEntryContextResult;
  audioPresentation?: GenerateAudioPresentation;
  referenceRecovery?: GenerationReferenceRecoveryState;
  referenceLabels?: Readonly<Record<string, string>>;
  referenceResolutionInput?: Omit<ResolveProjectGenerationReferencesInput, "prompt">;
  onReferenceCommand?: (
    command: GenerationReferenceCommand,
  ) => void | Promise<void>;
  job?: GenerationJob;
  jobProgress?: number;
  jobMessage?: string;
  terminalErrorExplanation?: string;
  submitting?: boolean;
  onSubmit?: (draft: GenerationDraftState & {
    referenceResolution?: ProjectGenerationReferenceResolution;
  }) => void | Promise<void>;
  onEdit?: () => void;
  onRevalidate?: () => void;
  onRetryItem?: (category: "reference" | "audio") => void;
  onRecoveryAction?: (action: RecoveryAction) => void;
  onCancel?: () => void;
}

const pickScope = (
  projectId: string | undefined,
  shotId: string | undefined,
  draftId: string | undefined,
): GenerationDraftScope => {
  if (shotId) {
    return { kind: "shot", shotId, projectId };
  }
  return {
    kind: "new-asset",
    draftId: draftId ?? projectId ?? "new-asset",
    projectId,
  };
};

const operationalErrorMessage = (action: string, error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${detail}`;
};

export const GenerateTab: React.FC<GenerateTabProps> = (props) => {
  const scope = useMemo(
    () => pickScope(props.projectId, props.shotId, props.draftId),
    [props.projectId, props.shotId, props.draftId],
  );
  const scopeKey = generationDraftKey(scope);
  const storedDraft = useGenerationDraftStore((state) => state.drafts[scopeKey]);
  const getDraft = useGenerationDraftStore((state) => state.getDraft);
  const saveDraft = useGenerationDraftStore((state) => state.saveDraft);
  const draft = storedDraft ?? getDraft(scope);
  const models = useMemo(() => {
    const all = props.models ?? [];
    if (!props.compatibleModelIds) return all;
    return all.filter((model) => props.compatibleModelIds?.includes(model.id));
  }, [props.compatibleModelIds, props.models]);
  const placementSeed =
    props.entryContextResult?.placementPolicy ??
    props.destination ??
    draft.placementPolicy;
  const placementDefault =
    props.entryContextResult?.defaultPlacementPolicy ??
    props.placementDefault ??
    props.destination ??
    draft.placementPolicy;
  const [selectedModelId, setSelectedModelId] = useState(
    props.modelId ?? draft.modelId ?? models[0]?.id ?? "",
  );
  const [prompt, setPrompt] = useState(props.prompt ?? draft.prompt);
  const [placement, setPlacement] = useState<GenerationPlacementPolicy>(placementSeed);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [announcement, setAnnouncement] = useState<{
    id: number;
    message: string;
  }>();
  const [operationalError, setOperationalError] = useState<string>();
  const modelRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const renderedScopeKeyRef = useRef(scopeKey);
  const controlledPromptRef = useRef(props.prompt);
  const scopeChangedOnRender = renderedScopeKeyRef.current !== scopeKey;
  const controlledPromptChangedOnRender = controlledPromptRef.current !== props.prompt;
  renderedScopeKeyRef.current = scopeKey;
  controlledPromptRef.current = props.prompt;
  const resolveReferences = useCallback(
    (value: string) => props.referenceResolutionInput
      ? resolveProjectGenerationReferences({
          ...props.referenceResolutionInput,
          prompt: value,
        })
      : undefined,
    [props.referenceResolutionInput],
  );
  const referenceResolution = useMemo(
    () => resolveReferences(prompt),
    [prompt, resolveReferences],
  );
  const persistReferenceResolution = useCallback((
    value: string,
    resolution: ProjectGenerationReferenceResolution,
  ) => {
    const current = useGenerationDraftStore.getState().getDraft(scope);
    const sameIds = current.referenceIds.length === resolution.referenceIds.length
      && current.referenceIds.every((id, index) => id === resolution.referenceIds[index]);
    const sameTargets = JSON.stringify(current.referenceTargets)
      === JSON.stringify(resolution.referenceTargets);
    if (current.prompt === value && sameIds && sameTargets) return;
    saveDraft(scope, {
      prompt: value,
      referenceIds: [...resolution.referenceIds],
      referenceTargets: { ...resolution.referenceTargets },
    });
  }, [saveDraft, scope]);
  const selectedReferences = useMemo<GenerateReference[]>(() => {
    const referenceIds = referenceResolution?.referenceIds ?? draft.referenceIds;
    const referenceTargets = referenceResolution?.referenceTargets ?? draft.referenceTargets;
    return referenceIds.map((referenceId) => {
      const recoveryReference = props.referenceRecovery?.references.find(
        (reference) => reference.id === referenceId,
      );
      const resolvedReference = referenceResolution?.submissionReferences.find(
        (reference) => reference.key === referenceId,
      );
      const mediaItem = props.referenceResolutionInput?.mediaItems.find(
        (item) => item.id === resolvedReference?.mediaVersionId,
      );
      const target = referenceTargets?.[referenceId];
      return {
        id: referenceId,
        label:
          props.referenceLabels?.[referenceId] ??
          mediaItem?.name ??
          (target?.kind === "missing" ? target.token : undefined) ??
          recoveryReference?.mediaId ??
          referenceId,
        origins: [...(resolvedReference?.origins ?? recoveryReference?.origins ?? ["draft"])],
        excluded: recoveryReference ? !recoveryReference.active : undefined,
        target,
      };
    });
  }, [
    draft.referenceIds,
    draft.referenceTargets,
    props.referenceLabels,
    props.referenceRecovery?.references,
    props.referenceResolutionInput?.mediaItems,
    referenceResolution,
  ]);
  const scopeResetRef = useRef({
    prompt: props.prompt ?? draft.prompt,
    modelId: props.modelId ?? draft.modelId ?? models[0]?.id ?? "",
    placement: placementSeed,
  });
  scopeResetRef.current = {
    prompt: props.prompt ?? draft.prompt,
    modelId: props.modelId ?? draft.modelId ?? models[0]?.id ?? "",
    placement: placementSeed,
  };

  useEffect(() => {
    if (props.modelId !== undefined) {
      setSelectedModelId(props.modelId);
      setSubmitted(false);
    }
  }, [props.modelId]);

  useEffect(() => {
    if (props.prompt !== undefined) {
      setPrompt(props.prompt);
      setSubmitted(false);
    }
  }, [props.prompt]);

  useEffect(() => {
    if (!referenceResolution || scopeChangedOnRender || controlledPromptChangedOnRender) return;
    persistReferenceResolution(prompt, referenceResolution);
  }, [
    controlledPromptChangedOnRender,
    persistReferenceResolution,
    prompt,
    referenceResolution,
    scopeChangedOnRender,
  ]);

  useEffect(() => {
    const next = scopeResetRef.current;
    setPrompt(next.prompt);
    setSelectedModelId(next.modelId);
    setPlacement(next.placement);
    setValidationAttempted(false);
    setSubmitted(false);
    setAnnouncement(undefined);
    setOperationalError(undefined);
  }, [scopeKey]);

  useEffect(() => {
    setPlacement(placementSeed);
    setSubmitted(false);
  }, [placementSeed]);

  useEffect(() => {
    if (!selectedModelId && models[0]) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  const setModel = (id: string) => {
    setSelectedModelId(id);
    setSubmitted(false);
    setOperationalError(undefined);
    saveDraft(scope, { modelId: id });
    props.onModelChange?.(id);
  };

  const updatePrompt = (value: string) => {
    setPrompt(value);
    setSubmitted(false);
    setOperationalError(undefined);
    const resolution = resolveReferences(value);
    if (resolution) {
      persistReferenceResolution(value, resolution);
    } else {
      saveDraft(scope, { prompt: value });
    }
    props.onPromptChange?.(value);
  };

  const updatePlacement = (value: GenerationPlacementPolicy) => {
    setPlacement(value);
    setSubmitted(false);
    setOperationalError(undefined);
    saveDraft(scope, { placementPolicy: value });
  };

  const tokenPills = useMemo(
    () =>
      [...prompt.matchAll(/@[a-z0-9_-]+/gi)].map((match, index) => ({
        value: match[0],
        ariaLabel: `Character mention ${index + 1}: ${match[0]}`,
        excluded: Boolean(props.characterSlugs?.includes(match[0].slice(1))),
      })),
    [prompt, props.characterSlugs],
  );
  const validationErrors = useMemo(() => {
    const errors: GenerateValidationError[] = [];
    const seen = new Set<string>();
    const add = (error: GenerateValidationError) => {
      if (seen.has(error.message)) return;
      seen.add(error.message);
      errors.push(error);
    };
    if (!models.some((model) => model.id === selectedModelId)) {
      add({
        field: "model",
        id: "generate-error-model",
        message: "Choose a compatible generation model.",
      });
    }
    if (!prompt.trim()) {
      add({
        field: "prompt",
        id: "generate-error-prompt-required",
        message: "Prompt is required.",
      });
    }
    Object.values(props.promptErrors ?? {}).forEach((message, index) => {
      if (!message) return;
      add({
        field: "prompt",
        id: `generate-error-prompt-${index}`,
        message,
      });
    });
    referenceResolution?.diagnostics.forEach((diagnostic, index) => {
      add({
        field: "prompt",
        id: `generate-error-reference-${index}`,
        message: diagnostic.message,
      });
    });
    if (referenceResolution && Object.values(referenceResolution.referenceTargets).some(
      (target) => target.kind === "missing",
    )) {
      add({
        field: "prompt",
        id: "generate-error-reference-missing",
        message: "A generation reference is missing or was deleted. Relink or remove it before submitting.",
      });
    }
    return errors;
  }, [models, prompt, props.promptErrors, referenceResolution, selectedModelId]);
  const modelErrorIds = validationErrors
    .filter((error) => error.field === "model")
    .map((error) => error.id)
    .join(" ") || undefined;
  const promptErrorIds = validationErrors
    .filter((error) => error.field === "prompt")
    .map((error) => error.id)
    .join(" ") || undefined;
  const explicitValidationErrors = Object.values(props.promptErrors ?? {}).some(Boolean);
  const showValidationSummary = validationAttempted || explicitValidationErrors;
  const submissionPolicyBlocked =
    props.job?.error?.code === "generation-v2-rollback-active";

  const focusField = (field: GenerateValidationError["field"]) => {
    if (field === "model") modelRef.current?.focus();
    else promptRef.current?.focus();
  };

  const submit = async () => {
    if (props.submitting || submitted || props.job || submissionPolicyBlocked) return;
    setValidationAttempted(true);
    if (validationErrors.length > 0) {
      focusField(validationErrors[0].field);
      return;
    }
    setSubmitted(true);
    setOperationalError(undefined);
    try {
      await props.onSubmit?.({
        ...draft,
        key: scopeKey,
        modelId: selectedModelId,
        prompt,
        referenceIds: referenceResolution
          ? [...referenceResolution.referenceIds]
          : draft.referenceIds,
        referenceTargets: referenceResolution
          ? { ...referenceResolution.referenceTargets }
          : draft.referenceTargets,
        placementPolicy: placement,
        updatedAt: Date.now(),
        ...(referenceResolution ? { referenceResolution } : {}),
      });
    } catch (error) {
      setSubmitted(false);
      setOperationalError(operationalErrorMessage("Generation submission", error));
    }
  };

  const handleReferenceCommand = (
    command: GenerationReferenceCommand,
    label: string,
  ) => {
    const actionLabel =
      command.action === "retry"
        ? "Retry"
        : command.action === "remove"
          ? "Remove"
          : "Deactivate";
    setAnnouncement((current) => ({
      id: (current?.id ?? 0) + 1,
      message: `${actionLabel} requested for ${label}`,
    }));
    setOperationalError(undefined);
    try {
      const result = props.onReferenceCommand?.(command);
      if (result) {
        void Promise.resolve(result).catch((error: unknown) => {
          setOperationalError(
            operationalErrorMessage(`${actionLabel} reference`, error),
          );
        });
      }
    } catch (error) {
      setOperationalError(operationalErrorMessage(`${actionLabel} reference`, error));
    }
  };

  const handleEdit = () => {
    props.onEdit?.();
    const field = props.job?.error?.field?.toLowerCase().includes("model")
      ? "model"
      : "prompt";
    focusField(field);
  };
  const handleRecoveryAction =
    props.onRecoveryAction || props.onCancel
      ? (action: RecoveryAction) => {
          if (action === "cancel" && props.onCancel && !props.onRecoveryAction) {
            props.onCancel();
            return;
          }
          props.onRecoveryAction?.(action);
        }
      : undefined;

  if (props.context === "unsupported") {
    return (
      <div role="status" className="min-w-0 p-3 text-sm text-text-secondary">
        Generate is unavailable for this selection.
      </div>
    );
  }

  return (
    <form
      aria-label="Generate"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="min-w-0 max-w-full w-full text-sm text-text-primary"
      data-testid="generate-tab"
    >
      <GenerateHeaderSection
        contextLabel={
          props.context === "shot" ? "shot-aware generation" : "new asset generation"
        }
        description={
          props.context === "shot"
            ? "Create a shot-aware image or video."
            : "Create a new visual asset."
        }
      />
      {showValidationSummary ? (
        <GenerateValidationSummary
          errors={validationErrors}
          onSelectField={focusField}
        />
      ) : null}
      <GenerateModelSection
        models={models}
        selectedModelId={selectedModelId}
        onSelect={setModel}
        inputRef={modelRef}
        invalid={showValidationSummary && Boolean(modelErrorIds)}
        describedBy={showValidationSummary ? modelErrorIds : undefined}
      />
      <GeneratePromptSection
        prompt={prompt}
        onPromptChange={updatePrompt}
        tokens={tokenPills}
        inputRef={promptRef}
        invalid={showValidationSummary && Boolean(promptErrorIds)}
        describedBy={showValidationSummary ? promptErrorIds : undefined}
      />
      <GenerateReferenceSection
        references={selectedReferences}
        recovery={props.referenceRecovery}
        labels={props.referenceLabels}
        onCommand={props.onReferenceCommand ? handleReferenceCommand : undefined}
      />
      <GenerateContextSection
        contextResult={props.entryContextResult}
        audioPresentation={props.audioPresentation}
        timing={props.timing}
        audioReason={props.audioReason}
      />
      <GenerateDestinationSection
        value={placement}
        defaultValue={placementDefault}
        onChange={updatePlacement}
      />
      <GenerateJobSection
        job={props.job}
        progress={props.jobProgress}
        message={props.jobMessage}
        announcement={announcement}
        operationalError={operationalError}
        terminalErrorExplanation={props.terminalErrorExplanation}
        onEdit={handleEdit}
        onRevalidate={props.onRevalidate}
        onRetryItem={props.onRetryItem}
        onRecoveryAction={handleRecoveryAction}
      />
      <GenerateActionsSection
        submitting={props.submitting}
        disabled={!models.length || Boolean(props.job) || submissionPolicyBlocked}
        submitted={submitted}
        job={props.job}
        onRecoveryAction={handleRecoveryAction}
      />
    </form>
  );
};

export default GenerateTab;
