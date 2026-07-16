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
export async function insertMediaAtCurrentTime(mediaId: string): Promise<void> {
  const timelineState = useTimelineStore.getState();
  const capturedTime = timelineState.isScrubbing && timelineState.scrubPosition !== null
    ? timelineState.scrubPosition
    : timelineState.playheadPosition;
  const projectState = useProjectStore.getState();
  const mediaItem = projectState.getMediaItem(mediaId);
  if (!mediaItem) return;

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
    if (!result.success) return;

    targetTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find(
        (track) =>
          !previousTrackIds.has(track.id) &&
          isCompatibleInsertionTrack(track, mediaItem.type),
      );
    if (!targetTrack) return;
  }

  useUIStore.getState().setActiveTrack(targetTrack.id);
  const previousClipIds = new Set(
    targetTrack.clips.map((clip) => clip.id),
  );
  const result = await useProjectStore
    .getState()
    .addClip(targetTrack.id, mediaId, capturedTime);
  if (!result.success) return;

  const insertedClip = useProjectStore
    .getState()
    .project.timeline.tracks.find((track) => track.id === targetTrack.id)
    ?.clips.find((clip) => !previousClipIds.has(clip.id));
  if (insertedClip) {
    useUIStore.getState().select({
      id: insertedClip.id,
      type: "clip",
      trackId: targetTrack.id,
    });
  }
}
