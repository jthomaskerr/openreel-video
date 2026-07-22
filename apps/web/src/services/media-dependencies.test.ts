import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { findMediaDependencies } from "./media-dependencies";

describe("findMediaDependencies", () => {
  it("lists every timeline clip that references the media", () => {
    const base = createEmptyProject("dependencies");
    const project = {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: [
          {
            id: "video-track",
            type: "video",
            name: "Video",
            clips: [
              { id: "clip-1", mediaId: "media-1" },
              { id: "clip-2", mediaId: "media-1" },
              { id: "clip-other", mediaId: "other" },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    } as unknown as Project;

    expect(findMediaDependencies(project, "media-1")).toMatchObject({
      timelineClipIds: ["clip-1", "clip-2"],
      total: 2,
    });
  });

  it("protects generated-image definitions that use the media as a source or current version", () => {
    const base = createEmptyProject("dependencies");
    const project = {
      ...base,
      generatedImageDefinitions: [
        { id: "definition-source", sourceMediaVersionId: "media-1" },
        { id: "definition-current", currentMediaVersionId: "media-1" },
        { id: "definition-other", sourceMediaVersionId: "other" },
      ],
    } as unknown as Project;

    expect(findMediaDependencies(project, "media-1")).toEqual({
      mediaId: "media-1",
      timelineClipIds: [],
      protectedWorkflowReferences: [
        { type: "generated-image-source", id: "definition-source" },
        { type: "generated-image-current", id: "definition-current" },
      ],
      total: 2,
    });
  });
});
