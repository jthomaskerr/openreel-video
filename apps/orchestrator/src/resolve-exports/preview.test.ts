import type { Project } from "@openreel/core";
import { describe, expect, test } from "vitest";
import {
  buildResolvePreview,
  type PreviewMediaAvailability,
} from "./preview";

function projectFixture(): Project {
  return {
    id: "vintage-tokyo",
    name: "Vintage Tokyo",
    description: "A summer edit",
    createdAt: 1,
    modifiedAt: 2,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
    mediaLibrary: {
      items: [
        media("video-1", "street.mp4", "video"),
        media("video-2", "shibuya.mp4", "video"),
        media("audio-1", "ambient.wav", "audio"),
        media("render-1", "vintage-tokyo-render.mp4", "video"),
      ],
    },
    generatedImageDefinitions: [],
    timeline: {
      duration: 6,
      markers: [],
      subtitles: [{ id: "subtitle-1", text: "Tokyo", startTime: 4, endTime: 5 }],
      tracks: [
        track("video-track", "video", [
          clip("clip-1", "video", "video-1", 0, 3),
          clip("clip-2", "video", "video-2", 3, 3),
        ]),
        track("audio-track", "audio", [clip("clip-3", "audio", "audio-1", 0, 6)]),
        track("title-track", "text", [clip("clip-4", "text", "", 1, 2)]),
      ],
    },
  } as unknown as Project;
}

function media(id: string, name: string, type: "video" | "audio"): object {
  return {
    id,
    name,
    type,
    fileHandle: null,
    blob: null,
    thumbnailUrl: null,
    metadata: {
      duration: 6,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48_000,
      channels: 2,
      fileSize: 42,
    },
  };
}

