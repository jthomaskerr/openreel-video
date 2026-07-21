/** Authoritative Generation V2 persistence and controller cache. */
import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  deriveWaveSpeedFieldMap,
  parseWaveSpeedRequestSchema,
  validateWaveSpeedProviderInputs,
  type WaveSpeedRequestSchema,
} from "@openreel/core/generation/wavespeed";
import {
  assertGenerationV2SubmissionAllowed,
  GenerationRouteIdentitySchema,
  parseGenerationJob,
  type GenerationEntryContext,
  type GenerationError,
  type GenerationJob as DurableGenerationJob,
  type GenerationPlacementPolicy,
  type GenerationRouteIdentity,
  type JsonValue,
} from "@openreel/music-video-domain/generation";
import {
  createGenerationController,
  type GenerationController,
  GenerationControllerJobCache,
  GenerationStoredRecord,
  LegacyGenerationNeedsAttention,
  ReconciledGenerationJob,
  ReconciliationClaimResult,
  SubmissionClaimResult,
} from "../features/generation/controller";
import {
  buildSceneGenerationRequest,
  resolveGenerationEntryContext,
  type SceneGenerationContextResult,
} from "../features/generation/context/scene-generation";
import type { GenerationReferenceRecoveryPorts } from "../features/generation/drafts/v2";
import type {
  GenerationAudioDraft,
  GenerationDraft,
  GenerationMutationPort,
  GenerationReferenceDraft,
} from "../features/generation/submit-generation";
import {
  allowedRecoveryActionsForJob,
  type RecoveryAction,
} from "../features/generation/recovery/state-machine";
import { resolveMainAudioSource } from "../features/generation/context";

export type GenerationProvider = DurableGenerationJob["provider"];
export type GenerationJobStatus = DurableGenerationJob["status"];
export type GenerationJob = DurableGenerationJob;

interface GenerationJobStore {
  records: GenerationStoredRecord[];
  legacyAttention: LegacyGenerationNeedsAttention[];
  jobs: DurableGenerationJob[];
  hydrate: (job: DurableGenerationJob) => DurableGenerationJob;
  saveLegacyAttention: (job: LegacyGenerationNeedsAttention) => void;
  getJobsForProject: (projectId: string) => DurableGenerationJob[];
}

function timestamp(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectViews(records: readonly GenerationStoredRecord[]): DurableGenerationJob[] {
  return records.flatMap((record) => record.kind === "v2" ? [record.job] : []);
}

const serverMemoryStorage = new Map<string, string>();
const generationPersistenceStorage = createJSONStorage(() => {
  if (typeof document !== "undefined" && typeof window !== "undefined") return window.localStorage;
  return {
    getItem: (key: string) => serverMemoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { serverMemoryStorage.set(key, value); },
    removeItem: (key: string) => { serverMemoryStorage.delete(key); },
  };
});

function stripForbiddenReleaseFlag(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripForbiddenReleaseFlag);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "generationV2ReleaseEnabled")
    .map(([key, child]) => [key, stripForbiddenReleaseFlag(child)]));
}

function legacyPayload(value: unknown): Record<string, JsonValue> {
  const cleaned = stripForbiddenReleaseFlag(JSON.parse(JSON.stringify(value ?? {})));
  return cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
    ? cleaned as Record<string, JsonValue>
    : {};
}

export function migrateGenerationJobPersistence(input: unknown): { records: GenerationStoredRecord[]; legacyAttention: LegacyGenerationNeedsAttention[] } {
  const wrapper = input && typeof input === "object" && "state" in input
    ? input as { state?: unknown }
    : { state: input };
  const state = wrapper.state && typeof wrapper.state === "object" ? wrapper.state as Record<string, unknown> : {};
  if (Array.isArray(state.records)) {
    const records: GenerationStoredRecord[] = [];
    for (const candidate of state.records) {
      if (candidate && typeof candidate === "object" && (candidate as any).kind === "v2") {
        const candidateJob = (candidate as any).job;
        try {
          records.push({ kind: "v2", job: parseGenerationJob(candidateJob) });
        } catch {
          const unsafe = candidateJob && typeof candidateJob === "object"
            ? candidateJob as Record<string, unknown>
            : {};
          records.push({
            kind: "legacy",
            storeKey: String(unsafe.id ?? `invalid-v2-${records.length}`),
            projectId: String(unsafe.projectId ?? ""),
            payload: legacyPayload(unsafe),
          });
        }
      } else if (candidate && typeof candidate === "object" && (candidate as any).kind === "legacy") {
        const record = candidate as any;
        records.push({ kind: "legacy", storeKey: String(record.storeKey), projectId: String(record.projectId), payload: legacyPayload(record.payload) });
      } else {
        const unsafe = candidate && typeof candidate === "object"
          ? candidate as Record<string, unknown>
          : {};
        records.push({
          kind: "legacy",
          storeKey: String(unsafe.id ?? `invalid-record-${records.length}`),
          projectId: String(unsafe.projectId ?? ""),
          payload: legacyPayload(candidate),
        });
      }
    }
    return {
      records,
      legacyAttention: Array.isArray(state.legacyAttention)
        ? state.legacyAttention.filter((candidate): candidate is LegacyGenerationNeedsAttention =>
            Boolean(candidate && typeof candidate === "object" && (candidate as any).kind === "legacy" && (candidate as any).status === "needs-attention"))
        : [],
    };
  }
  const rows = Array.isArray(state.jobs) ? state.jobs : [];
  return {
    records: rows.map((row, index) => {
      const candidate = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return {
        kind: "legacy" as const,
        storeKey: String(candidate.id ?? `legacy-${index}`),
        projectId: String(candidate.projectId ?? ""),
        payload: legacyPayload(candidate),
      };
    }),
    legacyAttention: [],
  };
}

