import { z } from "zod";
import { GENERATION_JOB_CONTRACT_VERSION, GENERATION_JOB_SCHEMA_VERSION, canonicalizeGenerationProjectActionPayload, serializeDurableGenerationValue, type GenerationJob, type GenerationOutput, type GenerationProjectActionCommand, type GenerationProjectActionResult, type GenerationProjectMutationReceipt, type GenerationShotAttempt, type JsonValue, type SanitizedGenerationProvenance } from "./contracts.js";

const finiteNonnegative = z.number().finite().nonnegative();
const timestamp = z.union([z.number().int().nonnegative(), z.string().datetime()]);
const strictIdentifier = z.string().trim().min(1).superRefine((v, ctx) => { if (/(?:blob:|local:|file:|data:|signed:|temporary:|https?:\/\/localhost(?::|\/))/i.test(v)) ctx.addIssue({ code: "custom", message: "generation-local-url-forbidden" }); else if (v === "0" || /(?:^|:)\/\//.test(v)) ctx.addIssue({ code: "custom", message: "invalid durable identifier" }); });
const durablePathIdentifier = strictIdentifier.refine(
  (value) => value !== "." && value !== ".." && !/[\u0000-\u001f\u007f<>:\"/\\|?*]/.test(value) && !/[. ]$/.test(value),
  "generation-identifier-invalid",
);
export const DurablePathIdentifierSchema = durablePathIdentifier;
export const DurableIdentifierSchema = strictIdentifier;
const nonEmptyString = z.string().trim().min(1);
const durableJsonString = z.string().refine((v) => !/(?:blob:|local:|file:|data:|signed:|temporary:|https?:\/\/localhost(?::|\/))/i.test(v), "generation-local-url-forbidden");
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), durableJsonString, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]));

export const GenerationRouteIdentitySchema = z.object({ providerInstanceId: strictIdentifier, providerModelId: strictIdentifier, requestedMode: z.enum(["text-to-image", "image-to-image", "text-to-video", "image-to-video"]), providerSchemaId: strictIdentifier, providerEndpointId: strictIdentifier, providerSchemaVersion: strictIdentifier }).strict();
export const GenerationEntryContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-asset") }).strict(),
  z.object({ kind: z.literal("unplaced-shot"), shotId: strictIdentifier }).strict(),
  z.object({ kind: z.literal("unlinked-range"), rangeId: strictIdentifier, startTime: finiteNonnegative, endTime: finiteNonnegative, destinationTrackId: strictIdentifier.optional() }).strict().superRefine((v, c) => { if (v.endTime <= v.startTime) c.addIssue({ code: "custom", message: "invalid range" }); }),
  z.object({ kind: z.literal("linked-projection"), shotId: strictIdentifier, clipId: strictIdentifier, startTime: finiteNonnegative, endTime: finiteNonnegative }).strict().superRefine((v, c) => { if (v.endTime <= v.startTime) c.addIssue({ code: "custom", message: "invalid range" }); }),
]);
export const GenerationPlacementPolicySchema = z.enum(["none", "create-linked-clip", "replace-selected-clip-media"]);
export const GenerationReferenceOriginSchema = z.enum(["source", "character", "shot", "user"]);
export const GenerationPreparationStatusSchema = z.enum(["preparing", "ready", "failed"]);
export const GenerationErrorSchema = z.object({ code: nonEmptyString, message: nonEmptyString, field: nonEmptyString.optional(), retryable: z.boolean() }).strict();
export const ResolvedGenerationReferenceSchema = z.object({ id: strictIdentifier, order: z.number().int().positive(), mediaId: strictIdentifier, versionId: strictIdentifier.optional(), origins: z.array(GenerationReferenceOriginSchema).min(1), active: z.boolean().default(true), state: z.enum(["active", "failed"]), preparationStatus: GenerationPreparationStatusSchema, errorHistory: z.array(GenerationErrorSchema), uploadLeaseId: strictIdentifier.optional() }).strict().superRefine((v, c) => { if (v.state === "failed" && v.errorHistory.length === 0) c.addIssue({ code: "custom", message: "failed references require error history" }); });

