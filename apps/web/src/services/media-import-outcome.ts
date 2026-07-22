export type MediaImportStage =
  | "preflight"
  | "decode"
  | "derivative"
  | "local-persistence"
  | "backend-upload"
  | "recovery-handle";

export type MediaImportRejectionReason =
  | "configured-cap"
  | "available-capacity"
  | "runtime-capability"
  | "unsupported-format"
  | "decode-failed"
  | "persistence-failed"
  | "upload-failed"
  | "handle-failed"
  | "unknown";

export type MediaRecoveryAction = "retry" | "relink" | "open-settings" | "none";

export interface MediaImportFileIdentity {
  readonly name: string;
  readonly size: number;
  readonly lastModified?: number;
}

interface MediaImportOutcomeBase {
  readonly file: MediaImportFileIdentity;
  readonly stage: MediaImportStage;
  readonly mediaId?: string;
  readonly message: string;
  readonly warnings: readonly string[];
  readonly recoveryAction: MediaRecoveryAction;
}

export type MediaImportOutcome =
  | (MediaImportOutcomeBase & { readonly status: "durable-success" })
  | (MediaImportOutcomeBase & {
      readonly status: "degraded-success";
      readonly reason: MediaImportRejectionReason;
    })
  | (MediaImportOutcomeBase & {
      readonly status: "rejected" | "failed";
      readonly reason: MediaImportRejectionReason;
    });

export interface MediaDependencySummary {
  readonly mediaId: string;
  readonly timelineClipIds: readonly string[];
  readonly protectedWorkflowReferences: readonly {
    type: string;
    id: string;
  }[];
  readonly total: number;
}