const createGenerationJobState: StateCreator<GenerationJobStore> = (set, get) => ({
  records: [],
  legacyAttention: [],
  jobs: [],
  hydrate: (input) => {
    const job = parseGenerationJob(input);
    const current = get().records.find(
      (record): record is Extract<GenerationStoredRecord, { kind: "v2" }> =>
        record.kind === "v2" && record.job.id === job.id,
    )?.job;
    if (current) {
      if (current.projectId !== job.projectId || current.context.projectId !== job.context.projectId) {
        throw new Error("generation-status-ownership-mismatch");
      }
      if (job.attempt < current.attempt || (job.attempt === current.attempt && timestamp(job.updatedAt) < timestamp(current.updatedAt))) {
        return current;
      }
      if (job.attempt === current.attempt && current.providerJobId && job.providerJobId && current.providerJobId !== job.providerJobId) {
        throw new Error("generation-provider-response-invalid");
      }
    }
    set((state) => {
      const records = [...state.records.filter((record) => record.kind !== "v2" || record.job.id !== job.id), { kind: "v2" as const, job }];
      return { records, jobs: projectViews(records) };
    });
    return job;
  },
  saveLegacyAttention: (job) => set((state) => {
    const records = state.records.filter((candidate) => candidate.kind !== "legacy" || candidate.storeKey !== job.storeKey);
    return {
      records,
      jobs: projectViews(records),
      legacyAttention: [...state.legacyAttention.filter((candidate) => candidate.storeKey !== job.storeKey), job],
    };
  }),
  getJobsForProject: (projectId) => get().jobs.filter((job) => job.projectId === projectId),
});

export const useGenerationJobStore = typeof document === "undefined"
  ? create<GenerationJobStore>()(createGenerationJobState)
  : create<GenerationJobStore>()(
    persist(
      createGenerationJobState,
    {
      name: "generation-jobs",
      version: 2,
      storage: generationPersistenceStorage,
      partialize: (state) => ({ records: state.records, legacyAttention: state.legacyAttention }) as GenerationJobStore,
      migrate: (persisted) => migrateGenerationJobPersistence(persisted) as GenerationJobStore,
      merge: (persisted, current) => {
        const migrated = migrateGenerationJobPersistence(persisted);
        return { ...current, ...migrated, jobs: projectViews(migrated.records) };
      },
    },
    ),
  );

export function hydrateGenerationJob(job: DurableGenerationJob): DurableGenerationJob {
  return useGenerationJobStore.getState().hydrate(job);
}

type Deferred = {
  claimId: string;
  promise: Promise<DurableGenerationJob>;
  resolve: (job: DurableGenerationJob) => void;
  reject: (error: GenerationError) => void;
};

function deferred(): Deferred {
  let resolve!: (job: DurableGenerationJob) => void;
  let reject!: (error: GenerationError) => void;
  const promise = new Promise<DurableGenerationJob>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { claimId: globalThis.crypto?.randomUUID?.() ?? `claim-${Date.now()}-${Math.random()}`, promise, resolve, reject };
}

const submissionClaims = new Map<string, Deferred & { completed?: DurableGenerationJob }>();
const reconciliationClaims = new Map<string, Deferred & { completed?: DurableGenerationJob }>();
const reconciliationKey = (projectId: string, jobId: string) => `${projectId}\u0000${jobId}`;

