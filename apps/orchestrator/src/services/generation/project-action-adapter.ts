import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import type { MediaItem, Project, ProjectBaseRevision } from "@openreel/core";
import {
  canonicalizeGenerationProjectActionPayload,
  classifyGenerationProjectTarget,
  type GenerationJob,
  type GenerationOutput,
  type GenerationProjectActionEnvelope,
  type GenerationProjectActionCommand,
  type GenerationProjectActionResult,
  type GenerationProjectMutationKind,
  type GenerationProjectMutationReceipt,
  GenerationProjectMutationReceiptSchema,
  type GenerationShotAttempt,
  type JsonValue,
} from "@openreel/music-video-domain/generation";
import { ActionExecutor } from "../../../../../packages/core/src/actions/index.js";
import { GitStore, type GitCommitReceipt, resolveGitExecutable } from "../../projects/git-store.js";
import { buildRequiredMediaManifest } from "../../projects/media-manifest.js";
import { ProjectStore } from "../../projects/project-store.js";
import { removePendingMedia, storePendingUpload } from "../../projects/pending-media.js";
import { executeSaveTransaction, recoverInterruptedSave, SaveTransactionError } from "../../projects/save-transaction.js";
import type { ServerRemovalManifest } from "../../projects/destructive-change.js";
import type { PlacementAttemptResult } from "./finalization.js";

export interface GenerationProjectActionAdapterOptions {
  readonly projectStore: ProjectStore;
  readonly gitStore: GitStore;
  readonly downloadCacheDir: string;
  readonly clock?: () => number;
  readonly actionId?: (input: { jobId: string; kind: GenerationProjectMutationKind }) => string;
  readonly maxConflictRetries?: number;
  readonly beforeTransaction?: (input: { attempt: number; jobId: string; kind: GenerationProjectMutationKind }) => void | Promise<void>;
  readonly afterCommit?: (envelope: GenerationProjectActionEnvelope) => void | Promise<void>;
}

export class GenerationProjectActionError extends Error {
  constructor(readonly code: string, message = code, options?: ErrorOptions) {
    super(message, options);
    this.name = "GenerationProjectActionError";
  }
}

interface MutationResult<T> {
  readonly value: T;
  readonly project: Project;
  readonly receipt: GenerationProjectMutationReceipt;
  readonly envelope: GenerationProjectActionEnvelope;
  readonly replayed: boolean;
}

interface PersistedGenerationProjectActions {
  readonly receipts?: Readonly<Record<string, unknown>>;
  readonly shotAttempts?: Readonly<Record<string, readonly GenerationShotAttempt[]>>;
}

const GENERATION_PROJECT_ACTIONS_INPUT_KEY = "generationProjectActions";
const execFileAsync = promisify(execFile);

interface MutationInput<T> {
  readonly job: GenerationJob;
  readonly idempotencyKey: string;
  readonly kind: GenerationProjectMutationKind;
  readonly semanticPayload: string;
  readonly replayValue: (project: Project, receipt: GenerationProjectMutationReceipt) => T;
  readonly mutate: (project: Project, receipt: GenerationProjectMutationReceipt) => Promise<ProjectMutation<T>> | ProjectMutation<T>;
}

interface ProjectMutation<T> {
  readonly project: Project;
  readonly value: T;
}

export type FinalizedGenerationProjectOutput = Pick<GenerationOutput, "mediaId" | "versionId"> & {
  readonly projectAction: GenerationProjectActionEnvelope;
};

function outputExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/mp4") return "mp4";
  throw new GenerationProjectActionError("generation-output-mime-unsupported");
}

function asBaseRevision(receipt: GitCommitReceipt, project: Project): ProjectBaseRevision {
  if (!receipt.commitSha || !receipt.treeSha || !receipt.projectBlobSha) {
    throw new GenerationProjectActionError(
      "generation-project-revision-unavailable",
      `Project ${project.id} has no complete confirmed revision.`,
    );
  }
  return {
    commitSha: receipt.commitSha,
    treeSha: receipt.treeSha,
    projectBlobSha: receipt.projectBlobSha,
    sourceModifiedAt: project.modifiedAt,
  };
}

