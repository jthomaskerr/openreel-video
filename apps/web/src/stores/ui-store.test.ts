import "../test/install-local-storage-mock";
import { describe, it, expect, beforeEach } from "vitest";
import type { Track } from "@openreel/core";
import {
  getSceneCreationDisabledReason,
  isSceneCompatibleTrack,
  resolveActiveTrackId,
  useUIStore,
} from "./ui-store";

const track = (
  id: string,
  type: Track["type"] = "video",
  overrides: Partial<Track> = {},
): Track =>
  ({
    id,
    name: id,
    type,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    ...overrides,
  }) as Track;

describe("ui-store inspectorActiveTab", () => {
  beforeEach(() => {
    useUIStore.setState({ inspectorActiveTab: "transform" });
  });

  it("defaults to transform", () => {
    expect(useUIStore.getState().inspectorActiveTab).toBe("transform");
  });

  it("setInspectorActiveTab updates the value", () => {
    useUIStore.getState().setInspectorActiveTab("color");
    expect(useUIStore.getState().inspectorActiveTab).toBe("color");
  });
});

describe("ui-store active track", () => {
  beforeEach(() => {
    useUIStore.setState({ activeTrackId: null, inspectorSelection: null });
  });

  it("uses the deterministic fallback order", () => {
    const tracks = [
      track("audio", "audio"),
      track("locked-video", "video", { locked: true }),
      track("video", "video"),
    ];

    expect(resolveActiveTrackId(tracks, "audio", "video")).toBe("audio");
    expect(resolveActiveTrackId(tracks, "missing", "locked-video")).toBe("locked-video");
    expect(resolveActiveTrackId(tracks, "missing", null)).toBe("video");
    expect(resolveActiveTrackId([track("audio", "audio")], null, null)).toBe("audio");
    expect(resolveActiveTrackId([], "video", "video")).toBeNull();
  });

  it("falls back when the active track is deleted or hidden", () => {
    const tracks = [track("hidden", "video", { hidden: true }), track("next", "video")];
    expect(resolveActiveTrackId(tracks, "deleted", null)).toBe("next");
    expect(resolveActiveTrackId(tracks, "hidden", null)).toBe("next");
    expect(resolveActiveTrackId([track("hidden", "audio", { hidden: true })], null, null)).toBe(
      "hidden",
    );
  });

  it("sets active track without changing selection", () => {
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "clip-1", trackId: "track-1" }] });
    useUIStore.getState().setActiveTrack("track-2");
    expect(useUIStore.getState().activeTrackId).toBe("track-2");
    expect(useUIStore.getState().selectedItems).toEqual([
      { type: "clip", id: "clip-1", trackId: "track-1" },
    ]);
  });

  it("keeps locked tracks active but reports why scene creation is unavailable", () => {
    const locked = track("locked", "video", { locked: true, muted: true });
    expect(resolveActiveTrackId([locked], "locked", null)).toBe("locked");
    expect(isSceneCompatibleTrack(locked)).toBe(false);
    expect(getSceneCreationDisabledReason([locked], "locked")).toBe(
      "Unlock the active track to create a scene.",
    );
    expect(isSceneCompatibleTrack(track("muted", "video", { muted: true }))).toBe(true);
  });

  it("returns stable actionable scene creation reasons", () => {
    const audio = track("audio", "audio");
    expect(getSceneCreationDisabledReason([], null)).toBe(
      "Add a video track before creating a scene.",
    );
    expect(getSceneCreationDisabledReason([audio], null)).toBe(
      "Select a video track to create a scene.",
    );
    expect(getSceneCreationDisabledReason([audio], "stale")).toBe(
      "Select a video track to create a scene.",
    );
    expect(getSceneCreationDisabledReason([audio], "audio")).toBe(
      "Select a video track to create a scene.",
    );
  });

  it("stores scene inspector selection independently from inspected assets", () => {
    const selection = {
      type: "scene" as const,
      sceneId: "scene-1",
      projectionClipId: "clip-1",
      focusTitleRequestId: 7,
    };
    useUIStore.getState().setInspectorSelection(selection);
    expect(useUIStore.getState().inspectorSelection).toEqual(selection);
    expect(useUIStore.getState().inspectedAsset).toBeNull();
    expect(useUIStore.getState().sidebarTab).toBe("inspector");
  });
});
