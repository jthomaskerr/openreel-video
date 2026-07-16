export const EMPTY_PLAYBACK_BACKGROUND = "#000000";

export function shouldDrawLastGoodFrame(
  hasActiveMediaClip: boolean,
  hasLastGoodFrame: boolean,
): boolean {
  return hasActiveMediaClip && hasLastGoodFrame;
}

export function paintPlaybackBackground(
  context: Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect">,
  width: number,
  height: number,
  hasActiveMediaFrame: boolean,
  mediaBackground: string,
): void {
  context.fillStyle = hasActiveMediaFrame
    ? mediaBackground
    : EMPTY_PLAYBACK_BACKGROUND;
  context.fillRect(0, 0, width, height);
}