export const generationControllerJobCache: GenerationControllerJobCache = {
  async claimSubmission({ identity }): Promise<SubmissionClaimResult> {
    const existing = submissionClaims.get(identity.key);
    if (existing?.completed) return { status: "existing", job: existing.completed };
    if (existing) return { status: "pending", waitForCompletion: existing.promise };
    const claim = deferred(); submissionClaims.set(identity.key, claim); return { status: "claimed", claimId: claim.claimId };
  },
  async completeSubmission({ key, claimId, job }) {
    const claim = submissionClaims.get(key);
    if (!claim || claim.claimId !== claimId) throw new Error("generation-submission-claim-mismatch");
    const durable = hydrateGenerationJob(job); claim.completed = durable; claim.resolve(durable);
  },
  async failSubmission({ key, claimId, error }) {
    const claim = submissionClaims.get(key);
    if (!claim || claim.claimId !== claimId) throw new Error("generation-submission-claim-mismatch");
    submissionClaims.delete(key); claim.reject(error);
  },
  async claimReconciliation({ projectId, jobId }): Promise<ReconciliationClaimResult> {
    const key = reconciliationKey(projectId, jobId);
    const existing = reconciliationClaims.get(key);
    if (existing?.completed) return { status: "existing", job: existing.completed };
    if (existing) return { status: "pending", waitForCompletion: existing.promise };
    const claim = deferred(); reconciliationClaims.set(key, claim); return { status: "claimed", claimId: claim.claimId };
  },
  async completeReconciliation({ projectId, jobId, claimId, job }) {
    const claim = reconciliationClaims.get(reconciliationKey(projectId, jobId));
    if (!claim || claim.claimId !== claimId) throw new Error("generation-reconciliation-claim-mismatch");
    const durable = hydrateGenerationJob(job); claim.completed = durable; claim.resolve(durable);
  },
  async invalidateReconciliation({ projectId, jobId }) {
    reconciliationClaims.delete(reconciliationKey(projectId, jobId));
  },
  async list(projectId) {
    return useGenerationJobStore.getState().records.filter((record) => record.kind === "v2" ? record.job.projectId === projectId : record.projectId === projectId);
  },
  async save(job: ReconciledGenerationJob) {
    if ("kind" in job && job.kind === "legacy") {
      useGenerationJobStore.getState().saveLegacyAttention(job);
      return job;
    }
    return hydrateGenerationJob(job as DurableGenerationJob);
  },
};

export interface WaveSpeedRouteCapability extends GenerationRouteIdentity {
  output: "image" | "video";
  supportsAudio: boolean;
  inputSchema: Readonly<WaveSpeedRequestSchema>;
}

export function waveSpeedRouteKey(route: GenerationRouteIdentity): string {
  return JSON.stringify([
    route.providerInstanceId,
    route.providerModelId,
    route.requestedMode,
    route.providerSchemaId,
    route.providerEndpointId,
    route.providerSchemaVersion,
  ]);
}

export interface WaveSpeedGenerationCapabilities {
  configured: boolean;
  generationV2ReleaseEnabled: boolean;
  providerInstanceId: string;
  routes: WaveSpeedRouteCapability[];
}

export interface WaveSpeedGenerationDraftInput {
  projectId: string;
  route: WaveSpeedRouteCapability;
  entryContext: GenerationEntryContext;
  prompt: string;
  negativePrompt?: string;
  placementPolicy?: GenerationPlacementPolicy;
  target: GenerationDraft["target"];
  providerInputs: Record<string, unknown>;
  references?: readonly GenerationReferenceDraft[];
  audio?: GenerationAudioDraft;
  idempotencyKey?: string;
}

export interface WaveSpeedProjectionAudioTrack {
  id: string;
  type: string;
  muted?: boolean;
  hidden?: boolean;
  clips: readonly {
    id: string;
    mediaId: string;
    startTime: number;
    duration: number;
    inPoint: number;
    outPoint: number;
    speed?: number;
    muted?: boolean;
  }[];
}

export interface WaveSpeedProjectionAudioMedia {
  id: string;
  assetGroupId?: string;
  type: string;
  blob?: Blob | null;
  originalUrl?: string | null;
  remoteUrl?: string | null;
  metadata: { codec?: string; channels?: number; sampleRate?: number };
}

