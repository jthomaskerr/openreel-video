import type { MediaItem, ReferenceTarget } from "@openreel/core";
import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import {
  createGeneratedImageController,
  type GeneratedImageControllerJob,
  type GeneratedImageControllerModel,
  type GeneratedImageControllerSubmission,
} from "../../../features/generation/generated-images/controller";
import { openReferenceTarget } from "../../../features/references/navigation";
import {
  createImageTask,
  IMAGE_MODELS,
  type ImageModelInput,
} from "../../../services/kieai/image-generation";
import { uploadFileStream } from "../../../services/kieai/file-upload";
import {
  fetchModelsCached,
  submitGenerationJob,
  type SchemaProperty,
  type WavespeedModel,
} from "../../../services/wavespeed";
import { sanitizeWaveSpeedInputs } from "../../../services/wavespeed/adapters/sanitize-inputs";
import { normalizeWaveSpeedModel } from "../../../services/wavespeed/model-capabilities";
import {
  useGenerationJobStore,
  type EnqueueParams,
  type GenerationJob,
} from "../../../stores/generation-job-store";
import { useProjectStore } from "../../../stores/project-store";
import { GeneratedImageEditor } from "./GeneratedImageEditor";
import type { MediaMentionOption } from "./mentions/MediaMentionEditor";

export interface ProjectGeneratedImageEditorProps {
  readonly definitionId: string;
  readonly placement: "modal" | "inspector";
}

const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

export const KIEAI_CONTROLLER_MODELS: readonly GeneratedImageControllerModel[] = [
  {
    id: IMAGE_MODELS.Z_IMAGE,
    label: "Z-Image",
    provider: "kieai",
    schemaVersion: "kieai-z-image-v1",
    inputFields: [
      {
        key: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: ASPECT_RATIOS.map((value) => ({ label: value, value })),
      },
    ],
    capability: {
      provider: "kieai",
      modelId: IMAGE_MODELS.Z_IMAGE,
      displayName: "Z-Image",
      output: "image",
      mode: "text-to-image",
      accepts: {
        prompt: true,
        negativePrompt: false,
        sourceImage: false,
        referenceImages: false,
        audio: false,
        seed: false,
      },
      aspectRatios: [...ASPECT_RATIOS],
      requestSchemaVersion: "kieai-z-image-v1",
      schemaVersion: "kieai-z-image-v1",
      supportsAudio: false,
      inputFields: { prompt: "prompt", aspectRatio: "aspect_ratio" },
    },
  },
  {
    id: IMAGE_MODELS.NANO_BANANA2,
    label: "Nano Banana 2",
    provider: "kieai",
    schemaVersion: "kieai-nano-banana-2-v1",
    inputFields: [
      {
        key: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: [...ASPECT_RATIOS, "auto"].map((value) => ({ label: value, value })),
      },
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: ["1K", "2K", "4K"].map((value) => ({ label: value, value })),
      },
      {
        key: "output_format",
        label: "Output format",
        type: "select",
        options: ["png", "jpg"].map((value) => ({ label: value, value })),
      },
    ],
    capability: {
      provider: "kieai",
      modelId: IMAGE_MODELS.NANO_BANANA2,
      displayName: "Nano Banana 2",
      output: "image",
      mode: "text-to-image",
      accepts: {
        prompt: true,
        negativePrompt: false,
        sourceImage: false,
        referenceImages: { min: 0, max: 14 },
        audio: false,
        seed: false,
      },
      aspectRatios: [...ASPECT_RATIOS, "auto"],
      requestSchemaVersion: "kieai-nano-banana-2-v1",
      schemaVersion: "kieai-nano-banana-2-v1",
      supportsAudio: false,
      referenceField: "image_input",
      inputFields: {
        prompt: "prompt",
        referenceImages: "image_input",
        aspectRatio: "aspect_ratio",
      },
    },
  },
];

function inputField(
  key: string,
  property: SchemaProperty,
  required: boolean,
): GeneratedImageControllerModel["inputFields"][number] | undefined {
  const label = property.title?.trim() || key.replaceAll("_", " ");
  const shared = {
    key,
    label,
    required,
    ...(property.description ? { description: property.description } : {}),
  };

  if (property.enum?.length) {
    return {
      ...shared,
      type: "select",
      options: property.enum.map((value) => ({ label: String(value), value: String(value) })),
    };
  }
  if (property.type === "boolean") return { ...shared, type: "boolean" };
  if (property.type === "integer" || property.type === "number") {
    return {
      ...shared,
      type: "number",
      ...(property.minimum !== undefined ? { min: property.minimum } : {}),
      ...(property.maximum !== undefined ? { max: property.maximum } : {}),
      ...(property.multipleOf !== undefined ? { step: property.multipleOf } : {}),
    };
  }
  if (property.type === "string") return { ...shared, type: "text" };
  return undefined;
}

