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
}

export interface PlaceGeneratedAssetInput {
  mediaId: string;
  shotId: string;
  startTime: number;
  duration: number;
  providerJobId?: string;
}

export interface PlaceGeneratedAssetResult {
  success: boolean;
  placed: boolean;
  trackId: string;
  clipId: string;
  error?: ActionResult["error"];
}

export async function placeGeneratedAssetOnTimeline(
  store: GeneratedAssetPlacementStore,
  input: PlaceGeneratedAssetInput,
): Promise<PlaceGeneratedAssetResult> {
  const media = store.project.mediaLibrary.items.find((item) => item.id === input.mediaId);
  if (!media) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: { code: "MEDIA_NOT_FOUND", message: `Media with ID ${input.mediaId} not found` },
    };
  }

  const trackType = media.type === "video" ? "video" : media.type === "image" ? "image" : null;
  if (!trackType) {
    return {
      success: false,
      placed: false,
      trackId: "",
      clipId: "",
      error: { code: "INCOMPATIBLE_TYPE", message: "Generated timeline placement supports image and video media" },
    };
  }

  const assetGroupId = media.assetGroupId ?? media.id;
  const duplicate = findPlacedClip(store.project, input.shotId, assetGroupId);
  if (duplicate) {
    return { success: true, placed: false, trackId: duplicate.trackId, clipId: duplicate.clipId };
  }

  const trackResult = await findOrCreateTrack(store, trackType);
  if (!trackResult.success) {
    return { success: false, placed: false, trackId: "", clipId: "", error: trackResult.error };
  }

  const metadata = {
    shotId: input.shotId,
    assetGroupId,
    providerJobId: input.providerJobId,
  };
  const clipResult = await store.addClip(trackResult.trackId, media.id, input.startTime, {
    duration: input.duration,
    type: trackType,
    metadata,
  });
  if (!clipResult.success) {
    return { success: false, placed: false, trackId: trackResult.trackId, clipId: "", error: clipResult.error };
  }

  const clip = store.project.timeline.tracks
    .find((track) => track.id === trackResult.trackId)
    ?.clips.find(
      (candidate) =>
        candidate.mediaId === media.id &&
        candidate.startTime === input.startTime &&
        candidate.metadata?.shotId === input.shotId,
    );

  if (!clip) {
    return {
      success: false,
      placed: false,
      trackId: trackResult.trackId,
      clipId: "",
      error: { code: "CLIP_NOT_FOUND", message: "Generated clip was added but could not be located" },
    };
  }

  return { success: true, placed: true, trackId: trackResult.trackId, clipId: clip.id };
}

async function findOrCreateTrack(
  store: GeneratedAssetPlacementStore,
  trackType: "image" | "video",
): Promise<{ success: true; trackId: string } | { success: false; error: ActionResult["error"] }> {
  const existing = store.project.timeline.tracks.find((track) => track.type === trackType);
  if (existing) return { success: true, trackId: existing.id };

  const beforeIds = new Set(store.project.timeline.tracks.map((track) => track.id));
  const result = await store.addTrack(trackType);
  if (!result.success) return { success: false, error: result.error };

  const created = store.project.timeline.tracks.find(
    (track) => track.type === trackType && !beforeIds.has(track.id),
  );
  if (!created) {
    return {
      success: false,
      error: { code: "TRACK_NOT_FOUND", message: `${trackType} track was added but could not be located` },
    };
  }
  return { success: true, trackId: created.id };
}

function findPlacedClip(project: Project, shotId: string, assetGroupId: string): { trackId: string; clipId: string } | null {
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.metadata?.shotId === shotId && clip.metadata?.assetGroupId === assetGroupId) {
        return { trackId: track.id, clipId: clip.id };
      }
    }
  }
  return null;
}