export type WaveSpeedProjectionAudioResult =
  | { kind: "ready"; audio: GenerationAudioDraft }
  | { kind: "zero-work"; reason: string }
  | { kind: "error"; code: string };

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareWaveSpeedProjectionAudio(input: {
  projectId: string;
  supportsAudio: boolean;
  entryContext: GenerationEntryContext;
  tracks: readonly WaveSpeedProjectionAudioTrack[];
  media: readonly WaveSpeedProjectionAudioMedia[];
  fetch?: typeof globalThis.fetch;
}): Promise<WaveSpeedProjectionAudioResult> {
  if (!input.supportsAudio) {
    return { kind: "zero-work", reason: "The selected generation route does not support audio." };
  }
  if (input.entryContext.kind !== "linked-projection") {
    return { kind: "zero-work", reason: "Audio preparation only runs for a selected linked projection." };
  }
  const timing = {
    source: "timeline" as const,
    startSeconds: input.entryContext.startTime,
    endSeconds: input.entryContext.endTime,
    durationSeconds: input.entryContext.endTime - input.entryContext.startTime,
  };
  const audioTracks = input.tracks.filter((track) => track.type === "audio" && !track.muted && !track.hidden);
  const clips = audioTracks.flatMap((track) => track.clips.map((clip) => ({
    id: clip.id,
    mediaId: clip.mediaId,
    versionId: clip.mediaId,
    role: "main" as const,
    startSeconds: clip.startTime,
    endSeconds: clip.startTime + clip.duration,
    sourceInSeconds: clip.inPoint,
    speed: clip.speed ?? 1,
    muted: clip.muted,
  })));
  const media = input.media.map((item) => ({
    id: item.id,
    versionId: item.id,
    accessible: Boolean(item.blob || item.remoteUrl || item.originalUrl),
    hasAudio: item.type === "audio" || Boolean(item.metadata.channels || item.metadata.sampleRate),
  }));
  const resolved = resolveMainAudioSource({ clips, media, timing });
  if (!resolved.source) return { kind: "error", code: resolved.errors[0]?.code ?? "audio-unavailable" };
  const sourceItem = input.media.find((item) =>
    item.id === resolved.source!.media.id
    || item.id === resolved.source!.media.versionId);
  if (!sourceItem) return { kind: "error", code: "audio-unavailable" };

  let bytes: ArrayBuffer;
  let mimeType = sourceItem.blob?.type || sourceItem.metadata.codec || "application/octet-stream";
  if (sourceItem.blob) {
    bytes = await sourceItem.blob.arrayBuffer();
  } else {
    const sourceUrl = sourceItem.remoteUrl ?? sourceItem.originalUrl;
    if (!sourceUrl || /^(?:blob|local|file|data):/i.test(sourceUrl)) {
      return { kind: "error", code: "generation-local-url-forbidden" };
    }
    const request = input.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await request(sourceUrl, { credentials: "same-origin" });
    if (!response.ok) return { kind: "error", code: `generation-audio-download-failed:${response.status}` };
    mimeType = response.headers.get("content-type")?.split(";")[0] || mimeType;
    bytes = await response.arrayBuffer();
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const range = resolved.source.range;
  return {
    kind: "ready",
    audio: {
      value: { projectId: input.projectId, body: bytes, mimeType },
      sourceMediaId: sourceItem.assetGroupId ?? sourceItem.id,
      sourceVersionId: resolved.source.media.versionId ?? sourceItem.id,
      sourceClipId: resolved.source.clip.id,
      projectStartSeconds: range.projectStartSeconds,
      projectEndSeconds: range.projectEndSeconds,
      sourceStartSeconds: range.sourceStartSeconds,
      sourceEndSeconds: range.sourceEndSeconds,
      mimeType,
      sha256: bytesToHex(new Uint8Array(digest)),
    },
  };
}

function routeIdentity(route: WaveSpeedRouteCapability): GenerationRouteIdentity {
  return {
    providerInstanceId: route.providerInstanceId,
    providerModelId: route.providerModelId,
    requestedMode: route.requestedMode,
    providerSchemaId: route.providerSchemaId,
    providerEndpointId: route.providerEndpointId,
    providerSchemaVersion: route.providerSchemaVersion,
  };
}

function readySelection(
  entryContext: GenerationEntryContext,
  audio?: GenerationAudioDraft,
): Extract<SceneGenerationContextResult, { status: "ready" }> {
  if (entryContext.kind === "new-asset" || entryContext.kind === "unplaced-shot") {
    return { status: "ready", includeAudio: false };
  }
  const durationSeconds = entryContext.endTime - entryContext.startTime;
  if (entryContext.kind === "unlinked-range") {
    return {
      status: "ready",
      includeAudio: false,
      timing: {
        source: "manual",
        startSeconds: entryContext.startTime,
        endSeconds: entryContext.endTime,
        durationSeconds,
      },
    };
  }
  return {
    status: "ready",
    includeAudio: Boolean(audio),
    projection: {
      clipId: entryContext.clipId,
      linkedShotId: entryContext.shotId,
      startTime: entryContext.startTime,
      duration: durationSeconds,
      inPoint: audio?.sourceStartSeconds ?? 0,
      outPoint: audio?.sourceEndSeconds ?? durationSeconds,
    },
    timing: {
      source: "timeline",
      startSeconds: entryContext.startTime,
      endSeconds: entryContext.endTime,
      durationSeconds,
    },
    ...(audio ? {
      audioInterval: {
        projectStartSeconds: entryContext.startTime,
        projectEndSeconds: entryContext.endTime,
        sourceStartSeconds: audio.sourceStartSeconds!,
        sourceEndSeconds: audio.sourceEndSeconds!,
      },
    } : {}),
  };
}

export function prepareWaveSpeedGenerationDraft(input: WaveSpeedGenerationDraftInput): {
  draft: GenerationDraft;
  entryContextResult: ReturnType<typeof resolveGenerationEntryContext>;
} {
  const resolution = input.entryContext.kind === "linked-projection"
    ? resolveGenerationEntryContext({
        ...input.entryContext,
        placementPolicy: input.placementPolicy,
        supportsAudio: input.route.supportsAudio ?? false,
      })
    : resolveGenerationEntryContext({
        ...input.entryContext,
        placementPolicy: input.placementPolicy,
      });
  if (resolution.errors.length > 0) {
    throw new TypeError(resolution.errors[0]?.code ?? "generation-entry-context-invalid");
  }
  if (input.audio && !resolution.audioEligible) {
    throw new TypeError("generation-audio-not-allowed-for-entry-context");
  }
  const audio = input.audio
    ? {
        sourceMediaId: input.audio.sourceMediaId!,
        sourceVersionId: input.audio.sourceVersionId!,
        sourceClipId: input.audio.sourceClipId!,
        projectStartSeconds: input.audio.projectStartSeconds!,
        projectEndSeconds: input.audio.projectEndSeconds!,
        sourceStartSeconds: input.audio.sourceStartSeconds!,
        sourceEndSeconds: input.audio.sourceEndSeconds!,
        mimeType: input.audio.mimeType!,
        sha256: input.audio.sha256!,
        preparationStatus: "ready" as const,
      }
    : undefined;
  if (audio && Object.values(audio).some((value) => value === undefined || value === "")) {
    throw new TypeError("generation-audio-identity-incomplete");
  }
  const contextRequest = buildSceneGenerationRequest({
    id: input.idempotencyKey ?? "generation-context",
    projectId: input.projectId,
    entryContext: resolution.entryContext,
    mode: input.route.requestedMode,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    selection: readySelection(resolution.entryContext, input.audio),
    target: input.target.kind === "new-version"
      ? { kind: "new-version", sourceMediaId: input.target.sourceMediaId!, placeholderMediaId: "pending-placeholder" }
      : { kind: "new-asset", placeholderMediaId: "pending-placeholder" },
    placementPolicy: resolution.placementPolicy,
    modelId: input.route.providerModelId,
    modelSchemaVersion: input.route.providerSchemaVersion,
    providerInputs: input.providerInputs,
    audio,
  });
  return {
    entryContextResult: resolution,
    draft: {
      projectId: input.projectId,
      provider: "wavespeed",
      providerInstanceId: input.route.providerInstanceId,
      routing: routeIdentity(input.route),
      modelId: input.route.providerModelId,
      modelSchemaVersion: input.route.providerSchemaVersion,
      target: input.target,
      context: contextRequest.context,
      providerInputs: input.providerInputs,
      references: input.references,
      audio: input.audio,
      placementPolicy: resolution.placementPolicy,
      idempotencyKey: input.idempotencyKey,
    },
  };
}

export function buildWaveSpeedGenerationDraft(input: WaveSpeedGenerationDraftInput): GenerationDraft {
  return prepareWaveSpeedGenerationDraft(input).draft;
}

type ProductionGenerationCommand = Exclude<RecoveryAction, "regenerate" | "variation">;

export interface ProductionGenerationRuntime {
  controller: GenerationController;
  referenceRecovery: GenerationReferenceRecoveryPorts;
  readCapabilities(options?: { refresh?: boolean }): Promise<WaveSpeedGenerationCapabilities>;
  synchronize(job: DurableGenerationJob): Promise<DurableGenerationJob>;
  command(action: ProductionGenerationCommand, job: DurableGenerationJob): Promise<DurableGenerationJob>;
}

export interface ProductionGenerationRuntimeOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  nextId?: (kind: "placeholder" | "job") => string;
  now?: () => number;
  mutations?: GenerationMutationPort;
  referenceRecovery?: Partial<GenerationReferenceRecoveryPorts>;
}