export function controllerModelFromWaveSpeed(
  rawModel: WavespeedModel,
): GeneratedImageControllerModel | undefined {
  const normalized = normalizeWaveSpeedModel(rawModel);
  if (!normalized.ok || normalized.capability.output !== "image") return undefined;
  const schema = rawModel.api_schema.api_schemas[0]?.request_schema;
  if (!schema) return undefined;

  const capability = normalized.capability;
  const reserved = new Set(
    [
      capability.inputFields.prompt,
      capability.inputFields.negativePrompt,
      capability.inputFields.sourceImage,
      capability.inputFields.referenceImages,
      capability.inputFields.audio,
    ].filter((field): field is string => Boolean(field)),
  );
  const required = new Set(schema.required ?? []);
  const orderedKeys = schema["x-order-properties"] ?? Object.keys(schema.properties);
  const inputFields = orderedKeys
    .filter((key) => !reserved.has(key))
    .map((key) => {
      const property = schema.properties[key];
      return property ? inputField(key, property, required.has(key)) : undefined;
    })
    .filter((field): field is NonNullable<typeof field> => Boolean(field));

  return {
    id: rawModel.model_id,
    label: rawModel.name || rawModel.model_id,
    provider: "wavespeed",
    capability,
    schemaVersion: capability.schemaVersion,
    inputFields,
    basePrice: rawModel.base_price,
    ...(rawModel.formula ? { priceFormula: rawModel.formula } : {}),
  };
}

export function mentionOptionsFromMedia(
  mediaItems: readonly MediaItem[],
): readonly MediaMentionOption[] {
  return mediaItems
    .filter((item) => item.type === "image")
    .map((item) => ({
      kind: "media" as const,
      id: item.id,
      label: item.title?.trim() || item.name,
      description:
        item.description?.trim() || item.generationMeta?.prompt?.trim() || "Image media",
      ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
      available: Boolean(item.blob || item.fileHandle || item.originalUrl || item.thumbnailUrl),
    }));
}

