import type {
  GenerationContext,
  GenerationPlacementPolicy,
  GenerationTarget,
  ResolvedGenerationAudio,
  ResolvedGenerationReference,
} from "@openreel/music-video-domain/generation";

import {
  resolveGenerationReferences,
  type ContextDiagnostic,
  type GenerationTiming,
} from "./index";

export const SCENE_AUDIO_REQUIRES_PLACEMENT =
  "Place scene on timeline generate audio from timing.";
export const SCENE_AUDIO_REQUIRES_SELECTION =
  "Select timeline projection generate audio timing.";

export type SceneGenerationDisabledCode =
  | "audio-requires-placement"
  | "audio-requires-selected-projection"
  | "projection-not-found"
  | "projection-scene-mismatch"
  | "projection-timing-invalid";

export interface SceneGenerationProjection {
  clipId: string;
  linkedShotId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

export interface SceneGenerationAudioInterval {
  projectStartSeconds: number;
  projectEndSeconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
}

export type SceneGenerationContextResult =
  | {
      status: "ready";
      includeAudio: boolean;
      projection?: SceneGenerationProjection;
      timing?: {
        source: "timeline";
        startSeconds: number;
        endSeconds: number;
        durationSeconds: number;
      };
      audioInterval?: SceneGenerationAudioInterval;
    }
  | { status: "disabled"; code: SceneGenerationDisabledCode; reason: string };

export type GenerationEntryContextInput =
  | { kind: "new-asset"; placementPolicy?: GenerationPlacementPolicy }
  | { kind: "unplaced-shot"; placementPolicy?: GenerationPlacementPolicy }
  | {
      kind: "explicit-unlinked-range";
      startSeconds: number;
      endSeconds: number;
      placementPolicy?: GenerationPlacementPolicy;
    }
  | {
      kind: "selected-linked-projection";
      projection: SceneGenerationProjection;
      supportsAudio: boolean;
      placementPolicy?: GenerationPlacementPolicy;
    };

export interface GenerationEntryContextResult {
  kind: GenerationEntryContextInput["kind"];
  timingAbsent: boolean;
  timing?: GenerationTiming;
  projection?: SceneGenerationProjection;
  audioEligible: boolean;
  defaultPlacementPolicy: GenerationPlacementPolicy;
  placementPolicy: GenerationPlacementPolicy;
  errors: ContextDiagnostic[];
  warnings: ContextDiagnostic[];
}

const invalidTiming = (): { errors: ContextDiagnostic[]; warnings: [] } => ({
  errors: [{ code: "timing-invalid" }],
  warnings: [],
});

const isFiniteRange = (startSeconds: number, endSeconds: number) =>
  Number.isFinite(startSeconds) &&
  Number.isFinite(endSeconds) &&
  startSeconds >= 0 &&
  endSeconds > startSeconds;

const isValidProjectionTiming = (projection: SceneGenerationProjection) =>
  Number.isFinite(projection.startTime) &&
  projection.startTime >= 0 &&
  Number.isFinite(projection.duration) &&
  projection.duration > 0 &&
  Number.isFinite(projection.inPoint) &&
  projection.inPoint >= 0 &&
  Number.isFinite(projection.outPoint) &&
  projection.outPoint > projection.inPoint;

export function resolveGenerationEntryContext(
  input: GenerationEntryContextInput,
): GenerationEntryContextResult {
  if (input.kind === "new-asset" || input.kind === "unplaced-shot") {
    const defaultPlacementPolicy = "none" as const;
    return {
      kind: input.kind,
      timingAbsent: true,
      audioEligible: false,
      defaultPlacementPolicy,
      placementPolicy: input.placementPolicy ?? defaultPlacementPolicy,
      errors: [],
      warnings: [],
    };
  }

  if (input.kind === "explicit-unlinked-range") {
    const defaultPlacementPolicy = "create-linked-clip" as const;
    if (!isFiniteRange(input.startSeconds, input.endSeconds)) {
      const invalid = invalidTiming();
      return {
        kind: input.kind,
        timingAbsent: true,
        audioEligible: false,
        defaultPlacementPolicy,
        placementPolicy: input.placementPolicy ?? defaultPlacementPolicy,
        ...invalid,
      };
    }

    const timing: GenerationTiming = {
      source: "manual",
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      durationSeconds: input.endSeconds - input.startSeconds,
    };

    return {
      kind: input.kind,
      timingAbsent: false,
      timing,
      audioEligible: false,
      defaultPlacementPolicy,
      placementPolicy: input.placementPolicy ?? defaultPlacementPolicy,
      errors: [],
      warnings: [],
    };
  }

  const defaultPlacementPolicy = "replace-selected-clip-media" as const;
  if (!isValidProjectionTiming(input.projection)) {
    const invalid = invalidTiming();
    return {
      kind: input.kind,
      timingAbsent: true,
      projection: input.projection,
      audioEligible: false,
      defaultPlacementPolicy,
      placementPolicy: input.placementPolicy ?? defaultPlacementPolicy,
      ...invalid,
    };
  }

  const timing: GenerationTiming = {
    source: "timeline",
    startSeconds: input.projection.startTime,
    endSeconds: input.projection.startTime + input.projection.duration,
    durationSeconds: input.projection.duration,
  };

  return {
    kind: input.kind,
    timingAbsent: false,
    projection: input.projection,
    timing,
    audioEligible: input.supportsAudio,
    defaultPlacementPolicy,
    placementPolicy: input.placementPolicy ?? defaultPlacementPolicy,
    errors: [],
    warnings: [],
  };
}

export function selectSceneGenerationContext(input: {
  shotId: string;
  includeAudio: boolean;
  projectionClipId?: string;
  projections: readonly SceneGenerationProjection[];
}): SceneGenerationContextResult {
  const linkedProjections = input.projections.filter(
    (projection) => projection.linkedShotId === input.shotId,
  );

  if (!input.projectionClipId) {
    if (!input.includeAudio) {
      return { status: "ready", includeAudio: false };
    }
    return linkedProjections.length === 0
      ? {
          status: "disabled",
          code: "audio-requires-placement",
          reason: SCENE_AUDIO_REQUIRES_PLACEMENT,
        }
      : {
          status: "disabled",
          code: "audio-requires-selected-projection",
          reason: SCENE_AUDIO_REQUIRES_SELECTION,
        };
  }

  const projection = input.projections.find(
    (candidate) => candidate.clipId === input.projectionClipId,
  );
  if (!projection) {
    return {
      status: "disabled",
      code: "projection-not-found",
      reason: "The selected timeline projection no longer exists.",
    };
  }
  if (projection.linkedShotId !== input.shotId) {
    return {
      status: "disabled",
      code: "projection-scene-mismatch",
      reason: "The selected timeline projection belongs to another scene.",
    };
  }
  if (
    !Number.isFinite(projection.startTime) ||
    projection.startTime < 0 ||
    !Number.isFinite(projection.duration) ||
    projection.duration <= 0 ||
    !Number.isFinite(projection.inPoint) ||
    projection.inPoint < 0 ||
    !Number.isFinite(projection.outPoint) ||
    projection.outPoint <= projection.inPoint
  ) {
    return {
      status: "disabled",
      code: "projection-timing-invalid",
      reason: "The selected timeline projection has invalid timing.",
    };
  }

  const timing = {
    source: "timeline" as const,
    startSeconds: projection.startTime,
    endSeconds: projection.startTime + projection.duration,
    durationSeconds: projection.duration,
  };
  return {
    status: "ready",
    includeAudio: input.includeAudio,
    projection,
    timing,
    ...(input.includeAudio
      ? {
          audioInterval: {
            projectStartSeconds: timing.startSeconds,
            projectEndSeconds: timing.endSeconds,
            sourceStartSeconds: projection.inPoint,
            sourceEndSeconds: projection.outPoint,
          },
        }
      : {}),
  };
}

type ReferenceWithoutOrigin = Omit<ResolvedGenerationReference, "origins">;

export interface SceneGenerationReferenceGroups {
  source?: ReferenceWithoutOrigin;
  characters?: readonly ReferenceWithoutOrigin[];
  shotReferences?: readonly ReferenceWithoutOrigin[];
  userReferences?: readonly ReferenceWithoutOrigin[];
}

export interface SceneGenerationRequest {
  id: string;
  projectId: string;
  provider: "wavespeed";
  modelId: string;
  modelSchemaVersion: string;
  context: GenerationContext;
  providerInputs: Record<string, unknown>;
}

export function buildSceneGenerationRequest(input: {
  id: string;
  projectId: string;
  shotId: string;
  selection: Extract<SceneGenerationContextResult, { status: "ready" }>;
  target: GenerationTarget;
  placementPolicy: GenerationPlacementPolicy;
  modelId: string;
  modelSchemaVersion: string;
  providerInputs: Record<string, unknown>;
  references?: SceneGenerationReferenceGroups;
  audio?: ResolvedGenerationAudio;
}): SceneGenerationRequest {
  const groups = input.references ?? {};
  const toResolverInput = (reference: ReferenceWithoutOrigin) => ({
    mediaId: reference.mediaId,
    ...(reference.versionId ? { versionId: reference.versionId } : {}),
    accessible: true,
  });
  const orderedInputs = [
    ...(groups.source ? [groups.source] : []),
    ...(groups.characters ?? []),
    ...(groups.shotReferences ?? []),
    ...(groups.userReferences ?? []),
  ];
  const inputByIdentity = new Map<string, ReferenceWithoutOrigin>();
  for (const reference of orderedInputs) {
    const identity = `${reference.mediaId}\u0000${reference.versionId ?? ""}`;
    if (!inputByIdentity.has(identity)) inputByIdentity.set(identity, reference);
  }
  const references: ResolvedGenerationReference[] = resolveGenerationReferences({
    source: groups.source ? toResolverInput(groups.source) : undefined,
    characters: (groups.characters ?? []).map(toResolverInput),
    shotReferences: (groups.shotReferences ?? []).map(toResolverInput),
    userReferences: (groups.userReferences ?? []).map(toResolverInput),
  }).map((reference) => {
    const original = inputByIdentity.get(
      `${reference.mediaId}\u0000${reference.versionId ?? ""}`,
    );
    if (!original) throw new TypeError("generation-reference-resolution-mismatch");
    return {
      mediaId: reference.mediaId,
      ...(reference.versionId ? { versionId: reference.versionId } : {}),
      origins: reference.origins,
      remoteInput: original.remoteInput,
    };
  });

  const context: GenerationContext = {
    projectId: input.projectId,
    shotId: input.shotId,
    ...(input.selection.projection
      ? { clipId: input.selection.projection.clipId }
      : {}),
    target: input.target,
    ...(input.selection.timing ? { timing: input.selection.timing } : {}),
    references,
    ...(input.audio ? { audio: input.audio } : {}),
    placementPolicy: input.placementPolicy,
  };

  return {
    id: input.id,
    projectId: input.projectId,
    provider: "wavespeed",
    modelId: input.modelId,
    modelSchemaVersion: input.modelSchemaVersion,
    context,
    providerInputs: input.providerInputs,
  };
}
