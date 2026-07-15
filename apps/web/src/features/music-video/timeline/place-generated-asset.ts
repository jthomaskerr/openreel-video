import type { ActionResult, Project, Track } from "@openreel/core";

export interface GeneratedAssetPlacementStore {
  readonly project: Project;
  addTrack: (trackType: Track["type"], position?: number) => Promise<ActionResult>;
  addClip: (
    trackId: string,
    mediaId: string,
    startTime: number,
    options?: {
      duration?: number;
      type?: "video" | "audio" | "image" | "metadata";
      metadata?: Record<string, unknown>;
    },
  ) => Promise<ActionResult>;
  /** Replace only the media identity of an existing clip. Implementations must
   * record this as one undoable action and may use the idempotency key to
   * replay a completed mutation. */
  replaceClipMedia?: (
    clipId: string,
    mediaId: string,
    idempotencyKey: string,
  ) => Promise<ActionResult>;
  beginHistoryGroup?: (description?: string) => void;
  endHistoryGroup?: () => void;
}

export type GeneratedAssetPlacementPolicy =
  | "none"
  | "create-linked-clip"
  | "replace-selected-clip-media";

export interface PlaceGeneratedAssetInput {
  mediaId: string;
  shotId: string;
  startTime: number;
  duration: number;
  providerJobId?: string;
  policy?: GeneratedAssetPlacementPolicy;
  clipId?: string;
  idempotencyKey?: string;
}

export interface PlaceGeneratedAssetResult {
  success: boolean;
  placed: boolean;
  trackId: string;
  clipId: string;
  error?: ActionResult["error"];
  status?: "applied" | "skipped";
}

type TimedClip = Project["timeline"]["tracks"][number]["clips"][number];

export async function placeGeneratedAssetOnTimeline(
  store: GeneratedAssetPlacementStore,
  input: PlaceGeneratedAssetInput,
): Promise<PlaceGeneratedAssetResult> {
  const policy = input.policy ?? "create-linked-clip";
  const idempotencyKey =
    input.idempotencyKey ??
    `generation-placement:${input.providerJobId ?? input.mediaId}:${input.shotId}:${policy}:${input.clipId ?? ""}`;

  if (policy === "none") {
    return {
      success: true,
      placed: false,
      trackId: "",
      clipId: "",
      status: "skipped",
    };
  }

  const media = store.project.mediaLibrary.items.find((item) => item.id === input.mediaId);
  if (!media) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: {
        code: "MEDIA_NOT_FOUND",
        message: `Media with ID ${input.mediaId} not found`,
      },
    };
  }

  if (policy === "replace-selected-clip-media") {
    return replaceSelectedClipMedia(store, input, media.id, idempotencyKey);
  }

  return createLinkedClip(store, input, media, idempotencyKey);
}

async function createLinkedClip(
  store: GeneratedAssetPlacementStore,
  input: PlaceGeneratedAssetInput,
  media: Project["mediaLibrary"]["items"][number],
  idempotencyKey: string,
): Promise<PlaceGeneratedAssetResult> {
  const trackType = media.type === "video" ? "video" : media.type === "image" ? "image" : null;
  if (!trackType) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: {
        code: "INCOMPATIBLE_TYPE",
        message: "Generated timeline placement supports image and video media",
      },
    };
  }

  const assetGroupId = media.assetGroupId ?? media.id;
  const duplicate = findPlacedClip(store.project, input.shotId, assetGroupId, idempotencyKey);
  if (duplicate) {
    return {
      success: true,
      placed: false,
      trackId: duplicate.trackId,
      clipId: duplicate.clipId,
      status: "skipped",
    };
  }

  const trackResult = await findOrCreateTrack(store, trackType);
  if (!trackResult.success) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: trackResult.error,
    };
  }

  const metadata = {
    shotId: input.shotId,
    assetGroupId,
    providerJobId: input.providerJobId,
    idempotencyKey,
  };

  const clipResult = await store.addClip(trackResult.trackId, media.id, input.startTime, {
    duration: input.duration,
    type: trackType,
    metadata,
  });
  if (!clipResult.success) {
    return {
      success: false,
      placed: false,
      trackId: trackResult.trackId,
      clipId: "",
      error: clipResult.error,
    };
  }

  const clip = findCreatedClip(store.project, trackResult.trackId, media.id, input.startTime, idempotencyKey);
  if (!clip) {
    return {
      success: false,
      placed: false,
      trackId: trackResult.trackId,
      clipId: "",
      error: {
        code: "CLIP_NOT_FOUND",
        message: "Generated clip was added but could not be located",
      },
    };
  }

  return {
    success: true,
    placed: true,
    trackId: trackResult.trackId,
    clipId: clip.id,
    status: "applied",
  };
}

