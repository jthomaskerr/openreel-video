import { describe, expect, it } from "vitest";
import {
  ResolveExportJobSchema,
  ResolveImportResultSchema,
  ResolvePreviewSchema,
} from "./index";

const readyJob = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  projectId: "vintage-tokyo",
  revision: "rev-123",
  phase: "ready",
  processed: 33,
  total: 33,
  percent: 100,
  warnings: [],
  createdAt: "2026-07-22T09:00:00.000Z",
  updatedAt: "2026-07-22T09:01:00.000Z",
  bridgeLaunchUrl: "openreel-resolve://import/223e4567-e89b-12d3-a456-426614174000",
};

const readyPreview = {
  projectId: "vintage-tokyo",
  revision: "rev-123",
  name: "Vintage Tokyo",
  description: "A summer edit",
  createdAt: 1,
  modifiedAt: 2,
  durationFrames: 180,
  frameRate: 30,
  trackCount: 1,
  clipCount: 1,
  mediaCount: 1,
  render: {
    status: "ready",
    mediaId: "render-1",
    previewUrl: "/api/projects/vintage-tokyo/media/render-1",
    updatedAt: 2,
    stale: false,
  },
  miniTimeline: {
    durationFrames: 180,
    tracks: [{
      id: "track-1",
      index: 0,
      type: "video",
      clips: [{ id: "clip-1", mediaId: "media-1", label: "Tokyo", startFrame: 0, endFrame: 90 }],
    }],
  },
  clipGroups: [{
    type: "video",
    clips: [{
      id: "clip-1",
      mediaId: "media-1",
      label: "Tokyo",
      startFrame: 0,
      endFrame: 90,
      preview: {
        status: "ready",
        kind: "video",
        url: "/api/projects/vintage-tokyo/media/media-1",
        thumbnailUrl: "/api/projects/vintage-tokyo/media/media-1/thumbnail",
      },
    }],
  }],
  compatibility: {
    status: "ready",
    blockingIssueCount: 0,
    warningCount: 0,
  },
};

const completedImportResult = {
  requestId: "123e4567-e89b-12d3-a456-426614174000",
  status: "completed",
  resolveVersion: "20.3.2",
  resolveBuild: "20.3.2.0001",
  projectName: "Vintage Tokyo",
  trackCounts: { video: 1 },
  clipCounts: { video: 3 },
  offlineMediaIds: [],
  saved: true,
  artifactSha256: "a".repeat(64),
};

