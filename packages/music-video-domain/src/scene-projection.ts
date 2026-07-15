import type { StoryboardShot, StoryboardShotSource } from "./types.js";

export type SceneProjectionSource = StoryboardShotSource;

/** Canonical link between a timeline clip projection and its scene record. */
export interface StoryboardClipMetadata {
  readonly kind: "storyboard-shot";
  readonly shotId: string;
  readonly shotIndex?: number;
  readonly label?: string;
  readonly prompt?: string;
  readonly source: SceneProjectionSource;
  /** Clip metadata supports provider-specific extension fields. */
  readonly [key: string]: unknown;
}

export interface SceneProjectionClip {
  readonly metadata?: unknown;
}

const SOURCES: ReadonlySet<string> = new Set<SceneProjectionSource>([
  "manual",
  "neuralframes",
  "storyboard-generation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSource(value: unknown): value is SceneProjectionSource {
  return typeof value === "string" && SOURCES.has(value);
}

function sourceFor(metadata: Record<string, unknown>): SceneProjectionSource {
  if (metadata.importSource === "neuralframes" || metadata.provider === "neuralframes") {
    return "neuralframes";
  }
  return isSource(metadata.source) ? metadata.source : "storyboard-generation";
}

/**
 * Read canonical and evidenced legacy scene-link metadata without mutating it.
 * Unknown extension fields are retained in the returned canonical object.
 */
export function normalizeSceneProjectionMetadata(
  metadata: unknown,
): StoryboardClipMetadata | undefined {
  if (!isRecord(metadata)) return undefined;

  if (metadata.kind === "storyboard-shot") {
    if (!usableId(metadata.shotId)) return undefined;
    return {
      ...metadata,
      kind: "storyboard-shot",
      shotId: metadata.shotId,
      source: sourceFor(metadata),
    };
  }

  if (metadata.kind !== "scene") return undefined;

  // Both fields exist in persisted OpenReel data. Do not treat an arbitrary
  // metadata `id` as a scene link: it may identify the metadata record itself.
  const shotId = usableId(metadata.shotId)
    ? metadata.shotId
    : usableId(metadata.sceneId)
      ? metadata.sceneId
      : undefined;
  if (!shotId) return undefined;

  return {
    ...metadata,
    kind: "storyboard-shot",
    shotId,
    source: sourceFor(metadata),
  };
}

export function getSceneIdFromClip(clip: SceneProjectionClip | null | undefined): string | undefined {
  return normalizeSceneProjectionMetadata(clip?.metadata)?.shotId;
}

export function isSceneProjection(
  clip: SceneProjectionClip | null | undefined,
): clip is SceneProjectionClip & { readonly metadata: Record<string, unknown> } {
  return getSceneIdFromClip(clip) !== undefined;
}

/** Create metadata for all new or updated projection links. */
export function createSceneProjectionMetadata(
  scene: Pick<StoryboardShot, "id" | "index" | "label" | "prompt">,
  source: SceneProjectionSource,
): StoryboardClipMetadata {
  return {
    kind: "storyboard-shot",
    shotId: scene.id,
    shotIndex: scene.index,
    label: scene.label,
    prompt: scene.prompt,
    source,
  };
}
