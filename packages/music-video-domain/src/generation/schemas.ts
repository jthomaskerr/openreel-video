import { z } from "zod";
import { GENERATION_JOB_SCHEMA_VERSION, type GenerationJob } from "./contracts.js";

const finiteNonnegative = z.number().finite().nonnegative();
const timestamp = z.number().int().nonnegative();
const id = z.string().min(1);
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
export const GenerationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-asset"), placeholderMediaId: id }).strict(),
  z.object({ kind: z.literal("new-version"), sourceMediaId: id, placeholderMediaId: id }).strict(),
]);
export const GenerationTimingSchema = z.object({
  source: z.enum(["timeline", "shot", "manual"]), startSeconds: finiteNonnegative,
  endSeconds: finiteNonnegative, durationSeconds: z.number().finite().positive(),
}).strict().superRefine((value, ctx) => {
  if (value.endSeconds <= value.startSeconds) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid range" });
  if (Math.abs(value.durationSeconds - (value.endSeconds - value.startSeconds)) > 1e-6) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duration mismatch" });
});
export const GenerationPlacementPolicySchema = z.enum(["none", "create-linked-clip", "replace-selected-clip-media"]);
export const GenerationErrorSchema = z.object({ code: id, message: z.string().optional(), field: z.string().optional(), retryable: z.boolean() }).strict();
export const GenerationPlacementStateSchema = z.object({ policy: GenerationPlacementPolicySchema, status: z.enum(["pending", "applied", "failed", "skipped"]), appliedAt: timestamp.optional(), error: GenerationErrorSchema.optional() }).strict();
export const GenerationReferenceOriginSchema = z.enum(["source", "character", "shot", "user"]);
export const ResolvedGenerationReferenceSchema = z.object({ mediaId: id, versionId: id.optional(), origins: z.array(GenerationReferenceOriginSchema).min(1), remoteInput: z.object({ kind: z.literal("upload-token"), value: id }).strict() }).strict();
export const ResolvedGenerationAudioSchema = z.object({
  sourceMediaId: id, sourceVersionId: id, sourceClipId: id,
  projectStartSeconds: finiteNonnegative, projectEndSeconds: finiteNonnegative,
  sourceStartSeconds: finiteNonnegative, sourceEndSeconds: finiteNonnegative,
  mimeType: id, sha256: id, remoteInput: z.object({ kind: z.literal("upload-token"), value: id }).strict(),
}).strict().superRefine((v, ctx) => {
  if (v.projectEndSeconds <= v.projectStartSeconds || v.sourceEndSeconds <= v.sourceStartSeconds) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid audio range" });
});
export const GenerationContextSchema = z.object({
  projectId: id, shotId: id.optional(), clipId: id.optional(), target: GenerationTargetSchema,
  timing: GenerationTimingSchema.optional(), references: z.array(ResolvedGenerationReferenceSchema),
  audio: ResolvedGenerationAudioSchema.optional(), placementPolicy: GenerationPlacementPolicySchema,
}).strict().superRefine((v, ctx) => {
  if (v.placementPolicy === "replace-selected-clip-media" && !v.clipId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clipId"], message: "clip required for replacement" });
});
export const GenerationAttemptSchema = z.object({ attemptNumber: z.number().int().positive(), providerJobId: id.optional(), startedAt: timestamp, endedAt: timestamp.optional(), terminalError: GenerationErrorSchema.optional() }).strict().superRefine((v, ctx) => {
  if (v.endedAt !== undefined && v.endedAt < v.startedAt) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "attempt ends before start" });
});
export const GenerationCheckpointNameSchema = z.enum(["output-claimed", "output-downloaded", "output-verified", "output-inspected", "placeholder-finalized", "shot-linked", "placement-applied"]);
export const GenerationCheckpointStateSchema = z.object({ status: z.enum(["pending", "completed", "failed"]), timestamp: timestamp.optional(), error: GenerationErrorSchema.optional() }).strict();
export const GenerationOutputSchema = z.object({ mediaId: id, versionId: id, mimeType: id, byteLength: z.number().int().nonnegative(), sha256: id, width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationSeconds: z.number().finite().positive().optional() }).strict();
export const GenerationModelCapabilitySchema = z.object({ provider: id, modelId: id, schemaVersion: id, output: z.enum(["image", "video"]), mode: z.enum(["text-to-image", "image-to-image", "text-to-video", "image-to-video"]), supportsAudio: z.boolean(), sourceField: id.optional(), referenceField: id.optional(), audioField: id.optional(), referenceMinimum: z.number().int().nonnegative().optional(), referenceMaximum: z.number().int().nonnegative().optional() }).strict();
export const SanitizedGenerationProvenanceSchema = z.object({ provider: id, modelId: id, modelSchemaVersion: id, jobId: id, timing: GenerationTimingSchema.optional(), sha256: id.optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), durationSeconds: z.number().finite().positive().optional(), inputs: z.record(z.string(), JsonValueSchema), references: z.array(z.object({ mediaId: id, versionId: id.optional(), origins: z.array(GenerationReferenceOriginSchema).min(1) }).strict()) }).strict();
export const ProjectCharacterSchema = z.object({ id, slug: id, displayName: id, primaryImageMediaId: id, primaryImageVersionId: id.optional() }).strict();
export const GenerationJobSchema = z.object({
  schemaVersion: z.literal(GENERATION_JOB_SCHEMA_VERSION), id, provider: id, modelId: id, modelSchemaVersion: id,
  status: z.enum(["preparing", "queued", "running", "completed", "failed", "canceling", "canceled", "needs-attention"]),
  createdAt: timestamp, updatedAt: timestamp, context: GenerationContextSchema, providerInputs: z.record(z.string(), JsonValueSchema),
  attempts: z.array(GenerationAttemptSchema), checkpoints: z.partialRecord(GenerationCheckpointNameSchema, GenerationCheckpointStateSchema),
  output: GenerationOutputSchema.optional(), error: GenerationErrorSchema.optional(), placement: GenerationPlacementStateSchema.optional(),
}).strict().superRefine((v, ctx) => {
  const numbers = v.attempts.map((attempt) => attempt.attemptNumber);
  if (new Set(numbers).size !== numbers.length || numbers.some((n, i) => n !== i + 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attempts"], message: "attempt numbers must be unique and contiguous" });
});

export function parseGenerationJob(value: unknown): GenerationJob { return GenerationJobSchema.parse(value) as GenerationJob; }
