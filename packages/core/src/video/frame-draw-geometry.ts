import type { Transform } from "../types/timeline";

interface FrameDrawGeometryInput {
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  fitMode: Transform["fitMode"];
  anchor: Transform["anchor"];
}

export interface FrameDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function calculateFrameDrawRect({
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
  fitMode,
  anchor,
}: FrameDrawGeometryInput): FrameDrawRect {
  const resolvedFitMode = !fitMode || fitMode === "none" ? "contain" : fitMode;
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  let width = sourceWidth;
  let height = sourceHeight;

  if (resolvedFitMode === "stretch") {
    width = canvasWidth;
    height = canvasHeight;
  } else if (resolvedFitMode === "cover") {
    if (sourceAspect > canvasAspect) {
      height = canvasHeight;
      width = canvasHeight * sourceAspect;
    } else {
      width = canvasWidth;
      height = canvasWidth / sourceAspect;
    }
  } else if (sourceAspect > canvasAspect) {
    width = canvasWidth;
    height = canvasWidth / sourceAspect;
  } else {
    height = canvasHeight;
    width = canvasHeight * sourceAspect;
  }

  return {
    x: -width * anchor.x,
    y: -height * anchor.y,
    width,
    height,
  };
}
