import { v4 as uuidv4 } from "uuid";
import type { MediaItem, MediaMetadata } from "@openreel/core";

/** Semantic label for a metadata clip section (e.g. "verse", "chorus", "beat"). */
export type MetadataKind = string;

export interface MetadataMediaOptions {
  kind: MetadataKind;
  label: string;
  /** CSS-compatible color string used to tint the clip in the timeline. */
  color: string;
  /** Intended clip length in seconds, stored in metadata.duration. */
  duration: number;
}

export interface MetadataMediaResult {
  /** A ready-to-register image MediaItem with a real Blob. */
  item: MediaItem;
  /** The same Blob that lives on item.blob — pass to saveMediaBlob. */
  blob: Blob;
  kind: MetadataKind;
  label: string;
  color: string;
  duration: number;
}

/**
 * Decode a base64 string to a Uint8Array using the browser-native atob.
 * Runs in any environment that exposes atob (browsers, jsdom, Deno).
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * A 1×1 transparent PNG (68 bytes).
 *
 * Stored as base64 to avoid encoding mistakes in raw byte literals.
 * No canvas, no network call — safe in any JS environment.
 */
const TRANSPARENT_1X1_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeMinimalPngBlob(): Blob {
  return new Blob([base64ToBytes(TRANSPARENT_1X1_PNG_B64)], {
    type: "image/png",
  });
}

/**
 * Create a lightweight, real image-backed MediaItem for use as a metadata
 * clip's media source.
 *
 * - The blob is a 1×1 transparent PNG — no canvas render, no network fetch.
 * - `metadata.duration` carries the intended clip length.
 * - `sourceFile.folder` carries `{ kind, label, color }` as JSON so the
 *   values survive project serialisation and can be recovered on load.
 * - kind / label / color / duration are also returned at the top level of the
 *   result object for direct consumption by clip-creation helpers.
 */
export function createMetadataMedia(
  options: MetadataMediaOptions,
): MetadataMediaResult {
  const { kind, label, color, duration } = options;

  const blob = makeMinimalPngBlob();
  const id = uuidv4();

  const metadata: MediaMetadata = {
    duration,
    width: 1,
    height: 1,
    frameRate: 0,
    codec: "png",
    sampleRate: 0,
    channels: 0,
    fileSize: blob.size,
  };

  const item: MediaItem = {
    id,
    name: `${kind}: ${label}`,
    type: "image",
    fileHandle: null,
    blob,
    metadata,
    thumbnailUrl: null,
    waveformData: null,
    sourceFile: {
      name: `${kind}: ${label}`,
      size: blob.size,
      lastModified: Date.now(),
      // Reuse the optional folder field as a structured-metadata slot so that
      // kind / label / color survive round-trips through JSON serialisation.
      folder: JSON.stringify({ kind, label, color }),
    },
  };

  return { item, blob, kind, label, color, duration };
}
