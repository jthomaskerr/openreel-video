import { describe, expect, it } from "vitest";
import { resolveTransportAudioTiming } from "./transport-audio-timing";

describe("resolveTransportAudioTiming", () => {
  it("converts timeline timing into source and wall-clock timing", () => {
    expect(resolveTransportAudioTiming({
      clipSpeed: 1.5,
      transportRate: 2,
      timelineOffset: 3,
      timelineDuration: 5,
      timelineDelay: 4,
    })).toEqual({
      sourcePlaybackRate: 3,
      sourceOffset: 4.5,
      sourceDuration: 7.5,
      contextDelay: 2,
    });
  });

  it("clamps invalid rates without producing non-finite scheduling values", () => {
    expect(resolveTransportAudioTiming({
      clipSpeed: Number.NaN,
      transportRate: 0,
      timelineOffset: -2,
      timelineDuration: Number.POSITIVE_INFINITY,
      timelineDelay: -1,
    })).toEqual({
      sourcePlaybackRate: 0.1,
      sourceOffset: 0,
      sourceDuration: 0,
      contextDelay: 0,
    });
  });
});
