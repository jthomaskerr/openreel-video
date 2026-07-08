import type { MediaItem } from "@openreel/core";

interface Props {
  item: MediaItem;
}

export function WaveformPreview({ item: _item }: Props) {
  return (
    <div className="space-y-2">
      <div
        data-testid="audio-waveform"
        className="flex min-h-[72px] items-center justify-center overflow-hidden rounded-md border border-border bg-background-tertiary"
      >
        <span className="font-mono text-[10px] text-text-muted">
          waveform pending
        </span>
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className="font-mono text-[10px] text-text-secondary">
          — / —
        </span>
      </div>
    </div>
  );
}
