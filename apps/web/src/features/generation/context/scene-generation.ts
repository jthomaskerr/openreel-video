import type {
  GenerationContext,
  GenerationEntryContext,
  GenerationMode,
  GenerationPlacementPolicy,
  GenerationTarget,
  ResolvedGenerationAudio,
  ResolvedGenerationReference,
} from "@openreel/music-video-domain/generation";

export type { GenerationEntryContext } from "@openreel/music-video-domain/generation";

import {
  resolveGenerationReferences,
  type ContextDiagnostic,
  type GenerationTiming,
  type ResolvedReference,
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
  | "projection-timing-invalid"
  | "projection-ambiguous";

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
        source: "timeline" | "manual";
        startSeconds: number;
        endSeconds: number;
        durationSeconds: number;
      };
      audioInterval?: SceneGenerationAudioInterval;
    }
  | { status: "disabled"; code: SceneGenerationDisabledCode; reason: string };

type AudioSourceResolver = () => void;
type NonProjectionEntryContext = Exclude<GenerationEntryContext, { kind: "linked-projection" }>;
export type GenerationEntryContextInput =
  | (NonProjectionEntryContext & {
      placementPolicy?: GenerationPlacementPolicy;
      audioSourceResolver?: AudioSourceResolver;
    })
  | (Extract<GenerationEntryContext, { kind: "linked-projection" }> & {
      placementPolicy?: GenerationPlacementPolicy;
      supportsAudio: boolean;
      audioSourceResolver?: AudioSourceResolver;
    });

export interface GenerationEntryContextResult {
  kind: GenerationEntryContextInput["kind"];
  entryContext: GenerationEntryContext;
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

const invalidEntryContext = (code: "entry-context-invalid" | "audio-capability-required") => ({
  errors: [{ code }],
  warnings: [],
});

function toCanonicalEntryContext(input: GenerationEntryContextInput): GenerationEntryContext {
  if (input.kind === "linked-projection") {
    const { placementPolicy: _placementPolicy, supportsAudio: _supportsAudio, audioSourceResolver: _audioSourceResolver, ...entryContext } = input;
    return entryContext;
  }
  const { placementPolicy: _placementPolicy, audioSourceResolver: _audioSourceResolver, ...entryContext } = input;
  return entryContext;
}

const isFiniteRange = (startSeconds: number, endSeconds: number) =>
  Number.isFinite(startSeconds) &&
  Number.isFinite(endSeconds) &&
  startSeconds >= 0 &&
  endSeconds > startSeconds;

const isValidProjectionTiming = (projection: Pick<SceneGenerationProjection, "startTime" | "duration" | "inPoint" | "outPoint">) =>
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
  const { placementPolicy } = input;
  const entryContext = toCanonicalEntryContext(input);

  if (input.kind === "new-asset" || input.kind === "unplaced-shot") {
    const defaultPlacementPolicy = "none" as const;
    if (input.kind === "unplaced-shot" && input.shotId.length === 0) {
      return { kind: input.kind, entryContext, timingAbsent: true, audioEligible: false, defaultPlacementPolicy, placementPolicy: placementPolicy ?? defaultPlacementPolicy, ...invalidEntryContext("entry-context-invalid") };
    }
    return {
      kind: input.kind,
      entryContext,
      timingAbsent: true,
      audioEligible: false,
      defaultPlacementPolicy,
      placementPolicy: placementPolicy ?? defaultPlacementPolicy,
      errors: [],
      warnings: [],
    };
  }

  if (input.kind === "unlinked-range") {
    const defaultPlacementPolicy = "create-linked-clip" as const;
    if (input.rangeId.length === 0) {
      return { kind: input.kind, entryContext, timingAbsent: true, audioEligible: false, defaultPlacementPolicy, placementPolicy: placementPolicy ?? defaultPlacementPolicy, ...invalidEntryContext("entry-context-invalid") };
    }
    if (!isFiniteRange(input.startTime, input.endTime)) {
      const invalid = invalidTiming();
      return {
        kind: input.kind,
        entryContext,
        timingAbsent: true,
        audioEligible: false,
        defaultPlacementPolicy,
        placementPolicy: placementPolicy ?? defaultPlacementPolicy,
        ...invalid,
      };
    }

    const timing: GenerationTiming = {
      source: "manual",
      startSeconds: input.startTime,
      endSeconds: input.endTime,
      durationSeconds: input.endTime - input.startTime,
    };

    return {
      kind: input.kind,
      entryContext,
      timingAbsent: false,
      timing,
      audioEligible: false,
      defaultPlacementPolicy,
      placementPolicy: placementPolicy ?? defaultPlacementPolicy,
      errors: [],
      warnings: [],
    };
  }

  const defaultPlacementPolicy = "replace-selected-clip-media" as const;
  if (input.shotId.length === 0 || input.clipId.length === 0) {
    return { kind: input.kind, entryContext, timingAbsent: true, audioEligible: false, defaultPlacementPolicy, placementPolicy: placementPolicy ?? defaultPlacementPolicy, ...invalidEntryContext("entry-context-invalid") };
  }
  if (input.supportsAudio === undefined) {
    return { kind: input.kind, entryContext, timingAbsent: true, audioEligible: false, defaultPlacementPolicy, placementPolicy: placementPolicy ?? defaultPlacementPolicy, ...invalidEntryContext("audio-capability-required") };
  }
  const projection = {
    clipId: input.clipId,
    linkedShotId: input.shotId,
    startTime: input.startTime,
    duration: input.endTime - input.startTime,
    inPoint: 0,
    outPoint: input.endTime - input.startTime,
  } satisfies SceneGenerationProjection;
  if (!isValidProjectionTiming(projection)) {
    const invalid = invalidTiming();
    return {
      kind: input.kind,
      entryContext,
      timingAbsent: true,
      projection,
      audioEligible: false,
      defaultPlacementPolicy,
      placementPolicy: placementPolicy ?? defaultPlacementPolicy,
      ...invalid,
    };
  }

