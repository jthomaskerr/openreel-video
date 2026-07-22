import type { Project } from "../../../types/project";
import type { Clip, Track } from "../../../types/timeline";
import type { ExportRange } from "../../types";
import type { CompatibilityIssue, MediaAvailabilityHint } from "../types";

export const createHandoffFixtureClip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "video-clip-1",
  type: "video",
  mediaId: "video-media-1",
  trackId: "video-track-1",
  startTime: 0,
  duration: 10,
  inPoint: 2,
  outPoint: 12,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0.5, y: 0.5 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...overrides,
});

export const createHandoffFixtureTrack = (overrides: Partial<Track> = {}): Track => ({
  id: "video-track-1",
  type: "video",
  name: "Video 1",
  clips: [createHandoffFixtureClip()],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

export const FULL_PROJECT_RANGE: ExportRange = { startTime: 0, endTime: 12 };
export const SELECTED_PROJECT_RANGE: ExportRange = { startTime: 3, endTime: 8 };

export const AVAILABLE_MEDIA = new Map<string, MediaAvailabilityHint>([
  ["video-media-1", { available: true, source: "blob", mediaType: "video/quicktime", byteLength: 1_024 }],
  ["audio-media-1", { available: true, source: "file-handle", mediaType: "audio/wav", byteLength: 512 }],
]);

export const MISSING_MEDIA = new Map<string, MediaAvailabilityHint>([
  ["video-media-1", { available: false }],
  ["audio-media-1", { available: true, source: "file-handle", mediaType: "audio/wav", byteLength: 512 }],
]);

export function createHandoffFixtureProject(overrides: Partial<Project> = {}): Project {
  const videoTrack = createHandoffFixtureTrack();
  const audioTrack = createHandoffFixtureTrack({
    id: "audio-track-1",
    type: "audio",
    name: "Audio 1",
    clips: [
      createHandoffFixtureClip({
        id: "audio-clip-1",
        type: "audio",
        mediaId: "audio-media-1",
        trackId: "audio-track-1",
        duration: 12,
        inPoint: 0,
        outPoint: 12,
      }),
    ],
  });

  return {
    id: "handoff-project-1",
    name: "Handoff Fixture",
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_000_100,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "video-media-1",
          name: "Camera A.mov",
          type: "video",
          fileHandle: null,
          blob: null,
          metadata: { duration: 30, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48_000, channels: 2, fileSize: 1_024 },
          thumbnailUrl: null,
        },
        {
          id: "audio-media-1",
          name: "Mix.wav",
          type: "audio",
          fileHandle: null,
          blob: null,
          metadata: { duration: 12, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 48_000, channels: 2, fileSize: 512 },
          thumbnailUrl: null,
        },
      ],
    },
    generatedImageDefinitions: [],
    timeline: { tracks: [videoTrack, audioTrack], subtitles: [], duration: 12, markers: [] },
    ...overrides,
  };
}

export function createBasicMultitrackProject(): Project {
  const base = createHandoffFixtureProject();
  const primaryVideo = createHandoffFixtureTrack({
    clips: [createHandoffFixtureClip({ duration: 4, outPoint: 6 })],
  });
  const overlayVideo = createHandoffFixtureTrack({
    id: "overlay-track-1",
    name: "Overlay",
    clips: [
      createHandoffFixtureClip({
        id: "image-clip-1",
        type: "image",
        mediaId: "image-media-1",
        trackId: "overlay-track-1",
        startTime: 1,
        duration: 2,
        inPoint: 0,
        outPoint: 2,
      }),
    ],
  });
  const audio = createHandoffFixtureTrack({
    id: "audio-track-1",
    type: "audio",
    name: "Audio 1",
    clips: [
      createHandoffFixtureClip({
        id: "audio-clip-1",
        type: "audio",
        mediaId: "audio-media-1",
        trackId: "audio-track-1",
        duration: 6,
        inPoint: 0,
        outPoint: 6,
      }),
    ],
  });
  return {
    ...base,
    name: "Resolve & iMovie Fixture",
    timeline: { ...base.timeline, duration: 6, tracks: [primaryVideo, overlayVideo, audio] },
    mediaLibrary: {
      items: [
        ...base.mediaLibrary.items,
        {
          id: "image-media-1",
          name: "Title & Logo.png",
          type: "image",
          fileHandle: null,
          blob: null,
          metadata: { duration: 6, width: 1920, height: 1080, frameRate: 30, codec: "png", sampleRate: 0, channels: 0, fileSize: 256 },
          thumbnailUrl: null,
        },
      ],
    },
  };
}

export function expectedIssue(overrides: Partial<CompatibilityIssue> = {}): CompatibilityIssue {
  return {
    code: "resolve.missing-media",
    severity: "blocking",
    entity: { kind: "media", id: "video-media-1", label: "Camera A.mov", trackIndex: 0, timelineFrame: 0 },
    message: "Camera A.mov is unavailable for the Resolve handoff.",
    action: "Relink the media and assess again.",
    retryable: true,
    details: {},
    ...overrides,
  };
}
