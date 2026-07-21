import { describe, expect, it } from "vitest";
import * as browserWaveSpeedApi from "./index";

describe("WaveSpeed browser boundary", () => {
  it("exports types only so no parallel submit, poll, or model API can bypass the production runtime", () => {
    expect(Object.keys(browserWaveSpeedApi)).toEqual([]);
  });
});
