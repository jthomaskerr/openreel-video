import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type WaveSurferInstance from "wavesurfer.js";
import { Play, Pause } from "lucide-react";
import type { MediaItem } from "@openreel/core";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  item: MediaItem;
}

export function WaveformPreview({ item }: Props) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurferInstance | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);

    const container = waveformRef.current;
    if (!container) return;

    let objectUrl: string | null = null;
    let url = item.originalUrl ?? null;
    if (item.blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(item.blob);
      url = objectUrl;
    }

    if (!url) return;

    const wavesurfer = WaveSurfer.create({
      container,
      url,
      peaks: item.waveformData ? [item.waveformData] : undefined,
      duration: item.metadata.duration || undefined,
      waveColor: "rgba(148, 163, 184, 0.45)",
      progressColor: "rgb(34, 197, 94)",
      cursorColor: "rgb(34, 197, 94)",
      cursorWidth: 2,
      height: 72,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      dragToSeek: true,
      normalize: true,
    });

    wavesurferRef.current = wavesurfer;
    wavesurfer.on("timeupdate", (time: number) => setCurrentTime(time));
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => {
      setIsPlaying(false);
      setCurrentTime(item.metadata.duration || 0);
    });

    return () => {
      wavesurferRef.current = null;
      wavesurfer.destroy();
      if (objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(objectUrl);
    };
  }, [item.blob, item.id, item.metadata.duration, item.originalUrl, item.waveformData]);

  const handlePlayPause = useCallback(() => {
    void wavesurferRef.current?.playPause();
  }, []);

  return (
    <div className="space-y-2">
      <div
        ref={waveformRef}
        data-testid="audio-waveform"
        className="min-h-[72px] overflow-hidden rounded-md border border-border bg-background-tertiary"
      />
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={handlePlayPause}
          aria-label={isPlaying ? "Pause audio preview" : "Play audio preview"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white hover:bg-accent/90 transition-colors"
          disabled={!item.blob && !item.originalUrl}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="font-mono text-[10px] text-text-secondary">
          {formatDuration(currentTime)} / {item.metadata.duration ? formatDuration(item.metadata.duration) : "—"}
        </span>
      </div>
    </div>
  );
}
