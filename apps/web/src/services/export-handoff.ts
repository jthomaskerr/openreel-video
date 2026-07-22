import {
  assessHandoff,
  createHandoffPlan,
  createImovieExportProfile,
  frameRangeFromSeconds,
  HANDOFF_TARGET_PROFILES,
  renderCompatibilityReport,
  sanitizeMediaFileName,
  serializeResolveFcpxml,
  type CompatibilityReport,
  type ExportEngine,
  type HandoffDiagnosticEvent,
  type HandoffEntityRef,
  type HandoffFailure,
  type HandoffPhase,
  type HandoffProgress,
  type HandoffResult,
  type HandoffSelection,
  type HandoffTarget,
  type MediaAvailabilityHint,
  type MediaItem,
  type Project,
  type WrittenArtifact,
} from "@openreel/core";

export interface MediaResolver {
  inspect(media: MediaItem, signal: AbortSignal): Promise<MediaAvailabilityHint>;
  open(media: MediaItem, signal: AbortSignal): Promise<ResolvedMediaSource>;
}

export interface ResolvedMediaSource {
  readonly mediaId: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly mediaType: string;
  stream(): ReadableStream<Uint8Array>;
}

export interface ResolveDestination {
  createProjectDirectory(name: string): Promise<DirectoryWriter>;
}

export interface DirectoryWriter {
  write(
    relativePath: string,
    body: string | ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<WrittenArtifact>;
  close(): Promise<void>;
}

export interface MovieDestination {
  open(fileName: string, mediaType: string): Promise<FileSystemWritableFileStream>;
}

export interface HandoffDependencies {
  readonly mediaResolver: MediaResolver;
  readonly resolveDestination: ResolveDestination;
  readonly movieDestination: MovieDestination;
  readonly exportEngine: Pick<ExportEngine, "exportVideo" | "cancel">;
  readonly emitDiagnostic: (event: HandoffDiagnosticEvent) => void;
}

export interface StartHandoffOptions {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: HandoffProgress) => void;
}

const TERMINAL_PHASES = new Set<HandoffPhase>(["completed", "blocked", "cancelled", "failed"]);

const COMMON_TRANSITIONS: Readonly<Record<HandoffPhase, readonly HandoffPhase[]>> = {
  idle: ["assessing"],
  assessing: ["awaiting-destination", "blocked", "cancelled", "failed"],
  "awaiting-destination": ["resolving-media", "rendering", "cancelled", "failed"],
  "resolving-media": ["packaging", "cancelled", "failed"],
  rendering: ["packaging", "cancelled", "failed"],
  packaging: ["saving", "cancelled", "failed"],
  saving: ["completed", "cancelled", "failed"],
  completed: [],
  blocked: [],
  cancelled: [],
  failed: [],
};

let operationSequence = 0;

export class HandoffOperation {
  readonly abortController = new AbortController();
  phase: HandoffPhase = "idle";
  cancelledFrom: Exclude<HandoffPhase, "idle"> = "assessing";
  private phaseProgress = 0;
  private terminalEmitted = false;

  constructor(
    readonly operationId: string,
    readonly target: HandoffTarget,
    private readonly onProgress: (progress: HandoffProgress) => void,
  ) {}

  transition(
    next: Exclude<HandoffPhase, "idle">,
    message: string,
    progress = 0,
    processedCount = 0,
    totalCount = 0,
    currentEntity?: HandoffEntityRef,
  ): void {
    if (TERMINAL_PHASES.has(this.phase)) throw new Error(`Handoff phase ${this.phase} is terminal`);
    if (!COMMON_TRANSITIONS[this.phase].includes(next)) {
      throw new Error(`Invalid handoff transition from ${this.phase} to ${next}`);
    }
    if (this.target === "resolve" && next === "rendering") {
      throw new Error("Invalid Resolve transition to rendering");
    }
    if (this.target === "imovie" && next === "resolving-media") {
      throw new Error("Invalid iMovie transition to resolving-media");
    }
    this.phase = next;
    this.phaseProgress = 0;
    this.emit(progress, message, processedCount, totalCount, currentEntity);
  }