function rejectInactiveCanonicalProviderInputReferences(
  providerInputs: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  const parsed = ResolvedGenerationReferenceSchema.array().safeParse(providerInputs.references);
  if (!parsed.success) return;
  parsed.data.forEach((reference, index) => {
    if (!reference.active) {
      context.addIssue({
        code: "custom",
        path: ["providerInputs", "references", index, "active"],
        message: "provider input references must be active",
      });
    }
  });
}
const ResolvedGenerationAudioBaseSchema = z.object({ sourceMediaId: strictIdentifier, sourceVersionId: strictIdentifier, sourceClipId: strictIdentifier, projectStartSeconds: finiteNonnegative, projectEndSeconds: finiteNonnegative, sourceStartSeconds: finiteNonnegative, sourceEndSeconds: finiteNonnegative, mimeType: nonEmptyString, sha256: strictIdentifier, preparationStatus: GenerationPreparationStatusSchema, uploadLeaseId: strictIdentifier.optional() }).strict();
const sameRoute = (left: z.infer<typeof GenerationRouteIdentitySchema>, right: z.infer<typeof GenerationRouteIdentitySchema>) => left.providerInstanceId === right.providerInstanceId && left.providerModelId === right.providerModelId && left.requestedMode === right.requestedMode && left.providerSchemaId === right.providerSchemaId && left.providerEndpointId === right.providerEndpointId && left.providerSchemaVersion === right.providerSchemaVersion;
export const ResolvedGenerationAudioSchema = ResolvedGenerationAudioBaseSchema.superRefine((v, c) => { if (v.projectEndSeconds <= v.projectStartSeconds || v.sourceEndSeconds <= v.sourceStartSeconds) c.addIssue({ code: "custom", message: "invalid audio range" }); });
export const GenerationTimingSchema = z.object({ source: z.enum(["timeline", "shot", "manual"]), startSeconds: finiteNonnegative, endSeconds: finiteNonnegative, durationSeconds: z.number().finite().positive() }).strict().superRefine((v, c) => { if (v.endSeconds <= v.startSeconds || Math.abs(v.durationSeconds - (v.endSeconds - v.startSeconds)) > 1e-6) c.addIssue({ code: "custom", message: "invalid range" }); });
export const GenerationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-asset"), placeholderMediaId: durablePathIdentifier }).strict(),
  z.object({ kind: z.literal("new-version"), sourceMediaId: durablePathIdentifier, placeholderMediaId: durablePathIdentifier }).strict().superRefine((v, c) => { if (v.sourceMediaId === v.placeholderMediaId) c.addIssue({ code: "custom", path: ["placeholderMediaId"], message: "generation-target-identities-conflict" }); }),
]);
export const GenerationContextSchema = z.object({ projectId: durablePathIdentifier, entryContext: GenerationEntryContextSchema, mode: z.enum(["text-to-image", "image-to-image", "text-to-video", "image-to-video"]), placementPolicy: GenerationPlacementPolicySchema, prompt: z.string(), negativePrompt: z.string().optional(), references: z.array(ResolvedGenerationReferenceSchema), audioAssetId: strictIdentifier.optional(), audioRange: z.object({ startTime: finiteNonnegative, endTime: finiteNonnegative }).strict().optional(), timing: GenerationTimingSchema.optional() }).strict().superRefine((v, c) => {
  if (v.audioRange && v.audioRange.endTime <= v.audioRange.startTime) c.addIssue({ code: "custom", message: "invalid audio range" });
  if (["new-asset", "unplaced-shot", "unlinked-range"].includes(v.entryContext.kind) && (v.audioAssetId || v.audioRange)) c.addIssue({ code: "custom", message: "entry context cannot carry audio context" });
  if (v.placementPolicy === "replace-selected-clip-media" && v.entryContext.kind !== "linked-projection") c.addIssue({ code: "custom", path: ["placementPolicy"], message: "generation-placement-linked-projection-required" });
  if (v.timing && (v.entryContext.kind === "linked-projection" || v.entryContext.kind === "unlinked-range")) {
    if (Math.abs(v.timing.startSeconds - v.entryContext.startTime) > 1e-6 || Math.abs(v.timing.endSeconds - v.entryContext.endTime) > 1e-6) c.addIssue({ code: "custom", path: ["timing"], message: "generation-timing-entry-range-mismatch" });
  }
});
export const GenerationAttemptSchema = z.object({ attemptNumber: z.number().int().positive(), routing: GenerationRouteIdentitySchema, providerJobId: strictIdentifier.optional(), startedAt: timestamp, endedAt: timestamp.optional(), terminalError: GenerationErrorSchema.optional() }).strict().superRefine((v, c) => { if (typeof v.startedAt === "number" && typeof v.endedAt === "number" && v.endedAt < v.startedAt) c.addIssue({ code: "custom", message: "attempt ends before start" }); });
export const GenerationCheckpointNameSchema = z.enum(["output-claimed", "output-downloaded", "output-verified", "output-inspected", "placeholder-finalized", "shot-linked", "placement-applied"]);
export const GenerationCheckpointStateSchema = z.object({ status: z.enum(["pending", "completed", "failed"]), timestamp: timestamp.optional(), error: GenerationErrorSchema.optional() }).strict();
export const GenerationRecoveryCheckpointSchema = z.object({ name: GenerationCheckpointNameSchema, status: GenerationCheckpointStateSchema.shape.status, timestamp, error: GenerationErrorSchema.optional() }).strict();
export const GenerationOutputSchema = z.object({ mediaId: strictIdentifier, versionId: strictIdentifier, mimeType: nonEmptyString, byteLength: z.number().int().nonnegative(), sha256: strictIdentifier, width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationSeconds: z.number().finite().positive().optional() }).strict();
export const GenerationPlacementStateSchema = z.object({ policy: GenerationPlacementPolicySchema, status: z.enum(["pending", "applied", "failed", "skipped"]), appliedAt: z.number().int().nonnegative().optional(), error: GenerationErrorSchema.optional(), replaySafe: z.boolean().optional() }).strict();
export const GenerationModelCapabilitySchema = z.object({ provider: z.enum(["kieai", "wavespeed", "atlascloud"]), modelId: strictIdentifier, schemaVersion: strictIdentifier, output: z.enum(["image", "video"]), mode: z.enum(["text-to-image", "image-to-image", "text-to-video", "image-to-video"]), supportsAudio: z.boolean(), sourceField: strictIdentifier.optional(), referenceField: strictIdentifier.optional(), audioField: strictIdentifier.optional(), referenceMinimum: z.number().int().nonnegative().optional(), referenceMaximum: z.number().int().nonnegative().optional() }).strict();
export const GenerationRouteErrorSchema = z.object({ code: z.enum(["generation-route-unsupported", "generation-route-ambiguous", "generation-route-stale", "generation-schema-drift", "generation-v2-rollback-active"]), message: nonEmptyString, retryable: z.boolean(), routing: GenerationRouteIdentitySchema.optional() }).strict();
const requestIds = { projectId: durablePathIdentifier, jobId: durablePathIdentifier };
export const GenerationSubmitRequestSchema = z.object({ ...requestIds, routing: GenerationRouteIdentitySchema, target: GenerationTargetSchema, context: GenerationContextSchema, providerInputs: z.record(z.string(), JsonValueSchema) }).strict().superRefine((v, c) => { if (v.projectId !== v.context.projectId) c.addIssue({ code: "custom", path: ["context", "projectId"], message: "generation-project-identity-mismatch" }); if (v.routing.requestedMode !== v.context.mode) c.addIssue({ code: "custom", path: ["context", "mode"], message: "generation-mode-identity-mismatch" }); if (v.context.placementPolicy === "create-linked-clip" && !v.context.timing) c.addIssue({ code: "custom", path: ["context", "timing"], message: "generation-placement-timing-required" }); const orders = v.context.references.map((r) => r.order); if (new Set(orders).size !== orders.length || orders.some((n, i) => n !== i + 1)) c.addIssue({ code: "custom", path: ["context", "references"], message: "references must be ordered and contiguous" }); v.context.references.forEach((r, i) => { if (!r.active || r.state !== "active" || r.preparationStatus !== "ready") c.addIssue({ code: "custom", path: ["context", "references", i], message: "references must be ready and active" }); }); });
export const GenerationStatusRequestSchema = z.object(requestIds).strict();
export const GenerationCancelRequestSchema = z.object({ ...requestIds, providerJobId: strictIdentifier }).strict();
export const GenerationProviderRetryRequestSchema = z.object({ ...requestIds, attemptNumber: z.number().int().positive(), failedProviderJobId: strictIdentifier }).strict();
export const GenerationFinalizationRetryRequestSchema = z.object({ ...requestIds, output: GenerationOutputSchema }).strict();
export const GenerationPlacementRetryRequestSchema = z.object({ ...requestIds, placementPolicy: GenerationPlacementPolicySchema }).strict();
export const GenerationReferenceRetryCommandSchema = z.object({ ...requestIds, referenceId: strictIdentifier }).strict();
export const GenerationReferenceRemoveCommandSchema = GenerationReferenceRetryCommandSchema;
export const GenerationReferenceDeactivateCommandSchema = GenerationReferenceRetryCommandSchema;
export const GenerationReferenceCommandSchema = z.discriminatedUnion("action", [GenerationReferenceRetryCommandSchema.extend({ action: z.literal("retry") }), GenerationReferenceRemoveCommandSchema.extend({ action: z.literal("remove") }), GenerationReferenceDeactivateCommandSchema.extend({ action: z.literal("deactivate") })]);
export const SanitizedGenerationProvenanceSchema = z.object({ provider: z.enum(["kieai", "wavespeed", "atlascloud"]), modelId: strictIdentifier, modelSchemaVersion: strictIdentifier, jobId: strictIdentifier, routing: GenerationRouteIdentitySchema, timing: GenerationTimingSchema.optional(), sha256: strictIdentifier.optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationSeconds: z.number().finite().positive().optional(), audio: ResolvedGenerationAudioBaseSchema.omit({ uploadLeaseId: true }).optional(), output: GenerationOutputSchema.optional(), checkpoints: z.array(GenerationRecoveryCheckpointSchema), references: z.array(z.object({ id: strictIdentifier, order: z.number().int().positive(), mediaId: strictIdentifier, versionId: strictIdentifier.optional(), origins: z.array(GenerationReferenceOriginSchema).min(1), state: z.enum(["active", "failed"]), preparationStatus: GenerationPreparationStatusSchema }).strict()) }).strict();
export const GenerationJobSchema = z.object({ schemaVersion: z.literal(GENERATION_JOB_SCHEMA_VERSION), contractVersion: z.literal(GENERATION_JOB_CONTRACT_VERSION), id: durablePathIdentifier, projectId: durablePathIdentifier, provider: z.enum(["kieai", "wavespeed", "atlascloud"]), providerInstanceId: strictIdentifier, modelId: strictIdentifier, modelSchemaVersion: strictIdentifier, routing: GenerationRouteIdentitySchema, providerJobId: strictIdentifier.optional(), status: z.enum(["queued", "submitting", "running", "completed", "finalizing", "succeeded", "failed", "canceled", "needs-attention"]), attempt: z.number().int().positive(), target: GenerationTargetSchema.optional(), context: GenerationContextSchema, providerInputs: z.record(z.string(), JsonValueSchema), attempts: z.array(GenerationAttemptSchema), checkpoints: z.record(GenerationCheckpointNameSchema, GenerationCheckpointStateSchema).or(z.object({}).strict()), output: GenerationOutputSchema.optional(), outputUrls: z.array(strictIdentifier).optional(), outputMediaIds: z.array(strictIdentifier).optional(), error: GenerationErrorSchema.optional(), createdAt: timestamp, updatedAt: timestamp, placement: GenerationPlacementStateSchema.optional(), projectAction: z.lazy(() => GenerationProjectActionEnvelopeSchema).optional() }).strict().superRefine((v, c) => { rejectInactiveCanonicalProviderInputReferences(v.providerInputs, c); if (v.projectId !== v.context.projectId) c.addIssue({ code: "custom", path: ["context", "projectId"], message: "generation-project-identity-mismatch" }); if (v.routing.requestedMode !== v.context.mode) c.addIssue({ code: "custom", path: ["context", "mode"], message: "generation-mode-identity-mismatch" }); const nums = v.attempts.map((a) => a.attemptNumber); if (nums.length !== v.attempt || new Set(nums).size !== nums.length || nums.some((n, i) => n !== i + 1)) c.addIssue({ code: "custom", path: ["attempts"], message: "attempt history must be contiguous through current attempt" }); const activeAttempt = v.attempts.find((a) => a.attemptNumber === v.attempt); if (!activeAttempt) c.addIssue({ code: "custom", path: ["attempts"], message: "current attempt is missing" }); if (v.providerInstanceId !== v.routing.providerInstanceId || v.modelId !== v.routing.providerModelId) c.addIssue({ code: "custom", path: ["routing"], message: "job provider identity must match route" }); if (["submitting", "running", "completed", "finalizing"].includes(v.status) && !v.providerJobId) c.addIssue({ code: "custom", path: ["providerJobId"], message: "active provider states require a durable provider job ID" }); if (v.providerJobId && activeAttempt?.providerJobId !== v.providerJobId) c.addIssue({ code: "custom", path: ["providerJobId"], message: "provider job must belong to the current attempt" }); if (activeAttempt && !sameRoute(activeAttempt.routing, v.routing)) c.addIssue({ code: "custom", path: ["routing"], message: "job route must match current attempt route" }); });
export function parseGenerationJob(value: unknown): GenerationJob { return GenerationJobSchema.parse(value) as GenerationJob; }

