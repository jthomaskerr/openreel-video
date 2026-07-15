import { describe, expect, it } from "vitest";

import {
  buildSceneGenerationRequest,
  SCENE_AUDIO_REQUIRES_PLACEMENT,
  SCENE_AUDIO_REQUIRES_SELECTION,
  selectSceneGenerationContext,
  type SceneGenerationProjection,
} from "./scene-generation";

const projection = (
  clipId: string,
  linkedShotId = "shot-1",
  overrides: Partial<SceneGenerationProjection> = {},
): SceneGenerationProjection => ({
  clipId,
  linkedShotId,
  startTime: 12,
  duration: 4,
  inPoint: 2,
  outPoint: 6,
  ...overrides,
});

describe("scene generation context truth table", () => {
  it("allows the existing visual path for an unplaced scene", () => {
    expect(
      selectSceneGenerationContext({
        shotId: "shot-1",
        includeAudio: false,
        projections: [],
      }),
    ).toEqual({ status: "ready", includeAudio: false });
  });

  it("requires placement for audio on an unplaced scene", () => {
    expect(
      selectSceneGenerationContext({
        shotId: "shot-1",
        includeAudio: true,
        projections: [],
      }),
    ).toEqual({
      status: "disabled",
      code: "audio-requires-placement",
      reason: SCENE_AUDIO_REQUIRES_PLACEMENT,
    });
  });

  it("never guesses a projection when a placed scene is opened from Media", () => {
    expect(
      selectSceneGenerationContext({
        shotId: "shot-1",
        includeAudio: true,
        projections: [projection("clip-a"), projection("clip-b")],
      }),
    ).toEqual({
      status: "disabled",
      code: "audio-requires-selected-projection",
      reason: SCENE_AUDIO_REQUIRES_SELECTION,
    });
  });

  it("uses only the explicitly selected projection timing and trim", () => {
    const selected = projection("clip-b", "shot-1", {
      startTime: 20,
      duration: 5,
      inPoint: 3,
      outPoint: 8,
    });
    const before = JSON.stringify(selected);
    const result = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: true,
      projectionClipId: "clip-b",
      projections: [
        projection("clip-a", "shot-1", { startTime: 1, duration: 2 }),
        selected,
      ],
    });

    expect(result).toMatchObject({
      status: "ready",
      projection: { clipId: "clip-b" },
      timing: {
        source: "timeline",
        startSeconds: 20,
        endSeconds: 25,
        durationSeconds: 5,
      },
      audioInterval: {
        projectStartSeconds: 20,
        projectEndSeconds: 25,
        sourceStartSeconds: 3,
        sourceEndSeconds: 8,
      },
    });
    expect(JSON.stringify(selected)).toBe(before);
  });

  it.each([
    ["missing", "projection-not-found"],
    ["other-scene", "projection-scene-mismatch"],
    ["invalid", "projection-timing-invalid"],
  ] as const)("disables %s projection state", (scenario, code) => {
    const projections =
      scenario === "missing"
        ? []
        : scenario === "other-scene"
          ? [projection("selected", "shot-2")]
          : [projection("selected", "shot-1", { duration: 0 })];
    expect(
      selectSceneGenerationContext({
        shotId: "shot-1",
        includeAudio: scenario !== "invalid",
        projectionClipId: "selected",
        projections,
      }),
    ).toMatchObject({ status: "disabled", code });
  });
});

describe("scene generation request fixture", () => {
  it("serializes model, selected clip timing, audio, and ordered references", () => {
    const selection = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: true,
      projectionClipId: "clip-b",
      projections: [projection("clip-b")],
    });
    if (selection.status !== "ready") throw new Error(selection.reason);

    const ref = (mediaId: string, token: string) => ({
      mediaId,
      remoteInput: { kind: "upload-token" as const, value: token },
    });
    const audio = {
      sourceMediaId: "audio-media",
      sourceVersionId: "audio-version",
      sourceClipId: "audio-clip",
      projectStartSeconds: 12,
      projectEndSeconds: 16,
      sourceStartSeconds: 4,
      sourceEndSeconds: 8,
      mimeType: "audio/wav",
      sha256: "audio-sha",
      remoteInput: { kind: "upload-token" as const, value: "audio-token" },
    };

    const request = buildSceneGenerationRequest({
      id: "request-1",
      projectId: "project-1",
      shotId: "shot-1",
      selection,
      target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
      placementPolicy: "none",
      modelId: "provider/model",
      modelSchemaVersion: "schema-v7",
      providerInputs: { prompt: "A scene" },
      references: {
        source: ref("source", "source-token"),
        characters: [ref("character", "character-token")],
        shotReferences: [ref("shared", "shared-token")],
        userReferences: [
          ref("shared", "ignored-lower-precedence-token"),
          ref("user", "user-token"),
        ],
      },
      audio,
    });

    expect(request).toEqual({
      id: "request-1",
      projectId: "project-1",
      provider: "wavespeed",
      modelId: "provider/model",
      modelSchemaVersion: "schema-v7",
      providerInputs: { prompt: "A scene" },
      context: {
        projectId: "project-1",
        shotId: "shot-1",
        clipId: "clip-b",
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        timing: {
          source: "timeline",
          startSeconds: 12,
          endSeconds: 16,
          durationSeconds: 4,
        },
        references: [
          { ...ref("source", "source-token"), origins: ["source"] },
          { ...ref("character", "character-token"), origins: ["character"] },
          {
            ...ref("shared", "shared-token"),
            origins: ["shot", "user"],
          },
          { ...ref("user", "user-token"), origins: ["user"] },
        ],
        audio,
        placementPolicy: "none",
      },
    });
  });

  it("does not add timing or clip identity to an unplaced visual request", () => {
    const selection = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: false,
      projections: [],
    });
    if (selection.status !== "ready") throw new Error(selection.reason);

    expect(
      buildSceneGenerationRequest({
        id: "request-1",
        projectId: "project-1",
        shotId: "shot-1",
        selection,
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        placementPolicy: "none",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
      }).context,
    ).toEqual({
      projectId: "project-1",
      shotId: "shot-1",
      target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
      references: [],
      placementPolicy: "none",
    });
  });
});
