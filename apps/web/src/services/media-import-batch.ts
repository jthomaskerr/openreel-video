import type { ActionResult } from "@openreel/core";
import type {
  MediaImportOutcome,
  MediaImportStage,
} from "./media-import-outcome";
import {
  evaluateMediaImportPreflight,
  getMediaStorageEvidence,
  parseConfiguredMaxMediaSourceBytes,
} from "./media-import-policy";

export interface MediaImportProgress {
  readonly filename: string;
  readonly index: number;
  readonly total: number;
  readonly stage: MediaImportStage;
}

export interface MediaImportBatchOptions {
  readonly importFile: (file: File) => Promise<ActionResult>;
  readonly maxSourceBytes?: number;
  readonly runtimeLimitBytes?: number;
  readonly getStorageEvidence?: typeof getMediaStorageEvidence;
  readonly onProgress?: (progress: MediaImportProgress) => void;
}

function identity(file: File) {
  return { name: file.name, size: file.size, lastModified: file.lastModified };
}

function isPersistenceWarning(warning: string): boolean {
  return /local media persistence|persist(?:ence|ing)|indexeddb|quota/i.test(warning);
}

export async function importMediaBatch(
  files: readonly File[],
  options: MediaImportBatchOptions,
): Promise<MediaImportOutcome[]> {
  const outcomes: MediaImportOutcome[] = [];
  const storageEvidence = await (
    options.getStorageEvidence ?? getMediaStorageEvidence
  )();

  for (const [offset, file] of files.entries()) {
    const progress = (stage: MediaImportStage) =>
      options.onProgress?.({
        filename: file.name,
        index: offset + 1,
        total: files.length,
        stage,
      });
    progress("preflight");

    const preflight = evaluateMediaImportPreflight({
      sourceBytes: file.size,
      maxSourceBytes:
        options.maxSourceBytes ??
        parseConfiguredMaxMediaSourceBytes(
          import.meta.env.VITE_MAX_MEDIA_IMPORT_BYTES,
        ),
      runtimeLimitBytes: options.runtimeLimitBytes,
      knownAvailableBytes: storageEvidence.knownAvailableBytes,
    });
    if (!preflight.accepted) {
      outcomes.push({
        file: identity(file),
        status: "rejected",
        stage: "preflight",
        reason: preflight.reason,
        message: `${file.name} exceeds the ${preflight.reason.replaceAll("-", " ")} limit (${preflight.limitBytes} bytes).`,
        warnings: storageEvidence.warning ? [storageEvidence.warning] : [],
        recoveryAction:
          preflight.reason === "configured-cap" ? "open-settings" : "none",
      });
      continue;
    }

    progress("decode");
    try {
      const result = await options.importFile(file);
      if (!result.success) {
        outcomes.push({
          file: identity(file),
          status: "failed",
          stage: "decode",
          reason:
            result.error?.code === "UNSUPPORTED_FORMAT"
              ? "unsupported-format"
              : "decode-failed",
          message: result.error?.message ?? `Failed to import ${file.name}.`,
          warnings: result.warnings ?? [],
          recoveryAction: "retry",
        });
        continue;
      }

      const warnings = result.warnings ?? [];
      if (warnings.some(isPersistenceWarning)) {
        outcomes.push({
          file: identity(file),
          mediaId: result.actionId,
          status: "degraded-success",
          stage: "local-persistence",
          reason: "persistence-failed",
          message: `${file.name} imported, but local persistence must be retried.`,
          warnings,
          recoveryAction: "retry",
        });
        continue;
      }

      outcomes.push({
        file: identity(file),
        mediaId: result.actionId,
        status: "durable-success",
        stage: "local-persistence",
        message: `${file.name} imported and stored locally.`,
        warnings,
        recoveryAction: "none",
      });
    } catch (error) {
      outcomes.push({
        file: identity(file),
        status: "failed",
        stage: "decode",
        reason: "unknown",
        message: error instanceof Error ? error.message : `Failed to import ${file.name}.`,
        warnings: [],
        recoveryAction: "retry",
      });
    }
  }

  return outcomes;
}
