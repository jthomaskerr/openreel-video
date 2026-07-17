import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ReferenceTarget } from "@openreel/core";
import { generationDraftKey, useGenerationDraftStore, type GenerationDraftState, type GenerationDraftScope } from "../../../../../features/generation/drafts";
import {
  GenerateActionsSection,
  GenerateContextSection,
  GenerateDestinationSection,
  GenerateHeaderSection,
  GenerateJobSection,
  GenerateModelSection,
  GeneratePromptSection,
  GenerateReferenceSection,
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
  references?: GenerateReference[];
  timing?: { start: number; end: number; source: string; reason?: string };
  audioReason?: string;
  destination?: "none" | "create-linked-clip" | "replace-selected-clip-media";
  job?: GenerateJob;
  submitting?: boolean;
  onSubmit?: (draft: GenerationDraftState) => void | Promise<void>;
  onCancel?: () => void;
  onRetry?: () => void;
  onSaveRetry?: () => void;
  onPlacementRetry?: () => void;
}

const pickScope = (props: GenerateTabProps): GenerationDraftScope => {
  if (props.shotId) return { kind: "shot", shotId: props.shotId, projectId: props.projectId };
  return { kind: "new-asset", draftId: props.draftId ?? props.projectId ?? "new-asset", projectId: props.projectId };
};

const firstErrorId = "generate-errors";

export const GenerateTab: React.FC<GenerateTabProps> = (props) => {
  const scope = useMemo(() => pickScope(props), [props.projectId, props.shotId, props.draftId]);
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
  const [selectedModelId, setSelectedModelId] = useState(props.modelId ?? draft.modelId ?? models[0]?.id ?? "");
  const [prompt, setPrompt] = useState(props.prompt ?? draft.prompt);
  const [submitted, setSubmitted] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.modelId) setSelectedModelId(props.modelId);
  }, [props.modelId]);

  useEffect(() => {
    if (props.prompt !== undefined) setPrompt(props.prompt);
  }, [props.prompt]);

  useEffect(() => {
    setPrompt(props.prompt ?? draft.prompt);
    setSelectedModelId(props.modelId ?? draft.modelId ?? models[0]?.id ?? "");
  }, [scopeKey]);

  useEffect(() => {
    if (!selectedModelId && models[0]) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  const setModel = (id: string) => {
    setSelectedModelId(id);
    saveDraft(scope, { modelId: id });
    props.onModelChange?.(id);
  };

  const updatePrompt = (value: string) => {
    setPrompt(value);
    saveDraft(scope, { prompt: value });
    props.onPromptChange?.(value);
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
  const errors = Object.values(props.promptErrors ?? {});

  const submit = async () => {
    if (props.submitting || submitted) return;
    if (!prompt.trim() || errors.length > 0 || !models.length) {
      promptRef.current?.focus();
      return;
    }
    setSubmitted(true);
    await props.onSubmit?.({
      ...draft,
      key: scopeKey,
      modelId: selectedModelId,
      prompt,
      placementPolicy: props.destination ?? draft.placementPolicy,
      updatedAt: Date.now(),
    });
  };

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
      className="min-w-0 overflow-x-hidden text-sm text-text-primary"
      data-testid="generate-tab"
    >
      <GenerateHeaderSection
        contextLabel={props.context === "shot" ? "shot-aware generation" : "new asset generation"}
        description={props.context === "shot" ? "Create a shot-aware image or video." : "Create a new visual asset."}
      />
      <GenerateModelSection models={models} selectedModelId={selectedModelId} onSelect={setModel} />
      <GeneratePromptSection
        prompt={prompt}
        onPromptChange={updatePrompt}
        tokens={tokenPills}
        errors={errors}
        firstErrorId={firstErrorId}
        inputRef={promptRef}
      />
      <GenerateReferenceSection references={props.references} />
      <GenerateContextSection timing={props.timing} audioReason={props.audioReason} />
      <GenerateDestinationSection value={props.destination ?? draft.placementPolicy} onChange={(value) => saveDraft(scope, { placementPolicy: value })} />
      <GenerateJobSection
        job={props.job}
        onRetry={props.onRetry}
        onSaveRetry={props.onSaveRetry}
        onPlacementRetry={props.onPlacementRetry}
      />
      <GenerateActionsSection
        submitting={props.submitting}
        disabled={!models.length}
        submitted={submitted}
        onCancel={props.onCancel}
      />
    </form>
  );
};

export default GenerateTab;
