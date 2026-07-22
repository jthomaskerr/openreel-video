import { useRef, useState } from "react";
import {
  ResolvePreviewClipSchema,
  type ResolvePreviewClip,
} from "@openreel/core";

export interface MediaClipPreviewProps {
  clip: ResolvePreviewClip;
}

export function MediaClipPreview({ clip }: MediaClipPreviewProps) {
  const parsed = ResolvePreviewClipSchema.safeParse(clip);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [visualError, setVisualError] = useState<string | null>(null);

  if (!parsed.success) {
    return (
      <article data-testid={`clip-${clip.id}`} className="rounded-md border bg-card p-3">
        <p role="alert" className="text-sm text-destructive">
          This clip preview was rejected because its backend media data is invalid.
        </p>
      </article>
    );
  }

  const safeClip = parsed.data;
  const preview = safeClip.preview;
  const isPlayable = preview.status === "ready" && (preview.kind === "video" || preview.kind === "audio");

  const togglePlayback = async () => {
    const media = preview.status === "ready" && preview.kind === "audio"
      ? audioRef.current
      : videoRef.current;
    if (!media) return;
    if (playing) {
      media.pause();
      setPlaying(false);
      return;
    }

    setPlaybackError(null);
    try {
      await media.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setPlaybackError(`Could not play ${safeClip.label}. Check that the backend media is still available.`);
    }
  };

  return (
    <article
      data-testid={`clip-${safeClip.id}`}
      className="min-w-0 space-y-2 rounded-md border bg-card p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 break-words text-sm font-medium">{safeClip.label || "Untitled clip"}</h4>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {safeClip.startFrame.toLocaleString("en-GB")}–{safeClip.endFrame.toLocaleString("en-GB")}
        </span>
      </div>

      {preview.status === "missing" && (
        <div className="flex aspect-video items-center justify-center rounded-md border border-dashed bg-muted/30 p-3 text-center">
          <p className="text-sm text-muted-foreground">{preview.reason}</p>
        </div>
      )}

      {preview.status === "ready" && preview.kind === "image" && (
        <div className="aspect-video overflow-hidden rounded-md border bg-muted/30">
          {visualError ? (
            <p role="alert" className="flex h-full items-center justify-center p-3 text-center text-sm text-destructive">
              {visualError}
            </p>
          ) : (
            <img
              src={preview.url}
              alt={`${safeClip.label} preview`}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setVisualError(`The image preview for ${safeClip.label} could not be loaded.`)}
            />
          )}
        </div>
      )}

      {preview.status === "ready" && preview.kind === "video" && (
        <div className="relative aspect-video overflow-hidden rounded-md border bg-black">
          <video
            ref={videoRef}
            src={preview.url}
            poster={preview.thumbnailUrl}
            preload="metadata"
            playsInline
            aria-label={`Video preview for ${safeClip.label}`}
            className="h-full w-full object-contain"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setPlaybackError(`The video preview for ${safeClip.label} is unavailable. Refresh the project preview and try again.`);
            }}
          />
        </div>
      )}

      {preview.status === "ready" && preview.kind === "audio" && (
        <div className="relative aspect-video overflow-hidden rounded-md border bg-muted/30">
          {visualError ? (
            <p role="alert" className="flex h-full items-center justify-center p-3 text-center text-sm text-destructive">
              {visualError}
            </p>
          ) : (
            <img
              src={preview.waveformUrl}
              alt={`Waveform for ${safeClip.label}`}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setVisualError(`The waveform for ${safeClip.label} could not be loaded.`)}
            />
          )}
          <audio
            ref={audioRef}
            src={preview.url}
            preload="metadata"
            aria-label={`Audio preview for ${safeClip.label}`}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setPlaybackError(`The audio preview for ${safeClip.label} is unavailable. Refresh the project preview and try again.`);
            }}
          />
        </div>
      )}

      {isPlayable && (
        <button
          type="button"
          aria-pressed={playing}
          aria-label={`${playing ? "Pause" : "Play"} ${safeClip.label}`}
          className="inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => { void togglePlayback(); }}
        >
          {playing ? "Pause preview" : "Play preview"}
        </button>
      )}

      {playbackError && (
        <p role="alert" className="text-sm text-destructive">{playbackError}</p>
      )}
    </article>
  );
}
