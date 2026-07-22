import { useRef, useState } from "react";
import {
  ResolvePreviewRenderSchema,
  type ResolvePreviewRender,
} from "@openreel/core";

export interface RenderedOutputPreviewProps {
  render: ResolvePreviewRender;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function RenderedOutputPreview({ render }: RenderedOutputPreviewProps) {
  const parsed = ResolvePreviewRenderSchema.safeParse(render);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!parsed.success) {
    return (
      <section aria-label="Rendered output preview" className="rounded-md border p-4">
        <p role="alert" className="text-sm text-destructive">
          The rendered output preview was rejected because its backend media data is invalid.
        </p>
      </section>
    );
  }

  const safeRender = parsed.data;
  if (safeRender.status === "missing") {
    return (
      <section aria-label="Rendered output preview" className="rounded-md border border-dashed p-4">
        <h3 className="text-sm font-semibold">Rendered output unavailable</h3>
        <p className="mt-1 text-sm text-muted-foreground">{safeRender.reason}</p>
      </section>
    );
  }

  const togglePlayback = async () => {
    const media = mediaRef.current;
    if (!media) return;
    if (playing) {
      media.pause();
      setPlaying(false);
      return;
    }
    setError(null);
    try {
      await media.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError("Could not play the rendered output. Refresh the project preview and try again.");
    }
  };

  return (
    <section aria-label="Rendered output preview" className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Rendered output</h3>
          <p className="text-xs text-muted-foreground">
            Updated {dateTimeFormatter.format(safeRender.updatedAt)}
          </p>
        </div>
        {safeRender.status === "stale" && (
          <p role="status" className="max-w-md text-sm font-medium text-foreground">
            Stale render: {safeRender.reason}
          </p>
        )}
      </div>
      <div className="aspect-video overflow-hidden rounded-md border bg-black">
        <video
          ref={mediaRef}
          src={safeRender.previewUrl}
          preload="metadata"
          playsInline
          aria-label="Latest rendered output"
          className="h-full w-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setError("The rendered output is unavailable. Refresh the project preview and try again.");
          }}
        />
      </div>
      <button
        type="button"
        aria-pressed={playing}
        aria-label={`${playing ? "Pause" : "Play"} latest rendered output`}
        className="inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => { void togglePlayback(); }}
      >
        {playing ? "Pause render" : "Play render"}
      </button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
