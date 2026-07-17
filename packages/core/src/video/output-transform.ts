import type { Transform } from "../types/timeline";

/**
 * Maps project-space pixel offsets into the target output coordinate space.
 * Clip scale is dimensionless and must not be multiplied by output resolution.
 */
export function mapTransformToOutput(
  transform: Transform,
  projectWidth: number,
  projectHeight: number,
  targetWidth: number,
  targetHeight: number,
): Transform {
  return {
    ...transform,
    position: {
      x: (transform.position.x * targetWidth) / projectWidth,
      y: (transform.position.y * targetHeight) / projectHeight,
    },
    scale: { ...transform.scale },
  };
}
