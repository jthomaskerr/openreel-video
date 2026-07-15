import type {
  GenerationContext,
  GenerationPlacementPolicy,
  GenerationTarget,
  ResolvedGenerationAudio,
  ResolvedGenerationReference,
} from "@openreel/music-video-domain/generation";

import { resolveGenerationReferences } from "./index";

export const SCENE_AUDIO_REQUIRES_PLACEMENT =
  "Place this scene on the timeline to generate audio from its timing.";
export const SCENE_AUDIO_REQUIRES_SELECTION =
  "Select a timeline projection to generate audio from its timing.";

export type SceneGenerationDisabledCode =
  | "audio-requires-placement"
  | "audio-requires-selected-projection"
  | "projection-not-found"
  | "projection-scene-mismatch"
  | "projection-timing-invalid";

/** Temporary structural seam for the WP2 projection selector. */
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
  | {
      status: "disabled";
      code: SceneGenerationDisabledCode;
      reason: string;
    };

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
