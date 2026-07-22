import type {
  ResolvePreviewMiniTimeline,
  ResolvePreviewMiniTimelineTrack,
} from "@openreel/core";

export interface MiniTimelineProps {
  timeline: ResolvePreviewMiniTimeline;
}

function boundedPercent(frame: number, durationFrames: number): number {
  if (durationFrames <= 0) return 0;
  return Math.min(100, Math.max(0, (frame / durationFrames) * 100));
}

function trackLabel(track: ResolvePreviewMiniTimelineTrack): string {
  const label = track.type.charAt(0).toLocaleUpperCase() + track.type.slice(1);
  return `${label} track ${track.index + 1}`;
}

export function MiniTimeline({ timeline }: MiniTimelineProps) {
  if (timeline.durationFrames === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        This project has no timeline duration to preview.
      </div>
    );
  }

  const tracks = timeline.tracks
    .map((track, order) => ({ track, order }))
    .sort((left, right) => left.track.index - right.track.index || left.order - right.order);

  return (
    <section
      aria-label={`Mini timeline, ${timeline.durationFrames.toLocaleString("en-GB")} frames`}
      className="space-y-3 rounded-md border bg-card p-3"
    >
      {tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">The timeline has no tracks to preview.</p>
      ) : tracks.map(({ track }) => (
        <div
          key={track.id}
          data-testid={`mini-timeline-track-${track.id}`}
          data-track-index={track.index}
          className="space-y-1"
        >
          <p className="text-xs font-medium text-muted-foreground">{trackLabel(track)}</p>
          <div className="relative h-8 overflow-hidden rounded-sm border bg-muted/30">
            {track.clips.map((clip) => {
              const left = boundedPercent(clip.startFrame, timeline.durationFrames);
              const right = boundedPercent(clip.endFrame, timeline.durationFrames);
              const width = Math.max(0, right - left);
              return (
                <div
                  key={clip.id}
                  data-testid={`mini-timeline-clip-${clip.id}`}
                  title={`${clip.label}, frames ${clip.startFrame} to ${clip.endFrame}`}
                  aria-hidden="true"
                  className="absolute inset-y-1 overflow-hidden rounded-sm border border-primary/40 bg-primary/20"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}
          </div>
          {track.clips.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {track.clips.map((clip) => (
                <li key={clip.id}>
                  {clip.label || "Untitled clip"}, frames {clip.startFrame.toLocaleString("en-GB")} to {clip.endFrame.toLocaleString("en-GB")}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
