import { describe, expect, it } from "vitest";
import {
  applyClipAmplitude,
  downsampleSignedChannels,
  selectWaveformResolution,
  sliceClipChannels,
  type TimelineWaveformData,
  type TimelineWaveformResolution,
} from "./TimelineWaveform";

const waveform: TimelineWaveformResolution = {
  channels: [
    new Float32Array([-0.1, 0.2, -0.3, 0.4, -0.5, 0.6, -0.7, 0.8, -0.9, 1]),
    new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8, 0.9, -1]),
  ],
  samplesPerSecond: 10,
};

describe("sliceClipChannels", () => {
  it("selects the exact trimmed source range for every decoded channel", () => {
    const channels = sliceClipChannels(
      waveform,
      { inPoint: 0.2, outPoint: 0.6, reversed: false },
    );

    expect([...channels[0]]).toEqual([
      expect.closeTo(-0.3),
      expect.closeTo(0.4),
      expect.closeTo(-0.5),
      expect.closeTo(0.6),
    ]);
    expect([...channels[1]]).toEqual([
      expect.closeTo(0.3),
      expect.closeTo(-0.4),
      expect.closeTo(0.5),
      expect.closeTo(-0.6),
    ]);
  });

  it("reverses every displayed source channel", () => {
    const channels = sliceClipChannels(
      waveform,
      { inPoint: 0.2, outPoint: 0.6, reversed: true },
    );

    expect(channels[0][0]).toBeCloseTo(0.6);
    expect(channels[0].at(-1)).toBeCloseTo(-0.3);
    expect(channels[1][0]).toBeCloseTo(-0.6);
    expect(channels[1].at(-1)).toBeCloseTo(0.3);
  });
});

describe("downsampleSignedChannels", () => {
  it("preserves the signed sample with the greatest magnitude in each bucket", () => {
    const channels = downsampleSignedChannels(
      [new Float32Array([0.1, -0.8, 0.7, 0.2, -0.4, 0.3])],
      6,
      2,
    );

    expect([...channels[0]]).toEqual([
      expect.closeTo(-0.8),
      expect.closeTo(-0.4),
    ]);
  });
});

describe("applyClipAmplitude", () => {
  it("updates waveform height for clip gain and fades", () => {
    const [channel] = applyClipAmplitude(
      [new Float32Array([1, 1, 1, 1, 1])],
      {
        duration: 1,
        volume: 0.5,
        muted: false,
        fade: { fadeIn: 0.25, fadeOut: 0.25 },
      },
    );

    expect([...channel]).toEqual([
      expect.closeTo(0),
      expect.closeTo(0.5),
      expect.closeTo(0.5),
      expect.closeTo(0.5),
      expect.closeTo(0),
    ]);
  });

  it("uses the same absolute volume automation interpolation as audio playback", () => {
    const [channel] = applyClipAmplitude(
      [new Float32Array([1, 1, 1])],
      {
        duration: 1,
        volume: 0.25,
        muted: false,
        automation: {
          volume: [
            { time: 0, value: 1 },
            { time: 1, value: 0.5 },
          ],
        },
      },
    );

    expect([...channel]).toEqual([
      expect.closeTo(1),
      expect.closeTo(0.75),
      expect.closeTo(0.5),
    ]);
  });

  it("renders muted clips at zero amplitude", () => {
    const [channel] = applyClipAmplitude(
      [new Float32Array([0.5, -0.5])],
      { duration: 1, volume: 1, muted: true },
    );

    expect([...channel]).toEqual([0, -0]);
  });

  it("clips boosted peaks before WaveSurfer can renormalize the whole waveform", () => {
    const [channel] = applyClipAmplitude(
      [new Float32Array([0.8, -0.25])],
      { duration: 1, volume: 2, muted: false },
    );

    expect([...channel]).toEqual([
      expect.closeTo(1),
      expect.closeTo(-0.5),
    ]);
  });
});

describe("selectWaveformResolution", () => {
  it("only moves to higher-resolution peaks as timeline zoom increases", () => {
    const resolutions = new Map([10, 100, 500, 1_000].map((samplesPerSecond) => [
      samplesPerSecond,
      { ...waveform, samplesPerSecond },
    ]));
    const multiResolution: TimelineWaveformData = { duration: 1, resolutions };

    expect(selectWaveformResolution(multiResolution, 20)?.samplesPerSecond).toBe(100);
    expect(selectWaveformResolution(multiResolution, 100)?.samplesPerSecond).toBe(500);
    expect(selectWaveformResolution(multiResolution, 500)?.samplesPerSecond).toBe(1_000);
  });
});
