import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project, Subtitle } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";

// Radix Select relies on pointer-capture APIs and scrollIntoView that jsdom
// does not implement. Polyfill them so opening/selecting options works.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function openSelectAndChoose(triggerName: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = screen.getByRole("option", { name: optionName });
  fireEvent.click(option);
}

const transcriptionServiceMock = vi.hoisted(() => ({
  transcribeClip: vi.fn(),
}));

vi.mock("@openreel/core", async () => {
  const actual = await vi.importActual<typeof import("@openreel/core")>(
    "@openreel/core",
  );
  return {
    ...actual,
    initializeTranscriptionService: vi.fn(() => transcriptionServiceMock),
    SpeechToTextEngine: {
      ...actual.SpeechToTextEngine,
      isSupported: () => true,
      getSupportedLanguages: () => [
        { code: "en-US", name: "English (US)" },
      ],
    },
  };
});

import { AutoCaptionPanel } from "./AutoCaptionPanel";

const videoClipId = "clip-video-1";
const videoTrackId = "track-video-1";
const audioClipId = "clip-audio-1";
const audioTrackId = "track-audio-1";
const imageClipId = "clip-image-1";
const imageTrackId = "track-image-1";

function makeSubtitle(overrides: Partial<Subtitle> = {}): Subtitle {
  return {
    id: "sub-1",
    text: "hello world",
    startTime: 0,
    endTime: 1,
    ...overrides,
  };
}