async function readConfirmedProjectSnapshot(
  projectStore: ProjectStore,
  gitStore: GitStore,
  projectId: string,
): Promise<{ readonly project: Project; readonly revision: ProjectBaseRevision }> {
  await recoverInterruptedSave(projectStore, gitStore, projectId);
  return gitStore.withProjectTransaction(projectId, async () => {
    const [rawProject, gitReceipt] = await Promise.all([
      readFile(join(projectStore.projectDir(projectId), "project.json"), "utf8").catch(() => undefined),
      gitStore.readConfirmedReceipt(projectId),
    ]);
    if (!rawProject || !gitReceipt) throw new GenerationProjectActionError("generation-project-not-found");
    const project = JSON.parse(rawProject) as Project;
    return { project, revision: asBaseRevision(gitReceipt, project) };
  });
}

function receiptFromUnknown(value: unknown): GenerationProjectMutationReceipt | undefined {
  const parsed = GenerationProjectMutationReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function findGenerationProjectReceipt(project: Project, idempotencyKey: string): GenerationProjectMutationReceipt | undefined {
  const candidates: GenerationProjectMutationReceipt[] = [];
  for (const item of project.mediaLibrary.items) {
    const candidate = receiptFromUnknown(generationProjectActionsFromItem(item)?.receipts?.[idempotencyKey]);
    if (candidate) candidates.push(candidate);
  }
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const actions = (clip.metadata as { generationProjectActions?: { receipts?: Record<string, unknown> } } | undefined)?.generationProjectActions;
      const candidate = receiptFromUnknown(actions?.receipts?.[idempotencyKey]);
      if (candidate) candidates.push(candidate);
    }
  }
  if (candidates.length === 0) return undefined;
  const canonical = JSON.stringify(candidates[0]);
  if (candidates.some((candidate) => JSON.stringify(candidate) !== canonical)) {
    throw new GenerationProjectActionError("generation-idempotency-conflict", "Conflicting project receipts share one idempotency key.");
  }
  return candidates[0];
}

async function receiptAppliedRevision(
  gitStore: GitStore,
  projectId: string,
  receipt: GenerationProjectMutationReceipt,
): Promise<ProjectBaseRevision> {
  const history = (await gitStore.getHistory(projectId)).map((entry) => entry.split(" ", 1)[0] ?? "");
  const baseIndex = history.indexOf(receipt.baseRevision.commitSha);
  const appliedCommitSha = baseIndex > 0 ? history[baseIndex - 1] : undefined;
  if (!appliedCommitSha) throw new GenerationProjectActionError("generation-project-action-envelope-missing");
  const appliedProject = await gitStore.getProjectAtCommit(projectId, appliedCommitSha);
  const appliedReceipt = appliedProject
    ? findGenerationProjectReceipt(appliedProject, receipt.idempotencyKey)
    : undefined;
  if (!appliedProject || JSON.stringify(appliedReceipt) !== JSON.stringify(receipt)) {
    throw new GenerationProjectActionError("generation-project-action-snapshot-invalid");
  }
  const { stdout } = await execFileAsync(
    resolveGitExecutable(),
    ["rev-parse", `${appliedCommitSha}^{tree}`, `${appliedCommitSha}:project.json`],
    { cwd: gitStore.worktreePath(projectId), encoding: "utf8" },
  );
  const [treeSha, projectBlobSha] = stdout.trim().split(/\s+/u);
  return asBaseRevision({ commitSha: appliedCommitSha, treeSha: treeSha ?? null, projectBlobSha: projectBlobSha ?? null, mediaManifestDigest: null }, appliedProject);
}

function generationProjectActionsFromItem(item: MediaItem | undefined): PersistedGenerationProjectActions | undefined {
  const actions = item?.generationMeta?.inputs?.[GENERATION_PROJECT_ACTIONS_INPUT_KEY];
  return actions && typeof actions === "object" && !Array.isArray(actions)
    ? actions as PersistedGenerationProjectActions
    : undefined;
}