  update(
    progress: number,
    message: string,
    processedCount = 0,
    totalCount = 0,
    currentEntity?: HandoffEntityRef,
  ): void {
    if (this.phase === "idle" || TERMINAL_PHASES.has(this.phase)) {
      throw new Error(`Cannot update progress in ${this.phase}`);
    }
    this.emit(progress, message, processedCount, totalCount, currentEntity);
  }

  cancel(message: string): void {
    if (TERMINAL_PHASES.has(this.phase)) return;
    if (this.phase !== "idle") this.cancelledFrom = this.phase;
    this.abortController.abort();
    this.transition("cancelled", message, this.phaseProgress);
  }

  throwIfAborted(externalSignal?: AbortSignal): void {
    if (externalSignal?.aborted || this.abortController.signal.aborted) throw new DOMException("Handoff cancelled", "AbortError");
  }

  private emit(
    progress: number,
    message: string,
    processedCount: number,
    totalCount: number,
    currentEntity?: HandoffEntityRef,
  ): void {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new RangeError("Handoff progress must be finite and between 0 and 1");
    }
    if (progress < this.phaseProgress) throw new RangeError("Handoff progress must be monotonic within a phase");
    if (TERMINAL_PHASES.has(this.phase)) {
      if (this.terminalEmitted) return;
      this.terminalEmitted = true;
    }
    this.phaseProgress = progress;
    this.onProgress({
      operationId: this.operationId,
      target: this.target,
      phase: this.phase as Exclude<HandoffPhase, "idle">,
      progress,
      processedCount,
      totalCount,
      ...(currentEntity ? { currentEntity } : {}),
      message,
    });
  }
}

function cancelledResult(
  operation: HandoffOperation,
  writtenArtifacts: readonly WrittenArtifact[],
): HandoffResult {
  return {
    status: "cancelled",
    target: operation.target,
    stage: operation.cancelledFrom,
    writtenArtifacts,
  };
}

function mapFailure(_target: HandoffTarget, stage: Exclude<HandoffPhase, "idle">, cause: unknown): HandoffFailure {
  const permissionDenied = cause instanceof DOMException && cause.name === "NotAllowedError";
  const stageCode: Partial<Record<Exclude<HandoffPhase, "idle">, string>> = {
    assessing: "handoff.assessment-failed",
    "awaiting-destination": "handoff.destination-failed",
    "resolving-media": "handoff.media-copy-failed",
    rendering: "handoff.render-failed",
    packaging: "handoff.artifact-write-failed",
    saving: "handoff.save-failed",
  };
  return {
    code: permissionDenied ? "handoff.permission-denied" : (stageCode[stage] ?? "handoff.operation-failed"),
    stage,
    message:
      permissionDenied
        ? "Permission was denied. Choose a writable destination and retry."
        : "The handoff could not continue. Review the compatibility details and retry.",
    entity: null,
    retryable: true,
    cause,
  };
}

function completedReport(
  project: Project,
  assessment: ReturnType<typeof assessHandoff>,
  artifacts: readonly WrittenArtifact[],
): CompatibilityReport {
  const profile = HANDOFF_TARGET_PROFILES.get(assessment.target);
  if (!profile) throw new Error(`Missing handoff target profile: ${assessment.target}`);
  const range = frameRangeFromSeconds(assessment.selection.range, assessment.timebase);
  const frameRate = `${assessment.timebase.framesPerSecondNumerator}/${assessment.timebase.framesPerSecondDenominator}`;
  return {
    schemaVersion: "1.0",
    project: { id: project.id, name: project.name },
    target: profile,
    range: {
      ...range,
      frameRate,
      startDisplay: `${range.startFrame} frames`,
      endDisplay: `${range.endFrame} frames`,
      durationDisplay: `${range.durationFrames} frames`,
    },
    artifacts: artifacts.map(({ sha256, ...artifact }) => ({
      ...artifact,
      ...(sha256 && /^[a-f0-9]{64}$/.test(sha256) ? { sha256 } : {}),
      required: true,
      status: "written",
    })),
    issues: assessment.issues,
    unsupportedItems: assessment.issues.filter((issue) => issue.severity === "flattening"),
    result: { status: "completed", summary: "Handoff artifacts were written successfully." },
    generatedAt: new Date(assessment.createdAt).toISOString(),
  };
}

