import { canAcceptMediaType, type MediaItem, type Track } from "@openreel/core";

export type TimelineMediaType = MediaItem["type"];

export interface PointerTimelineCoordinates {
  clientX: number;
  viewportLeft: number;
  scrollLeft: number;
  pixelsPerSecond: number;
}

export function pointerToTimelineTime({
  clientX,
  viewportLeft,
  scrollLeft,
  pixelsPerSecond,
}: PointerTimelineCoordinates): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  const contentX = clientX - viewportLeft + scrollLeft;
  return Math.max(0, contentX / pixelsPerSecond);
}

export function isMediaCompatibleWithTrack(
  mediaType: TimelineMediaType,
  trackType: Track["type"],
): boolean {
  return canAcceptMediaType({ type: trackType }, mediaType);
}

export function getMediaDropRejection(
  track: Pick<Track, "locked" | "type">,
  mediaType: TimelineMediaType,
): string | null {
  if (track.locked) return "Track is locked";
  if (!isMediaCompatibleWithTrack(mediaType, track.type)) {
    return `${mediaType === "srt" ? "Subtitle" : mediaType} media is not compatible with this track`;
  }
  return null;
}
