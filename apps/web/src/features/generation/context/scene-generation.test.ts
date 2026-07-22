import { describe, expect, it } from "vitest";

import type {
  GenerationContext,
  GenerationEntryContext as CanonicalGenerationEntryContext,
  ResolvedGenerationAudio,
  ResolvedGenerationReference,
} from "@openreel/music-video-domain/generation";

import {
  buildSceneGenerationRequest,
  SCENE_AUDIO_REQUIRES_PLACEMENT,
  SCENE_AUDIO_REQUIRES_SELECTION,
  resolveGenerationEntryContext,
  selectSceneGenerationContext,
  type GenerationEntryContext,
  type SceneGenerationTiming,
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

const audioFixture = (): ResolvedGenerationAudio => ({
  sourceMediaId: "audio-media",
  sourceVersionId: "audio-version",
  sourceClipId: "audio-clip",
  projectStartSeconds: 12,
  projectEndSeconds: 16,
  sourceStartSeconds: 4,
  sourceEndSeconds: 8,
  mimeType: "audio/wav",
  sha256: "audio-sha",
  uploadLeaseId: "audio-token",
  preparationStatus: "preparing",
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

describe("generation entry context resolver", () => {
  it.each([
    [
      "new asset",
      { kind: "new-asset" as const },
      {
        timingAbsent: true,
        audioEligible: false,
        defaultPlacementPolicy: "none",
        placementPolicy: "none",
      },
    ],
    [
      "unplaced shot",
      { kind: "unplaced-shot" as const, shotId: "shot-1" },
      {
        timingAbsent: true,
        audioEligible: false,
        defaultPlacementPolicy: "none",
        placementPolicy: "none",
      },
    ],
    [
      "explicit unlinked range",
      {
        kind: "unlinked-range" as const,
        rangeId: "range-1",
        startTime: 0,
        endTime: 2.5,
        destinationTrackId: "track-1",
      },
      {
        timingAbsent: false,
        audioEligible: false,
        defaultPlacementPolicy: "create-linked-clip",
        placementPolicy: "create-linked-clip",
        timing: {
          source: "manual",
          startSeconds: 0,
          endSeconds: 2.5,
          durationSeconds: 2.5,
        },
      },
    ],
    [
      "selected linked projection",
      {
        kind: "linked-projection" as const,
        shotId: "shot-1",
        clipId: "clip-b",
        startTime: 20,
        endTime: 25,
        supportsAudio: true,
      },
      {
        timingAbsent: false,
        audioEligible: true,
        defaultPlacementPolicy: "replace-selected-clip-media",
        placementPolicy: "replace-selected-clip-media",
        projection: { clipId: "clip-b" },
        timing: {
          source: "timeline",
          startSeconds: 20,
          endSeconds: 25,
          durationSeconds: 5,
        },
      },
    ],
  ] as const)(
    "%s",
    (_label, input, expected) =>
      expect(resolveGenerationEntryContext(input)).toMatchObject(expected),
  );

  it("preserves the complete explicit entry identity", () => {
    const entryContext: GenerationEntryContext = {
      kind: "unlinked-range",
      rangeId: "range-1",
      startTime: 0,
      endTime: 2,
      destinationTrackId: "track-1",
    };

    expect(resolveGenerationEntryContext(entryContext).entryContext).toEqual(entryContext);
  });

  it("requires explicit model audio capability", () => {
    expect(
      // @ts-expect-error linked projection capability is required by the input contract
      resolveGenerationEntryContext({
        kind: "linked-projection",
        shotId: "shot-1",
        clipId: "clip-1",
        startTime: 0,
        endTime: 2,
      }),
    ).toMatchObject({ errors: [{ code: "audio-capability-required" }] });
  });

  it.each([
    [{ kind: "unplaced-shot", shotId: "" } as const, "entry-context-invalid"],
    [{ kind: "unlinked-range", rangeId: "", startTime: 0, endTime: 2 } as const, "entry-context-invalid"],
    [{ kind: "linked-projection", shotId: "", clipId: "clip-1", startTime: 0, endTime: 2, supportsAudio: false } as const, "entry-context-invalid"],
  ] as const)("rejects empty entry identifier %#", (input, code) => {
    expect(resolveGenerationEntryContext(input).errors).toEqual([{ code }]);
  });

  it("does not call the audio port for any non-audio entry or unsupported projection", () => {
    const resolveAudioSource = () => {
      throw new Error("audio port must not be called");
    };
    const entries = [
      { kind: "new-asset" as const },
      { kind: "unplaced-shot" as const, shotId: "shot-1" },
      { kind: "unlinked-range" as const, rangeId: "range-1", startTime: 0, endTime: 2 },
    ];

    entries.forEach((entry) =>
      resolveGenerationEntryContext({ ...entry, audioSourceResolver: resolveAudioSource }),
    );
    resolveGenerationEntryContext({
      kind: "linked-projection",
      shotId: "shot-1",
      clipId: "clip-1",
      startTime: 0,
      endTime: 2,
      supportsAudio: false,
      audioSourceResolver: resolveAudioSource,
    });
  });

  it("honors an override on a selected projection", () => {
    const result = resolveGenerationEntryContext({
      kind: "linked-projection",
      shotId: "shot-1",
      clipId: "clip-b",
      startTime: 12,
      endTime: 16,
      supportsAudio: false,
      placementPolicy: "none",
    });

    expect(result).toMatchObject({
      defaultPlacementPolicy: "replace-selected-clip-media",
      placementPolicy: "none",
      audioEligible: false,
    });
  });

  it.each([
    ["zero span", { kind: "unlinked-range" as const, rangeId: "r", startTime: 0, endTime: 0 }],
    [
      "half span with non-finite end",
      {
        kind: "unlinked-range" as const,
        rangeId: "r",
        startTime: 0.5,
        endTime: Number.NaN,
      },
    ],
    [
      "negative start",
      {
        kind: "unlinked-range" as const,
        rangeId: "r",
        startTime: -1,
        endTime: 2,
      },
    ],
    [
      "equal bounds",
      {
        kind: "unlinked-range" as const,
        rangeId: "r",
        startTime: 2,
        endTime: 2,
      },
    ],
    [
      "reversed bounds",
      {
        kind: "unlinked-range" as const,
        rangeId: "r",
        startTime: 4,
        endTime: 3,
      },
    ],
    [
      "invalid selected projection",
      {
        kind: "linked-projection" as const,
        shotId: "shot-1",
        clipId: "clip-b",
        startTime: 12,
        endTime: 12,
        supportsAudio: true,
      },
    ],
  ] as const)("rejects %s", (_label, input) => {
    const result = resolveGenerationEntryContext(input);

    expect(result.errors).toEqual([{ code: "timing-invalid" }]);
    expect(result.audioEligible).toBe(false);
  });

  it("rejects duplicate selected projection identities", () => {
    expect(
      selectSceneGenerationContext({
        shotId: "shot-1",
        includeAudio: true,
        projectionClipId: "clip-1",
        projections: [projection("clip-1"), projection("clip-1")],
      }),
    ).toMatchObject({ status: "disabled", code: "projection-ambiguous" });
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

    const ref = (
      mediaId: string,
      token: string,
    ): Omit<ResolvedGenerationReference, "origins" | "uploadLeaseId"> &
      Required<Pick<ResolvedGenerationReference, "uploadLeaseId">> => ({
      id: `${mediaId}-ref`,
      order: 0,
      mediaId,
      state: "active",
      preparationStatus: "preparing",
      errorHistory: [],
      uploadLeaseId: token,
    });
    const audio = audioFixture();

    const request = buildSceneGenerationRequest({
      id: "request-1",
      projectId: "project-1",
      entryContext: {
        kind: "linked-projection",
        shotId: "shot-1",
        clipId: "clip-b",
        startTime: 12,
        endTime: 16,
      },
      selection,
      target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
      placementPolicy: "none",
      mode: "image-to-video",
      prompt: "A scene",
      modelId: "provider/model",
      modelSchemaVersion: "schema-v7",
      providerInputs: { prompt: "A scene" },
      references: {
        source: ref("source", "source-token"),
        characters: [ref("character", "character-token")],
        shotReferences: [ref("shared", "shared-token")],
        userReferences: [ref("shared", "user-shared-token"), ref("user", "user-token")],
      },
      audio,
    });

    expect(request).toMatchObject({
      id: "request-1",
      projectId: "project-1",
      provider: "wavespeed",
      modelId: "provider/model",
      modelSchemaVersion: "schema-v7",
      context: {
        projectId: "project-1",
        entryContext: {
          kind: "linked-projection",
          shotId: "shot-1",
          clipId: "clip-b",
          startTime: 12,
          endTime: 16,
        },
        mode: "image-to-video",
        prompt: "A scene",
        placementPolicy: "none",
        audioAssetId: "audio-media",
        audioRange: { startTime: 12, endTime: 16 },
      },
      providerInputs: { prompt: "A scene" },
    });

    expect(request.context.references).toHaveLength(4);
    expect(request.context.references.map((reference: ResolvedGenerationReference) => reference.order)).toEqual([1, 2, 3, 4]);
    expect(request.context.references[0]).toMatchObject({
      mediaId: "source",
      origins: ["source"],
      preparationStatus: "preparing",
      uploadLeaseId: "source-token",
    });
    expect(request.context.references[0]).toMatchObject({ id: "source-ref", state: "active", errorHistory: [] });
    expect(request.context.references[1]).toMatchObject({
      mediaId: "character",
      origins: ["character"],
      preparationStatus: "preparing",
      uploadLeaseId: "character-token",
    });
    expect(request.context.references[2]).toMatchObject({
      mediaId: "shared",
      origins: ["shot", "user"],
      preparationStatus: "preparing",
      uploadLeaseId: "shared-token",
    });
    expect(request.context.references[3]).toMatchObject({
      mediaId: "user",
      origins: ["user"],
      preparationStatus: "preparing",
      uploadLeaseId: "user-token",
    });
  });

  it("returns a canonical GenerationContext without unsafe casts", () => {
    const canonicalEntryContext: CanonicalGenerationEntryContext = { kind: "new-asset" };
    const request = buildSceneGenerationRequest({
      id: "request-canonical",
      projectId: "project-1",
      entryContext: canonicalEntryContext,
      mode: "text-to-image",
      prompt: "Library asset",
      selection: { status: "ready", includeAudio: false },
      target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
      placementPolicy: "none",
      modelId: "provider/model",
      modelSchemaVersion: "schema-v1",
      providerInputs: {},
    });

    const context: GenerationContext = request.context;
    expect(context.entryContext).toEqual(canonicalEntryContext);
    expect(context.placementPolicy).toBe("none");
  });

  it.each([
    { kind: "new-asset" as const },
    { kind: "unplaced-shot" as const, shotId: "shot-1" },
    { kind: "unlinked-range" as const, rangeId: "range-1", startTime: 0, endTime: 4 },
  ])("rejects audio for %s entry contexts", (entryContext) => {
    expect(() =>
      buildSceneGenerationRequest({
        id: "request-audio-mismatch",
        projectId: "project-1",
        entryContext,
        mode: "image-to-video",
        prompt: "Scene",
        selection: { status: "ready", includeAudio: false },
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        placementPolicy: entryContext.kind === "unlinked-range" ? "create-linked-clip" : "none",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
        audio: audioFixture(),
      }),
    ).toThrow("generation-audio-not-allowed-for-entry-context");
  });

  it("rejects linked selection timing that differs from entryContext", () => {
    const selection = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: true,
      projectionClipId: "clip-b",
      projections: [projection("clip-b", "shot-1", { startTime: 12, duration: 4 })],
    });
    if (selection.status !== "ready") throw new Error(selection.reason);

    expect(() =>
      buildSceneGenerationRequest({
        id: "request-selection-mismatch",
        projectId: "project-1",
        entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-b", startTime: 13, endTime: 17 },
        mode: "image-to-video",
        prompt: "Scene",
        selection,
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        placementPolicy: "replace-selected-clip-media",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
      }),
    ).toThrow("generation-entry-context-selection-mismatch");
  });

  it("rejects linked audio range that differs from entryContext", () => {
    const selection = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: true,
      projectionClipId: "clip-b",
      projections: [projection("clip-b")],
    });
    if (selection.status !== "ready") throw new Error(selection.reason);

    expect(() =>
      buildSceneGenerationRequest({
        id: "request-audio-range-mismatch",
        projectId: "project-1",
        entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-b", startTime: 12, endTime: 16 },
        mode: "image-to-video",
        prompt: "Scene",
        selection,
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        placementPolicy: "replace-selected-clip-media",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
        audio: { ...audioFixture(), projectStartSeconds: 13, projectEndSeconds: 17 },
      }),
    ).toThrow("generation-entry-context-audio-range-mismatch");
  });

  it("rejects linked audio when selection explicitly disables audio", () => {
    const selection = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: false,
      projectionClipId: "clip-b",
      projections: [projection("clip-b")],
    });
    if (selection.status !== "ready") throw new Error(selection.reason);

    expect(() =>
      buildSceneGenerationRequest({
        id: "request-audio-selection-mismatch",
        projectId: "project-1",
        entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-b", startTime: 12, endTime: 16 },
        mode: "image-to-video",
        prompt: "Scene",
        selection,
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        placementPolicy: "replace-selected-clip-media",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
        audio: audioFixture(),
      }),
    ).toThrow("generation-entry-context-audio-selection-mismatch");
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
        entryContext: { kind: "new-asset" },
        mode: "text-to-image",
        prompt: "",
        selection,
        target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
        placementPolicy: "none",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
      }).context,
    ).toEqual({
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      prompt: "",
      references: [],
      placementPolicy: "none",
    });
  });

  it("preserves user-selected placement override on selected projection", () => {
    const selection = selectSceneGenerationContext({
      shotId: "shot-1",
      includeAudio: true,
      projectionClipId: "clip-b",
      projections: [projection("clip-b")],
    });
    if (selection.status !== "ready") throw new Error(selection.reason);

    expect(
      buildSceneGenerationRequest({
        id: "request-2",
        projectId: "project-1",
        entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-b", startTime: 12, endTime: 16 },
        mode: "image-to-video",
        prompt: "A scene",
        selection,
        target: {
          kind: "new-version",
          sourceMediaId: "source-1",
          placeholderMediaId: "placeholder-1",
        },
        placementPolicy: "replace-selected-clip-media",
        modelId: "provider/model",
        modelSchemaVersion: "schema-v1",
        providerInputs: {},
      }).context.placementPolicy,
    ).toBe("replace-selected-clip-media");
  });

  it("serializes exact timing when linked placement is requested for an unlinked range", () => {
    const entryContext = {
      kind: "unlinked-range" as const,
      rangeId: "range-1",
      destinationTrackId: "track-1",
      startTime: 7,
      endTime: 11,
    };
    const resolved = resolveGenerationEntryContext({
      ...entryContext,
      placementPolicy: "create-linked-clip",
    });
    const timing: SceneGenerationTiming | undefined = resolved.timing;

    const request = buildSceneGenerationRequest({
      id: "request-unlinked-range",
      projectId: "project-1",
      entryContext,
      mode: "text-to-image",
      prompt: "A scene",
      selection: {
        status: "ready",
        includeAudio: false,
        timing,
      },
      target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
      placementPolicy: "create-linked-clip",
      modelId: "provider/model",
      modelSchemaVersion: "schema-v1",
      providerInputs: {},
    });

    expect(request.context.timing).toEqual({
      source: "manual",
      startSeconds: 7,
      endSeconds: 11,
      durationSeconds: 4,
    });
  });
});