function generationActionsWithReceipt(item: MediaItem | undefined, idempotencyKey: string, receipt: GenerationProjectMutationReceipt) {
  const existing = generationProjectActionsFromItem(item);
  return {
    receipts: { ...(existing?.receipts ?? {}), [idempotencyKey]: receipt },
    ...(existing?.shotAttempts ? { shotAttempts: existing.shotAttempts } : {}),
  };
}

function placementKind(job: GenerationJob): GenerationProjectMutationKind {
  if (job.context.placementPolicy === "create-linked-clip") return "create-linked-clip";
  if (job.context.placementPolicy === "replace-selected-clip-media") return "replace-clip-media";
  throw new GenerationProjectActionError("generation-placement-policy-none");
}

function placementSemanticPayload(job: GenerationJob, output: GenerationOutput): string {
  return canonicalizeGenerationProjectActionPayload({
    jobId: job.id,
    projectId: job.projectId,
    policy: job.context.placementPolicy,
    entryContext: job.context.entryContext,
    timing: job.context.timing ?? null,
    output,
  } as unknown as JsonValue);
}

function revisionsEqual(left: ProjectBaseRevision, right: ProjectBaseRevision): boolean {
  return left.commitSha === right.commitSha
    && left.treeSha === right.treeSha
    && left.projectBlobSha === right.projectBlobSha
    && left.sourceModifiedAt === right.sourceModifiedAt;
}

function projectsEqualIgnoringModifiedAt(left: Project, right: Project): boolean {
  return isDeepStrictEqual({ ...left, modifiedAt: right.modifiedAt }, right);
}

function serverRemovalManifest(current: Project, target: Project): ServerRemovalManifest {
  const targetMedia = new Set(target.mediaLibrary.items.map((item) => item.id));
  const targetTracks = new Set(target.timeline.tracks.map((track) => track.id));
  const targetClips = new Set(target.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const removedMediaIds = current.mediaLibrary.items.map((item) => item.id).filter((id) => !targetMedia.has(id));
  const removedClipIds = current.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)).filter((id) => !targetClips.has(id));
  const removedTrackIds = current.timeline.tracks.map((track) => track.id).filter((id) => !targetTracks.has(id));
  const removedMedia = new Set(removedMediaIds);
  const dependentClipReferences = current.timeline.tracks.flatMap((track) => track.clips
    .filter((clip) => removedMedia.has(clip.mediaId))
    .map((clip) => ({ clipId: clip.id, mediaId: clip.mediaId, trackId: track.id })));
  return { removedMediaIds, removedClipIds, removedTrackIds, dependentClipReferences };
}

export class GenerationProjectActionAdapter {
  private readonly clock: () => number;
  private readonly createActionId: NonNullable<GenerationProjectActionAdapterOptions["actionId"]>;
  private readonly maxConflictRetries: number;

  constructor(private readonly options: GenerationProjectActionAdapterOptions) {
    this.clock = options.clock ?? (() => Date.now());
    this.createActionId = options.actionId ?? (({ jobId, kind }) => `${jobId}:${kind}`);
    this.maxConflictRetries = options.maxConflictRetries ?? 3;
  }

