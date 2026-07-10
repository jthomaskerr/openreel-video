export const GENERATION_JOB_SCHEMA_VERSION = 2 as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type GenerationTarget =
  | { kind: "new-asset"; placeholderMediaId: string }
  | { kind: "new-version"; sourceMediaId: string; placeholderMediaId: string };

export interface GenerationTiming {
  source: "timeline" | "shot" | "manual";
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export type GenerationPlacementPolicy = "none" | "create-linked-clip" | "replace-selected-clip-media";
export interface GenerationPlacementState {
  policy: GenerationPlacementPolicy;
  status: "pending" | "applied" | "failed" | "skipped";
  appliedAt?: number;
  error?: GenerationError;
}
export type GenerationReferenceOrigin = "source" | "character" | "shot" | "user";
export interface ResolvedGenerationReference {
  mediaId: string;
  versionId?: string;
  origins: GenerationReferenceOrigin[];
  remoteInput: { kind: "upload-token"; value: string };
}
export interface ResolvedGenerationAudio {
  sourceMediaId: string;
  sourceVersionId: string;
  sourceClipId: string;
  projectStartSeconds: number;
  projectEndSeconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  mimeType: string;
  sha256: string;
  remoteInput: { kind: "upload-token"; value: string };
}
export interface GenerationContext {
  projectId: string;
  shotId?: string;
  clipId?: string;
  target: GenerationTarget;
  timing?: GenerationTiming;
  references: ResolvedGenerationReference[];
  audio?: ResolvedGenerationAudio;
  placementPolicy: GenerationPlacementPolicy;
}
export interface GenerationError { code: string; message?: string; field?: string; retryable: boolean }
export interface GenerationAttempt {
  attemptNumber: number;
  providerJobId?: string;
  startedAt: number;
  endedAt?: number;
  terminalError?: GenerationError;
}
export type GenerationCheckpointName =
  | "output-claimed" | "output-downloaded" | "output-verified" | "output-inspected"
  | "placeholder-finalized" | "shot-linked" | "placement-applied";
export interface GenerationCheckpointState { status: "pending" | "completed" | "failed"; timestamp?: number; error?: GenerationError }
export interface GenerationOutput { mediaId: string; versionId: string; mimeType: string; byteLength: number; sha256: string; width?: number; height?: number; durationSeconds?: number }
export interface GenerationJob {
  schemaVersion: typeof GENERATION_JOB_SCHEMA_VERSION;
  id: string;
  provider: string;
  modelId: string;
  modelSchemaVersion: string;
  status: "preparing" | "queued" | "running" | "completed" | "failed" | "canceling" | "canceled" | "needs-attention";
  createdAt: number;
  updatedAt: number;
  context: GenerationContext;
  providerInputs: Record<string, JsonValue>;
  attempts: GenerationAttempt[];
  checkpoints: Partial<Record<GenerationCheckpointName, GenerationCheckpointState>>;
  output?: GenerationOutput;
  error?: GenerationError;
  placement?: GenerationPlacementState;
}
export interface GenerationModelCapability {
  provider: string; modelId: string; schemaVersion: string; output: "image" | "video";
  mode: "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video";
  supportsAudio: boolean; sourceField?: string; referenceField?: string; audioField?: string;
  referenceMinimum?: number; referenceMaximum?: number;
}
export interface SanitizedGenerationProvenance {
  provider: string; modelId: string; modelSchemaVersion: string; jobId: string;
  timing?: GenerationTiming; sha256?: string; width?: number; height?: number; durationSeconds?: number;
  inputs: Record<string, JsonValue>;
  references: Array<{ mediaId: string; versionId?: string; origins: GenerationReferenceOrigin[] }>;
}
export interface ProjectCharacter { id: string; slug: string; displayName: string; primaryImageMediaId: string; primaryImageVersionId?: string }