export const GenerationProjectMutationKindSchema = z.enum(["finalize-placeholder", "finalize-version", "append-shot-attempt", "create-linked-clip", "replace-clip-media", "finalize-composite"]);
export const GenerationProjectBaseRevisionSchema = z.object({ commitSha: strictIdentifier, treeSha: strictIdentifier, projectBlobSha: strictIdentifier, sourceModifiedAt: z.number().int().nonnegative() }).strict();
const GenerationSemanticPayloadSchema = z.string().superRefine((value, context) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    const json = JsonValueSchema.safeParse(parsed);
    if (!json.success) {
      context.addIssue({ code: "custom", message: "generation-semantic-payload-invalid" });
      return;
    }
    const canonical = canonicalizeGenerationProjectActionPayload(json.data as import("./contracts.js").JsonValue);
    if (canonical !== value) context.addIssue({ code: "custom", message: "generation-semantic-payload-not-canonical" });
  } catch {
    context.addIssue({ code: "custom", message: "generation-semantic-payload-invalid" });
  }
});
export const GenerationProjectMutationReceiptSchema: z.ZodType<GenerationProjectMutationReceipt> = z.object({
  schemaVersion: z.literal(1),
  actionId: durablePathIdentifier,
  jobId: durablePathIdentifier,
  idempotencyKey: durablePathIdentifier,
  kind: GenerationProjectMutationKindSchema,
  semanticPayload: GenerationSemanticPayloadSchema,
  baseRevision: GenerationProjectBaseRevisionSchema,
  appliedAt: z.number().int().nonnegative(),
}).strict();
export const GenerationShotAttemptSchema: z.ZodType<GenerationShotAttempt> = z.object({
  schemaVersion: z.literal(1),
  jobId: durablePathIdentifier,
  providerJobId: durablePathIdentifier,
  mediaId: durablePathIdentifier,
  versionId: durablePathIdentifier,
  outputSha256: strictIdentifier,
  createdAt: z.number().int().nonnegative(),
}).strict();
export const GenerationProjectActionsSchema = z.object({ receipts: z.record(durablePathIdentifier, GenerationProjectMutationReceiptSchema), shotAttempts: z.record(durablePathIdentifier, z.array(GenerationShotAttemptSchema).readonly()).optional() }).strict();
export const GenerationProjectActionEnvelopeSchema = z.object({ schemaVersion: z.literal(1), projectId: durablePathIdentifier, receipt: GenerationProjectMutationReceiptSchema, appliedRevision: GenerationProjectBaseRevisionSchema }).strict();
export const GenerationProjectActionCommandSchema: z.ZodType<GenerationProjectActionCommand> = z.object({ projectId: durablePathIdentifier, actionId: durablePathIdentifier, operation: z.enum(["undo", "redo"]), expectedRevision: GenerationProjectBaseRevisionSchema, envelope: GenerationProjectActionEnvelopeSchema }).strict();
export const GenerationProjectActionResultSchema: z.ZodType<GenerationProjectActionResult> = z.object({ projectId: durablePathIdentifier, actionId: durablePathIdentifier, operation: z.enum(["undo", "redo"]), status: z.enum(["applied", "replayed"]), revision: GenerationProjectBaseRevisionSchema, envelope: GenerationProjectActionEnvelopeSchema }).strict();

