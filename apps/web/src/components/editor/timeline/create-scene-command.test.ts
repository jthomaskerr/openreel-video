import { describe, expect, it, vi } from "vitest";

import {
  executeTimelineCreateSceneCommand,
  getCreateSceneMenuState,
  type CreateSceneActivationGate,
} from "./create-scene-command";

const videoTrack = { id: "video-1", type: "video", locked: false };

describe("Create Scene menu state", () => {
  it("is enabled for the active unlocked video track", () => {
    expect(getCreateSceneMenuState([videoTrack], videoTrack.id)).toEqual({
      enabled: true,
      trackId: videoTrack.id,
    });
  });

  it.each([
    [[], null, "Add a video track before creating a scene."],
    [[videoTrack], null, "Select a video track to create a scene."],
    [[videoTrack], "missing", "Select a video track to create a scene."],
    [
      [{ ...videoTrack, locked: true }],
      videoTrack.id,
      "Unlock the active track to create a scene.",
    ],
    [
      [{ id: "audio-1", type: "audio", locked: false }],
      "audio-1",
      "Select a video track to create a scene.",
    ],
  ] as const)("returns the exact disabled reason", (tracks, activeTrackId, reason) => {
    expect(getCreateSceneMenuState(tracks, activeTrackId)).toEqual({
      enabled: false,
      reason,
    });
  });

  it("gives locked precedence over incompatible type", () => {
    expect(
      getCreateSceneMenuState(
        [{ id: "audio-1", type: "audio", locked: true }],
        "audio-1",
      ),
    ).toEqual({
      enabled: false,
      reason: "Unlock the active track to create a scene.",
    });
  });
});

describe("Create Scene activation", () => {
  it("passes the exact floating playhead once and reports the created IDs", async () => {
    const floatingPlayhead = 123.45678901234567;
    const createAndPlaceScene = vi.fn().mockResolvedValue({
      success: true,
      value: { sceneId: "scene-1", clipId: "clip-1" },
    });
    const onCreated = vi.fn();

    const result = await executeTimelineCreateSceneCommand({
      tracks: [videoTrack],
      activeTrackId: videoTrack.id,
      playheadTime: floatingPlayhead,
      gate: { inFlight: false },
      createAndPlaceScene,
      onCreated,
      onFailed: vi.fn(),
    });

    expect(createAndPlaceScene).toHaveBeenCalledTimes(1);
    expect(createAndPlaceScene).toHaveBeenCalledWith({
      trackId: videoTrack.id,
      startTime: floatingPlayhead,
    });
    expect(onCreated).toHaveBeenCalledWith({
      sceneId: "scene-1",
      clipId: "clip-1",
      trackId: videoTrack.id,
    });
    expect(result).toEqual({
      status: "created",
      sceneId: "scene-1",
      clipId: "clip-1",
    });
  });

  it("prevents menu close/focus re-entry while creation is pending", async () => {
    let resolveCreation!: (value: {
      success: true;
      value: { sceneId: string; clipId: string };
    }) => void;
    const createAndPlaceScene = vi.fn(
      () =>
        new Promise<{
          success: true;
          value: { sceneId: string; clipId: string };
        }>((resolve) => {
          resolveCreation = resolve;
        }),
    );
    const gate: CreateSceneActivationGate = { inFlight: false };
    const command = {
      tracks: [videoTrack],
      activeTrackId: videoTrack.id,
      playheadTime: 8.25,
      gate,
      createAndPlaceScene,
      onCreated: vi.fn(),
      onFailed: vi.fn(),
    };

    const first = executeTimelineCreateSceneCommand(command);
    const duplicate = await executeTimelineCreateSceneCommand(command);

    expect(duplicate).toEqual({ status: "duplicate" });
    expect(createAndPlaceScene).toHaveBeenCalledTimes(1);

    resolveCreation({
      success: true,
      value: { sceneId: "scene-1", clipId: "clip-1" },
    });
    await first;
    expect(command.onCreated).toHaveBeenCalledTimes(1);
  });

  it("surfaces a typed operation failure without running success effects", async () => {
    const onCreated = vi.fn();
    const onFailed = vi.fn();
    const result = await executeTimelineCreateSceneCommand({
      tracks: [videoTrack],
      activeTrackId: videoTrack.id,
      playheadTime: 3,
      gate: { inFlight: false },
      createAndPlaceScene: vi.fn().mockResolvedValue({
        success: false,
        error: { code: "PLACEMENT_FAILED", message: "Could not place scene." },
      }),
      onCreated,
      onFailed,
    });

    expect(result).toEqual({
      status: "failed",
      code: "PLACEMENT_FAILED",
      message: "Could not place scene.",
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith({
      code: "PLACEMENT_FAILED",
      message: "Could not place scene.",
    });
  });
});