function seedProjectWithClip(opts: {
  clipId: string;
  trackId: string;
  mediaId: string;
  clipType: "video" | "audio" | "image";
  trackType: "video" | "audio" | "image";
}): Project {
  const base = createEmptyProject("Auto Caption Test");
  const seeded: Project = {
    ...base,
    timeline: {
      ...base.timeline,
      duration: 10,
      tracks: [
        {
          id: opts.trackId,
          type: opts.trackType,
          name: "Track",
          clips: [
            {
              id: opts.clipId,
              type: opts.clipType,
              mediaId: opts.mediaId,
              trackId: opts.trackId,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              audioEffects: [],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
  useProjectStore.setState({ project: seeded });
  return seeded;
}

function addMediaItem(
  project: Project,
  overrides: { id: string; type: "video" | "audio" | "image"; blob?: Blob | null; fileHandle?: FileSystemFileHandle | null },
) {
  const updated: Project = {
    ...project,
    mediaLibrary: {
      items: [
        ...project.mediaLibrary.items,
        {
          id: overrides.id,
          name: `${overrides.id}.mp4`,
          type: overrides.type,
          fileHandle: overrides.fileHandle ?? null,
          blob: overrides.blob === undefined ? new Blob(["x"], { type: "video/mp4" }) : overrides.blob,
          metadata: {
            duration: 10,
            width: 1920,
            height: 1080,
            frameRate: 30,
            codec: "h264",
            sampleRate: 48000,
            channels: 2,
            fileSize: 1024,
          },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
  };
  useProjectStore.setState({ project: updated });
  return updated;
}

function selectClip(clipId: string, trackId: string) {
  useUIStore.getState().select({ type: "clip", id: clipId, trackId });
}

describe("AutoCaptionPanel — selected clip transcription", () => {
  beforeEach(() => {
    transcriptionServiceMock.transcribeClip.mockReset();
  });

  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("defaults to microphone mode when no clip is selected and shows guidance when switched to selected-clip", () => {
    render(<AutoCaptionPanel />);

    // Microphone mode is the default entry point when nothing is selected.
    expect(
      screen.getByRole("button", { name: /Start Recording/ }),
    ).toBeInTheDocument();

    openSelectAndChoose(/Caption Source/, /Selected Clip/);

    expect(
      screen.getByText(
        /Select an audio or video clip in the timeline to generate captions/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Generate Captions/ }),
    ).toBeDisabled();
  });

  it("defaults to selected-clip mode and enables Generate Captions for a selected video clip", () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video" });
    selectClip(videoClipId, videoTrackId);

    render(<AutoCaptionPanel />);

    const generateButton = screen.getByRole("button", {
      name: /Generate Captions/,
    });
    expect(generateButton).not.toBeDisabled();
  });

  it("defaults to selected-clip mode and enables Generate Captions for a selected audio clip", () => {
    const project = seedProjectWithClip({
      clipId: audioClipId,
      trackId: audioTrackId,
      mediaId: "media-audio-1",
      clipType: "audio",
      trackType: "audio",
    });
    addMediaItem(project, { id: "media-audio-1", type: "audio" });
    selectClip(audioClipId, audioTrackId);

    render(<AutoCaptionPanel />);

    const generateButton = screen.getByRole("button", {
      name: /Generate Captions/,
    });
    expect(generateButton).not.toBeDisabled();
  });

  it("shows wrong-type guidance and disables Generate for a non-audio/video clip", () => {
    const project = seedProjectWithClip({
      clipId: imageClipId,
      trackId: imageTrackId,
      mediaId: "media-image-1",
      clipType: "image",
      trackType: "image",
    });
    addMediaItem(project, { id: "media-image-1", type: "image" });
    selectClip(imageClipId, imageTrackId);

    render(<AutoCaptionPanel />);

    // Non-audio/video selections default to microphone mode; switch manually
    // to selected-clip mode to see the wrong-type guidance.
    openSelectAndChoose(/Caption Source/, /Selected Clip/);

    expect(
      screen.getByText(/Selected clip does not contain audio/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Generate Captions/ }),
    ).toBeDisabled();
  });

  it("calls transcribeClip and addSubtitle for each returned subtitle on success", async () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video" });
    selectClip(videoClipId, videoTrackId);

    const subtitles = [makeSubtitle({ id: "s1" }), makeSubtitle({ id: "s2" })];
    transcriptionServiceMock.transcribeClip.mockResolvedValue(subtitles);

    const addSubtitleSpy = vi.spyOn(useProjectStore.getState(), "addSubtitle");

    render(<AutoCaptionPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Captions/ }));

    await waitFor(() => {
      expect(transcriptionServiceMock.transcribeClip).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(addSubtitleSpy).toHaveBeenCalledTimes(2);
    });
    expect(addSubtitleSpy).toHaveBeenCalledWith(subtitles[0]);
    expect(addSubtitleSpy).toHaveBeenCalledWith(subtitles[1]);
  });

  it("applies the selected style preset when non-default after success", async () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video" });
    selectClip(videoClipId, videoTrackId);

    transcriptionServiceMock.transcribeClip.mockResolvedValue([
      makeSubtitle(),
    ]);

    const applyPresetSpy = vi
      .spyOn(useProjectStore.getState(), "applySubtitleStylePreset")
      .mockResolvedValue(true);

    render(<AutoCaptionPanel />);

    openSelectAndChoose(/Caption Style/, /Modern/);

    fireEvent.click(screen.getByRole("button", { name: /Generate Captions/ }));

    await waitFor(() => {
      expect(applyPresetSpy).toHaveBeenCalledWith("modern");
    });
  });

  it("shows media-unavailable error and does not call transcribeClip when media has no blob or fileHandle", async () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video", blob: null, fileHandle: null });
    selectClip(videoClipId, videoTrackId);

    render(<AutoCaptionPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Captions/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/source media is unavailable/),
      ).toBeInTheDocument();
    });
    expect(transcriptionServiceMock.transcribeClip).not.toHaveBeenCalled();
  });

  it("surfaces the rejection message and resets state when transcribeClip fails", async () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video" });
    selectClip(videoClipId, videoTrackId);

    transcriptionServiceMock.transcribeClip.mockRejectedValue(
      new Error("Transcription service is unavailable."),
    );

    render(<AutoCaptionPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Captions/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/Transcription service is unavailable\./),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Generate Captions/ }),
      ).not.toBeDisabled();
    });
  });

  it("renders backend transcription progress while generating", async () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video" });
    selectClip(videoClipId, videoTrackId);

    let resolveTranscription: (subtitles: Subtitle[]) => void = () => {};
    transcriptionServiceMock.transcribeClip.mockImplementation(
      (_clip: unknown, _mediaItem: unknown, onProgress: (p: unknown) => void) => {
        onProgress({
          phase: "uploading",
          progress: 25,
          message: "Uploading audio for transcription...",
        });
        return new Promise((resolve) => {
          resolveTranscription = resolve;
        });
      },
    );

    render(<AutoCaptionPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Captions/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/Uploading audio for transcription/),
      ).toBeInTheDocument();
    });

    resolveTranscription([]);
    await waitFor(() => {
      expect(
        screen.queryByText(/Uploading audio for transcription/),
      ).toBeNull();
    });
  });

  it("allows switching between microphone and selected-clip modes without crashing", () => {
    const project = seedProjectWithClip({
      clipId: videoClipId,
      trackId: videoTrackId,
      mediaId: "media-video-1",
      clipType: "video",
      trackType: "video",
    });
    addMediaItem(project, { id: "media-video-1", type: "video" });
    selectClip(videoClipId, videoTrackId);

    render(<AutoCaptionPanel />);

    expect(
      screen.getByRole("button", { name: /Generate Captions/ }),
    ).toBeInTheDocument();

    openSelectAndChoose(/Caption Source/, /Microphone Recording/);
    expect(
      screen.getByRole("button", { name: /Start Recording/ }),
    ).toBeInTheDocument();

    openSelectAndChoose(/Caption Source/, /Selected Clip/);
    expect(
      screen.getByRole("button", { name: /Generate Captions/ }),
    ).toBeInTheDocument();
  });
});