async function replaceSelectedClipMedia(
  store: GeneratedAssetPlacementStore,
  input: PlaceGeneratedAssetInput,
  mediaId: string,
  idempotencyKey: string,
): Promise<PlaceGeneratedAssetResult> {
  if (!input.clipId) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: {
        code: "CLIP_NOT_FOUND",
        message: "A selected clip is required for replacement",
      },
    };
  }

  const target = findClip(store.project, input.clipId);
  if (!target) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: {
        code: "CLIP_NOT_FOUND",
        message: `Clip with ID ${input.clipId} not found`,
      },
    };
  }

  if (input.shotId && target.clip.metadata?.shotId && target.clip.metadata.shotId !== input.shotId) {
    return {
      success: false,
      placed: false,
      trackId: target.track.id,
      clipId: target.clip.id,
      error: {
        code: "INVALID_PARAMS",
        message: "Selected clip does not belong to the requested shot",
      },
    };
  }

  if (target.clip.mediaId === mediaId) {
    return {
      success: true,
      placed: false,
      trackId: target.track.id,
      clipId: target.clip.id,
      status: "skipped",
    };
  }

  if (!store.replaceClipMedia) {
    return {
      success: false,
      placed: false,
      trackId: target.track.id,
      clipId: target.clip.id,
      error: {
        code: "ACTION_FAILED",
        message: "Store does not support undoable clip replacement",
      },
    };
  }

  store.beginHistoryGroup?.("Replace generated clip media");
  try {
    const result = await store.replaceClipMedia(input.clipId, mediaId, idempotencyKey);
    if (!result.success) {
      return {
        success: false,
        placed: false,
        trackId: target.track.id,
        clipId: target.clip.id,
        error: result.error,
      };
    }

    return {
      success: true,
      placed: true,
      trackId: target.track.id,
      clipId: target.clip.id,
      status: "applied",
    };
  } finally {
    store.endHistoryGroup?.();
  }
}

async function findOrCreateTrack(
  store: GeneratedAssetPlacementStore,
  trackType: "image" | "video",
): Promise<{ success: true; trackId: string } | { success: false; error: ActionResult["error"] }> {
  const existing = store.project.timeline.tracks.find((track) => track.type === trackType);
  if (existing) {
    return { success: true, trackId: existing.id };
  }

  const beforeIds = new Set(store.project.timeline.tracks.map((track) => track.id));
  const result = await store.addTrack(trackType);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const created = store.project.timeline.tracks.find(
    (track) => track.type === trackType && !beforeIds.has(track.id),
  );
  if (!created) {
    return {
      success: false,
      error: {
        code: "TRACK_NOT_FOUND",
        message: `${trackType} track was added but could not be located`,
      },
    };
  }

  return { success: true, trackId: created.id };
}

function findPlacedClip(
  project: Project,
  shotId: string,
  assetGroupId: string,
  idempotencyKey: string,
): { trackId: string; clipId: string } | null {
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.metadata?.idempotencyKey === idempotencyKey) {
        return { trackId: track.id, clipId: clip.id };
      }
    }
  }

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.metadata?.shotId === shotId && clip.metadata?.assetGroupId === assetGroupId) {
        return { trackId: track.id, clipId: clip.id };
      }
    }
  }

  return null;
}

function findCreatedClip(
  project: Project,
  trackId: string,
  mediaId: string,
  startTime: number,
  idempotencyKey: string,
): TimedClip | null {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    return null;
  }

  return (
    track.clips.find(
      (clip) =>
        clip.metadata?.idempotencyKey === idempotencyKey &&
        clip.mediaId === mediaId &&
        clip.startTime === startTime,
    ) ??
    track.clips.find(
      (clip) =>
        clip.mediaId === mediaId &&
        clip.startTime === startTime &&
        clip.metadata?.idempotencyKey === idempotencyKey,
    ) ??
    null
  );
}

function findClip(
  project: Project,
  clipId: string,
): { clip: TimedClip; track: Track } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return { clip, track };
    }
  }
  return null;
}
