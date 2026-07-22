import type { ExportRange } from "../types";

export type HandoffTarget = "resolve" | "imovie";
export type HandoffMode = "editable" | "flattened";

export interface HandoffTargetProfile {
  readonly id: HandoffTarget;
  readonly label: string;
  readonly mode: HandoffMode;
  readonly contractVersion: string;
  readonly applicationVersions: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly issueMatrixVersion: string;
}

export interface HandoffSelection {
  readonly projectId: string;
  readonly projectModifiedAt: number;
  readonly target: HandoffTarget;
  readonly range: ExportRange;
}

export interface Timebase {
  readonly framesPerSecondNumerator: number;
  readonly framesPerSecondDenominator: number;
  readonly frameDurationNumerator: number;
  readonly frameDurationDenominator: number;
  readonly sourceFrameRate: number;
}

export interface RationalTime {
  readonly numerator: number;
  readonly denominator: number;
}

export interface FrameRange {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly durationFrames: number;
}

export type HandoffEntityKind = "project" | "track" | "clip" | "media" | "export";

export interface HandoffEntityRef {
  readonly kind: HandoffEntityKind;
  readonly id: string;
  readonly label: string;
  readonly trackIndex: number | null;
  readonly timelineFrame: number | null;
}

export type CompatibilityIssueSeverity = "blocking" | "flattening" | "info";

export interface CompatibilityIssue {
  readonly code: string;
  readonly severity: CompatibilityIssueSeverity;
  readonly entity: HandoffEntityRef;
  readonly message: string;
  readonly action: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface CompatibilityAssessment {
  readonly assessmentId: string;
  readonly target: HandoffTarget;
  readonly selection: HandoffSelection;
  readonly timebase: Timebase;
  readonly status: "ready" | "blocked";
  readonly issues: readonly CompatibilityIssue[];
  readonly includedTrackIds: readonly string[];
  readonly includedClipIds: readonly string[];
  readonly requiredMediaIds: readonly string[];
  readonly createdAt: number;
}

export type MediaResolutionSource = "blob" | "persisted-blob" | "file-handle" | "verified-url";

export interface MediaReference {
  readonly mediaId: string;
  readonly sourceName: string;
  readonly outputName: string;
  readonly relativeUrl: string;
  readonly type: "video" | "audio" | "image";
  readonly duration: RationalTime | null;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly resolutionSource?: MediaResolutionSource;
}

export interface ProjectedClip {
  readonly clipId: string;
  readonly trackId: string;
  readonly mediaId: string;
  readonly trackIndex: number;
  readonly lane: number;
  readonly timelineRange: FrameRange;
  readonly sourceStartFrame: number;
  readonly sourceDurationFrames: number;
  readonly enabled: boolean;
  readonly kind: "video" | "audio" | "image";
  readonly mediaReferenceId: string;
}

export interface ProjectedTrack {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio";
  readonly index: number;
}

export type HandoffArtifactKind = "fcpxml" | "movie" | "media" | "report";
export type HandoffArtifactStatus = "planned" | "writing" | "written" | "failed" | "cancelled";

export interface HandoffArtifact {
  readonly kind: HandoffArtifactKind;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly required: boolean;
  readonly byteLength: number | null;
  readonly sha256: string | null;
  readonly status: HandoffArtifactStatus;
}

export interface TimelineHandoffPlan {
  readonly planId: string;
  readonly assessmentId: string;
  readonly project: { readonly id: string; readonly name: string; readonly width: number; readonly height: number };
  readonly targetProfile: HandoffTargetProfile;
  readonly selection: HandoffSelection;
  readonly timebase: Timebase;
  readonly durationFrames: number;
  readonly tracks: readonly ProjectedTrack[];
  readonly clips: readonly ProjectedClip[];
  readonly media: readonly MediaReference[];
  readonly issues: readonly CompatibilityIssue[];
  readonly artifacts: readonly HandoffArtifact[];
}

export interface ReportArtifact {
  readonly kind: HandoffArtifactKind;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly required: boolean;
  readonly byteLength?: number;
  readonly sha256?: string;
  readonly status: "written" | "failed" | "cancelled";
}

export interface CompatibilityReport {
  readonly schemaVersion: "1.0";
  readonly project: { readonly id: string; readonly name: string };
  readonly target: Pick<HandoffTargetProfile, "id" | "label" | "mode" | "contractVersion" | "applicationVersions">;
  readonly range: FrameRange & {
    readonly frameRate: string;
    readonly startDisplay: string;
    readonly endDisplay: string;
    readonly durationDisplay: string;
  };
  readonly artifacts: readonly ReportArtifact[];
  readonly issues: readonly CompatibilityIssue[];
  readonly unsupportedItems: readonly CompatibilityIssue[];
  readonly result: { readonly status: "completed" | "failed" | "cancelled"; readonly summary: string };
  readonly generatedAt: string;
}

export type HandoffPhase =
  | "idle"
  | "assessing"
  | "awaiting-destination"
  | "resolving-media"
  | "rendering"
  | "packaging"
  | "saving"
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed";

export interface HandoffProgress {
  readonly operationId: string;
  readonly target: HandoffTarget;
  readonly phase: Exclude<HandoffPhase, "idle">;
  readonly progress: number;
  readonly processedCount: number;
  readonly totalCount: number;
  readonly currentEntity?: HandoffEntityRef;
  readonly message: string;
}

export interface WrittenArtifact {
  readonly kind: HandoffArtifactKind;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256?: string;
}

export interface HandoffFailure {
  readonly code: string;
  readonly stage: Exclude<HandoffPhase, "idle">;
  readonly message: string;
  readonly entity: HandoffEntityRef | null;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

export type HandoffResult =
  | { readonly status: "completed"; readonly target: HandoffTarget; readonly report: CompatibilityReport; readonly artifacts: readonly WrittenArtifact[] }
  | { readonly status: "blocked"; readonly target: HandoffTarget; readonly assessment: CompatibilityAssessment }
  | { readonly status: "cancelled"; readonly target: HandoffTarget; readonly stage: Exclude<HandoffPhase, "idle">; readonly writtenArtifacts: readonly WrittenArtifact[] }
  | { readonly status: "failed"; readonly target: HandoffTarget; readonly failure: HandoffFailure; readonly writtenArtifacts: readonly WrittenArtifact[] };

export interface MediaAvailabilityHint {
  readonly available: boolean;
  readonly source?: MediaResolutionSource;
  readonly mediaType?: string;
  readonly byteLength?: number;
}

export interface HandoffDiagnosticEvent {
  readonly name: string;
  readonly target: HandoffTarget;
  readonly stage?: Exclude<HandoffPhase, "idle">;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