function parseCapabilities(input: unknown): WaveSpeedGenerationCapabilities {
  if (!input || typeof input !== "object") throw new Error("generation-capabilities-invalid");
  const value = input as Record<string, unknown>;
  const topLevelKeys = new Set(["configured", "generationV2ReleaseEnabled", "providerInstanceId", "routes"]);
  if (Object.keys(value).some((key) => !topLevelKeys.has(key))
    || typeof value.configured !== "boolean"
    || typeof value.generationV2ReleaseEnabled !== "boolean"
    || typeof value.providerInstanceId !== "string"
    || !Array.isArray(value.routes)) {
    throw new Error("generation-capabilities-invalid");
  }
  const routes = Array.isArray(value.routes) ? value.routes.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("generation-route-capability-invalid");
    const route = candidate as Record<string, unknown>;
    const routeKeys = new Set([
      "providerInstanceId",
      "providerModelId",
      "requestedMode",
      "providerSchemaId",
      "providerEndpointId",
      "providerSchemaVersion",
      "output",
      "supportsAudio",
      "inputSchema",
    ]);
    if (Object.keys(route).some((key) => !routeKeys.has(key))
      || (route.output !== "image" && route.output !== "video")
      || typeof route.supportsAudio !== "boolean") {
      throw new Error("generation-route-capability-invalid");
    }
    const identity = GenerationRouteIdentitySchema.safeParse({
      providerInstanceId: route.providerInstanceId,
      providerModelId: route.providerModelId,
      requestedMode: route.requestedMode,
      providerSchemaId: route.providerSchemaId,
      providerEndpointId: route.providerEndpointId,
      providerSchemaVersion: route.providerSchemaVersion,
    });
    if (!identity.success) throw new Error("generation-route-capability-invalid");
    const parsed: WaveSpeedRouteCapability = {
      ...identity.data,
      output: route.output,
      supportsAudio: route.supportsAudio,
      inputSchema: parseWaveSpeedRequestSchema(route.inputSchema),
    };
    return parsed;
  }) : [];
  return {
    configured: value.configured === true,
    generationV2ReleaseEnabled: value.generationV2ReleaseEnabled === true,
    providerInstanceId: String(value.providerInstanceId ?? ""),
    routes,
  };
}

