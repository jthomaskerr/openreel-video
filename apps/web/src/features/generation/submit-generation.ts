import type { GenerationContext, GenerationError, GenerationJob, GenerationTarget } from "@openreel/music-video-domain/generation";

export interface GenerationDraft {
  projectId: string;
  provider: string;
  modelId: string;
  modelSchemaVersion: string;
  target: { kind: "new-asset" | "new-version"; sourceMediaId?: string };
  context: Omit<GenerationContext, "target"> & { target?: never };
  providerInputs: Record<string, unknown>;
  references?: readonly GenerationReferenceDraft[];
  audio?: GenerationAudioDraft;
  placementPolicy?: GenerationContext["placementPolicy"];
  idempotencyKey?: string;
}

export interface GenerationReferenceDraft { mediaId: string; versionId?: string; origins?: GenerationContext["references"][number]["origins"]; value?: unknown }
export interface GenerationAudioDraft { value: unknown; sourceMediaId?: string; sourceVersionId?: string; sourceClipId?: string; projectStartSeconds?: number; projectEndSeconds?: number; sourceStartSeconds?: number; sourceEndSeconds?: number; mimeType?: string; sha256?: string }

export interface PlaceholderInput { projectId: string; target: GenerationTarget; sourceMediaId?: string }
export interface GenerationMutationPort {
  createPlaceholder(input: PlaceholderInput): Promise<{ mediaId?: string; placeholderMediaId?: string } | string>;
  markPlaceholderFailed(input: { projectId: string; placeholderMediaId: string; error: GenerationError }): Promise<void>;
}
export interface ReferenceUploadPort { uploadReference(input: GenerationReferenceDraft): Promise<{ tokenId: string }> }
export interface AudioUploadPort { uploadAudio(input: GenerationAudioDraft): Promise<{ tokenId: string }> }
export interface GenerationSanitizerPort { sanitize(input: { draft: GenerationDraft; source?: { tokenId: string }; references: readonly { tokenId: string }[]; audio?: { tokenId: string } }): { inputs: Record<string, unknown>; errors?: readonly { field: string; code: string }[] } }
export interface ProviderSubmitPort { submit(input: { provider: string; modelId: string; modelSchemaVersion: string; inputs: Record<string, unknown>; context: GenerationContext; idempotencyKey: string }): Promise<{ providerJobId: string }> }
export interface GenerationJobCachePort { put(job: GenerationJob): Promise<void> }
export interface GenerationClock { now(): number }
export interface GenerationIdFactory { next(prefix: "placeholder" | "job"): string }
export interface SubmitGenerationPorts {
  mutations: GenerationMutationPort;
  references?: ReferenceUploadPort;
  audio?: AudioUploadPort;
  sanitizer?: GenerationSanitizerPort;
  provider: ProviderSubmitPort;
  cache: GenerationJobCachePort;
  clock: GenerationClock;
  ids: GenerationIdFactory;
}

export class GenerationSubmissionError extends Error {
  readonly code: string;
  readonly field?: string;
  constructor(code: string, message = code, field?: string) { super(message); this.name = "GenerationSubmissionError"; this.code = code; this.field = field; }
}

const inflight = new Map<string, Promise<GenerationJob>>();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
};
const errorFor = (stage: string, cause: unknown): GenerationError => ({ code: `generation-${stage}-failed`, message: cause instanceof Error ? cause.message : String(cause), retryable: true });

function validateDraft(draft: GenerationDraft): void {
  if (!draft.projectId) throw new GenerationSubmissionError("invalid-draft", "Project is required", "projectId");
  if (!draft.modelId) throw new GenerationSubmissionError("invalid-draft", "Model is required", "modelId");
  if (!draft.provider) throw new GenerationSubmissionError("invalid-draft", "Provider is required", "provider");
  if (draft.target.kind === "new-version" && !draft.target.sourceMediaId) throw new GenerationSubmissionError("invalid-draft", "Source media is required", "target.sourceMediaId");
  if (!draft.providerInputs || typeof draft.providerInputs !== "object" || Array.isArray(draft.providerInputs)) throw new GenerationSubmissionError("invalid-draft", "Inputs are required", "providerInputs");
}

export function submitGeneration(draft: GenerationDraft, ports: SubmitGenerationPorts): Promise<GenerationJob> {
  try { validateDraft(draft); } catch (error) { return Promise.reject(error); }
  const key = draft.idempotencyKey ?? stable({ ...draft, context: draft.context, references: draft.references, audio: draft.audio });
  const existing = inflight.get(key);
  if (existing) return existing;
  const operation = executeSubmission(draft, ports);
  inflight.set(key, operation);
  void operation.then(() => { if (inflight.get(key) === operation) inflight.delete(key); }, () => { if (inflight.get(key) === operation) inflight.delete(key); });
  return operation;
}