function track(id: string, type: string, clips: object[]): object {
  return { id, name: id, type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

function clip(id: string, type: string, mediaId: string, startTime: number, duration: number): object {
  return {
    id,
    type,
    mediaId,
    trackId: `${type}-track`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
    audioEffects: [],
    transform: {},
    volume: 1,
    keyframes: [],
  };
}

function availabilityFixture(): ReadonlyMap<string, PreviewMediaAvailability> {
  return new Map([
    ["video-1", { status: "ready" }],
    ["video-2", { status: "ready" }],
    ["audio-1", { status: "ready" }],
    ["render-1", { status: "ready", renderedAt: 3, renderedRevision: "rev-123" }],
  ]);
}

describe("buildResolvePreview", () => {
  test("groups clips by type and preserves timing in mini timeline primitives", () => {
    const preview = buildResolvePreview(projectFixture(), "rev-123", availabilityFixture());

    expect(preview.clipGroups.map((group) => [group.type, group.clips.length])).toEqual([
      ["video", 2],
      ["audio", 1],
      ["titles", 1],
      ["subtitles", 1],
    ]);
    expect(preview.miniTimeline.tracks[0]!.clips[0]).toMatchObject({ startFrame: 0, endFrame: 90 });
    expect(preview.render).toEqual({
      status: "ready",
      mediaId: "render-1",
      previewUrl: "/api/projects/vintage-tokyo/media/render-1",
      updatedAt: 3,
      stale: false,
    });
    expect(preview.trackCount).toBe(3);
    expect(preview.miniTimeline.tracks).toHaveLength(4);
    expect(preview.clipGroups.find((group) => group.type === "video")!.clips[0]!.preview).toMatchObject({
      url: "/api/projects/vintage-tokyo/media/video-1",
      thumbnailUrl: "/api/projects/vintage-tokyo/media/video-1",
    });
    expect(preview.clipGroups.find((group) => group.type === "audio")!.clips[0]!.preview).toMatchObject({
      url: "/api/projects/vintage-tokyo/media/audio-1",
      waveformUrl: "/api/projects/vintage-tokyo/media/audio-1",
    });
  });

  test("reports unavailable media and stale renders without exposing file paths", () => {
    const availability = new Map(availabilityFixture());
    availability.set("audio-1", { status: "missing", reason: "Canonical media is unavailable" });
    availability.set("render-1", { status: "ready", renderedAt: 3, renderedRevision: "older-revision" });

    const preview = buildResolvePreview(projectFixture(), "rev-123", availability);

    expect(preview.clipGroups.find((group) => group.type === "audio")!.clips[0]!.preview).toEqual({
      status: "missing",
      reason: "Canonical media is unavailable",
    });
    expect(preview.render).toEqual({
      status: "stale",
      mediaId: "render-1",
      previewUrl: "/api/projects/vintage-tokyo/media/render-1",
      updatedAt: 3,
      stale: true,
      reason: "Render belongs to revision older-revision, not rev-123",
    });
    expect(preview.compatibility).toEqual({ status: "blocked", blockingIssueCount: 1, warningCount: 0 });
    expect(JSON.stringify(preview)).not.toContain("/Volumes/");
  });

  test("retains graphics and unsupported clips while converting fractional times to frames", () => {
    const project = projectFixture();
    (project.timeline.tracks as unknown as object[]).push(
      track("graphics-track", "graphics", [clip("graphic-1", "shape", "", 1 / 60, 1 / 20)]),
      track("metadata-track", "metadata", [clip("unknown-1", "metadata", "", 2 / 30, 1 / 30)]),
    );

    const preview = buildResolvePreview(project, "rev-123", availabilityFixture());

    expect(preview.clipGroups.find((group) => group.type === "graphics")!.clips).toHaveLength(1);
    expect(preview.clipGroups.find((group) => group.type === "unsupported")!.clips).toHaveLength(1);
    expect(preview.miniTimeline.tracks[3]!.clips[0]).toMatchObject({ startFrame: 1, endFrame: 2 });
    expect(preview.miniTimeline.tracks[4]!.clips[0]).toMatchObject({ startFrame: 2, endFrame: 3 });
    expect(preview.compatibility).toEqual({ status: "degraded", blockingIssueCount: 0, warningCount: 1 });
  });

  test("blocks supported clips with missing, dangling, or absent media IDs", () => {
    const project = projectFixture();
    (project.timeline.tracks[0]!.clips as unknown as object[]).push(
      clip("no-media", "video", "", 0, 1),
      clip("dangling-media", "video", "absent-media", 1, 1),
    );

    const preview = buildResolvePreview(project, "rev-123", availabilityFixture());

    expect(preview.clipGroups.find((group) => group.type === "video")!.clips.slice(-2).map((clip) => clip.preview.status)).toEqual([
      "missing",
      "missing",
    ]);
    expect(preview.compatibility).toEqual({ status: "blocked", blockingIssueCount: 2, warningCount: 0 });
  });

  test.each([
    ["no render", new Map<string, PreviewMediaAvailability>(), { status: "missing", reason: "No rendered output is available" }],
    ["missing render", new Map<string, PreviewMediaAvailability>([["render-1", { status: "missing", renderedAt: 3, reason: "Rendered output is unavailable" }]]), { status: "missing", reason: "Rendered output is unavailable" }],
    ["unknown render revision", new Map<string, PreviewMediaAvailability>([["render-1", { status: "ready", renderedAt: 3 }]]), { status: "stale", reason: "Render revision is unavailable" }],
  ])("reports %s explicitly", (_name, availability, expected) => {
    const preview = buildResolvePreview(projectFixture(), "rev-123", availability);

    expect(preview.render).toMatchObject(expected);
  });

  test("emits only canonical project-media URLs", () => {
    const preview = buildResolvePreview(projectFixture(), "rev-123", availabilityFixture());
    const urls = preview.clipGroups.flatMap((group) => group.clips.flatMap((clip) => {
      if (clip.preview.status !== "ready") return [];
      return [clip.preview.url, ...(clip.preview.kind === "video" && clip.preview.thumbnailUrl ? [clip.preview.thumbnailUrl] : []), ...(clip.preview.kind === "audio" ? [clip.preview.waveformUrl] : [])];
    }));

    const previewUrls = [preview.render.status === "missing" ? undefined : preview.render.previewUrl, ...urls]
      .filter((url): url is string => Boolean(url));
    expect(previewUrls.every((url) => /^\/api\/projects\/vintage-tokyo\/media\/[A-Za-z0-9-]+$/.test(url))).toBe(true);
  });
});