function mapWaveSpeedUploadInputs(input: {
  route: WaveSpeedRouteCapability;
  providerInputs: Readonly<Record<string, unknown>>;
  references: readonly {
    tokenId: string;
    role: string;
    origins: readonly string[];
  }[];
  audioToken?: string;
}): { inputs: Record<string, unknown>; errors?: readonly { field: string; code: string }[] } {
  const fields = deriveWaveSpeedFieldMap(input.route.inputSchema);
  const inputs = stripWaveSpeedMediaInputs(input.route, input.providerInputs);
  const errors: Array<{ field: string; code: string }> = [];
  const sourceReferences = input.references.filter((reference) =>
    reference.role === "source" || reference.origins.includes("source"));
  const remainingReferences = fields.sourceImage
    ? input.references.filter((reference) => !sourceReferences.includes(reference))
    : input.references;
  if (sourceReferences.length > 0) {
    if (!fields.sourceImage || sourceReferences.length !== 1) {
      errors.push({ field: fields.sourceImage ?? "references", code: "unsupported-source-mapping" });
    } else {
      inputs[fields.sourceImage] = sourceReferences[0]!.tokenId;
    }
  }
  if (remainingReferences.length > 0) {
    if (!fields.referenceImages) {
      errors.push({ field: "references", code: "unsupported-reference-mapping" });
    } else if (input.route.inputSchema.properties[fields.referenceImages]?.type === "array") {
      inputs[fields.referenceImages] = remainingReferences.map((reference) => reference.tokenId);
    } else if (remainingReferences.length === 1) {
      inputs[fields.referenceImages] = remainingReferences[0]!.tokenId;
    } else {
      errors.push({ field: fields.referenceImages, code: "reference-cardinality" });
    }
  }
  if (input.audioToken) {
    if (!input.route.supportsAudio || !fields.audio) {
      errors.push({ field: fields.audio ?? "audio", code: "unsupported-audio-mapping" });
    } else {
      inputs[fields.audio] = input.audioToken;
    }
  }
  errors.push(...validateWaveSpeedProviderInputs({ schema: input.route.inputSchema, inputs }));
  return errors.length > 0 ? { inputs, errors } : { inputs };
}

function stripWaveSpeedMediaInputs(
  route: WaveSpeedRouteCapability,
  providerInputs: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fields = deriveWaveSpeedFieldMap(route.inputSchema);
  const inputs: Record<string, unknown> = { ...providerInputs };
  for (const mediaField of [fields.sourceImage, fields.referenceImages, fields.audio]) {
    if (mediaField) delete inputs[mediaField];
  }
  return inputs;
}

async function responseJob(response: Response): Promise<DurableGenerationJob> {
  const body = await response.json().catch(() => ({})) as { job?: unknown };
  if (!response.ok) throw new Error(`generation-request-failed:${response.status}`);
  return parseGenerationJob(body.job);
}

