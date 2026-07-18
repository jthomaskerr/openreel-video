import type { ReferenceTarget } from "@openreel/core";
import React, { useMemo, useRef } from "react";
import {
  createGeneratedImageController,
  type GeneratedImageControllerJob,
  type GeneratedImageControllerModel,
} from "../../../../../features/generation/generated-images/controller";
import {
  generationDraftKey,
  useGenerationDraftStore,
  type GenerationDraftScope,
  type GenerationDraftState,
} from "../../../../../features/generation/drafts";
import { GeneratedImageEditor } from "../../../generate/GeneratedImageEditor";

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
  if (props.shotId) {
    return { kind: "shot", shotId: props.shotId, projectId: props.projectId };
  }
  return {
    kind: "new-asset",
    draftId: props.draftId ?? props.projectId ?? "new-asset",
    projectId: props.projectId,
  };
};

function controllerModel(model: GenerateModel): GeneratedImageControllerModel {
  const output = model.modes?.includes("video") && !model.modes.includes("image")
    ? "video"
    : "image";
  return {
    id: model.id,
    label: model.label,
    provider: model.provider ?? "wavespeed",
    schemaVersion: "generate-tab-compatibility-v1",
    inputFields: [],
    capability: {
      provider: "wavespeed",
      modelId: model.id,
      displayName: model.label,
      output,
      mode: output === "video" ? "text-to-video" : "text-to-image",
      accepts: {
        prompt: true,
        negativePrompt: false,
        sourceImage: false,
        referenceImages: false,
        audio: false,
        seed: false,
      },
      requestSchemaVersion: "generate-tab-compatibility-v1",
      schemaVersion: "generate-tab-compatibility-v1",
      supportsAudio: false,
      inputFields: { prompt: "prompt" },
    },
  };
}

function jobStatus(status: string): GeneratedImageControllerJob["status"] {
  return status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "canceled"
    ? status
    : "running";
}

function controllerJob(
  job: GenerateJob,
  definitionId: string,
): GeneratedImageControllerJob {
  return {
    id: job.id,
    definitionId,
    providerJobId: job.id,
    status: jobStatus(job.status),
    message: job.message,
    progress: job.progress,
    error: job.error,
    createdAt: 0,
    updatedAt: 0,
  };
}

export const GenerateTab: React.FC<GenerateTabProps> = (props) => {
  const scope = useMemo(
    () => pickScope(props),
    [props.projectId, props.shotId, props.draftId],
  );
  const scopeKey = generationDraftKey(scope);
  const storedDraft = useGenerationDraftStore((state) => state.drafts[scopeKey]);
  const getDraft = useGenerationDraftStore((state) => state.getDraft);
  const saveDraft = useGenerationDraftStore((state) => state.saveDraft);
  const draft = storedDraft ?? getDraft(scope);
  const models = useMemo(() => {
    const available = props.models ?? [];
    return props.compatibleModelIds
      ? available.filter((model) => props.compatibleModelIds?.includes(model.id))
      : available;
  }, [props.compatibleModelIds, props.models]);
  const propsRef = useRef(props);
  propsRef.current = props;

  const controller = useMemo(() => {
    const definitionId = scopeKey;
    const initialModelId = props.modelId ?? draft.modelId ?? models[0]?.id;
    const initialModel = models.find((model) => model.id === initialModelId);
    let localDefinition = {
      id: definitionId,
      projectId: props.projectId ?? "local-project",
      assetGroupId: definitionId,
      title: "Generated asset",
      draft: {
        provider: initialModel?.provider ?? "wavespeed",
        modelId: initialModelId,
        prompt: props.prompt ?? draft.prompt,
        roleByReferenceKey: {},
        inputs: {},
      },
      attemptIds: [] as string[],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    let submittedJob: GeneratedImageControllerJob | undefined;

    return createGeneratedImageController({
      models: models.map(controllerModel),
      ports: {
        getProject: () => ({
          id: localDefinition.projectId,
          generatedImageDefinitions: [localDefinition],
        }),
        updateDraft: async (_definitionId, patch) => {
          localDefinition = {
            ...localDefinition,
            draft: {
              ...localDefinition.draft,
              ...patch,
              inputs: patch.inputs ?? localDefinition.draft.inputs,
              roleByReferenceKey:
                patch.roleByReferenceKey ?? localDefinition.draft.roleByReferenceKey,
            },
          };
          saveDraft(scope, {
            ...(patch.modelId ? { modelId: patch.modelId } : {}),
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          });
          if (patch.modelId) propsRef.current.onModelChange?.(patch.modelId);
          if (patch.prompt !== undefined) {
            propsRef.current.onPromptChange?.(patch.prompt);
          }
          return { success: true };
        },
        getJobs: () => {
          const external = propsRef.current.job
            ? [controllerJob(propsRef.current.job, definitionId)]
            : [];
          return submittedJob ? [submittedJob, ...external] : external;
        },
        submit: async ({ definition }) => {
          await propsRef.current.onSubmit?.({
            ...draft,
            key: scopeKey,
            modelId: definition.draft.modelId,
            prompt: definition.draft.prompt,
            placementPolicy:
              propsRef.current.destination ?? draft.placementPolicy,
            updatedAt: Date.now(),
          });
          submittedJob = {
            id: `submitted:${definitionId}`,
            definitionId,
            providerJobId: `submitted:${definitionId}`,
            status: "queued",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          return submittedJob;
        },
        cancel: async (job) => {
          propsRef.current.onCancel?.();
          submittedJob = { ...job, status: "canceled", updatedAt: Date.now() };
          return submittedJob;
        },
        retry: async (job) => {
          propsRef.current.onRetry?.();
          submittedJob = {
            ...job,
            providerJobId: `${job.providerJobId}:retry`,
            status: "queued",
            updatedAt: Date.now(),
          };
          return submittedJob;
        },
      },
    });
  }, [draft, models, props.modelId, props.projectId, props.prompt, saveDraft, scope, scopeKey]);

  if (props.context === "unsupported") {
    return (
      <div role="status" className="min-w-0 p-3 text-sm text-text-secondary">
        Generate is unavailable for this selection.
      </div>
    );
  }

  return (
    <GeneratedImageEditor
      controller={controller}
      definitionId={scopeKey}
      placement="inspector"
      mediaItems={[]}
      mentionOptions={[]}
      onOpenReference={() => undefined}
      legacy={{
        contextLabel:
          props.context === "shot"
            ? "shot-aware generation"
            : "new asset generation",
        description:
          props.context === "shot"
            ? "Create a shot-aware image or video."
            : "Create a new visual asset.",
        models,
        characterSlugs: props.characterSlugs,
        promptErrors: props.promptErrors,
        references: props.references,
        timing: props.timing,
        audioReason: props.audioReason,
        destination: props.destination ?? draft.placementPolicy,
        onDestinationChange: (placementPolicy) =>
          saveDraft(scope, { placementPolicy }),
        job: props.job,
        submitting: props.submitting,
        onSaveRetry: props.onSaveRetry,
        onPlacementRetry: props.onPlacementRetry,
      }}
    />
  );
};

export default GenerateTab;
