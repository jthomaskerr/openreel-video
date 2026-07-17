import { Loader2 } from "lucide-react";
import type { ExportUIState } from "../../stores/ui-store";

interface ExportProgressOverlayProps {
  state: ExportUIState;
}

function formatRemainingTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return minutes > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${remainingSeconds}s`;
}

export function ExportProgressOverlay({ state }: ExportProgressOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-background-secondary/95 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Exporting Video</h3>
            <p className="text-xs text-text-muted">{state.phase || "Preparing..."}</p>
          </div>
        </div>

        <div
          className="mb-3"
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.progress)}
        >
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-text-secondary">Progress</span>
            <span className="font-mono text-text-muted">{Math.round(state.progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/30">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary-hover transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, state.progress))}%` }}
            />
          </div>
        </div>

        {state.estimateConfidence === "observed" &&
        state.estimatedTimeRemaining !== null &&
        state.framesPerSecond !== null ? (
          <div className="flex justify-between text-xs text-text-muted">
            <span>About {formatRemainingTime(state.estimatedTimeRemaining)} remaining</span>
            <span>{state.framesPerSecond.toFixed(1)} fps</span>
          </div>
        ) : (
          <p className="text-xs text-text-muted">Measuring export speed…</p>
        )}

        {state.backgroundDegraded && (
          <p className="mt-3 text-xs text-warning" role="alert">
            This browser is limiting background export performance. Foregrounding the editor may speed it up.
          </p>
        )}
      </div>
    </div>
  );
}