export function createProductionGenerationRuntime(
  options: ProductionGenerationRuntimeOptions = {},
): ProductionGenerationRuntime {
  const baseUrl = (options.baseUrl ?? "/api/generate/wavespeed").replace(/\/$/, "");
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const id = options.nextId ?? (() => globalThis.crypto?.randomUUID?.() ?? `generation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const now = options.now ?? Date.now;
  const authoritativeJobs = new Map<string, DurableGenerationJob>();
  const synchronizations = new Map<string, Promise<DurableGenerationJob>>();
  let capabilityRequest: Promise<WaveSpeedGenerationCapabilities> | undefined;
  const routeCapabilities = new Map<string, WaveSpeedRouteCapability>();

  const readCapabilities = async (readOptions?: { refresh?: boolean }) => {
    if (!capabilityRequest || readOptions?.refresh) {
      const operation = request(`${baseUrl}/config`, { credentials: "same-origin" })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(`generation-capabilities-request-failed:${response.status}`);
          const parsed = parseCapabilities(body);
          routeCapabilities.clear();
          for (const route of parsed.routes) routeCapabilities.set(waveSpeedRouteKey(route), route);
          return parsed;
        });
      capabilityRequest = operation;
      void operation.finally(() => {
        if (capabilityRequest === operation) capabilityRequest = undefined;
      }).catch(() => undefined);
    }
    return capabilityRequest;
  };

  const mutations = options.mutations ?? {
    async createPlaceholder({ target }) {
      return { placeholderMediaId: target.placeholderMediaId };
    },
    async markPlaceholderFailed(input) {
      console.error("generation-placeholder-failed", input);
    },
  } satisfies GenerationMutationPort;

  async function upload(value: unknown): Promise<{ tokenId: string }> {
    if (!value || typeof value !== "object") throw new Error("generation-upload-value-required");
    const uploadValue = value as { projectId?: unknown; body?: unknown; mimeType?: unknown; url?: unknown };
    const projectId = String(uploadValue.projectId ?? "");
    if (!projectId) throw new Error("generation-upload-project-required");
    let body = uploadValue.body;
    let mimeType = String(uploadValue.mimeType ?? "");
    if (body === undefined && typeof uploadValue.url === "string") {
      if (!/^https:\/\//i.test(uploadValue.url)) throw new Error("generation-local-url-forbidden");
      const source = await request(uploadValue.url, { credentials: "omit" });
      if (!source.ok) throw new Error(`generation-reference-download-failed:${source.status}`);
      body = await source.arrayBuffer();
      mimeType ||= source.headers.get("content-type") ?? "application/octet-stream";
    }
    if (!(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      throw new Error("generation-upload-body-required");
    }
    const response = await request(`${baseUrl}/upload`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": mimeType || (body instanceof Blob ? body.type : "application/octet-stream"),
        "X-Project-Id": projectId,
      },
      body: body instanceof Blob || body instanceof ArrayBuffer ? body : body.buffer as ArrayBuffer,
    });
    const result = await response.json().catch(() => ({})) as { uploadId?: string };
    if (!response.ok || !result.uploadId) throw new Error(`generation-upload-failed:${response.status}`);
    return { tokenId: result.uploadId };
  }

  const releaseUploadLease: GenerationReferenceRecoveryPorts["releaseUploadLease"] =
    options.referenceRecovery?.releaseUploadLease
    ?? (async () => {
      console.warn("generation-upload-lease-expiry-managed-by-server", { redacted: true });
    });
  const referenceRecovery: GenerationReferenceRecoveryPorts = {
    retryReference: options.referenceRecovery?.retryReference ?? ((reference) => upload(reference.value)),
    releaseUploadLease,
    ...(options.referenceRecovery?.referenceMinimum === undefined
      ? {}
      : { referenceMinimum: options.referenceRecovery.referenceMinimum }),
  };

  const baseController = createGenerationController({
    submission: {
      mutations,
      references: { uploadReference: (reference) => upload(reference.value) },
      audio: { uploadAudio: (audio) => upload(audio.value) },
      sanitizer: {
        prepareDraftInputs(draft) {
          const route = routeCapabilities.get(waveSpeedRouteKey(draft.routing));
          return route ? stripWaveSpeedMediaInputs(route, draft.providerInputs) : { ...draft.providerInputs };
        },
        sanitize({ draft, references, audio }) {
          const route = routeCapabilities.get(waveSpeedRouteKey(draft.routing));
          if (!route) return { inputs: {}, errors: [{ field: "routing", code: "generation-route-stale" }] };
          const orderedReferences = (draft.references ?? [])
            .filter((reference) => reference.status !== "unavailable")
            .slice()
            .sort((left, right) =>
              (left.order ?? 0) - (right.order ?? 0)
              || (left.key ?? left.mediaId).localeCompare(right.key ?? right.mediaId));
          return mapWaveSpeedUploadInputs({
            route,
            providerInputs: draft.providerInputs,
            references: orderedReferences.map((reference, index) => ({
              tokenId: references[index]?.tokenId ?? "",
              role: reference.role ?? "reference",
              origins: reference.origins ?? [],
            })),
            ...(audio?.tokenId ? { audioToken: audio.tokenId } : {}),
          });
        },
      },
      provider: {
        async submit(input) {
          const response = await request(`${baseUrl}/`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-Project-Id": input.context.projectId },
            body: JSON.stringify({
              projectId: input.context.projectId,
              jobId: input.jobId,
              routing: input.routing,
              target: input.target,
              context: input.context,
              providerInputs: input.inputs,
            }),
          });
          const job = await responseJob(response);
          if (job.id !== input.jobId) throw new Error("generation-logical-job-id-mismatch");
          if (job.projectId !== input.context.projectId || job.context.projectId !== input.context.projectId) {
            throw new Error("generation-status-ownership-mismatch");
          }
    if (waveSpeedRouteKey(job.routing) !== waveSpeedRouteKey(input.routing)) throw new Error("generation-route-identity-mismatch");
          if (!job.providerJobId) throw new Error("generation-provider-job-id-missing");
          authoritativeJobs.set(job.id, job);
          return { providerJobId: job.providerJobId };
        },
      },
      cache: {
        async put(job) {
          hydrateGenerationJob(authoritativeJobs.get(job.id) ?? job);
        },
      },
      clock: { now },
      ids: {
        next: id,
      },
    },
    leases: {
      releaseUploadLease,
    },
    jobs: generationControllerJobCache,
    status: {
      async read(job) {
        const response = await request(`${baseUrl}/${encodeURIComponent(job.id)}`, {
          credentials: "same-origin",
          headers: { "X-Project-Id": job.projectId },
        });
        return responseJob(response);
      },
    },
  });

  const controller: GenerationController = {
    async submit(draft) {
      const capabilities = await readCapabilities({ refresh: true });
      if (!capabilities.configured) throw new Error("provider-not-configured");
      assertGenerationV2SubmissionAllowed(2, capabilities.generationV2ReleaseEnabled);
      if (!capabilities.routes.some((candidate) => waveSpeedRouteKey(candidate) === waveSpeedRouteKey(draft.routing))) {
        throw new Error("generation-route-stale");
      }
      const submitted = await baseController.submit(draft);
      const authoritative = authoritativeJobs.get(submitted.id) ?? submitted;
      return hydrateGenerationJob(authoritative);
    },
    reconcile: (projectId) => baseController.reconcile(projectId),
    invalidateReconciliation: (input) => baseController.invalidateReconciliation(input),
  };

  return {
    controller,
    referenceRecovery,
    readCapabilities,
    async synchronize(job) {
      const key = `${job.projectId}\u0000${job.id}`;
      const existing = synchronizations.get(key);
      if (existing) return existing;
      const operation = (async () => {
        await controller.invalidateReconciliation({ projectId: job.projectId, jobId: job.id });
        const reconciled = await controller.reconcile(job.projectId);
        const authoritative = reconciled.find((candidate): candidate is DurableGenerationJob =>
          !("kind" in candidate) && candidate.id === job.id);
        if (!authoritative) throw new Error("generation-not-found");
        if (authoritative.projectId !== job.projectId || authoritative.context.projectId !== job.context.projectId) {
          throw new Error("generation-status-ownership-mismatch");
        }
        return hydrateGenerationJob(authoritative);
      })();
      synchronizations.set(key, operation);
      try { return await operation; }
      finally { if (synchronizations.get(key) === operation) synchronizations.delete(key); }
    },
    async command(action, job) {
      if (!allowedRecoveryActionsForJob(job).includes(action)) {
        throw new Error(`generation-recovery-action-not-allowed:${action}`);
      }
      const response = await request(`${baseUrl}/${encodeURIComponent(job.id)}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Project-Id": job.projectId },
        body: "{}",
      });
      const authoritative = await responseJob(response);
      if (authoritative.id !== job.id
        || authoritative.projectId !== job.projectId
        || authoritative.context.projectId !== job.context.projectId) {
        throw new Error("generation-status-ownership-mismatch");
      }
      const hydrated = hydrateGenerationJob(authoritative);
      await controller.invalidateReconciliation({ projectId: job.projectId, jobId: job.id });
      return hydrated;
    },
  };
}

let productionGenerationRuntime: ProductionGenerationRuntime | undefined;

export function getProductionGenerationRuntime(): ProductionGenerationRuntime {
  productionGenerationRuntime ??= createProductionGenerationRuntime();
  return productionGenerationRuntime;
}

export function getProductionGenerationController(): GenerationController {
  return getProductionGenerationRuntime().controller;
}
