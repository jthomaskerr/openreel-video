import React from "react";
import { Switch } from "@openreel/ui";
import { isValidLoopRange } from "./playback-lifecycle";

export interface PreviewTransportControlsProps {
  playheadPosition: number;
  duration: number;
  revertToPlaybackStartOnStop: boolean;
  onRevertToPlaybackStartOnStopChange: (enabled: boolean) => void;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  onLoopEnabledChange: (enabled: boolean) => void;
  onSetLoopStart: (position: number) => void;
  onSetLoopEnd: (position: number) => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
}

export function getLoopMarkerPercentages(
  loopStart: number,
  loopEnd: number,
  duration: number,
): { start: number; end: number } | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return {
    start: Math.max(0, Math.min(100, (loopStart / duration) * 100)),
    end: Math.max(0, Math.min(100, (loopEnd / duration) * 100)),
  };
}

export const PreviewTransportControls: React.FC<PreviewTransportControlsProps> = ({
  playheadPosition,
  revertToPlaybackStartOnStop,
  onRevertToPlaybackStartOnStopChange,
  loopEnabled,
  loopStart,
  loopEnd,
  onLoopEnabledChange,
  onSetLoopStart,
  onSetLoopEnd,
  playbackRate,
  onPlaybackRateChange,
}) => {
  const hasValidLoop = isValidLoopRange(loopStart, loopEnd);

  return (
    <div className="flex items-center gap-2" aria-label="Preview transport options">
      <label
        htmlFor="preview-revert-on-stop"
        className="flex items-center gap-1.5 text-[10px] text-fg-2 whitespace-nowrap"
        title="Return the playhead to where this playback session began"
      >
        <span>Revert to begin on stop</span>
        <Switch
          id="preview-revert-on-stop"
          checked={revertToPlaybackStartOnStop}
          onCheckedChange={onRevertToPlaybackStartOnStopChange}
        />
      </label>

      <div className="flex items-center gap-1" aria-label="A-B loop controls">
        <button
          type="button"
          onClick={() => onSetLoopStart(playheadPosition)}
          className="h-7 min-w-7 rounded-md border border-border px-1.5 text-[10px] font-semibold text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          aria-label="Set loop start at playhead"
          title="Set A at the current playhead"
        >
          A
        </button>
        <button
          type="button"
          onClick={() => onSetLoopEnd(playheadPosition)}
          className="h-7 min-w-7 rounded-md border border-border px-1.5 text-[10px] font-semibold text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          aria-label="Set loop end at playhead"
          title="Set B at the current playhead"
        >
          B
        </button>
        <button
          type="button"
          disabled={!hasValidLoop}
          aria-pressed={loopEnabled}
          aria-label={loopEnabled ? "Disable A-B loop" : "Enable A-B loop"}
          title={hasValidLoop ? "Toggle A-B loop playback" : "Set A before B to enable looping"}
          onClick={() => onLoopEnabledChange(!loopEnabled)}
          className={`h-7 rounded-md border px-2 text-[10px] font-medium transition-colors ${
            loopEnabled
              ? "border-accent bg-accent/15 text-accent"
              : "border-border text-fg-2 hover:bg-hover hover:text-fg"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Loop
        </button>
      </div>

      <label className="flex items-center gap-1.5 text-[10px] text-fg-2 whitespace-nowrap">
        <span>Speed</span>
        <input
          type="range"
          min={0.1}
          max={4}
          step={0.1}
          value={playbackRate}
          onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          aria-label="Playback speed"
          className="w-20 accent-accent"
        />
        <span className="w-8 text-right font-mono tabular-nums text-fg">
          {playbackRate.toFixed(1)}x
        </span>
      </label>
    </div>
  );
};
