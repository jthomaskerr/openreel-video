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

type GeneratedImageCommandErrorDetails = {
  readonly projectId: string;
  readonly mediaId?: string;
  readonly definitionId?: string;
  readonly affectedDefinitionIds?: readonly string[];
};

export type GeneratedImageCommandErrorCode =
  | "DEFINITION_IN_USE"
  | "DEFINITION_NOT_FOUND"
  | "INVALID_MEDIA_TYPE"
  | "MEDIA_NOT_FOUND";

export type GeneratedImageCommandError = {
  readonly code: GeneratedImageCommandErrorCode;
  readonly message: string;
  readonly details: GeneratedImageCommandErrorDetails;
};

type CommandSuccessResult = {
  readonly success: true;
  readonly nextProject: GeneratedImageCommandProject;
  readonly definitionId?: string;
  readonly mediaId?: string;
  readonly undo?: () => GeneratedImageCommandProject;
};

type CommandFailureResult = {
  readonly success: false;
  readonly error: GeneratedImageCommandError;
  readonly requiresConfirmation?: boolean;
  readonly affectedDefinitionIds?: readonly string[];
};

export type CommandResult = CommandSuccessResult | CommandFailureResult;

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

const cloneProject = (
  project: GeneratedImageCommandProject,
): GeneratedImageCommandProject => ({
  id: project.id,
  mediaItems: [...project.mediaItems],
  mediaGroups: [...project.mediaGroups],
  generatedImageDefinitions: [...project.generatedImageDefinitions],
});

const cloneDraft = (draft: GeneratedImageDraft): GeneratedImageDraft => ({
  ...draft,
  roleByReferenceKey: { ...draft.roleByReferenceKey },
  inputs: { ...draft.inputs },
});

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

const createCommandError = (
  code: GeneratedImageCommandErrorCode,
  message: string,
  details: GeneratedImageCommandErrorDetails,
): GeneratedImageCommandError => ({
  code,
  message,
  details,
});

const createMissingMediaError = (
  projectId: string,
  mediaId: string,
): GeneratedImageCommandError =>
  createCommandError("MEDIA_NOT_FOUND", `Media item not found: ${mediaId}`, {
    projectId,
    mediaId,
  });

const createMissingDefinitionError = (
  projectId: string,
  definitionId: string,
): GeneratedImageCommandError =>
  createCommandError(
    "DEFINITION_NOT_FOUND",
    `Generated image definition not found: ${definitionId}`,
    {
      projectId,
      definitionId,
    },
  );

const createInvalidMediaTypeError = (
  projectId: string,
  mediaId: string,
): GeneratedImageCommandError =>
  createCommandError("INVALID_MEDIA_TYPE", `Media item is not an image: ${mediaId}`, {
    projectId,
    mediaId,
  });

const createDefinitionInUseError = (
  projectId: string,
  definitionId: string,
  affectedDefinitionIds: readonly string[],
): GeneratedImageCommandError =>
  createCommandError(
    "DEFINITION_IN_USE",
    `Generated image definition ${definitionId} is still referenced`,
    {
      projectId,
      definitionId,
      affectedDefinitionIds,
    },
  );

const pruneUnusedMediaGroup = (
  project: GeneratedImageCommandProject,
  assetGroupId: string,
): GeneratedImageCommandProject => {
  const mediaStillUsesGroup = project.mediaItems.some((mediaItem) => mediaItem.assetGroupId === assetGroupId);
  const definitionStillUsesGroup = project.generatedImageDefinitions.some(
    (definition) => definition.assetGroupId === assetGroupId,
  );
  if (mediaStillUsesGroup || definitionStillUsesGroup) {
    return project;
  }

  return {
    ...project,
    mediaGroups: project.mediaGroups.filter((group) => group.id !== assetGroupId),
  };
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
    draft: cloneDraft(input.draft),
    attemptIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    success: true,
    nextProject: {
      ...cloneProject(project),
      mediaGroups: [...project.mediaGroups, { id: assetGroupId }],
      mediaItems: [...project.mediaItems, nextMediaItem],
      generatedImageDefinitions: [...project.generatedImageDefinitions, nextDefinition],
    },
    definitionId,
    mediaId,
  };
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
    return {
      success: true,
      nextProject: cloneProject(project),
      definitionId: existingDefinition.id,
      mediaId,
    };
  }

  const mediaItem = findMediaItem(project, mediaId);
  if (!mediaItem) {
    return { success: false, error: createMissingMediaError(project.id, mediaId) };
  }
  if (mediaItem.type !== "image") {
    return { success: false, error: createInvalidMediaTypeError(project.id, mediaId) };
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

  return {
    success: true,
    nextProject: {
      ...cloneProject(project),
      generatedImageDefinitions: [...project.generatedImageDefinitions, nextDefinition],
    },
    definitionId,
    mediaId,
  };
}

export function updateGeneratedImageDraft(
  project: GeneratedImageCommandProject,
  definitionId: string,
  patch: Partial<GeneratedImageDraft>,
  input: UpdateGeneratedImageDraftInput,
): CommandResult {
  const definitionIndex = findDefinitionIndex(project, definitionId);
  if (definitionIndex < 0) {
    return { success: false, error: createMissingDefinitionError(project.id, definitionId) };
  }

  const previousProject = cloneProject(project);
  const previousDefinition = previousProject.generatedImageDefinitions[definitionIndex];
  const nextDefinition: GeneratedImageDefinition = {
    ...previousDefinition,
    draft: {
      ...cloneDraft(previousDefinition.draft),
      ...patch,
      roleByReferenceKey: patch.roleByReferenceKey
        ? { ...patch.roleByReferenceKey }
        : { ...previousDefinition.draft.roleByReferenceKey },
      inputs: patch.inputs ? { ...patch.inputs } : { ...previousDefinition.draft.inputs },
    },
    updatedAt: input.now(),
  };

  return {
    success: true,
    nextProject: {
      ...previousProject,
      generatedImageDefinitions: previousProject.generatedImageDefinitions.map((definition, index) =>
        index === definitionIndex ? nextDefinition : definition,
      ),
    },
    definitionId,
    undo: () => previousProject,
  };
}

export function deleteGeneratedImage(
  project: GeneratedImageCommandProject,
  definitionId: string,
  options?: { readonly confirmed?: boolean },
): CommandResult {
  const definition = findDefinition(project, definitionId);
  if (!definition) {
    return { success: false, error: createMissingDefinitionError(project.id, definitionId) };
  }

  const affectedDefinitionIds = findDependentDefinitionIds(project, definitionId);
  if (affectedDefinitionIds.length > 0 && !options?.confirmed) {
    return {
      success: false,
      requiresConfirmation: true,
      affectedDefinitionIds,
      error: createDefinitionInUseError(project.id, definitionId, affectedDefinitionIds),
    };
  }

  const previousProject = cloneProject(project);
  const mediaId = definition.currentMediaVersionId;
  const nextMediaItems =
    mediaId &&
    findMediaItem(previousProject, mediaId)?.generationMeta
      ? previousProject.mediaItems.filter((item) => item.id !== mediaId)
      : previousProject.mediaItems;

  const nextProject = pruneUnusedMediaGroup(
    {
      ...previousProject,
      mediaItems: nextMediaItems,
      generatedImageDefinitions: previousProject.generatedImageDefinitions.filter(
        (item) => item.id !== definitionId,
      ),
    },
    definition.assetGroupId,
  );

  return {
    success: true,
    nextProject,
    definitionId,
    mediaId,
  };
}