export async function startHandoff(
  project: Project,
  selection: HandoffSelection,
  dependencies: HandoffDependencies,
  options: StartHandoffOptions,
): Promise<HandoffResult> {
  const operation = new HandoffOperation(
    `handoff-${++operationSequence}`,
    selection.target,
    options.onProgress,
  );
  const cancelFromExternalSignal = () => {
    operation.cancel("Handoff cancelled by user");
    if (selection.target === "imovie") dependencies.exportEngine.cancel();
  };
  options.signal.addEventListener("abort", cancelFromExternalSignal, { once: true });
  const availability = new Map<string, MediaAvailabilityHint>();
  const writtenArtifacts: WrittenArtifact[] = [];

  try {
    operation.transition("assessing", "Assessing compatibility");
    operation.throwIfAborted(options.signal);

    for (let index = 0; index < project.mediaLibrary.items.length; index += 1) {
      const media = project.mediaLibrary.items[index];
      operation.throwIfAborted(options.signal);
      const hint = await dependencies.mediaResolver.inspect(media, operation.abortController.signal);
      operation.throwIfAborted(options.signal);
      availability.set(media.id, hint);
      operation.update(
        (index + 1) / Math.max(1, project.mediaLibrary.items.length),
        `Checked media ${index + 1} of ${project.mediaLibrary.items.length}`,
        index + 1,
        project.mediaLibrary.items.length,
        { kind: "media", id: media.id, label: media.name, trackIndex: null, timelineFrame: null },
      );
    }

    const assessment = assessHandoff(project, selection, {
      mediaAvailability: availability,
      targetProfiles: HANDOFF_TARGET_PROFILES,
    });
    dependencies.emitDiagnostic({
      name: assessment.status === "blocked" ? "handoff.assessment.blocked" : "handoff.assessment.completed",
      target: selection.target,
      stage: "assessing",
      fields: {
        blockingIssues: assessment.issues.filter((entry) => entry.severity === "blocking").length,
        flatteningIssues: assessment.issues.filter((entry) => entry.severity === "flattening").length,
      },
    });

    if (assessment.status === "blocked") {
      operation.transition("blocked", "Resolve compatibility issues before export", 1);
      return { status: "blocked", target: selection.target, assessment };
    }

    operation.transition("awaiting-destination", "Choose an export destination", 0);
    if (selection.target === "resolve") {
      let writer: DirectoryWriter | undefined;
      try {
        const resolveProfile = HANDOFF_TARGET_PROFILES.get("resolve");
        if (!resolveProfile) throw new Error("Missing Resolve handoff target profile");
        const plan = createHandoffPlan(project, assessment, resolveProfile);
        writer = await dependencies.resolveDestination.createProjectDirectory(plan.project.name);
        dependencies.emitDiagnostic({
          name: "handoff.destination.selected",
          target: selection.target,
          stage: "awaiting-destination",
          fields: { directoryName: plan.project.name },
        });
        operation.throwIfAborted(options.signal);
        operation.transition("resolving-media", "Collecting source media", 0);
        for (let index = 0; index < plan.media.length; index += 1) {
          const mediaReference = plan.media[index];
          const media = project.mediaLibrary.items.find((item) => item.id === mediaReference.mediaId);
          if (!media) throw new Error(`Required media ${mediaReference.mediaId} is missing`);
          const source = await dependencies.mediaResolver.open(media, operation.abortController.signal);
          operation.throwIfAborted(options.signal);
          if (source.mediaId !== media.id) throw new Error(`Resolved media ID did not match ${media.id}`);
          dependencies.emitDiagnostic({
            name: "handoff.media.resolve.completed",
            target: selection.target,
            stage: "resolving-media",
            fields: { mediaId: media.id, byteLength: source.byteLength },
          });
          dependencies.emitDiagnostic({
            name: "handoff.artifact.write.started",
            target: selection.target,
            stage: "resolving-media",
            fields: { artifactKind: "media", relativePath: mediaReference.relativeUrl },
          });
          const artifact = await writer.write(
            mediaReference.relativeUrl,
            source.stream(),
            operation.abortController.signal,
          );
          writtenArtifacts.push(artifact);
          dependencies.emitDiagnostic({
            name: "handoff.artifact.write.completed",
            target: selection.target,
            stage: "resolving-media",
            fields: { artifactKind: artifact.kind, relativePath: artifact.relativePath, byteLength: artifact.byteLength },
          });
          operation.update(
            (index + 1) / Math.max(1, plan.media.length),
            `Copied media ${index + 1} of ${plan.media.length}`,
            index + 1,
            plan.media.length,
            { kind: "media", id: media.id, label: media.name, trackIndex: null, timelineFrame: null },
          );
        }

        operation.transition("packaging", "Writing timeline and compatibility report", 0);
        const fcpxmlPath = plan.artifacts.find((entry) => entry.kind === "fcpxml")?.relativePath;
        if (!fcpxmlPath) throw new Error("Resolve plan is missing the FCPXML artifact");
        dependencies.emitDiagnostic({
          name: "handoff.artifact.write.started",
          target: selection.target,
          stage: "packaging",
          fields: { artifactKind: "fcpxml", relativePath: fcpxmlPath },
        });
        const fcpxmlArtifact = await writer.write(
          fcpxmlPath,
          serializeResolveFcpxml(plan),
          operation.abortController.signal,
        );
        writtenArtifacts.push(fcpxmlArtifact);
        dependencies.emitDiagnostic({
          name: "handoff.artifact.write.completed",
          target: selection.target,
          stage: "packaging",
          fields: { artifactKind: "fcpxml", relativePath: fcpxmlPath, byteLength: fcpxmlArtifact.byteLength },
        });
        const report = completedReport(project, assessment, writtenArtifacts);
        dependencies.emitDiagnostic({
          name: "handoff.artifact.write.started",
          target: selection.target,
          stage: "packaging",
          fields: { artifactKind: "report", relativePath: "compatibility-report.md" },
        });
        const reportArtifact = await writer.write(
          "compatibility-report.md",
          renderCompatibilityReport(report),
          operation.abortController.signal,
        );
        writtenArtifacts.push(reportArtifact);
        dependencies.emitDiagnostic({
          name: "handoff.artifact.write.completed",
          target: selection.target,
          stage: "packaging",
          fields: { artifactKind: "report", relativePath: reportArtifact.relativePath, byteLength: reportArtifact.byteLength },
        });
        operation.transition("saving", "Finalizing Resolve handoff folder", 0);
        await writer.close();
        writer = undefined;
        const finalReport = completedReport(project, assessment, writtenArtifacts);
        operation.transition("completed", "Resolve handoff folder is ready", 1);
        dependencies.emitDiagnostic({
          name: "handoff.completed",
          target: selection.target,
          stage: "completed",
          fields: { artifactCount: writtenArtifacts.length },
        });
        return { status: "completed", target: selection.target, report: finalReport, artifacts: writtenArtifacts };
      } finally {
        if (writer) await writer.close();
      }
    }

    if (selection.target === "imovie") {
      const settings = createImovieExportProfile(project, selection);
      const fileName = `${sanitizeMediaFileName(project.name, project.id)}-imovie.mov`;
      const writable = await dependencies.movieDestination.open(fileName, "video/quicktime");
      dependencies.emitDiagnostic({
        name: "handoff.destination.selected",
        target: selection.target,
        stage: "awaiting-destination",
        fields: { fileName },
      });
      operation.throwIfAborted(options.signal);
      operation.transition("rendering", "Rendering flattened iMovie movie", 0);
      const generator = dependencies.exportEngine.exportVideo(project, settings, writable);
      let next = await generator.next();
      while (!next.done) {
        operation.throwIfAborted(options.signal);
        const exportProgress = next.value;
        operation.update(
          exportProgress.progress,
          exportProgress.phase === "complete" ? "Finalizing movie" : `Rendering movie: ${exportProgress.phase}`,
          exportProgress.currentFrame,
          exportProgress.totalFrames,
        );
        dependencies.emitDiagnostic({
          name: "handoff.render.progress",
          target: selection.target,
          stage: "rendering",
          fields: {
            progress: exportProgress.progress,
            currentFrame: exportProgress.currentFrame,
            totalFrames: exportProgress.totalFrames,
            byteLength: exportProgress.bytesWritten,
          },
        });
        next = await generator.next();
      }
      const exportResult = next.value;
      if (!exportResult.success) throw new Error("The iMovie movie render failed. Review export diagnostics and retry.");
      operation.transition("packaging", "Preparing compatibility report", 0);
      const movieArtifact: WrittenArtifact = {
        kind: "movie",
        relativePath: fileName,
        mediaType: "video/quicktime",
        byteLength: exportResult.stats?.fileSize ?? 0,
        sha256: "unavailable-for-streamed-output",
      };
      writtenArtifacts.push(movieArtifact);
      const report = completedReport(project, assessment, [movieArtifact]);
      operation.transition("saving", "Finalizing iMovie handoff", 0);
      operation.transition("completed", "iMovie handoff is ready", 1);
      dependencies.emitDiagnostic({
        name: "handoff.completed",
        target: selection.target,
        stage: "completed",
        fields: { artifactCount: 1 },
      });
      return { status: "completed", target: selection.target, report, artifacts: writtenArtifacts };
    }

    const failure = mapFailure(selection.target, "awaiting-destination", new Error("Target writer is not available yet"));
    operation.transition("failed", failure.message, 0);
    dependencies.emitDiagnostic({
      name: "handoff.failed",
      target: selection.target,
      stage: failure.stage,
      fields: { errorCode: failure.code, retryable: failure.retryable },
    });
    return { status: "failed", target: selection.target, failure, writtenArtifacts: [] };
  } catch (cause) {
    if (options.signal.aborted || operation.abortController.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) {
      operation.cancel("Handoff cancelled by user");
      dependencies.emitDiagnostic({
        name: "handoff.cancelled",
        target: selection.target,
        stage: operation.cancelledFrom,
        fields: {},
      });
      return cancelledResult(operation, writtenArtifacts);
    }
    const stage = operation.phase === "idle" ? "assessing" : operation.phase;
    const failure = mapFailure(selection.target, stage as Exclude<HandoffPhase, "idle">, cause);
    if (!TERMINAL_PHASES.has(operation.phase)) operation.transition("failed", failure.message, 0);
    if (failure.stage === "resolving-media") {
      dependencies.emitDiagnostic({
        name: "handoff.media.resolve.failed",
        target: selection.target,
        stage: failure.stage,
        fields: { errorCode: failure.code, retryable: failure.retryable },
      });
    }
    dependencies.emitDiagnostic({
      name: "handoff.failed",
      target: selection.target,
      stage: failure.stage,
      fields: { errorCode: failure.code, retryable: failure.retryable },
    });
    return { status: "failed", target: selection.target, failure, writtenArtifacts };
  } finally {
    options.signal.removeEventListener("abort", cancelFromExternalSignal);
  }
}
