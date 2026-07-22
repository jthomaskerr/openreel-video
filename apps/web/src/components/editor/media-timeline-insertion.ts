import { canAcceptMediaType, type MediaItem, type Track } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

type CompatibleTrackType = Extract<
  Track["type"],
  "video" | "audio" | "image" | "subtitle"
>;

export function getDefaultTrackType(mediaType: MediaItem["type"]): CompatibleTrackType {
  if (mediaType === "audio") return "audio";
  if (mediaType === "image") return "image";
  if (mediaType === "srt") return "subtitle";
  return "video";
}

export function isCompatibleInsertionTrack(
  track: Track | undefined,
  mediaType: MediaItem["type"],
): track is Track {
  return Boolean(track && !track.locked && canAcceptMediaType(track, mediaType));
}

/** Insert a Media-pane item at the timeline position visible when the action starts. */
export type MediaInsertionResult =
  | {
      success: true;
      mediaId: string;
      trackId: string;
      clipId: string;
      startTime: number;
    }
  | {
      success: false;
      stage: "resolve-media" | "resolve-track" | "create-track" | "create-clip";
      mediaId: string;
      trackId?: string;
      message: string;
    };

export async function insertMediaAtCurrentTime(
  mediaId: string,
): Promise<MediaInsertionResult> {
  const timelineState = useTimelineStore.getState();
  const capturedTime = timelineState.isScrubbing && timelineState.scrubPosition !== null
    ? timelineState.scrubPosition
    : timelineState.playheadPosition;
  const projectState = useProjectStore.getState();
  const mediaItem = projectState.getMediaItem(mediaId);
  if (!mediaItem) {
    return {
      success: false,
      stage: "resolve-media",
      mediaId,
      message: `Media ${mediaId} is no longer available. Relink or re-import it and try again.`,
    };
  }

  const trackType = getDefaultTrackType(mediaItem.type);
  const uiState = useUIStore.getState();
  let targetTrack = projectState.project.timeline.tracks.find(
    (track) => track.id === uiState.activeTrackId,
  );

  if (!isCompatibleInsertionTrack(targetTrack, mediaItem.type)) {
    targetTrack = projectState.project.timeline.tracks.find((track) =>
      isCompatibleInsertionTrack(track, mediaItem.type),
    );
  }

  if (!targetTrack) {
    const previousTrackIds = new Set(
      projectState.project.timeline.tracks.map((track) => track.id),
    );
    const result = await projectState.addTrack(trackType);
    if (!result.success) {
      return {
        success: false,
        stage: "create-track",
        mediaId,
        message: result.error?.message ?? `Could not create a ${trackType} track.`,
      };
    }

    targetTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find(
        (track) =>
          !previousTrackIds.has(track.id) &&
          isCompatibleInsertionTrack(track, mediaItem.type),
      );
    if (!targetTrack) {
      return {
        success: false,
        stage: "resolve-track",
        mediaId,
        message: `The new ${trackType} track could not be resolved. Try adding a track manually.`,
      };
    }
  }

  const targetTrackId = targetTrack.id;
  const previousClipIds = new Set(
    targetTrack.clips.map((clip) => clip.id),
  );
  const result = await useProjectStore
    .getState()
    .addClip(targetTrackId, mediaId, capturedTime);
  if (!result.success) {
    return {
      success: false,
      stage: "create-clip",
      mediaId,
      trackId: targetTrackId,
      message: result.error?.message ?? "Could not add the media clip to the timeline.",
    };
  }

  const insertedClip = useProjectStore
    .getState()
    .project.timeline.tracks.find((track) => track.id === targetTrackId)
    ?.clips.find((clip) => !previousClipIds.has(clip.id));
  if (!insertedClip) {
    return {
      success: false,
      stage: "create-clip",
      mediaId,
      trackId: targetTrackId,
      message: "The timeline accepted the operation but the new clip could not be found.",
    };
  }
  useUIStore.getState().setActiveTrack(targetTrackId);
  useUIStore.getState().select({
    id: insertedClip.id,
    type: "clip",
    trackId: targetTrackId,
  });
  return {
    success: true,
    mediaId,
    trackId: targetTrackId,
    clipId: insertedClip.id,
    startTime: capturedTime,
  };
}
