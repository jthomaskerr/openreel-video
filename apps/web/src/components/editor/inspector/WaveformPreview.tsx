import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import type WaveSurferInstance from "wavesurfer.js";
import { Play, Pause } from "lucide-react";
import type { MediaItem } from "@openreel/core";

type WaveformPreviewItem = MediaItem & {
  remoteUrl?: string | null;
  waveformData?: Float32Array | number[] | Record<string, number> | null;
};

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function normalizeWaveformData(
  waveformData: WaveformPreviewItem["waveformData"],
): Float32Array | number[] | null {
  if (!waveformData) return null;
  if (waveformData instanceof Float32Array) return waveformData;
  if (Array.isArray(waveformData)) {
    return waveformData.every((value) => typeof value === "number" && Number.isFinite(value))
      ? waveformData
      : null;
  }
  if (typeof waveformData === "object") {
    const values = Object.entries(waveformData)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, value]) => value);
    return values.length > 0 && values.every((value) => typeof value === "number" && Number.isFinite(value))
      ? values
      : null;
  }
  return null;
}

interface Props {
  item: MediaItem;
}

export function WaveformPreview({ item }: Props) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurferInstance | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const waveformItem = item as WaveformPreviewItem;
  const remoteUrl = waveformItem.remoteUrl ?? null;
  const waveformData = useMemo(
    () => normalizeWaveformData(waveformItem.waveformData ?? null),
    [waveformItem.waveformData],
  );
  const duration = item.metadata?.duration;
  const hasPlayableSource = Boolean(item.blob || item.originalUrl || remoteUrl);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setLoadError(null);

    const container = waveformRef.current;
    if (!container) return;

    let objectUrl: string | null = null;
    let wavesurfer: WaveSurferInstance | null = null;
    let url = remoteUrl ?? item.originalUrl ?? null;
    if (item.blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(item.blob);
      url = objectUrl;
    }

    if (!url) return;

    try {
      wavesurfer = WaveSurfer.create({
        container,
        url,
        peaks: waveformData ? [waveformData] : undefined,
        duration: duration || undefined,
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
    } catch (error) {
      console.warn("[WaveformPreview] Failed to initialize waveform", error);
      setLoadError("Audio preview unavailable");
      if (objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(objectUrl);
      return;
    }

    wavesurferRef.current = wavesurfer;
    wavesurfer.on("timeupdate", (time: number) => setCurrentTime(time));
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("error", (error: Error) => {
      console.warn("[WaveformPreview] Failed to load audio preview", error);
      setLoadError("Audio preview unavailable");
      setIsPlaying(false);
    });
    wavesurfer.on("finish", () => {
      setIsPlaying(false);
      setCurrentTime(duration || 0);
    });

    return () => {
      wavesurferRef.current = null;
      wavesurfer?.destroy();
      if (objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(objectUrl);
    };
  }, [item.blob, item.id, duration, item.originalUrl, remoteUrl, waveformData]);

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
          disabled={!hasPlayableSource}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="font-mono text-[10px] text-text-secondary">
          {loadError ?? `${formatDuration(currentTime)} / ${formatDuration(duration)}`}
        </span>
      </div>
    </div>
  );
}
