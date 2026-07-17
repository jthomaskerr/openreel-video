import type { ActionResult, MediaItem, Project } from "@openreel/core";

export interface GeneratedAssetFinalizationStore {
  readonly project: Project;
  /** Replace a placeholder in place, retaining its media ID. */
  finalizePlaceholder?: (input: {
    placeholderMediaId: string;
    item: MediaItem;
    blob: Blob;
    idempotencyKey: string;
  }) => Promise<ActionResult>;
  /** Add an immutable output version to the source asset group. */
  finalizeVersion?: (input: {
    sourceMediaId: string;
    placeholderMediaId: string;
    item: MediaItem;
    blob: Blob;
    idempotencyKey: string;
  }) => Promise<ActionResult>;
  appendShotAttempt?: (input: {
    shotId: string;
    generatedMediaId: string;
    attempt: unknown;
    idempotencyKey: string;
  }) => Promise<ActionResult>;
}

export type GeneratedAssetTarget =
  | { kind: "new-asset"; placeholderMediaId: string }
  | { kind: "new-version"; sourceMediaId: string; placeholderMediaId: string };

export interface FinalizeGeneratedAssetInput {
  target: GeneratedAssetTarget;
  item: MediaItem;
  blob: Blob;
  jobId: string;
  shotId?: string;
  attempt?: unknown;
}

export interface FinalizeGeneratedAssetResult {
  success: boolean;
  mediaId: string;
  shotLinked: boolean;
  replayed: boolean;
  error?: ActionResult["error"];
}

type ReplayableActionResult = ActionResult & { replayed?: boolean };

/**
 * Applies the media-side finalization checkpoint exactly once.
 *
 * The supplied mutation ports own persistence and idempotency. This helper
 * only validates the placeholder target, forwards the correct mutation input,
 * and appends a single shot attempt when shot linkage is requested.
 */
export async function finalizeGeneratedAsset(
  store: GeneratedAssetFinalizationStore,
  input: FinalizeGeneratedAssetInput,
): Promise<FinalizeGeneratedAssetResult> {
  const mediaId = input.target.placeholderMediaId;
  const existing = store.project.mediaLibrary.items.find((item) => item.id === mediaId);
  if (!existing) {
    return fail(mediaId, {
      code: "MEDIA_NOT_FOUND",
      message: `Placeholder ${mediaId} not found`,
    });
  }

  const finalizeKey = `generation-finalize:${input.jobId}:${input.target.kind}`;
  const finalizeResult =
    input.target.kind === "new-asset"
      ? await store.finalizePlaceholder?.({
          placeholderMediaId: mediaId,
          item: input.item,
          blob: input.blob,
          idempotencyKey: finalizeKey,
        })
      : await store.finalizeVersion?.({
          sourceMediaId: input.target.sourceMediaId,
          placeholderMediaId: mediaId,
          item: input.item,
          blob: input.blob,
          idempotencyKey: finalizeKey,
        });

  if (!finalizeResult) {
    return fail(mediaId, {
      code: "ACTION_FAILED",
      message: "Store does not expose generation finalization",
    });
  }
  if (!finalizeResult.success) {
    return fail(mediaId, finalizeResult.error);
  }
  reconcileProjectFinalization(store.project, input);

  const replayed = isReplay(finalizeResult);
  if (!hasShotAttempt(input)) {
    return { success: true, mediaId, shotLinked: false, replayed };
  }

  if (!store.appendShotAttempt) {
    return fail(mediaId, {
      code: "ACTION_FAILED",
      message: "Store does not expose shot mutation",
    });
  }

  const shotKey = `generation-shot:${input.jobId}:${input.shotId}`;
  const shotResult = await store.appendShotAttempt({
    shotId: input.shotId,
    generatedMediaId: mediaId,
    attempt: input.attempt,
    idempotencyKey: shotKey,
  });
  if (!shotResult.success) {
    return {
      success: false,
      mediaId,
      shotLinked: false,
      replayed: replayed || isReplay(shotResult),
      error: shotResult.error,
    };
  }

  return {
    success: true,
    mediaId,
    shotLinked: true,
    replayed: replayed || isReplay(shotResult),
  };
}