  const timing: GenerationTiming = {
    source: "timeline",
    startSeconds: input.startTime,
    endSeconds: input.endTime,
    durationSeconds: input.endTime - input.startTime,
  };

  if (input.supportsAudio && input.audioSourceResolver) input.audioSourceResolver();

  return {
    kind: input.kind,
    entryContext,
    timingAbsent: false,
    projection,
    timing,
    audioEligible: input.supportsAudio,
    defaultPlacementPolicy,
    placementPolicy: placementPolicy ?? defaultPlacementPolicy,
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

  const matchingProjections = input.projections.filter(
    (candidate) => candidate.clipId === input.projectionClipId,
  );
  if (matchingProjections.length === 0) {
    return {
      status: "disabled",
      code: "projection-not-found",
      reason: "The selected timeline projection no longer exists.",
    };
  }
  if (matchingProjections.length > 1) {
    return {
      status: "disabled",
      code: "projection-ambiguous",
      reason: "More than one timeline projection matches the selected identity.",
    };
  }
  const projection = matchingProjections[0];
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

type ReferenceWithoutOrigin = Omit<ResolvedGenerationReference, "origins"> & {
  uploadLeaseId: string;
};

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

function assertEntryContextAgreement(input: {
  entryContext: GenerationEntryContext;
  selection: Extract<SceneGenerationContextResult, { status: "ready" }>;
  audio?: ResolvedGenerationAudio;
}): void {
  const { entryContext, selection, audio } = input;
  const hasSelectionTiming = selection.timing !== undefined;
  const hasSelectionProjection = selection.projection !== undefined;

  if (entryContext.kind !== "linked-projection" && audio) {
    throw new TypeError("generation-audio-not-allowed-for-entry-context");
  }

  if (entryContext.kind === "new-asset" || entryContext.kind === "unplaced-shot") {
    if (hasSelectionTiming || hasSelectionProjection || selection.audioInterval) {
      throw new TypeError("generation-entry-context-selection-mismatch");
    }
    return;
  }

  if (entryContext.kind === "unlinked-range") {
    if (
      hasSelectionProjection ||
      !selection.timing ||
      selection.timing.source !== "manual" ||
      selection.timing.startSeconds !== entryContext.startTime ||
      selection.timing.endSeconds !== entryContext.endTime
    ) {
      throw new TypeError("generation-entry-context-selection-mismatch");
    }
    return;
  }

  const projection = selection.projection;
  if (
    !projection ||
    !selection.timing ||
    projection.clipId !== entryContext.clipId ||
    projection.linkedShotId !== entryContext.shotId ||
    projection.startTime !== entryContext.startTime ||
    projection.startTime + projection.duration !== entryContext.endTime ||
    selection.timing.source !== "timeline" ||
    selection.timing.startSeconds !== entryContext.startTime ||
    selection.timing.endSeconds !== entryContext.endTime
  ) {
    throw new TypeError("generation-entry-context-selection-mismatch");
  }

  if (
    audio &&
    !selection.includeAudio
  ) {
    throw new TypeError("generation-entry-context-audio-selection-mismatch");
  }

  if (
    audio &&
    (audio.projectStartSeconds !== entryContext.startTime ||
      audio.projectEndSeconds !== entryContext.endTime)
  ) {
    throw new TypeError("generation-entry-context-audio-range-mismatch");
  }
}

export function buildSceneGenerationRequest(input: {
  id: string;
  projectId: string;
  entryContext: GenerationEntryContext;
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  selection: Extract<SceneGenerationContextResult, { status: "ready" }>;
  target: GenerationTarget;
  placementPolicy: GenerationPlacementPolicy;
  modelId: string;
  modelSchemaVersion: string;
  providerInputs: Record<string, unknown>;
  references?: SceneGenerationReferenceGroups;
  audio?: ResolvedGenerationAudio;
}): SceneGenerationRequest {
  assertEntryContextAgreement(input);
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
  const resolvedByIdentity = new Map<string, ResolvedReference>();
  for (const reference of resolveGenerationReferences({
    source: groups.source ? toResolverInput(groups.source) : undefined,
    characters: (groups.characters ?? []).map(toResolverInput),
    shotReferences: (groups.shotReferences ?? []).map(toResolverInput),
    userReferences: (groups.userReferences ?? []).map(toResolverInput),
  })) {
    resolvedByIdentity.set(`${reference.mediaId}\u0000${reference.versionId ?? ""}`, reference);
  }
  const references = Array.from(inputByIdentity.entries()).map(([identity, original], index) => {
    const reference = resolvedByIdentity.get(identity);
    if (!reference) throw new TypeError("generation-reference-resolution-mismatch");
    return {
      ...original,
      order: index + 1,
      origins: reference.origins,
    } satisfies ResolvedGenerationReference;
  });

  const context: GenerationContext = {
    projectId: input.projectId,
    entryContext: input.entryContext,
    mode: input.mode,
    prompt: input.prompt,
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    references,
    ...(input.audio
      ? {
          audioAssetId: input.audio.sourceMediaId,
          audioRange: { startTime: input.audio.projectStartSeconds, endTime: input.audio.projectEndSeconds },
        }
      : {}),
    ...(input.selection.timing ? { timing: input.selection.timing } : {}),
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
