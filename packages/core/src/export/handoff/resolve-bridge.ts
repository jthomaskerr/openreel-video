import { z } from "zod";
import { isDurableId } from "../../identity";

const ProjectMediaUrlSchema = z.string().regex(
  /^\/api\/projects\/[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,126}[A-Za-z0-9])?\/media\/[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,126}[A-Za-z0-9])?(?:\/(?:thumbnail|waveform))?$/,
);
const NonnegativeFrameSchema = z.number().int().nonnegative();
const ResolveJobIdSchema = z.string().refine(
  (value) => isDurableId(value, "resolve-job"),
  "Expected a durable Resolve job ID",
);
const ResolveRequestIdSchema = z.string().refine(
  (value) => isDurableId(value, "resolve-request"),
  "Expected a durable Resolve request ID",
);

export const ResolveBridgeErrorCodeSchema = z.enum([
  "STALE_PROJECT_REVISION", "MEDIA_INCOMPLETE", "EXPORT_FAILED",
  "BRIDGE_NOT_INSTALLED", "ACCESSIBILITY_DENIED", "RESOLVE_NOT_FOUND",
  "RESOLVE_UI_UNEXPECTED", "SCRIPT_NOT_DISCOVERED", "REQUEST_EXPIRED",
  "REQUEST_CONSUMED", "ARTIFACT_HASH_MISMATCH", "FCPXML_REJECTED",
  "SAVE_FAILED", "OFFLINE_MEDIA", "IMPORT_TIMEOUT",
]);

export type ResolveBridgeErrorCode = z.infer<typeof ResolveBridgeErrorCodeSchema>;

export const ResolveImportResultSchema = z.object({
  requestId: ResolveRequestIdSchema,
  status: z.enum(["completed", "failed"]),
  resolveVersion: z.string().min(1),
  resolveBuild: z.string().min(1),
  projectName: z.string().min(1),
  timelineName: z.string().min(1).optional(),
  durationFrames: NonnegativeFrameSchema.optional(),
  trackCounts: z.record(z.string(), NonnegativeFrameSchema),
  clipCounts: z.record(z.string(), NonnegativeFrameSchema),
  offlineMediaIds: z.array(z.string()),
  referencedMediaIds: z.array(z.string()).default([]),
  saved: z.boolean(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  failure: z.object({
    code: ResolveBridgeErrorCodeSchema,
    message: z.string(),
  }).strict().optional(),
}).strict();

export type ResolveImportResult = z.infer<typeof ResolveImportResultSchema>;

export const ResolveExportJobSchema = z.object({
  id: ResolveJobIdSchema,
  projectId: z.string().min(1),
  revision: z.string().min(1),
  phase: z.enum(["queued", "loading", "assessing", "resolving-media", "serializing",
    "verifying", "ready", "launching", "importing", "saving", "validating",
    "completed", "failed", "cancelled"]),
  processed: NonnegativeFrameSchema,
  total: NonnegativeFrameSchema,
  percent: z.number().min(0).max(100),
  warnings: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  bridgeLaunchUrl: z.string().regex(/^openreel-resolve:\/\/import\/nonce-[A-Za-z0-9._~-]+$/).optional(),
}).strict();

export type ResolveExportJob = z.infer<typeof ResolveExportJobSchema>;

export const ResolvePreviewClipTypeSchema = z.enum([
  "video", "audio", "titles", "graphics", "subtitles", "unsupported",
]);

export type ResolvePreviewClipType = z.infer<typeof ResolvePreviewClipTypeSchema>;

export const ResolvePreviewRenderSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    mediaId: z.string().min(1),
    previewUrl: ProjectMediaUrlSchema,
    updatedAt: z.number(),
    stale: z.literal(false),
  }).strict(),
  z.object({
    status: z.literal("stale"),
    mediaId: z.string().min(1),
    previewUrl: ProjectMediaUrlSchema,
    updatedAt: z.number(),
    stale: z.literal(true),
    reason: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal("missing"),
    reason: z.string().min(1),
  }).strict(),
]);

export type ResolvePreviewRender = z.infer<typeof ResolvePreviewRenderSchema>;