function reconcileProjectFinalization(project: Project, input: FinalizeGeneratedAssetInput): void {
  const mediaId = input.target.placeholderMediaId;
  const mediaItems = project.mediaLibrary.items;
  const placeholderIndex = mediaItems.findIndex((item) => item.id === mediaId);
  if (placeholderIndex < 0) {
    return;
  }

  const definition = findDefinition(project, input);
  const assetGroupId = input.target.kind === "new-version"
    ? mediaItems.find((item) => item.id === input.target.sourceMediaId)?.assetGroupId
      ?? definition?.assetGroupId
      ?? mediaItems[placeholderIndex]?.assetGroupId
    : definition?.assetGroupId ?? mediaItems[placeholderIndex]?.assetGroupId;

  if (assetGroupId) {
    for (const item of mediaItems) {
      if (item.assetGroupId === assetGroupId) {
        item.isCurrent = item.id === mediaId;
      }
    }
  }

  mediaItems[placeholderIndex] = {
    ...mediaItems[placeholderIndex],
    ...input.item,
    id: mediaId,
    assetGroupId,
    isCurrent: true,
    ...(input.item.generationMeta ? { generationMeta: input.item.generationMeta } : {}),
  };

  if (!definition) {
    return;
  }

  definition.currentMediaVersionId = mediaId;
  if (!definition.sourceMediaVersionId) {
    definition.sourceMediaVersionId = input.target.kind === "new-version"
      ? input.target.sourceMediaId
      : mediaId;
  }
  const attemptId = extractAttemptId(input);
  if (attemptId && !definition.attemptIds.includes(attemptId)) {
    definition.attemptIds = [...definition.attemptIds, attemptId];
  }
}

function findDefinition(project: Project, input: FinalizeGeneratedAssetInput) {
  if (input.target.kind === "new-version") {
    return project.generatedImageDefinitions.find((definition) =>
      definition.currentMediaVersionId === input.target.sourceMediaId
      || definition.sourceMediaVersionId === input.target.sourceMediaId
      || definition.assetGroupId === project.mediaLibrary.items.find((item) => item.id === input.target.sourceMediaId)?.assetGroupId,
    );
  }
  return project.generatedImageDefinitions.find((definition) =>
    definition.currentMediaVersionId === input.target.placeholderMediaId
    || definition.assetGroupId === project.mediaLibrary.items.find((item) => item.id === input.target.placeholderMediaId)?.assetGroupId,
  );
}

function extractAttemptId(input: FinalizeGeneratedAssetInput): string | undefined {
  const attempt = input.attempt;
  if (attempt && typeof attempt === "object" && "id" in attempt) {
    const id = (attempt as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

export async function appendGeneratedShotAttempt(
  store: GeneratedAssetFinalizationStore,
  input: { shotId: string; generatedMediaId: string; attempt: unknown; jobId: string },
): Promise<{ success: boolean; replayed: boolean; error?: ActionResult["error"] }> {
  if (!store.appendShotAttempt) {
    return {
      success: false,
      replayed: false,
      error: {
        code: "ACTION_FAILED",
        message: "Store does not expose shot mutation",
      },
    };
  }

  const result = await store.appendShotAttempt({
    ...input,
    idempotencyKey: `generation-shot:${input.jobId}:${input.shotId}`,
  });
  return {
    success: result.success,
    replayed: isReplay(result),
    ...(result.success ? {} : { error: result.error }),
  };
}

function hasShotAttempt(
  input: FinalizeGeneratedAssetInput,
): input is FinalizeGeneratedAssetInput & { shotId: string; attempt: unknown } {
  return input.shotId !== undefined && input.attempt !== undefined;
}

function isReplay(result: ActionResult): boolean {
  return (result as ReplayableActionResult).replayed === true;
}

function fail(
  mediaId: string,
  error: ActionResult["error"],
): FinalizeGeneratedAssetResult {
  return { success: false, mediaId, shotLinked: false, replayed: false, error };
}
