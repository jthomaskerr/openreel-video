import type { ActionResult, MediaItem, Project } from "@openreel/core";

export interface GeneratedAssetFinalizationStore {
  readonly project: Project;
  /** Replace a placeholder in-place, retaining its media ID. */
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

/**
 * Applies the media-side finalization checkpoint exactly once. The mutation
 * port owns persistence and should atomically recognize the supplied key.
 * This function deliberately does not infer a source asset from references.
 */
export async function finalizeGeneratedAsset(
  store: GeneratedAssetFinalizationStore,
  input: FinalizeGeneratedAssetInput,
): Promise<FinalizeGeneratedAssetResult> {
  const mediaId = input.target.placeholderMediaId;
  const existing = store.project.mediaLibrary.items.find((item) => item.id === mediaId);
  if (!existing) {
    return fail(mediaId, { code: "MEDIA_NOT_FOUND", message: `Placeholder ${mediaId} not found` });
  }

  const key = `generation-finalize:${input.jobId}:${input.target.kind}`;
  const result = input.target.kind === "new-asset"
    ? await store.finalizePlaceholder?.({ placeholderMediaId: mediaId, item: input.item, blob: input.blob, idempotencyKey: key })
    : await store.finalizeVersion?.({ sourceMediaId: input.target.sourceMediaId, placeholderMediaId: mediaId, item: input.item, blob: input.blob, idempotencyKey: key });

  if (!result) return fail(mediaId, { code: "ACTION_FAILED", message: "Store does not expose generation finalization" });
  if (!result.success) return fail(mediaId, result.error);

  let shotLinked = false;
  if (input.shotId && input.attempt && store.appendShotAttempt) {
    const shotKey = `generation-shot:${input.jobId}:${input.shotId}`;
    const shotResult = await store.appendShotAttempt({ shotId: input.shotId, generatedMediaId: mediaId, attempt: input.attempt, idempotencyKey: shotKey });
    if (!shotResult.success) return { success: false, mediaId, shotLinked: false, replayed: isReplay(shotResult), error: shotResult.error };
    shotLinked = true;
  }
  return { success: true, mediaId, shotLinked, replayed: isReplay(result) };
}

export async function appendGeneratedShotAttempt(
  store: GeneratedAssetFinalizationStore,
  input: { shotId: string; generatedMediaId: string; attempt: unknown; jobId: string },
): Promise<{ success: boolean; replayed: boolean; error?: ActionResult["error"] }> {
  if (!store.appendShotAttempt) return { success: false, replayed: false, error: { code: "ACTION_FAILED", message: "Store does not expose shot mutation" } };
  const result = await store.appendShotAttempt({ ...input, idempotencyKey: `generation-shot:${input.jobId}:${input.shotId}` });
  return { success: result.success, replayed: isReplay(result), ...(result.success ? {} : { error: result.error }) };
}

function isReplay(result: ActionResult): boolean {
  return (result as ActionResult & { replayed?: boolean }).replayed === true;
}

function fail(mediaId: string, error: ActionResult["error"]): FinalizeGeneratedAssetResult {
  return { success: false, mediaId, shotLinked: false, replayed: false, error };
}
