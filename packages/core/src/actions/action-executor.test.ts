import { describe, expect, it } from "vitest";
import type { Action, Project } from "../types";
import { ActionExecutor } from "./action-executor";

function projectWithMedia(externallyReferenced: boolean): Project {
  return {
    id: "vintage-tokyo",
    name: "Vintage Tokyo",
    createdAt: 1,
    modifiedAt: 2,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: {
      items: [{
        id: "media-1",
        name: "interview.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        thumbnailUrl: null,
        externallyReferenced,
        metadata: {
          duration: 1,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 0,
          channels: 0,
          fileSize: 42,
        },
      }],
    },
    generatedImageDefinitions: [],
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  };
}

function deleteMediaAction(): Action {
  return {
    id: "action-1",
    type: "media/delete",
    timestamp: 1,
    params: { mediaId: "media-1" },
  };
}

describe("ActionExecutor externally referenced media protection", () => {
  it("blocks deletion of media referenced by Resolve without mutating the project", async () => {
    const project = projectWithMedia(true);

    const result = await new ActionExecutor().execute(deleteMediaAction(), project);

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "EXTERNAL_MEDIA_DELETE_BLOCKED",
        details: { mediaId: "media-1" },
      },
    });
    expect(project.mediaLibrary.items.map((item) => item.id)).toEqual(["media-1"]);
  });

  it("continues to delete media that is not externally referenced", async () => {
    const project = projectWithMedia(false);

    const result = await new ActionExecutor().execute(deleteMediaAction(), project);

    expect(result.success).toBe(true);
    expect(project.mediaLibrary.items).toEqual([]);
  });
});
