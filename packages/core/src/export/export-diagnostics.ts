import type { ExportVisibility } from "./export-performance";

export type ExportDiagnosticEvent =
  | {
      event: "export-start";
      browser: string;
      codec: string;
      width: number;
      height: number;
      frameRate: number;
      totalFrames: number;
      requestedAcceleration: "no-preference";
    }
  | {
      event: "encoder-config";
      codec: string;
      width: number;
      height: number;
      frameRate: number;
      bitrate: number;
      requestedAcceleration: "no-preference";
      effectiveAcceleration: string | null;
    }
  | { event: "export-preparation"; audioMs: number; decodersMs: number }
  | {
      event: "decoder-fallback";
      assetId: string;
      operation: string;
      fallback: string;
    }
  | {
      event: "export-performance";
      frame: number;
      decodeRenderMs: number;
      encodeWriteMs: number;
      cleanupCount: number;
      cleanupMs: number;
      framesPerSecond: number;
      visibility: ExportVisibility;
    }
  | {
      event: "export-finished";
      phase: "cancelled" | "finalized";
      elapsedMs: number;
    }
  | {
      event: "export-error";
      phase: string;
      code: string;
      message: string;
    };

export type ExportDiagnosticSink = (event: ExportDiagnosticEvent) => void;

export interface ExportDiagnostics {
  emit(event: ExportDiagnosticEvent): void;
  error(phase: string, error: unknown): void;
}

const defaultSink: ExportDiagnosticSink = (event) => {
  const method = event.event === "export-error" ? "warn" : "debug";
  console[method]("[openreel:export]", event);
};

function allowlisted(event: ExportDiagnosticEvent): ExportDiagnosticEvent {
  switch (event.event) {
    case "export-start": {
      const {
        browser,
        codec,
        width,
        height,
        frameRate,
        totalFrames,
        requestedAcceleration,
      } = event;
      return {
        event: "export-start",
        browser,
        codec,
        width,
        height,
        frameRate,
        totalFrames,
        requestedAcceleration,
      };
    }
    case "encoder-config": {
      const {
        codec,
        width,
        height,
        frameRate,
        bitrate,
        requestedAcceleration,
        effectiveAcceleration,
      } = event;
      return {
        event: "encoder-config",
        codec,
        width,
        height,
        frameRate,
        bitrate,
        requestedAcceleration,
        effectiveAcceleration,
      };
    }
    case "export-preparation": {
      const { audioMs, decodersMs } = event;
      return { event: "export-preparation", audioMs, decodersMs };
    }
    case "decoder-fallback": {
      const { assetId, operation, fallback } = event;
      return { event: "decoder-fallback", assetId, operation, fallback };
    }
    case "export-performance": {
      const {
        frame,
        decodeRenderMs,
        encodeWriteMs,
        cleanupCount,
        cleanupMs,
        framesPerSecond,
        visibility,
      } = event;
      return {
        event: "export-performance",
        frame,
        decodeRenderMs,
        encodeWriteMs,
        cleanupCount,
        cleanupMs,
        framesPerSecond,
        visibility,
      };
    }
    case "export-finished": {
      const { phase, elapsedMs } = event;
      return { event: "export-finished", phase, elapsedMs };
    }
    case "export-error": {
      const { phase, code, message } = event;
      return { event: "export-error", phase, code, message };
    }
  }
}

export function createExportDiagnostics(
  sink: ExportDiagnosticSink = defaultSink,
): ExportDiagnostics {
  return {
    emit(event) {
      sink(allowlisted(event));
    },
    error(phase, _error) {
      sink({
        event: "export-error",
        phase,
        code: "EXPORT_ERROR",
        message: `Export failed during ${phase}`,
      });
    },
  };
}