describe("Resolve bridge contracts", () => {
  it("rejects launch URLs containing project data or filesystem paths", () => {
    expect(() => ResolveExportJobSchema.parse({
      ...readyJob,
      bridgeLaunchUrl: "openreel-resolve://import/job-1?path=/tmp/export",
    })).toThrow();
  });

  it("defaults referenced media IDs in a completed import result", () => {
    const result = ResolveImportResultSchema.parse(completedImportResult);

    expect(result.referencedMediaIds).toEqual([]);
  });

  it("rejects unknown keys in every top-level bridge payload", () => {
    expect(() => ResolveExportJobSchema.parse({ ...readyJob, unexpected: true })).toThrow();
    expect(() => ResolveImportResultSchema.parse({ ...completedImportResult, unexpected: true })).toThrow();
    expect(() => ResolvePreviewSchema.parse({ ...readyPreview, unexpected: true })).toThrow();
  });

  it.each([
    ["an import failure", () => ResolveImportResultSchema.parse({
      ...completedImportResult,
      status: "failed",
      failure: { code: "EXPORT_FAILED", message: "nope", unexpected: true },
    })],
    ["a render state", () => ResolvePreviewSchema.parse({
      ...readyPreview,
      render: { ...readyPreview.render, unexpected: true },
    })],
    ["the mini timeline", () => ResolvePreviewSchema.parse({
      ...readyPreview,
      miniTimeline: { ...readyPreview.miniTimeline, unexpected: true },
    })],
    ["a mini-timeline track", () => ResolvePreviewSchema.parse({
      ...readyPreview,
      miniTimeline: {
        ...readyPreview.miniTimeline,
        tracks: [{ ...readyPreview.miniTimeline.tracks[0], unexpected: true }],
      },
    })],
    ["a mini-timeline clip", () => ResolvePreviewSchema.parse({
      ...readyPreview,
      miniTimeline: {
        ...readyPreview.miniTimeline,
        tracks: [{
          ...readyPreview.miniTimeline.tracks[0],
          clips: [{ ...readyPreview.miniTimeline.tracks[0].clips[0], unexpected: true }],
        }],
      },
    })],
    ["a clip group", () => ResolvePreviewSchema.parse({
      ...readyPreview,
      clipGroups: [{ ...readyPreview.clipGroups[0], unexpected: true }],
    })],
    ["the compatibility summary", () => ResolvePreviewSchema.parse({
      ...readyPreview,
      compatibility: { ...readyPreview.compatibility, unexpected: true },
    })],
  ])("rejects unknown keys inside %s", (_location, parse) => {
    expect(parse).toThrow();
  });

  it.each([
    ["missing", { status: "missing", reason: "unavailable", unexpected: true }],
    ["video", { status: "ready", kind: "video", url: "/api/projects/vintage-tokyo/media/media-1", unexpected: true }],
    ["audio", { status: "ready", kind: "audio", url: "/api/projects/vintage-tokyo/media/media-1", waveformUrl: "/api/projects/vintage-tokyo/media/media-1/waveform", unexpected: true }],
    ["image", { status: "ready", kind: "image", url: "/api/projects/vintage-tokyo/media/media-1", unexpected: true }],
  ])("rejects unknown keys inside the %s preview variant", (_kind, preview) => {
    expect(() => ResolvePreviewSchema.parse({
      ...readyPreview,
      clipGroups: [{
        ...readyPreview.clipGroups[0],
        clips: [{ ...readyPreview.clipGroups[0].clips[0], preview }],
      }],
    })).toThrow();
  });

  it.each([
    "/api/projects/vintage-tokyo/media/media-1?path=/Users/name/secret.mov",
    "/api/projects/vintage-tokyo/media/media-1#fragment",
    "/api/projects//tmp/secret",
    "/api/projects/../media/secret",
    "/api/projects/%2e%2e/media/secret",
    "/api/projects/vintage-tokyo/media/%2Ftmp%2Fsecret",
  ])("rejects unsafe project-media URL %s everywhere it can appear", (unsafeUrl) => {
    expect(() => ResolvePreviewSchema.parse({
      ...readyPreview,
      render: { ...readyPreview.render, previewUrl: unsafeUrl },
    })).toThrow();
    expect(() => ResolvePreviewSchema.parse({
      ...readyPreview,
      clipGroups: [{
        ...readyPreview.clipGroups[0],
        clips: [{
          ...readyPreview.clipGroups[0].clips[0],
          preview: { status: "ready", kind: "video", url: unsafeUrl },
        }],
      }],
    })).toThrow();
    expect(() => ResolvePreviewSchema.parse({
      ...readyPreview,
      clipGroups: [{
        ...readyPreview.clipGroups[0],
        clips: [{
          ...readyPreview.clipGroups[0].clips[0],
          preview: {
            status: "ready",
            kind: "video",
            url: "/api/projects/vintage-tokyo/media/media-1",
            thumbnailUrl: unsafeUrl,
          },
        }],
      }],
    })).toThrow();
    expect(() => ResolvePreviewSchema.parse({
      ...readyPreview,
      clipGroups: [{
        ...readyPreview.clipGroups[0],
        clips: [{
          ...readyPreview.clipGroups[0].clips[0],
          preview: {
            status: "ready",
            kind: "audio",
            url: "/api/projects/vintage-tokyo/media/media-1",
            waveformUrl: unsafeUrl,
          },
        }],
      }],
    })).toThrow();
  });

  it.each([
    ["an absolute render URL", {
      ...readyPreview,
      render: { ...readyPreview.render, previewUrl: "https://example.com/preview" },
    }],
    ["a file clip preview URL", {
      ...readyPreview,
      clipGroups: [{
        ...readyPreview.clipGroups[0],
        clips: [{
          ...readyPreview.clipGroups[0].clips[0],
          preview: { status: "ready", kind: "video", url: "file:///tmp/preview.mov" },
        }],
      }],
    }],
    ["reversed clip frames", {
      ...readyPreview,
      miniTimeline: {
        ...readyPreview.miniTimeline,
        tracks: [{
          ...readyPreview.miniTimeline.tracks[0],
          clips: [{ ...readyPreview.miniTimeline.tracks[0].clips[0], startFrame: 91, endFrame: 90 }],
        }],
      },
    }],
    ["an unknown clip type", {
      ...readyPreview,
      miniTimeline: {
        ...readyPreview.miniTimeline,
        tracks: [{ ...readyPreview.miniTimeline.tracks[0], type: "captions" }],
      },
    }],
  ])("rejects previews containing %s", (_reason, preview) => {
    expect(() => ResolvePreviewSchema.parse(preview)).toThrow();
  });

  it("accepts a fully specified relative-URL preview", () => {
    expect(ResolvePreviewSchema.parse(readyPreview)).toEqual(readyPreview);
  });
});
