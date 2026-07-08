import type { MediaItem } from "../types/project";
import { getMediaStatus, MediaStatus } from "../types/project";

/**
 * Returns true when the media item has no loadable file: no blob in memory
 * and no remote/original URL to fetch from.
 */
export function isVideoFileMissing(item: MediaItem): boolean {
  return getMediaStatus(item) !== MediaStatus.OK;
}

/**
 * Resolves the best available thumbnail URL for a media item.
 *
 * Normal path: return `item.thumbnailUrl` when it exists.
 *
 * Fallback path — only when the video file is missing (no blob, no remote URL)
 * AND `clipMetadata` is provided (i.e. called from a context that has the clip):
 *
 *   1. First entry in `clipMetadata.referenceAssetIds` whose resolved MediaItem
 *      has a thumbnailUrl. Contract: when a first-frame / reference image asset
 *      exists, it MUST appear first in this array; there is no separate role
 *      metadata to distinguish "first-frame" from generic reference images.
 *   2. `clipMetadata.referenceImageUrl` — direct URL preview stored on the clip
 *      (e.g. NeuralFrames scene_image_url).
 *   3. First entry of `clipMetadata.referenceImageUrls`.
 *
 * Note: fallback deliberately ignores `generationMeta` — that field describes
 * how the asset was generated (status, provider, model) and its source asset
 * IDs belong to the generation-domain, not to the project media library.
 *
 * @param item          The media item whose thumbnail is needed.
 * @param allMediaItems All media items in the project library.
 * @param clipMetadata  Optional: the `Clip.metadata` record for the clip that
 *                      this media item is attached to. Enables first-frame and
 *                      reference-image fallbacks.
 */
export function getEffectiveThumbnailUrl(
  item: MediaItem | undefined,
  allMediaItems: readonly MediaItem[],
  clipMetadata?: Record<string, unknown> | null,
): string | null {
  if (!item) return null;

  // Own thumbnail — use it unconditionally.
  if (item.thumbnailUrl) return item.thumbnailUrl;

  // No clip context or file is still available — no fallback to apply.
  if (!clipMetadata || !isVideoFileMissing(item)) return null;

  // ── 1. referenceAssetIds → first library item with a thumbnail ────────────
  const refAssetIds = readStringArray(clipMetadata, "referenceAssetIds");
  for (const id of refAssetIds) {
    const refItem = allMediaItems.find((m) => m.id === id);
    if (refItem?.thumbnailUrl) return refItem.thumbnailUrl;
  }

  // ── 2. referenceImageUrl — direct URL ─────────────────────────────────────
  const refUrl = readString(clipMetadata, "referenceImageUrl");
  if (refUrl) return refUrl;

  // ── 3. referenceImageUrls — first entry ───────────────────────────────────
  const refUrls = readStringArray(clipMetadata, "referenceImageUrls");
  if (refUrls.length > 0) return refUrls[0];

  return null;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function readString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return typeof val === "string" && val.length > 0 ? val : null;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] {
  const val = obj[key];
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string" && v.length > 0);
}
