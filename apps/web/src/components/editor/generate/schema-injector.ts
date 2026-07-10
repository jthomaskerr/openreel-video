/**
 * Schema injection helpers — resolve reference images and source images
 * into model-specific schema input fields.
 */

import type { WavespeedModel, SchemaProperty } from "../../../services/wavespeed/index";
import type { MediaItem } from "@openreel/core";

/**
 * Detect which fields in a WaveSpeed schema accept image/video URIs.
 * Returns their keys so the caller can inject reference URLs.
 */
export function findImageUriFields(
  schema: NonNullable<ReturnType<typeof getRequestSchema>>,
): string[] {
  const props = schema.properties ?? {};
  return Object.entries(props)
    .filter(([, prop]) => isImageUriField(prop))
    .map(([key]) => key);
}

function getRequestSchema(model: WavespeedModel) {
  return model.api_schema?.api_schemas?.[0]?.request_schema;
}

function isImageUriField(prop: SchemaProperty): boolean {
  if (prop.format === "uri") {
    const accept = prop["x-accept"];
    if (accept) return accept.includes("image") || accept.includes("video");
    return true; // URI fields without explicit accept may accept images
  }
  return false;
}

/**
 * Inject reference image URLs and source image URL into model inputs.
 * 
 * - `refMediaItems`: selected reference images from the media library (must have resolvable URLs)
 * - `sourceImageUrl`: pre-uploaded source image URL for image-to-image/edit models
 * - `currentInputs`: existing input values to merge into
 */
export function injectImageInputs(
  schema: NonNullable<ReturnType<typeof getRequestSchema>>,
  currentInputs: Record<string, unknown>,
  refMediaItems: MediaItem[],
  sourceImageUrl?: string,
): Record<string, unknown> {
  const imageFields = findImageUriFields(schema);
  if (imageFields.length === 0) return currentInputs;

  const updated = { ...currentInputs };
  const allUrls: string[] = [];

  // Source image first for edit/image-to-image models
  if (sourceImageUrl) allUrls.push(sourceImageUrl);

  // Reference images after
  for (const item of refMediaItems) {
    const url = item.originalUrl ?? item.thumbnailUrl;
    if (url) allUrls.push(url);
  }

  if (allUrls.length === 0) return updated;

  // Populate fields by convention:
  // - Single-valued fields (non-array, single URI): get first URL
  // - Array fields: get all URLs
  // - Multi-valued string/image fields: distribute across available fields
  for (const field of imageFields) {
    const prop = schema.properties[field];
    if (!prop) continue;

    if (prop.type === "array") {
      updated[field] = [...allUrls];
    } else if (allUrls.length === 1 || schema.properties[field]?.["x-accept"]?.includes("multiple")) {
      // Single field — first URL only, unless it's explicitly multiple-accept
      updated[field] = allUrls[0];
    } else {
      // For models with multiple single-image fields, distribute
      // Use the field name to pick:
      // - fields containing "source" or "input" get the source image
      // - fields containing "ref" get reference images
      const fieldLower = field.toLowerCase();
      if (fieldLower.includes("source") || fieldLower.includes("input")) {
        updated[field] = sourceImageUrl ?? allUrls[0];
      } else {
        updated[field] = allUrls.length > 1 ? allUrls[1] : allUrls[allUrls.length - 1];
      }
    }
  }

  return updated;
}

/**
 * Get resolvable URLs for the selected reference media items.
 * Filters to items that have either originalUrl or thumbnailUrl.
 */
export function getRefImageUrls(
  mediaItems: MediaItem[],
  refIds: string[],
): MediaItem[] {
  return refIds
    .map((id) => mediaItems.find((item) => item.id === id))
    .filter((item): item is MediaItem => {
      const url = item?.originalUrl ?? item?.thumbnailUrl;
      return !!url && /^https:\/\//i.test(url);
    });
}
