import type { GeneratedImageDefinition, GeneratedImageDraft } from "@openreel/core";

type GeneratedImageMediaItem = {
  readonly id: string;
  readonly type?: string;
  readonly name?: string;
  readonly fileName?: string;
  readonly title?: string;
  readonly blob?: Blob;
  readonly assetGroupId?: string;
  readonly isCurrent?: boolean;
  readonly generationMeta?: {
    readonly provider: string;
    readonly model: string;
    readonly prompt?: string;
    readonly negativePrompt?: string;
    readonly inputs?: Record<string, unknown>;
    readonly jobId?: string;
    readonly status?: string;
  };
};

type GeneratedImageAssetGroup = {
  readonly id: string;
};

export type GeneratedImageCommandProject = {
  readonly id: string;
  mediaItems: GeneratedImageMediaItem[];
  mediaGroups: GeneratedImageAssetGroup[];
  generatedImageDefinitions: GeneratedImageDefinition[];
};

export type CommandResult = {
  readonly success: boolean;
  readonly definitionId?: string;
  readonly mediaId?: string;
  readonly requiresConfirmation?: boolean;
  readonly affectedDefinitionIds?: readonly string[];
  readonly error?: string;
  readonly undo?: () => void;
};

type CreateGeneratedImageInput = {
  readonly title: string;
  readonly draft: GeneratedImageDraft;
  readonly createId: () => string;
  readonly now: () => string;
};

type ConvertImportedImageInput = {
  readonly createId: () => string;
  readonly now: () => string;
};

type UpdateGeneratedImageDraftInput = {
  readonly now: () => string;
};

const findDefinitionIndex = (
  project: GeneratedImageCommandProject,
  definitionId: string,
): number => project.generatedImageDefinitions.findIndex((definition) => definition.id === definitionId);

const findDefinition = (
  project: GeneratedImageCommandProject,
  definitionId: string,
): GeneratedImageDefinition | undefined =>
  project.generatedImageDefinitions.find((definition) => definition.id === definitionId);

const findMediaItem = (
  project: GeneratedImageCommandProject,
  mediaId: string,
): GeneratedImageMediaItem | undefined => project.mediaItems.find((mediaItem) => mediaItem.id === mediaId);

const getDraftDependencyIds = (definition: GeneratedImageDefinition): readonly string[] => {
  const dependencyIds = definition.draft.inputs.generatedImageDefinitionIds;
  if (!Array.isArray(dependencyIds)) {
    return [];
  }

  return dependencyIds.filter((value): value is string => typeof value === "string");
};

const findDependentDefinitionIds = (
  project: GeneratedImageCommandProject,
  targetDefinitionId: string,
): readonly string[] =>
  project.generatedImageDefinitions
    .filter((definition) => definition.id !== targetDefinitionId)
    .filter((definition) => getDraftDependencyIds(definition).includes(targetDefinitionId))
    .map((definition) => definition.id);

const removeMediaGroupIfUnused = (
  project: GeneratedImageCommandProject,
  assetGroupId: string,
): void => {
  const mediaStillUsesGroup = project.mediaItems.some((mediaItem) => mediaItem.assetGroupId === assetGroupId);
  const definitionStillUsesGroup = project.generatedImageDefinitions.some(
    (definition) => definition.assetGroupId === assetGroupId,
  );
  if (mediaStillUsesGroup || definitionStillUsesGroup) {
    return;
  }

  project.mediaGroups = project.mediaGroups.filter((group) => group.id !== assetGroupId);
};

