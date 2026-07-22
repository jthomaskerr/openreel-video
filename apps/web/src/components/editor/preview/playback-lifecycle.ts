export interface PlaybackCleanupPositionInput {
  completed: boolean;
  startPosition: number;
  clockIsActive: boolean;
  clockPosition: number;
}

export function resolvePlaybackCleanupPosition({
  completed,
  startPosition,
  clockIsActive,
  clockPosition,
}: PlaybackCleanupPositionInput): number {
  if (completed) return startPosition;
  return clockIsActive ? clockPosition : startPosition;
}

const PLAYBACK_END_TOLERANCE_SECONDS = 0.001;

export function shouldInitializeDecodedVideo(
  mediaType: "video" | "audio" | "image" | "srt" | undefined,
): boolean {
  return mediaType === "video";
}

interface PlaybackStopPositionInput {
  revertToSessionStart: boolean;
  sessionStart: number;
  stoppedPosition: number;
}

interface PlaybackSessionStartInput {
  requestedPosition: number;
  timelineEnd: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
}

export function isValidLoopRange(loopStart: number, loopEnd: number): boolean {
  return Number.isFinite(loopStart)
    && Number.isFinite(loopEnd)
    && loopStart >= 0
    && loopEnd - loopStart > PLAYBACK_END_TOLERANCE_SECONDS;
}

export function resolvePlaybackStopPosition({
  revertToSessionStart,
  sessionStart,
  stoppedPosition,
}: PlaybackStopPositionInput): number {
  const resolved = revertToSessionStart ? sessionStart : stoppedPosition;
  return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
}

export function resolvePlaybackSessionStart({
  requestedPosition,
  timelineEnd,
  loopEnabled,
  loopStart,
  loopEnd,
}: PlaybackSessionStartInput): number {
  const requested = Number.isFinite(requestedPosition)
    ? Math.max(0, requestedPosition)
    : 0;

  if (loopEnabled && isValidLoopRange(loopStart, loopEnd)) {
    const isOutsideLoop = requested < loopStart
      || requested >= loopEnd - PLAYBACK_END_TOLERANCE_SECONDS;
    return isOutsideLoop ? loopStart : requested;
  }

  if (
    timelineEnd > 0
    && requested >= timelineEnd - PLAYBACK_END_TOLERANCE_SECONDS
  ) {
    return 0;
  }

  return requested;
}