async function executeSubmission(draft: GenerationDraft, ports: SubmitGenerationPorts): Promise<GenerationJob> {
  const placeholderId = ports.ids.next("placeholder");
  const target: GenerationTarget = draft.target.kind === "new-version"
    ? { kind: "new-version", sourceMediaId: draft.target.sourceMediaId!, placeholderMediaId: placeholderId }
    : { kind: "new-asset", placeholderMediaId: placeholderId };
  let created = false;
  const fail = async (stage: string, cause: unknown): Promise<never> => {
    const error = errorFor(stage, cause);
    if (created) await ports.mutations.markPlaceholderFailed({ projectId: draft.projectId, placeholderMediaId: placeholderId, error });
    throw new GenerationSubmissionError(error.code, error.message);
  };
  try {
    await ports.mutations.createPlaceholder({ projectId: draft.projectId, target, sourceMediaId: draft.target.sourceMediaId });
    created = true;
  } catch (cause) { return fail("placeholder", cause); }

  let references: { tokenId: string }[] = [];
  try {
    for (const reference of draft.references ?? []) {
      if (!ports.references) throw new GenerationSubmissionError("reference-upload-unavailable");
      references.push(await ports.references.uploadReference(reference));
    }
  } catch (cause) { return fail("reference-upload", cause); }
  let audio: { tokenId: string } | undefined;
  try { if (draft.audio) { if (!ports.audio) throw new GenerationSubmissionError("audio-upload-unavailable"); audio = await ports.audio.uploadAudio(draft.audio); } }
  catch (cause) { return fail("audio-upload", cause); }

  let sanitized: Record<string, unknown>;
  try {
    const sanitizedResult = ports.sanitizer?.sanitize({ draft, references, audio });
    sanitized = sanitizedResult?.inputs ?? { ...draft.providerInputs };
    const errors = sanitizedResult?.errors ?? [];
    if (errors.length) throw new GenerationSubmissionError("invalid-input", errors[0].code, errors[0].field);
  } catch (cause) { return fail("sanitize", cause); }
  const context: GenerationContext = { ...draft.context, target, references: (draft.references ?? []).map((ref, i) => ({ mediaId: ref.mediaId, ...(ref.versionId ? { versionId: ref.versionId } : {}), origins: ref.origins ?? ["user"], remoteInput: { kind: "upload-token", value: references[i]?.tokenId ?? "" } })), ...(audio && draft.audio ? { audio: { sourceMediaId: draft.audio.sourceMediaId ?? "audio", sourceVersionId: draft.audio.sourceVersionId ?? "version", sourceClipId: draft.audio.sourceClipId ?? "clip", projectStartSeconds: draft.audio.projectStartSeconds ?? 0, projectEndSeconds: draft.audio.projectEndSeconds ?? 1, sourceStartSeconds: draft.audio.sourceStartSeconds ?? 0, sourceEndSeconds: draft.audio.sourceEndSeconds ?? 1, mimeType: draft.audio.mimeType ?? "audio/wav", sha256: draft.audio.sha256 ?? "pending", remoteInput: { kind: "upload-token", value: audio.tokenId } } } : {}), placementPolicy: draft.placementPolicy ?? draft.context.placementPolicy };
  const now = ports.clock.now();
  const job: GenerationJob = { schemaVersion: 2, id: ports.ids.next("job"), provider: draft.provider, modelId: draft.modelId, modelSchemaVersion: draft.modelSchemaVersion, status: "preparing", createdAt: now, updatedAt: now, context, providerInputs: sanitized as GenerationJob["providerInputs"], attempts: [], checkpoints: {} };
  let providerJobId: string;
  try { providerJobId = (await ports.provider.submit({ provider: draft.provider, modelId: draft.modelId, modelSchemaVersion: draft.modelSchemaVersion, inputs: sanitized, context, idempotencyKey: draft.idempotencyKey ?? job.id })).providerJobId; }
  catch (cause) { return fail("provider-submit", cause); }
  const queued: GenerationJob = { ...job, status: "queued", updatedAt: ports.clock.now(), attempts: [{ attemptNumber: 1, providerJobId, startedAt: now }] };
  try { await ports.cache.put(queued); } catch (cause) { return fail("cache-write", cause); }
  return queued;
}

export function clearGenerationSubmissionInflight(): void { inflight.clear(); }
