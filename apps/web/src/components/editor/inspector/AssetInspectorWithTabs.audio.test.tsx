import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem } from "@openreel/core";

const wavesurferMock = vi.hoisted(() => {
  const instance = {
    on: vi.fn(),
    playPause: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    instance,
    create: vi.fn(() => instance),
  };
});

vi.mock("wavesurfer.js", () => ({
  default: {
    create: wavesurferMock.create,
  },
}));

import { AssetInspectorWithTabs } from "./AssetInspectorWithTabs";

type AudioFixtureItem = MediaItem & {
  waveformData?: Float32Array;
};

function makeAudioItem(overrides: Partial<AudioFixtureItem> = {}): AudioFixtureItem {
  return {
    id: "audio-1",
    name: "song.wav",
    type: "audio",
    fileHandle: null,
    blob: new Blob(["audio"], { type: "audio/wav" }),
    metadata: {
      duration: 125,
      width: 0,
      height: 0,
      frameRate: 0,
      codec: "pcm_s16le",
      sampleRate: 44100,
      channels: 2,
      fileSize: 2048,
      bpm: 128,
      key: "C",
      scale: "minor",
      has_lyrics: true,
    } as MediaItem["metadata"],
    thumbnailUrl: null,
    waveformData: new Float32Array([0.1, 0.4, 0.8, 0.2]),
    ...overrides,
  };
}

describe("AssetInspectorWithTabs audio tab", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows both Audio and File tabs for audio assets", () => {
    render(<AssetInspectorWithTabs item={makeAudioItem()} />);

    expect(screen.getByRole("tab", { name: /Audio/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /File/ })).toBeInTheDocument();
  });

  it("shows waveform playback in preview and audio analysis in Audio tab", () => {
    render(<AssetInspectorWithTabs item={makeAudioItem()} />);

    // Waveform and play controls are in the preview area (always visible)
    expect(screen.getByRole("button", { name: /Play audio preview/ })).toBeInTheDocument();
    expect(screen.getByTestId("audio-waveform")).toBeInTheDocument();

    // Audio analysis fields require Audio tab
    fireEvent.click(screen.getByRole("tab", { name: /Audio/ }));
    expect(screen.getByText("128 BPM")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("minor")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("configures click seeking, progress highlighting, and play control", () => {
    render(<AssetInspectorWithTabs item={makeAudioItem({ blob: null, originalUrl: "https://cdn.example.test/song.wav" })} />);

    fireEvent.click(screen.getByRole("button", { name: /Play audio preview/ }));

    expect(wavesurferMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dragToSeek: true,
        progressColor: "rgb(34, 197, 94)",
        peaks: [expect.any(Float32Array)],
      }),
    );
    expect(wavesurferMock.instance.playPause).toHaveBeenCalledTimes(1);
  });

  it("keeps the inspector mounted when waveform initialization throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    wavesurferMock.create.mockImplementationOnce(() => {
      throw new TypeError("bad waveform data");
    });

    render(<AssetInspectorWithTabs item={makeAudioItem({ originalUrl: "https://cdn.example.test/song.wav" })} />);

    expect(await screen.findByText("Audio preview unavailable")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Audio/ })).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      "[WaveformPreview] Failed to initialize waveform",
      expect.any(TypeError),
    );
    warnSpy.mockRestore();
  });

  it("ignores malformed persisted waveform data instead of passing it to WaveSurfer", async () => {
    render(
      <AssetInspectorWithTabs
        item={makeAudioItem({
          originalUrl: "https://cdn.example.test/song.wav",
          waveformData: { 0: 0.1, 1: "bad" } as unknown as Float32Array,
        })}
      />,
    );

    await waitFor(() => expect(wavesurferMock.create).toHaveBeenCalled());
    expect(wavesurferMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        peaks: undefined,
      }),
    );
  });
});