  async finalize(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<FinalizedGenerationProjectOutput> {
    const classification = classifyGenerationProjectTarget(input.job);
    if (classification.status === "needs-attention") {
      throw new GenerationProjectActionError(classification.error.code, classification.error.message);
    }
    const target = classification.target;
    const kind: GenerationProjectMutationKind = target.kind === "new-version" ? "finalize-version" : "finalize-placeholder";
    const semanticPayload = canonicalizeGenerationProjectActionPayload({
      jobId: input.job.id,
      projectId: input.job.projectId,
      target,
      output: input.output,
    } as unknown as JsonValue);
    const replayValue = (project: Project) => {
      const item = project.mediaLibrary.items.find((candidate) => candidate.id === target.placeholderMediaId);
      if (!item) throw new GenerationProjectActionError("generation-project-receipt-output-missing");
      return { mediaId: item.assetGroupId ?? item.id, versionId: item.id };
    };

    const existing = await this.readExactReceipt(input.job.projectId, input.idempotencyKey, kind, semanticPayload);
    if (existing) {
      const envelope = await this.getActionEnvelope(input.job.projectId, input.idempotencyKey);
      if (!envelope) throw new GenerationProjectActionError("generation-project-action-envelope-missing");
      return { ...replayValue(existing.project), projectAction: envelope };
    }

    const cached = await this.readCachedOutput(input.job, input.output);
    const filename = `${target.placeholderMediaId}.${outputExtension(cached.mimeType)}`;
    const tempDirectory = await mkdtemp(join(tmpdir(), "openreel-generated-output-"));
    const tempPath = join(tempDirectory, basename(filename));
    try {
      await copyFile(cached.path, tempPath);
      await storePendingUpload(
        this.options.projectStore.projectDir(input.job.projectId),
        target.placeholderMediaId,
        tempPath,
        filename,
        cached.mimeType,
        cached.bytes.byteLength,
      );
      const result = await this.mutateProject({
        job: input.job,
        idempotencyKey: input.idempotencyKey,
        kind,
        semanticPayload,
        replayValue,
        mutate: (project, receipt) => {
          const source = target.kind === "new-version"
            ? project.mediaLibrary.items.find((item) => item.id === target.sourceMediaId)
            : undefined;
          if (target.kind === "new-version" && !source) throw new GenerationProjectActionError("generation-project-source-missing");
          const groupId = source?.assetGroupId ?? source?.id ?? target.placeholderMediaId;
          const inspected = input.output;
          const generated: MediaItem = {
            id: target.placeholderMediaId,
            name: filename,
            type: cached.mimeType.startsWith("video/") ? "video" : "image",
            fileHandle: null,
            blob: null,
            metadata: {
              fileSize: cached.bytes.byteLength,
              width: inspected.width ?? 0,
              height: inspected.height ?? 0,
              duration: inspected.durationSeconds ?? 0,
              frameRate: 0,
              codec: cached.mimeType,
              sampleRate: 0,
              channels: 0,
            },
            thumbnailUrl: null,
            originalUrl: `/assets/${encodeURIComponent(filename)}`,
            assetGroupId: groupId,
            isCurrent: true,
            generationMeta: {
              provider: input.job.provider,
              model: input.job.modelId,
              prompt: input.job.context.prompt,
              negativePrompt: input.job.context.negativePrompt,
              jobId: input.job.id,
              status: "succeeded",
              inputs: {
                [GENERATION_PROJECT_ACTIONS_INPUT_KEY]: generationActionsWithReceipt(undefined, input.idempotencyKey, receipt),
              },
            },
          };
          const items = project.mediaLibrary.items
            .filter((item) => item.id !== target.placeholderMediaId)
            .map((item) => target.kind === "new-version" && (item.assetGroupId ?? item.id) === groupId ? { ...item, isCurrent: false } : item);
          return {
            project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: [...items, generated] } },
            value: { mediaId: groupId, versionId: generated.id },
          };
        },
      });
      if (result.replayed) await removePendingMedia(this.options.projectStore.projectDir(input.job.projectId), target.placeholderMediaId);
      return { ...result.value, projectAction: result.envelope };
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  async link(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<void> {
    if (input.job.context.entryContext.kind !== "unplaced-shot") {
      throw new GenerationProjectActionError("generation-project-shot-context-invalid");
    }
    if (!input.job.providerJobId) throw new GenerationProjectActionError("generation-provider-id-missing");
    const shotId = input.job.context.entryContext.shotId;
    const semanticPayload = canonicalizeGenerationProjectActionPayload({
      jobId: input.job.id,
      projectId: input.job.projectId,
      shotId,
      output: input.output,
    } as unknown as JsonValue);
    await this.mutateProject({
      job: input.job,
      idempotencyKey: input.idempotencyKey,
      kind: "append-shot-attempt",
      semanticPayload,
      replayValue: () => undefined,
      mutate: (project, receipt) => {
        const itemIndex = project.mediaLibrary.items.findIndex((item) => item.id === input.output.versionId);
        if (itemIndex < 0) throw new GenerationProjectActionError("generation-project-output-version-missing");
        const item = project.mediaLibrary.items[itemIndex]!;
        const actions = generationActionsWithReceipt(item, input.idempotencyKey, receipt);
        const attempt: GenerationShotAttempt = {
          schemaVersion: 1,
          jobId: input.job.id,
          providerJobId: input.job.providerJobId!,
          mediaId: input.output.mediaId,
          versionId: input.output.versionId,
          outputSha256: input.output.sha256,
          createdAt: this.clock(),
        };
        const nextItem: MediaItem = {
          ...item,
          generationMeta: {
            ...(item.generationMeta ?? { provider: input.job.provider, model: input.job.modelId }),
            inputs: {
              ...(item.generationMeta?.inputs ?? {}),
              [GENERATION_PROJECT_ACTIONS_INPUT_KEY]: {
                ...actions,
                shotAttempts: {
                  ...(actions.shotAttempts ?? {}),
                  [shotId]: [...(actions.shotAttempts?.[shotId] ?? []), attempt],
                },
              },
            },
          },
        };
        return {
          project: {
            ...project,
            mediaLibrary: {
              ...project.mediaLibrary,
              items: project.mediaLibrary.items.map((candidate, index) => index === itemIndex ? nextItem : candidate),
            },
          },
          value: undefined,
        };
      },
    });
  }

  async place(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<PlacementAttemptResult> {
    let kind: GenerationProjectMutationKind;
    let semanticPayload: string;
    try {
      kind = placementKind(input.job);
      semanticPayload = placementSemanticPayload(input.job, input.output);
      await this.mutateProject({
        job: input.job,
        idempotencyKey: input.idempotencyKey,
        kind,
        semanticPayload,
        replayValue: () => undefined,
        mutate: async (project, receipt) => {
          const mutatedProject = kind === "create-linked-clip"
            ? await this.createLinkedClip(project, input, receipt)
            : this.replaceClipMedia(project, input, receipt);
          return { project: mutatedProject, value: undefined };
        },
      });
      return { outcome: "applied" };
    } catch (cause) {
      const code = cause instanceof GenerationProjectActionError ? cause.code : "generation-project-placement-failed";
      const error = { code, message: cause instanceof Error ? cause.message : code, retryable: code === "generation-project-conflict-retry-exhausted" };
      if (code === "generation-idempotency-conflict" || code === "generation-project-commit-response-lost") return { outcome: "unknown", error };
      return { outcome: "not-applied", replaySafe: true, error };
    }
  }

  async reconcile(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<PlacementAttemptResult> {
    try {
      const kind = placementKind(input.job);
      const semanticPayload = placementSemanticPayload(input.job, input.output);
      const { project } = await readConfirmedProjectSnapshot(this.options.projectStore, this.options.gitStore, input.job.projectId);
      const receipt = findGenerationProjectReceipt(project, input.idempotencyKey);
      if (receipt) {
        if (receipt.kind !== kind || receipt.semanticPayload !== semanticPayload) {
          return { outcome: "unknown", error: { code: "generation-idempotency-conflict", message: "Project action receipt conflicts with the requested placement.", retryable: false } };
        }
        return { outcome: "applied" };
      }
      return { outcome: "not-applied", replaySafe: true };
    } catch (cause) {
      const code = cause instanceof GenerationProjectActionError ? cause.code : "generation-placement-reconciliation-failed";
      return { outcome: "unknown", error: { code, message: cause instanceof Error ? cause.message : "Placement reconciliation failed", retryable: code !== "generation-idempotency-conflict" } };
    }
  }

  async getActionEnvelope(projectId: string, idempotencyKey: string): Promise<GenerationProjectActionEnvelope | undefined> {
    const { project } = await readConfirmedProjectSnapshot(this.options.projectStore, this.options.gitStore, projectId);
    const receipt = findGenerationProjectReceipt(project, idempotencyKey);
    if (!receipt) return undefined;
    return { schemaVersion: 1, projectId, receipt, appliedRevision: await receiptAppliedRevision(this.options.gitStore, projectId, receipt) };
  }

  async applyProjectAction(command: GenerationProjectActionCommand): Promise<GenerationProjectActionResult> {
    if (command.projectId !== command.envelope.projectId || command.actionId !== command.envelope.receipt.actionId) {
      throw new GenerationProjectActionError("generation-project-action-identity-mismatch");
    }
    const { project: current, revision: currentRevision } = await readConfirmedProjectSnapshot(
      this.options.projectStore,
      this.options.gitStore,
      command.projectId,
    );
    if (!revisionsEqual(command.expectedRevision, currentRevision)) throw new GenerationProjectActionError("generation-project-action-conflict");
    const currentReceipt = findGenerationProjectReceipt(current, command.envelope.receipt.idempotencyKey);
    const [baseSnapshot, appliedSnapshot] = await Promise.all([
      this.options.gitStore.getProjectAtCommit(command.projectId, command.envelope.receipt.baseRevision.commitSha),
      this.options.gitStore.getProjectAtCommit(command.projectId, command.envelope.appliedRevision.commitSha),
    ]);
    if (!baseSnapshot || !appliedSnapshot) throw new GenerationProjectActionError("generation-project-action-snapshot-missing");
    const baseReceipt = findGenerationProjectReceipt(baseSnapshot, command.envelope.receipt.idempotencyKey);
    const appliedReceipt = findGenerationProjectReceipt(appliedSnapshot, command.envelope.receipt.idempotencyKey);
    if (baseReceipt !== undefined || JSON.stringify(appliedReceipt) !== JSON.stringify(command.envelope.receipt)) {
      throw new GenerationProjectActionError("generation-project-action-snapshot-invalid");
    }
    let target: Project;
    if (command.operation === "undo") {
      if (!revisionsEqual(currentRevision, command.envelope.appliedRevision) || !isDeepStrictEqual(current, appliedSnapshot)) {
        throw new GenerationProjectActionError("generation-project-action-conflict");
      }
      if (!currentReceipt || JSON.stringify(currentReceipt) !== JSON.stringify(command.envelope.receipt)) throw new GenerationProjectActionError("generation-project-action-conflict");
      target = baseSnapshot;
    } else {
      if (currentReceipt) {
        if (JSON.stringify(currentReceipt) === JSON.stringify(command.envelope.receipt)) {
          return { projectId: command.projectId, actionId: command.actionId, operation: command.operation, status: "replayed", revision: currentRevision, envelope: command.envelope };
        }
        throw new GenerationProjectActionError("generation-project-action-conflict");
      }
      if (!projectsEqualIgnoringModifiedAt(current, baseSnapshot)) throw new GenerationProjectActionError("generation-project-action-conflict");
      target = appliedSnapshot;
    }
    const proposed = { ...target, modifiedAt: Math.max(current.modifiedAt + 1, this.clock()) };
    const saved = await executeSaveTransaction(this.options.projectStore, this.options.gitStore, {
      projectId: command.projectId,
      baseRevision: currentRevision,
      project: proposed,
      requiredMediaManifest: buildRequiredMediaManifest(proposed),
      saveIntent: "recovery",
      destructiveIntent: true,
    }, { serverRemovalManifest: serverRemovalManifest(current, proposed) });
    return {
      projectId: command.projectId,
      actionId: command.actionId,
      operation: command.operation,
      status: "applied",
      revision: asBaseRevision(saved, saved.project),
      envelope: command.envelope,
    };
  }

  private async createLinkedClip(project: Project, input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }, receipt: GenerationProjectMutationReceipt): Promise<Project> {
    const timing = input.job.context.timing;
    if (!timing) throw new GenerationProjectActionError("generation-placement-timing-required");
    const media = project.mediaLibrary.items.find((item) => item.id === input.output.versionId);
    if (!media) throw new GenerationProjectActionError("generation-project-output-version-missing");
    if (media.type !== "image" && media.type !== "video") throw new GenerationProjectActionError("generation-placement-media-type-unsupported");
    const entry = input.job.context.entryContext;
    const destinationTrackId = entry.kind === "unlinked-range" ? entry.destinationTrackId : undefined;
    let track = destinationTrackId ? project.timeline.tracks.find((candidate) => candidate.id === destinationTrackId) : undefined;
    if (destinationTrackId && !track) throw new GenerationProjectActionError("generation-placement-track-not-found");
    if (track && track.locked) throw new GenerationProjectActionError("generation-placement-track-locked");
    if (track && track.type !== media.type) throw new GenerationProjectActionError("generation-placement-track-incompatible");
    const executor = new ActionExecutor();
    if (!track) {
      track = project.timeline.tracks.find((candidate) => candidate.type === media.type && !candidate.locked);
      if (!track) {
        const trackId = `${receipt.actionId}-track`;
        const result = await executor.executeWithoutHistory({ type: "track/add", id: `${receipt.actionId}:track`, timestamp: this.clock(), params: { trackType: media.type, trackId } }, project);
        if (!result.success) throw new GenerationProjectActionError("generation-placement-track-add-failed", result.error?.message);
        track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
      }
    }
    if (!track) throw new GenerationProjectActionError("generation-placement-track-add-failed");
    const existingActions = { receipts: { [input.idempotencyKey]: receipt } };
    const result = await executor.executeWithoutHistory({
      type: "clip/add",
      id: `${receipt.actionId}:clip`,
      timestamp: this.clock(),
      params: {
        trackId: track.id,
        mediaId: media.id,
        type: media.type,
        startTime: timing.startSeconds,
        duration: timing.durationSeconds,
        metadata: {
          ...(entry.kind === "linked-projection" || entry.kind === "unplaced-shot" ? { shotId: entry.shotId } : {}),
          assetGroupId: input.output.mediaId,
          providerJobId: input.job.providerJobId,
          idempotencyKey: input.idempotencyKey,
          generationProjectActions: existingActions,
        },
      },
    }, project);
    if (!result.success) throw new GenerationProjectActionError("generation-placement-clip-add-failed", result.error?.message);
    return project;
  }

  private replaceClipMedia(project: Project, input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }, receipt: GenerationProjectMutationReceipt): Project {
    const entry = input.job.context.entryContext;
    if (entry.kind !== "linked-projection") throw new GenerationProjectActionError("generation-placement-linked-projection-required");
    const media = project.mediaLibrary.items.find((item) => item.id === input.output.versionId);
    if (!media) throw new GenerationProjectActionError("generation-project-output-version-missing");
    const matches = project.timeline.tracks.flatMap((track) => track.clips.filter((clip) => clip.id === entry.clipId).map((clip) => ({ track, clip })));
    if (matches.length !== 1) throw new GenerationProjectActionError(matches.length === 0 ? "generation-placement-clip-not-found" : "generation-placement-clip-ambiguous");
    const existing = matches[0]!.clip;
    const shotId = (existing.metadata as { shotId?: unknown } | undefined)?.shotId;
    if (shotId !== undefined && shotId !== entry.shotId) throw new GenerationProjectActionError("generation-placement-shot-mismatch");
    const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
    const existingActions = (metadata.generationProjectActions as { receipts?: Record<string, unknown> } | undefined) ?? {};
    const replacement = {
      ...existing,
      mediaId: media.id,
      metadata: {
        ...metadata,
        assetGroupId: input.output.mediaId,
        providerJobId: input.job.providerJobId,
        idempotencyKey: input.idempotencyKey,
        generationProjectActions: { ...existingActions, receipts: { ...(existingActions.receipts ?? {}), [input.idempotencyKey]: receipt } },
      },
    };
    return {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) => track.id === matches[0]!.track.id
          ? { ...track, clips: track.clips.map((clip) => clip.id === existing.id ? replacement : clip) }
          : track),
      },
    };
  }

  private async readCachedOutput(job: GenerationJob, output: GenerationOutput) {
    if (!job.providerJobId) throw new GenerationProjectActionError("generation-provider-id-missing");
    const cacheKey = createHash("sha256").update(job.providerJobId).digest("hex");
    const path = join(this.options.downloadCacheDir, `${cacheKey}.bin`);
    const [bytes, metadataText] = await Promise.all([
      readFile(path),
      readFile(join(this.options.downloadCacheDir, `${cacheKey}.json`), "utf8"),
    ]).catch((cause) => { throw new GenerationProjectActionError("generation-output-cache-missing", undefined, { cause }); });
    const metadata = JSON.parse(metadataText) as { mimeType?: unknown };
    if (typeof metadata.mimeType !== "string" || metadata.mimeType !== output.mimeType) throw new GenerationProjectActionError("generation-output-cache-metadata-invalid");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== output.byteLength || sha256 !== output.sha256) throw new GenerationProjectActionError("generation-output-cache-integrity-failed");
    return { path, bytes, mimeType: metadata.mimeType };
  }

  private async readExactReceipt(projectId: string, idempotencyKey: string, kind: GenerationProjectMutationKind, semanticPayload: string) {
    const { project } = await readConfirmedProjectSnapshot(this.options.projectStore, this.options.gitStore, projectId);
    const receipt = findGenerationProjectReceipt(project, idempotencyKey);
    if (!receipt) return undefined;
    if (receipt.kind !== kind || receipt.semanticPayload !== semanticPayload) throw new GenerationProjectActionError("generation-idempotency-conflict");
    return { project, receipt };
  }

  private async mutateProject<T>(input: MutationInput<T>): Promise<MutationResult<T>> {
    for (let attempt = 0; attempt < this.maxConflictRetries; attempt += 1) {
      const { project: current, revision: baseRevision } = await readConfirmedProjectSnapshot(
        this.options.projectStore,
        this.options.gitStore,
        input.job.projectId,
      );
      const existing = findGenerationProjectReceipt(current, input.idempotencyKey);
      if (existing) {
        if (existing.kind !== input.kind || existing.semanticPayload !== input.semanticPayload) throw new GenerationProjectActionError("generation-idempotency-conflict");
        return {
          value: input.replayValue(current, existing),
          project: current,
          receipt: existing,
          envelope: {
            schemaVersion: 1,
            projectId: current.id,
            receipt: existing,
            appliedRevision: await receiptAppliedRevision(this.options.gitStore, current.id, existing),
          },
          replayed: true,
        };
      }
      const receipt: GenerationProjectMutationReceipt = {
        schemaVersion: 1,
        actionId: this.createActionId({ jobId: input.job.id, kind: input.kind }),
        jobId: input.job.id,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        semanticPayload: input.semanticPayload,
        baseRevision,
        appliedAt: this.clock(),
      };
      const draft = structuredClone(current) as Project;
      const mutation = await input.mutate(draft, receipt);
      const project: Project = {
        ...mutation.project,
        modifiedAt: Math.max(current.modifiedAt + 1, this.clock()),
      };
      try {
        await this.options.beforeTransaction?.({ attempt, jobId: input.job.id, kind: input.kind });
        const saved = await executeSaveTransaction(this.options.projectStore, this.options.gitStore, {
          projectId: project.id,
          baseRevision,
          project,
          requiredMediaManifest: buildRequiredMediaManifest(project),
          saveIntent: "recovery",
        });
        const result: MutationResult<T> = {
          value: mutation.value,
          project: saved.project,
          receipt,
          envelope: {
            schemaVersion: 1,
            projectId: project.id,
            receipt,
            appliedRevision: asBaseRevision(saved, saved.project),
          },
          replayed: false,
        };
        try {
          await this.options.afterCommit?.(result.envelope);
        } catch (cause) {
          throw new GenerationProjectActionError("generation-project-commit-response-lost", undefined, { cause });
        }
        return result;
      } catch (cause) {
        if (cause instanceof SaveTransactionError && cause.body.code === "PROJECT_CONFLICT") {
          if (attempt + 1 < this.maxConflictRetries) continue;
          throw new GenerationProjectActionError("generation-project-conflict-retry-exhausted", undefined, { cause });
        }
        throw cause;
      }
    }
    throw new GenerationProjectActionError("generation-project-conflict-retry-exhausted");
  }
}