export function createGeneratedImage(
  project: GeneratedImageCommandProject,
  input: CreateGeneratedImageInput,
): CommandResult {
  const assetGroupId = input.createId();
  const mediaId = input.createId();
  const definitionId = input.createId();
  const timestamp = input.now();

  const nextMediaItem: GeneratedImageMediaItem = {
    id: mediaId,
    type: "image",
    title: input.title,
    assetGroupId,
    isCurrent: true,
    generationMeta: {
      provider: input.draft.provider ?? "generated-image",
      model: input.draft.modelId ?? "draft",
      prompt: input.draft.prompt,
      negativePrompt: input.draft.negativePrompt,
      inputs: { ...input.draft.inputs },
      status: "unrealized",
    },
  };

  const nextDefinition: GeneratedImageDefinition = {
    id: definitionId,
    projectId: project.id,
    assetGroupId,
    currentMediaVersionId: mediaId,
    title: input.title,
    draft: input.draft,
    attemptIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  project.mediaGroups = [...project.mediaGroups, { id: assetGroupId }];
  project.mediaItems = [...project.mediaItems, nextMediaItem];
  project.generatedImageDefinitions = [...project.generatedImageDefinitions, nextDefinition];

  return { success: true, definitionId, mediaId };
}

export function convertImportedImageToGeneratedImage(
  project: GeneratedImageCommandProject,
  mediaId: string,
  input: ConvertImportedImageInput,
): CommandResult {
  const existingDefinition = project.generatedImageDefinitions.find(
    (definition) =>
      definition.currentMediaVersionId === mediaId || definition.sourceMediaVersionId === mediaId,
  );
  if (existingDefinition) {
    return { success: true, definitionId: existingDefinition.id, mediaId };
  }

  const mediaItem = findMediaItem(project, mediaId);
  if (!mediaItem) {
    return { success: false, error: `Media item not found: ${mediaId}` };
  }
  if (mediaItem.type !== "image") {
    return { success: false, error: `Media item is not an image: ${mediaId}` };
  }

  const definitionId = input.createId();
  const timestamp = input.now();
  const title = mediaItem.title ?? mediaItem.name ?? mediaItem.fileName ?? "Imported image";
  const assetGroupId = mediaItem.assetGroupId ?? mediaId;
  const nextDefinition: GeneratedImageDefinition = {
    id: definitionId,
    projectId: project.id,
    assetGroupId,
    currentMediaVersionId: mediaId,
    sourceMediaVersionId: mediaId,
    title,
    draft: {
      prompt: title,
      roleByReferenceKey: {},
      inputs: {},
    },
    attemptIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  project.generatedImageDefinitions = [...project.generatedImageDefinitions, nextDefinition];
  return { success: true, definitionId, mediaId };
}

export function updateGeneratedImageDraft(
  project: GeneratedImageCommandProject,
  definitionId: string,
  patch: Partial<GeneratedImageDraft>,
  input: UpdateGeneratedImageDraftInput,
): CommandResult {
  const definitionIndex = findDefinitionIndex(project, definitionId);
  if (definitionIndex < 0) {
    return { success: false, error: `Generated image definition not found: ${definitionId}` };
  }

  const previousDefinition = project.generatedImageDefinitions[definitionIndex];
  const nextDefinition: GeneratedImageDefinition = {
    ...previousDefinition,
    draft: {
      ...previousDefinition.draft,
      ...patch,
    },
    updatedAt: input.now(),
  };

  project.generatedImageDefinitions = project.generatedImageDefinitions.map((definition, index) =>
    index === definitionIndex ? nextDefinition : definition,
  );

  return {
    success: true,
    definitionId,
    undo: () => {
      project.generatedImageDefinitions = project.generatedImageDefinitions.map((definition, index) =>
        index === definitionIndex ? previousDefinition : definition,
      );
    },
  };
}

export function deleteGeneratedImage(
  project: GeneratedImageCommandProject,
  definitionId: string,
  options?: { readonly confirmed?: boolean },
): CommandResult {
  const definition = findDefinition(project, definitionId);
  if (!definition) {
    return { success: false, error: `Generated image definition not found: ${definitionId}` };
  }

  const affectedDefinitionIds = findDependentDefinitionIds(project, definitionId);
  if (affectedDefinitionIds.length > 0 && !options?.confirmed) {
    return {
      success: false,
      requiresConfirmation: true,
      affectedDefinitionIds,
    };
  }

  project.generatedImageDefinitions = project.generatedImageDefinitions.filter(
    (item) => item.id !== definitionId,
  );

  const mediaId = definition.currentMediaVersionId;
  if (mediaId) {
    const mediaItem = findMediaItem(project, mediaId);
    if (mediaItem?.generationMeta) {
      project.mediaItems = project.mediaItems.filter((item) => item.id !== mediaId);
    }
  }

  removeMediaGroupIfUnused(project, definition.assetGroupId);
  return { success: true, definitionId, mediaId };
}