function controllerJob(job: GenerationJob, definitionId: string): GeneratedImageControllerJob {
  return {
    id: job.id,
    definitionId,
    providerJobId: job.providerJobId,
    status: job.status,
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

interface SubmittedGenerationJobStore {
  readonly getJobs: () => readonly GenerationJob[];
  readonly enqueue: (params: EnqueueParams) => void;
  readonly retry: (id: string, newProviderJobId: string) => void;
}

export function recordSubmittedGenerationJob(
  input: EnqueueParams & { readonly definitionId: string; readonly retryJobId?: string },
  store: SubmittedGenerationJobStore = {
    getJobs: () => useGenerationJobStore.getState().jobs,
    enqueue: (params) => useGenerationJobStore.getState().enqueue(params),
    retry: (id, providerJobId) => useGenerationJobStore.getState().retry(id, providerJobId),
  },
): GeneratedImageControllerJob {
  const { definitionId, retryJobId, ...params } = input;
  if (retryJobId) store.retry(retryJobId, params.providerJobId);
  else store.enqueue(params);
  const job = store
    .getJobs()
    .find((candidate) =>
      retryJobId ? candidate.id === retryJobId : candidate.providerJobId === params.providerJobId,
    );
  if (!job) throw new Error(`Generation job ${params.providerJobId} was not recorded locally.`);
  return controllerJob(job, definitionId);
}

function mediaIdForDefinition(definitionId: string): string | undefined {
  const definition = useProjectStore
    .getState()
    .project.generatedImageDefinitions.find((candidate) => candidate.id === definitionId);
  if (!definition) return undefined;
  if (definition.currentMediaVersionId) return definition.currentMediaVersionId;
  return useProjectStore
    .getState()
    .project.mediaLibrary.items.find((item) => item.assetGroupId === definition.assetGroupId)?.id;
}

function jobsForDefinition(definitionId: string): GenerationJob[] {
  const mediaId = mediaIdForDefinition(definitionId);
  if (!mediaId) return [];
  return useGenerationJobStore
    .getState()
    .jobs.filter((job) => job.linkedMediaIds.includes(mediaId));
}

function providerInputsForSubmission(
  submission: GeneratedImageControllerSubmission,
  rawModel: WavespeedModel,
): Record<string, unknown> {
  const schema = rawModel.api_schema.api_schemas[0]?.request_schema;
  if (!schema) throw new Error(`WaveSpeed model ${rawModel.model_id} has no request schema.`);
  const { definition, model, references } = submission;
  const fields = model.capability.inputFields;
  const draftValues: Record<string, unknown> = { ...definition.draft.inputs };
  if (fields.prompt) draftValues[fields.prompt] = definition.draft.prompt;
  if (fields.negativePrompt && definition.draft.negativePrompt) {
    draftValues[fields.negativePrompt] = definition.draft.negativePrompt;
  }

  const mediaItems = useProjectStore.getState().project.mediaLibrary.items;
  const tokenForId = (mediaId: string | undefined) => {
    if (!mediaId) return undefined;
    const item = mediaItems.find((candidate) => candidate.id === mediaId);
    const tokenId = item?.originalUrl || item?.thumbnailUrl;
    return tokenId ? { tokenId } : undefined;
  };
  const source = tokenForId(definition.sourceMediaVersionId);
  const resolvedReferences = references
    .map((reference) => tokenForId(reference.mediaVersionId))
    .filter((reference): reference is { tokenId: string } => Boolean(reference));
  const sanitized = sanitizeWaveSpeedInputs({
    schema,
    capability: model.capability,
    draftValues,
    ...(source ? { source } : {}),
    references: resolvedReferences,
  });
  if (sanitized.errors.length) {
    throw new Error(
      `WaveSpeed input validation failed: ${sanitized.errors
        .map((error) => `${error.field} (${error.code})`)
        .join(", ")}`,
    );
  }
  return sanitized.inputs;
}

async function submit(
  submission: GeneratedImageControllerSubmission,
  rawModels: ReadonlyMap<string, WavespeedModel>,
  retryJobId?: string,
): Promise<GeneratedImageControllerJob> {
  if (submission.model.provider === "kieai") {
    return submitKieAI(submission, retryJobId);
  }
  const rawModel = rawModels.get(submission.model.id);
  if (!rawModel) throw new Error(`WaveSpeed model ${submission.model.id} is unavailable.`);
  const mediaId = mediaIdForDefinition(submission.definition.id);
  if (!mediaId) throw new Error("The generated image placeholder is unavailable.");
  const providerInputs = providerInputsForSubmission(submission, rawModel);
  const projectId = submission.definition.projectId;
  const requestId = uuidv4();
  const result = await submitGenerationJob({
    id: requestId,
    projectId,
    provider: "wavespeed",
    modelId: submission.model.id,
    modelSchemaVersion: submission.model.schemaVersion,
    context: {
      projectId,
      target: { kind: "new-asset", placeholderMediaId: mediaId },
      references: [],
      placementPolicy: "none",
    },
    providerInputs,
  });
  useProjectStore.getState().setGenerationStatus(mediaId, "pending");
  return recordSubmittedGenerationJob({
    definitionId: submission.definition.id,
    retryJobId,
    provider: "wavespeed",
    providerJobId: result.jobId,
    model: submission.model.id,
    prompt: submission.definition.draft.prompt,
    inputs: providerInputs,
    projectId,
    linkedMediaIds: [mediaId, ...submission.references.map((reference) => reference.mediaVersionId)],
  });
}

async function mediaUrl(mediaId: string): Promise<string> {
  const item = useProjectStore
    .getState()
    .project.mediaLibrary.items.find((candidate) => candidate.id === mediaId);
  if (!item) throw new Error(`Reference image ${mediaId} is unavailable.`);
  if (item.originalUrl) return item.originalUrl;
  if (item.blob) {
    const uploaded = await uploadFileStream(item.blob);
    const url = uploaded.fileUrl || uploaded.downloadUrl;
    if (url) return url;
    throw new Error(`Reference image ${mediaId} uploaded without a usable URL.`);
  }
  throw new Error(
    `Reference image ${mediaId} has no local blob or provider-accessible URL.`,
  );
}

export function kieAIProviderInputs(input: {
  readonly modelId: string;
  readonly prompt: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly referenceUrls: readonly string[];
}): ImageModelInput {
  if (input.modelId === IMAGE_MODELS.Z_IMAGE) {
    return {
      prompt: input.prompt,
      aspect_ratio:
        (input.inputs.aspect_ratio as "1:1" | "4:3" | "3:4" | "16:9" | "9:16") ||
        "16:9",
    };
  }
  if (input.modelId === IMAGE_MODELS.NANO_BANANA2) {
    return {
      prompt: input.prompt,
      ...(input.referenceUrls.length ? { image_input: [...input.referenceUrls] } : {}),
      aspect_ratio:
        (input.inputs.aspect_ratio as
          | "1:1"
          | "4:3"
          | "3:4"
          | "16:9"
          | "9:16"
          | "auto") || "16:9",
      resolution: (input.inputs.resolution as "1K" | "2K" | "4K") || "2K",
      output_format: (input.inputs.output_format as "png" | "jpg") || "png",
    };
  }
  throw new Error(`KieAI model ${input.modelId} is unavailable.`);
}

async function submitKieAI(
  submission: GeneratedImageControllerSubmission,
  retryJobId?: string,
): Promise<GeneratedImageControllerJob> {
  const mediaId = mediaIdForDefinition(submission.definition.id);
  if (!mediaId) throw new Error("The generated image placeholder is unavailable.");
  const referenceUrls = await Promise.all(
    submission.references.map((reference) => mediaUrl(reference.mediaVersionId)),
  );
  const { prompt, inputs } = submission.definition.draft;
  const providerInputs = kieAIProviderInputs({
    modelId: submission.model.id,
    prompt,
    inputs,
    referenceUrls,
  });

  const providerJobId = await createImageTask(
    submission.model.id as typeof IMAGE_MODELS.Z_IMAGE | typeof IMAGE_MODELS.NANO_BANANA2,
    providerInputs,
  );
  useProjectStore.getState().setGenerationStatus(mediaId, "pending");
  return recordSubmittedGenerationJob({
    definitionId: submission.definition.id,
    retryJobId,
    provider: "kieai",
    providerJobId,
    model: submission.model.id,
    prompt,
    inputs: providerInputs as unknown as Record<string, unknown>,
    projectId: submission.definition.projectId,
    linkedMediaIds: [mediaId, ...submission.references.map((reference) => reference.mediaVersionId)],
  });
}

export function ProjectGeneratedImageEditor({
  definitionId,
  placement,
}: ProjectGeneratedImageEditorProps) {
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);
  useProjectStore((state) => state.project.modifiedAt);
  useGenerationJobStore((state) =>
    state.jobs.reduce((revision, job) => revision + job.updatedAt, 0),
  );
  const [rawModels, setRawModels] = useState<WavespeedModel[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    let active = true;
    const cache = fetchModelsCached();
    if (cache.cached) {
      setRawModels(cache.cached);
      setLoadingModels(false);
    } else {
      setLoadingModels(true);
    }
    setModelError(null);
    void cache
      .refresh()
      .then((models: WavespeedModel[]) => {
        if (active) setRawModels(models);
      })
      .catch((error: unknown) => {
        if (active) {
          setModelError(error instanceof Error ? error.message : "Model discovery failed.");
        }
      })
      .finally(() => {
        if (active) setLoadingModels(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const models = useMemo(
    () => [
      ...KIEAI_CONTROLLER_MODELS,
      ...rawModels
        .map(controllerModelFromWaveSpeed)
        .filter((model): model is GeneratedImageControllerModel => Boolean(model)),
    ],
    [rawModels],
  );
  const rawModelsById = useMemo(
    () => new Map(rawModels.map((model) => [model.model_id, model])),
    [rawModels],
  );
  const mentionOptions = useMemo(() => mentionOptionsFromMedia(mediaItems), [mediaItems]);
  const controller = useMemo(
    () =>
      createGeneratedImageController({
        models,
        referenceContext: {
          characters: [],
          mediaVersions: mediaItems.map((item) => ({
            mediaId: item.id,
            versionId: item.id,
            accessible: Boolean(
              item.blob || item.fileHandle || item.originalUrl || item.thumbnailUrl,
            ),
          })),
          shotReferences: [],
        },
        ports: {
          getProject: () => useProjectStore.getState().project,
          updateDraft: (nextDefinitionId, patch) =>
            useProjectStore.getState().updateGeneratedImageDraft({
              definitionId: nextDefinitionId,
              patch,
            }),
          getJobs: (nextDefinitionId) =>
            jobsForDefinition(nextDefinitionId).map((job) =>
              controllerJob(job, nextDefinitionId),
            ),
          submit: (submission) => submit(submission, rawModelsById),
          cancel: async (job) => {
            useGenerationJobStore.getState().cancel(job.id);
            const canceled = useGenerationJobStore
              .getState()
              .jobs.find((candidate) => candidate.id === job.id);
            return canceled ? controllerJob(canceled, definitionId) : undefined;
          },
          retry: async (job, submission) => {
            return submit(submission, rawModelsById, job.id);
          },
        },
      }),
    [definitionId, mediaItems, models, rawModelsById],
  );

  if (loadingModels) {
    return (
      <div role="status" className="p-3 text-sm text-text-secondary">
        Loading image generation models…
      </div>
    );
  }
  if (modelError) {
    return (
      <div role="alert" className="m-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        Image generation models could not be loaded: {modelError}
      </div>
    );
  }
  if (!models.length) {
    return (
      <div role="alert" className="m-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        No schema-supported image generation models are available.
      </div>
    );
  }

  return (
    <GeneratedImageEditor
      controller={controller}
      definitionId={definitionId}
      placement={placement}
      mediaItems={mediaItems}
      mentionOptions={mentionOptions}
      onOpenReference={(target: ReferenceTarget, event) =>
        openReferenceTarget(target, event.shiftKey ? "inspector" : "modal", {
          invoker: event.currentTarget,
        })
      }
    />
  );
}
