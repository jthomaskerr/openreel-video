import { describe, expect, it } from "vitest";
import { calculateFrameDrawRect } from "./frame-draw-geometry";

describe("calculateFrameDrawRect", () => {
  it("fills a same-aspect 480p output at semantic scale 1", () => {
    const rect = calculateFrameDrawRect({
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasWidth: 854,
      canvasHeight: 480,
      fitMode: "contain",
      anchor: { x: 0.5, y: 0.5 },
    });
    expect(rect.height).toBe(480);
    expect(rect.width).toBeCloseTo(853.33, 1);
    expect(rect.x).toBeCloseTo(-426.67, 1);
    expect(rect.y).toBe(-240);
  });

  it("letterboxes portrait media without shrinking the landscape axis twice", () => {
    expect(
      calculateFrameDrawRect({
        sourceWidth: 1080,
        sourceHeight: 1920,
        canvasWidth: 854,
        canvasHeight: 480,
        fitMode: "contain",
        anchor: { x: 0.5, y: 0.5 },
      }),
    ).toEqual({ x: -135, y: -240, width: 270, height: 480 });
  });
});
