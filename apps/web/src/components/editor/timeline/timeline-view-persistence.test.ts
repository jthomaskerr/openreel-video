import "../../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadTimelineViewState,
  saveTimelineViewState,
  TIMELINE_VIEW_STATE_STORAGE_KEY,
} from "./timeline-view-persistence";

describe("timeline view persistence", () => {
  beforeEach(() => localStorage.clear());

  it("keeps playhead and scroll positions isolated by project", () => {
    saveTimelineViewState("project-a", {
      playheadPosition: 12.5,
      scrollX: 320,
      scrollY: 80,
    });
    saveTimelineViewState("project-b", {
      playheadPosition: 3.25,
      scrollX: 40,
      scrollY: 10,
    });

    expect(loadTimelineViewState("project-a")).toEqual({
      playheadPosition: 12.5,
      scrollX: 320,
      scrollY: 80,
    });
    expect(loadTimelineViewState("project-b")).toEqual({
      playheadPosition: 3.25,
      scrollX: 40,
      scrollY: 10,
    });
    expect(loadTimelineViewState("project-c")).toBeNull();
  });

  it("ignores corrupt and unsafe persisted positions", () => {
    localStorage.setItem(TIMELINE_VIEW_STATE_STORAGE_KEY, "not json");
    expect(loadTimelineViewState("project-a")).toBeNull();

    localStorage.setItem(
      TIMELINE_VIEW_STATE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        projects: {
          "project-a": {
            playheadPosition: -1,
            scrollX: 20,
            scrollY: 30,
            updatedAt: 1,
          },
        },
      }),
    );
    expect(loadTimelineViewState("project-a")).toBeNull();
  });
});
