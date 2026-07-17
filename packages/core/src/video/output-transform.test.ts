import { describe, expect, it } from "vitest";
import type { Transform } from "../types/timeline";
import { mapTransformToOutput } from "./output-transform";

const makeTransform = (overrides: Partial<Transform> = {}): Transform => ({
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  ...overrides,
});

describe("mapTransformToOutput", () => {
  it("scales project-space position but preserves semantic clip scale at 480p", () => {
    const mapped = mapTransformToOutput(
      makeTransform({
        position: { x: 100, y: 50 },
        scale: { x: 1, y: 1 },
      }),
      1920,
      1080,
      854,
      480,
    );

    expect(mapped.position.x).toBeCloseTo((100 * 854) / 1920, 6);
    expect(mapped.position.y).toBeCloseTo((50 * 480) / 1080, 6);
    expect(mapped.scale).toEqual({ x: 1, y: 1 });
  });

  it("preserves intentional zoom independently of output resolution", () => {
    const mapped = mapTransformToOutput(
      makeTransform({ scale: { x: 1.25, y: 0.8 } }),
      1920,
      1080,
      854,
      480,
    );

    expect(mapped.scale).toEqual({ x: 1.25, y: 0.8 });
  });
});