export const ResolvePreviewMediaPreviewSchema = z.union([
  z.object({ status: z.literal("missing"), reason: z.string().min(1) }).strict(),
  z.object({
    status: z.literal("ready"),
    kind: z.literal("video"),
    url: ProjectMediaUrlSchema,
    thumbnailUrl: ProjectMediaUrlSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal("ready"),
    kind: z.literal("audio"),
    url: ProjectMediaUrlSchema,
    waveformUrl: ProjectMediaUrlSchema,
  }).strict(),
  z.object({
    status: z.literal("ready"),
    kind: z.literal("image"),
    url: ProjectMediaUrlSchema,
  }).strict(),
]);

export type ResolvePreviewMediaPreview = z.infer<typeof ResolvePreviewMediaPreviewSchema>;

export const ResolvePreviewMiniTimelineClipSchema = z.object({
  id: z.string().min(1),
  mediaId: z.string().min(1).optional(),
  label: z.string(),
  startFrame: NonnegativeFrameSchema,
  endFrame: NonnegativeFrameSchema,
}).strict().refine((clip) => clip.endFrame >= clip.startFrame, {
  message: "endFrame must be greater than or equal to startFrame",
  path: ["endFrame"],
});

export type ResolvePreviewMiniTimelineClip = z.infer<typeof ResolvePreviewMiniTimelineClipSchema>;

export const ResolvePreviewMiniTimelineTrackSchema = z.object({
  id: z.string().min(1),
  index: NonnegativeFrameSchema,
  type: ResolvePreviewClipTypeSchema,
  clips: z.array(ResolvePreviewMiniTimelineClipSchema),
}).strict();

export type ResolvePreviewMiniTimelineTrack = z.infer<typeof ResolvePreviewMiniTimelineTrackSchema>;

export const ResolvePreviewMiniTimelineSchema = z.object({
  durationFrames: NonnegativeFrameSchema,
  tracks: z.array(ResolvePreviewMiniTimelineTrackSchema),
}).strict();

export type ResolvePreviewMiniTimeline = z.infer<typeof ResolvePreviewMiniTimelineSchema>;

export const ResolvePreviewClipSchema = z.object({
  id: z.string().min(1),
  mediaId: z.string().min(1).optional(),
  label: z.string(),
  startFrame: NonnegativeFrameSchema,
  endFrame: NonnegativeFrameSchema,
  preview: ResolvePreviewMediaPreviewSchema,
}).strict().refine((clip) => clip.endFrame >= clip.startFrame, {
  message: "endFrame must be greater than or equal to startFrame",
  path: ["endFrame"],
});

export type ResolvePreviewClip = z.infer<typeof ResolvePreviewClipSchema>;

export const ResolvePreviewClipGroupSchema = z.object({
  type: ResolvePreviewClipTypeSchema,
  clips: z.array(ResolvePreviewClipSchema),
}).strict();

export type ResolvePreviewClipGroup = z.infer<typeof ResolvePreviewClipGroupSchema>;

export const ResolvePreviewCompatibilitySchema = z.object({
  status: z.enum(["ready", "degraded", "blocked"]),
  blockingIssueCount: NonnegativeFrameSchema,
  warningCount: NonnegativeFrameSchema,
}).strict();

export type ResolvePreviewCompatibility = z.infer<typeof ResolvePreviewCompatibilitySchema>;

export const ResolvePreviewSchema = z.object({
  projectId: z.string().min(1),
  revision: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.number(),
  modifiedAt: z.number(),
  durationFrames: NonnegativeFrameSchema,
  frameRate: z.number().positive(),
  trackCount: NonnegativeFrameSchema,
  clipCount: NonnegativeFrameSchema,
  mediaCount: NonnegativeFrameSchema,
  render: ResolvePreviewRenderSchema,
  miniTimeline: ResolvePreviewMiniTimelineSchema,
  clipGroups: z.array(ResolvePreviewClipGroupSchema),
  compatibility: ResolvePreviewCompatibilitySchema,
}).strict();

export type ResolvePreview = z.infer<typeof ResolvePreviewSchema>;
