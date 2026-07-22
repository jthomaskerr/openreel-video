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
