import { describe, expect, it } from "vitest";
import {
  WAVESPEED_GENERATION_V2_RELEASE_ENABLED,
  isWaveSpeedGenerationV2Available,
} from "./feature-flag";

describe("WaveSpeed generation V2 release flag", () => {
  it("stays disabled until the independent release gate passes", () => {
    expect(WAVESPEED_GENERATION_V2_RELEASE_ENABLED).toBe(false);
    expect(isWaveSpeedGenerationV2Available(true)).toBe(false);
    expect(isWaveSpeedGenerationV2Available(false)).toBe(false);
  });
});
