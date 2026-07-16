import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { matchProjectJsonAssetFiles } from "./project-json-assets";

function file(name: string, size: number): File {
  return new File(["x".repeat(size)], name, { type: "video/mp4" });
}

function projectWithMedia(sourceFile: {
  name: string;
  size: number;
  lastModified: number;
  folder?: string;
}): Project {
  return {
    id: "project-1",
    name: "Project",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "media-1",
          name: sourceFile.name,
          type: "video",
          fileHandle: null,
          blob: null,
          metadata: {
            duration: 1,
            width: 1920,
            height: 1080,
            frameRate: 30,
            codec: "",
            sampleRate: 0,
            channels: 0,
            fileSize: sourceFile.size
          },
          thumbnailUrl: null,

          sourceFile
        },
      ]
    },
    generatedImageDefinitions: [],
    timeline: {
      tracks: [],
      subtitles: [],
      duration: 0,
      markers: []
    }
  };
}

describe("matchProjectJsonAssetFiles", () => {
  it("resolves media source paths relative to the project JSON file", () => {
    const clip = file("clip.mp4", 4);

    const matches = matchProjectJsonAssetFiles(
      projectWithMedia({ name: "clip.mp4", size: 4, lastModified: 1, folder: "media" }),
      [{ file: clip, relativePath: "projects/cut/media/clip.mp4" }],
      "projects/cut/project.json",
    );

    expect(matches).toEqual([
      {
        mediaId: "media-1",
        file: clip,
        sourceFolder: "projects/cut/media"
      },
    ]);
  });

  it("falls back to exact filename and size for legacy project JSON", () => {
    const clip = file("clip.mp4", 4);

    const matches = matchProjectJsonAssetFiles(
      projectWithMedia({ name: "clip.mp4", size: 4, lastModified: 1 }),
      [{ file: clip, relativePath: "exports/assets/renamed-folder/clip.mp4" }],
      "exports/project.json",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.mediaId).toBe("media-1");
    expect(matches[0]?.file).toBe(clip);
  });
});