export const GenerationProjectBoundarySchema = z.object({ projectId: strictIdentifier, generationJobIds: z.array(strictIdentifier), mediaIds: z.array(strictIdentifier) }).strict();
export const GenerationMutationBoundarySchema = z.object({ projectId: strictIdentifier, mutationId: strictIdentifier, kind: nonEmptyString, payload: JsonValueSchema }).strict();
export const GenerationEventBoundarySchema = z.object({ projectId: strictIdentifier, eventId: strictIdentifier, type: nonEmptyString, payload: JsonValueSchema }).strict();
export const GenerationEvidenceManifestSchema = z.object({ projectId: strictIdentifier, jobId: strictIdentifier, artifacts: z.array(z.object({ id: strictIdentifier, uri: durableJsonString }).strict()) }).strict();
export const GenerationFinalizationInputSchema = z.object({ projectId: strictIdentifier, jobId: strictIdentifier, providerJobId: strictIdentifier, output: GenerationOutputSchema }).strict();
export type GenerationProjectBoundary = z.infer<typeof GenerationProjectBoundarySchema>;
export type GenerationMutationBoundary = z.infer<typeof GenerationMutationBoundarySchema>;
export type GenerationEventBoundary = z.infer<typeof GenerationEventBoundarySchema>;
export type GenerationEvidenceManifest = z.infer<typeof GenerationEvidenceManifestSchema>;
export type GenerationFinalizationInput = z.infer<typeof GenerationFinalizationInputSchema>;
function serializeTypedBoundary<T>(schema: z.ZodType<T>, value: unknown): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.message === "generation-local-url-forbidden")) throw new Error("generation-local-url-forbidden");
    throw parsed.error;
  }
  return serializeDurableGenerationValue(parsed.data);
}
export const serializeGenerationJob = (value: GenerationJob) => serializeTypedBoundary(GenerationJobSchema, value);
export const serializeGenerationOutput = (value: GenerationOutput) => serializeTypedBoundary(GenerationOutputSchema, value);
export const serializeGenerationProvenance = (value: SanitizedGenerationProvenance) => serializeTypedBoundary(SanitizedGenerationProvenanceSchema, value);
export const serializeGenerationProject = (value: GenerationProjectBoundary) => serializeTypedBoundary(GenerationProjectBoundarySchema, value);
export const serializeGenerationMutation = (value: GenerationMutationBoundary) => serializeTypedBoundary(GenerationMutationBoundarySchema, value);
export const serializeGenerationEvent = (value: GenerationEventBoundary) => serializeTypedBoundary(GenerationEventBoundarySchema, value);
export const serializeGenerationEvidenceManifest = (value: GenerationEvidenceManifest) => serializeTypedBoundary(GenerationEvidenceManifestSchema, value);
export const serializeGenerationFinalizationInput = (value: GenerationFinalizationInput) => serializeTypedBoundary(GenerationFinalizationInputSchema, value);
