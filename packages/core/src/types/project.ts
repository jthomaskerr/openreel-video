import type { Timeline } from "./timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";
import type { GeneratedImageDefinition } from "../generation/references";

/**
 * Producer-independent status of the primary media source file.
 *
 * - OK: media blob is available and loadable.
 * - MISSING: no blob and no generation metadata — imported/linked file that
 *   cannot be found on disk. User can "Link file" to resolve.
 * - UNREALIZED: no blob BUT generationMeta exists — a generated asset that
 *   has not been produced yet. Not "missing," just not ready. User can retry
 *   generation, not "Link file."
 * - PENDING: generation is in progress (KieAI/WaveSpeed polling).
 * - ERROR: generation or polling failed.
 */
export enum MediaStatus {
  OK = "OK",
  MISSING = "MISSING",
  UNREALIZED = "UNREALIZED",
  PENDING = "PENDING",
  ERROR = "ERROR",
}

/**
 * Derive the media-file status from a MediaItem without checking flags
 * like `isPlaceholder` or `isMissingMedia` that overloaded two concerns.
 */
export function getMediaStatus(item: MediaItem): MediaStatus {
  if (item.blob) return MediaStatus.OK;
  if (item.generationMeta) {
    const gs = item.generationMeta.status;
    if (gs === "failed" || gs === "cancelled") return MediaStatus.ERROR;
    if (gs === "unrealized") return MediaStatus.UNREALIZED;
    // queued, submitting, processing, running, pending — all "in flight"
    return MediaStatus.PENDING;
  }
  // No blob and no generation metadata — truly missing
  return MediaStatus.MISSING;
}

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly mediaLibrary: MediaLibrary;
  readonly generatedImageDefinitions: GeneratedImageDefinition[];
  readonly timeline: Timeline;
  readonly textClips?: TextClip[];
  readonly shapeClips?: ShapeClip[];
  readonly svgClips?: SVGClip[];
  readonly stickerClips?: StickerClip[];
}

export interface MediaLibrary {
  readonly items: MediaItem[];
}

export interface MediaItem {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image" | "srt";
  readonly fileHandle: FileSystemFileHandle | null;
  readonly blob: Blob | null;
  readonly metadata: MediaMetadata;
  readonly thumbnailUrl: string | null;
  readonly filmstripThumbnails?: FilmstripThumbnail[];
  readonly originalUrl?: string;
  /** File hint stored in JSON for cross-session/cross-machine asset matching */
  readonly sourceFile?: { name: string; size: number; lastModified: number; folder?: string };

  /** KieAI task ID used to poll for completion */
  readonly kieaiTaskId?: string;
  /** Shared identifier for all MediaItems that are versions of the same asset */
  readonly assetGroupId?: string;
  /** Current version flag within an asset group */
  readonly isCurrent?: boolean;
  /** Generation details that produced this media item */
  readonly generationMeta?: {
    readonly provider: string;
    readonly model: string;
    readonly prompt?: string;
    readonly negativePrompt?: string;
    readonly inputs?: Record<string, unknown>;
    readonly jobId?: string;
    readonly status?: string;
  };
  /**
   * Display title for the asset, distinct from `name` (the immutable source filename).
   * Populated at import from container metadata (ID3/MP4/WebM/Vorbis/RIFF title tags) when
   * present, otherwise derived from the filename (snake/kebab case converted to sentence case,
   * extension dropped). User-editable afterward via the rename action.
   */
  readonly title?: string;
  /** User-editable description / notes for the asset */
  readonly description?: string;
  /** User-assigned tags for filtering and organization */
  readonly tags?: string[];
  /** User-assigned group / bucket for the asset */
  readonly group?: string;
  /** Backend URL where this media version's binary is stored. Populated on load from backend; stripped before saving back. */
  readonly remoteUrl?: string;
  /** True after a confirmed external editor import references this media item. */
  readonly externallyReferenced?: boolean;
}

/** Thumbnail for filmstrip display in timeline */
export interface FilmstripThumbnail {
  readonly timestamp: number;
  readonly url: string;
}

export interface MediaMetadata {
  readonly duration: number; // In seconds
  readonly width: number; // For video/image
  readonly height: number; // For video/image
  readonly frameRate: number; // For video
  readonly codec: string;
  readonly sampleRate: number; // For audio
  readonly channels: number; // For audio
  readonly fileSize: number;
  /** Detected or imported tempo for audio assets */
  readonly bpm?: number;
  /** Detected or imported musical key for audio assets */
  readonly key?: string;
  /** Detected or imported scale/mode for audio assets */
  readonly scale?: string;
  /** Whether lyrics are present in the audio metadata/import payload */
  readonly has_lyrics?: boolean;
  /** Number of audio tracks in the file (may be > 1 for multi-track video/audio files) */
  readonly audioTrackCount?: number;
}
