import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import { createMetadataMedia, type MetadataKind } from "./metadata-media";

export interface MetadataClipStore {
  readonly project: Project;
  addTrack: (trackType: Track["type"], position?: number) => Promise<ActionResult>;
  renameTrack: (trackId: string, name: string) => void;
  addGeneratedMedia: (item: MediaItem, blob: Blob) => Promise<ActionResult>;
  addClip: (
    trackId: string,
    mediaId: string,
    startTime: number,
    options?: { duration?: number; metadata?: Record<string, unknown> },
  ) => Promise<ActionResult>;
}

export interface AddTimelineMetadataClipInput {
  trackName: string;
  kind: MetadataKind;
  label: string;
  color: string;
  startTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface AddTimelineMetadataClipResult {
  success: boolean;
  trackId: string;
  mediaId: string;
  clipId: string;
  error?: ActionResult["error"];
}

export async function addTimelineMetadataClip(
  store: MetadataClipStore,
  input: AddTimelineMetadataClipInput,
): Promise<AddTimelineMetadataClipResult> {
  const trackResult = await findOrCreateMetadataTrack(store, input.trackName);
  if (!trackResult.success) {
    return { success: false, trackId: "", mediaId: "", clipId: "", error: trackResult.error };
  }

  const metadataMedia = createMetadataMedia({
    kind: input.kind,
    label: input.label,
    color: input.color,
    duration: input.duration,
  });

  const mediaResult = await store.addGeneratedMedia(metadataMedia.item, metadataMedia.blob);
  if (!mediaResult.success) {
    return {
      success: false,
      trackId: trackResult.trackId,
      mediaId: metadataMedia.item.id,
      clipId: "",
      error: mediaResult.error,
    };
  }

  const payload = input.metadata ?? {};
  const clipMetadata = {
    ...payload,
    kind: input.kind,
    label: input.label,
    color: input.color,
    payload,
  };

  const clipResult = await store.addClip(trackResult.trackId, metadataMedia.item.id, input.startTime, {
    duration: input.duration,
    metadata: clipMetadata,
  });
  if (!clipResult.success) {
    return {
      success: false,
      trackId: trackResult.trackId,
      mediaId: metadataMedia.item.id,
      clipId: "",
      error: clipResult.error,
    };
  }

  const clipId = findCreatedClipId(store.project, trackResult.trackId, metadataMedia.item.id, input.startTime);
  if (!clipId) {
    return {
      success: false,
      trackId: trackResult.trackId,
      mediaId: metadataMedia.item.id,
      clipId: "",
      error: {
        code: "CLIP_NOT_FOUND",
        message: "Metadata clip was added but could not be located",
      },
    };
  }

  return {
    success: true,
    trackId: trackResult.trackId,
    mediaId: metadataMedia.item.id,
    clipId,
  };
}

async function findOrCreateMetadataTrack(
  store: MetadataClipStore,
  trackName: string,
): Promise<{ success: true; trackId: string } | { success: false; error: ActionResult["error"] }> {
  const existing = store.project.timeline.tracks.find(
    (track) => track.type === "metadata" && track.name === trackName,
  );
  if (existing) {
    return { success: true, trackId: existing.id };
  }

  const beforeIds = new Set(store.project.timeline.tracks.map((track) => track.id));
  const addResult = await store.addTrack("metadata");
  if (!addResult.success) {
    return { success: false, error: addResult.error };
  }

  const created = store.project.timeline.tracks.find(
    (track) => track.type === "metadata" && !beforeIds.has(track.id),
  );
  if (!created) {
    return {
      success: false,
      error: {
        code: "TRACK_NOT_FOUND",
        message: "Metadata track was added but could not be located",
      },
    };
  }

  store.renameTrack(created.id, trackName);
  return { success: true, trackId: created.id };
}

function findCreatedClipId(
  project: Project,
  trackId: string,
  mediaId: string,
  startTime: number,
): string | null {
  const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
  const clip = track?.clips.find(
    (candidate) => candidate.mediaId === mediaId && candidate.startTime === startTime,
  );
  return clip?.id ?? null;
}
