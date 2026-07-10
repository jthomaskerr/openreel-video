import { describe, expect, it } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { sanitizeForAutoSave } from "./auto-save";

function makeMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "media-1",
    name: "clip.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 24,
      codec: "h264",
      sampleRate: 0,
      channels: 0,
      fileSize: 100,
    },
    thumbnailUrl: "data:image/png;base64,thumb",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Test Project",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [makeMediaItem()] },
    timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
    ...overrides,
  };
}

describe("sanitizeForAutoSave", () => {
  it("nulls out a thumbnailUrl that starts with blob:", () => {
    const project = makeProject({
      mediaLibrary: {
        items: [makeMediaItem({ thumbnailUrl: "blob:http://localhost/dead-uuid" })],
      },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.mediaLibrary.items[0].thumbnailUrl).toBeNull();
  });

  it("preserves a non-blob thumbnailUrl (data: URI)", () => {
    const project = makeProject({
      mediaLibrary: {
        items: [makeMediaItem({ thumbnailUrl: "data:image/png;base64,thumb" })],
      },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.mediaLibrary.items[0].thumbnailUrl).toBe("data:image/png;base64,thumb");
  });

  it("preserves a non-blob thumbnailUrl (remote https: URL)", () => {
    const project = makeProject({
      mediaLibrary: {
        items: [makeMediaItem({ thumbnailUrl: "https://cdn.example.com/thumb.jpg" })],
      },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.mediaLibrary.items[0].thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("drops filmstripThumbnails entirely when any tile is a blob: URL", () => {
    const project = makeProject({
      mediaLibrary: {
        items: [
          makeMediaItem({
            filmstripThumbnails: [
              { timestamp: 0, url: "data:image/png;base64,ok" },
              { timestamp: 2.5, url: "blob:http://localhost/dead-frame-1" },
              { timestamp: 5, url: "data:image/png;base64,ok2" },
            ],
          }),
        ],
      },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.mediaLibrary.items[0].filmstripThumbnails).toBeUndefined();
  });

  it("preserves filmstripThumbnails unchanged when no tile is a blob: URL", () => {
    const filmstripThumbnails = [
      { timestamp: 0, url: "data:image/png;base64,ok" },
      { timestamp: 2.5, url: "https://cdn.example.com/frame-1.jpg" },
    ];
    const project = makeProject({
      mediaLibrary: {
        items: [makeMediaItem({ filmstripThumbnails })],
      },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.mediaLibrary.items[0].filmstripThumbnails).toEqual(filmstripThumbnails);
  });

  it("sanitizes multiple media items independently", () => {
    const project = makeProject({
      mediaLibrary: {
        items: [
          makeMediaItem({ id: "media-1", thumbnailUrl: "blob:http://localhost/dead-1" }),
          makeMediaItem({ id: "media-2", thumbnailUrl: "data:image/png;base64,fine" }),
          makeMediaItem({
            id: "media-3",
            thumbnailUrl: null,
            filmstripThumbnails: [{ timestamp: 0, url: "blob:http://localhost/dead-frame" }],
          }),
        ],
      },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.mediaLibrary.items[0].thumbnailUrl).toBeNull();
    expect(sanitized.mediaLibrary.items[1].thumbnailUrl).toBe("data:image/png;base64,fine");
    expect(sanitized.mediaLibrary.items[2].filmstripThumbnails).toBeUndefined();
  });

  it("leaves other project fields untouched", () => {
    const project = makeProject({
      id: "project-42",
      name: "My Cut",
      timeline: { tracks: [], subtitles: [], duration: 42, markers: [] },
    });

    const sanitized = sanitizeForAutoSave(project);

    expect(sanitized.id).toBe("project-42");
    expect(sanitized.name).toBe("My Cut");
    expect(sanitized.settings).toEqual(project.settings);
    expect(sanitized.timeline).toEqual(project.timeline);
  });

  it("leaves other media item fields untouched", () => {
    const project = makeProject({
      mediaLibrary: {
        items: [
          makeMediaItem({
            thumbnailUrl: "blob:http://localhost/dead-uuid",
            originalUrl: "https://cdn.example.com/original.mp4",
            remoteUrl: "https://backend.example.com/media/1.mp4",
          }),
        ],
      },
    });

    const sanitized = sanitizeForAutoSave(project);
    const item = sanitized.mediaLibrary.items[0];

    expect(item.id).toBe("media-1");
    expect(item.name).toBe("clip.mp4");
    expect(item.originalUrl).toBe("https://cdn.example.com/original.mp4");
    expect(item.remoteUrl).toBe("https://backend.example.com/media/1.mp4");
    expect(item.metadata).toEqual(project.mediaLibrary.items[0].metadata);
  });
});
