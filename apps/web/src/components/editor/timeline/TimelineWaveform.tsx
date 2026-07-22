import { useEffect, useRef, useState } from "react";
import type { AutomationPoint, Clip, MediaItem } from "@openreel/core";
import WaveSurfer from "wavesurfer.js";
import type WaveSurferInstance from "wavesurfer.js";
import { useTimelineStore } from "../../../stores/timeline-store";

interface TimelineWaveformProps {
  clip: Clip;
  mediaItem: MediaItem;
  pixelsPerSecond: number;
  trackHeight: number;
}

export interface TimelineWaveformResolution {
  channels: Float32Array[];
  samplesPerSecond: number;
}

export interface TimelineWaveformData {
  duration: number;
  resolutions: Map<number, TimelineWaveformResolution>;
}

const RESOLUTIONS = [10, 50, 100, 200, 500, 1_000] as const;
const MAX_SAMPLES_PER_SECOND = RESOLUTIONS.at(-1) ?? 1_000;
const blobWaveforms = new WeakMap<Blob, Promise<TimelineWaveformData | null>>();
const urlWaveforms = new Map<string, Promise<TimelineWaveformData | null>>();

export function selectWaveformResolution(
  waveform: TimelineWaveformData,
  sourcePixelsPerSecond: number,
): TimelineWaveformResolution | null {
  const ideal = Math.max(10, Math.min(MAX_SAMPLES_PER_SECOND, sourcePixelsPerSecond * 2));
  const ordered = [...waveform.resolutions.entries()].sort(([a], [b]) => a - b);
  return ordered.find(([resolution]) => resolution >= ideal)?.[1]
    ?? ordered.at(-1)?.[1]
    ?? null;
}

export function sliceClipChannels(
  waveform: TimelineWaveformResolution,
  clip: Pick<Clip, "inPoint" | "outPoint" | "reversed">,
): Float32Array[] {
  const startIndex = Math.max(0, Math.floor(clip.inPoint * waveform.samplesPerSecond));
  return waveform.channels.map((channel) => {
    const endIndex = Math.min(
      channel.length,
      Math.ceil(clip.outPoint * waveform.samplesPerSecond),
    );
    const peaks = channel.slice(startIndex, endIndex);
    if (clip.reversed) peaks.reverse();
    return peaks;
  });
}

export function downsampleSignedChannels(
  channels: Float32Array[],
  sourceSamplesPerSecond: number,
  targetSamplesPerSecond: number,
): Float32Array[] {
  if (targetSamplesPerSecond >= sourceSamplesPerSecond) {
    return channels.map((channel) => channel.slice());
  }

  const ratio = sourceSamplesPerSecond / targetSamplesPerSecond;
  return channels.map((channel) => {
    const target = new Float32Array(Math.ceil(channel.length / ratio));
    for (let index = 0; index < target.length; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(channel.length, Math.ceil((index + 1) * ratio));
      let signedPeak = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
        const sample = channel[sourceIndex] ?? 0;
        if (Math.abs(sample) > Math.abs(signedPeak)) signedPeak = sample;
      }
      target[index] = signedPeak;
    }
    return target;
  });
}

function automationValueAtTime(
  points: readonly AutomationPoint[],
  time: number,
  baseVolume: number,
): number {
  if (points.length === 0) return baseVolume;
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((a, b) => a.time - b.time);
  if (ordered.length === 0) return baseVolume;

  let previous: AutomationPoint | null = null;
  for (const point of ordered) {
    if (Math.abs(point.time - time) <= 0.0001) return point.value;
    if (point.time > time) {
      if (!previous) return baseVolume;
      const span = point.time - previous.time;
      if (span <= 0.0001) return point.value;
      const progress = (time - previous.time) / span;
      return previous.value + (point.value - previous.value) * progress;
    }
    previous = point;
  }
  return previous?.value ?? baseVolume;
}

export function applyClipAmplitude(
  channels: Float32Array[],
  clip: Pick<Clip, "duration" | "volume" | "muted" | "fade" | "automation">,
): Float32Array[] {
  const baseVolume = clip.muted ? 0 : Math.max(0, clip.volume ?? 1);
  const automation = clip.automation?.volume ?? [];
  const duration = Math.max(clip.duration, Number.EPSILON);
  const fadeIn = Math.max(0, clip.fade?.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fade?.fadeOut ?? 0);

  return channels.map((channel) => {
    const scaled = new Float32Array(channel.length);
    const lastIndex = Math.max(1, channel.length - 1);
    for (let index = 0; index < channel.length; index += 1) {
      const time = (index / lastIndex) * duration;
      const automatedVolume = clip.muted
        ? 0
        : Math.max(0, automationValueAtTime(automation, time, baseVolume));
      const fadeInGain = fadeIn > 0 ? Math.min(1, time / fadeIn) : 1;
      const fadeOutGain = fadeOut > 0 ? Math.min(1, (duration - time) / fadeOut) : 1;
      const amplitude = (channel[index] ?? 0) * automatedVolume * fadeInGain * fadeOutGain;
      scaled[index] = Math.max(-1, Math.min(1, amplitude));
    }
    return scaled;
  });
}

async function decodeWaveform(blob: Blob, mediaId: string): Promise<TimelineWaveformData> {
  const decoderContainer = document.createElement("div");
  const decoder = WaveSurfer.create({
    container: decoderContainer,
    height: 1,
    interact: false,
  });

  try {
    await decoder.loadBlob(blob);
    const duration = decoder.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Invalid decoded duration: ${duration}`);
    }
    const maxLength = Math.max(1, Math.ceil(duration * MAX_SAMPLES_PER_SECOND));
    const exported = decoder.exportPeaks({
      channels: 2,
      maxLength,
      precision: 1_000_000,
    });
    if (exported.length === 0) {
      throw new Error("WaveSurfer decoded no audio channels");
    }
    const highResolution = exported.map((channel) => Float32Array.from(channel));
    const resolutions = new Map<number, TimelineWaveformResolution>();
    for (const samplesPerSecond of RESOLUTIONS) {
      resolutions.set(samplesPerSecond, {
        channels: samplesPerSecond === MAX_SAMPLES_PER_SECOND
          ? highResolution
          : downsampleSignedChannels(
            highResolution,
            MAX_SAMPLES_PER_SECOND,
            samplesPerSecond,
          ),
        samplesPerSecond,
      });
    }
    return { duration, resolutions };
  } catch (error) {
    console.error("[TimelineWaveform] WaveSurfer source decoding failed", {
      mediaId,
      error,
    });
    throw error;
  } finally {
    decoder.destroy();
  }
}

function requestWaveform(mediaItem: MediaItem): Promise<TimelineWaveformData | null> {
  if (mediaItem.blob && mediaItem.blob.size > 0) {
    const existing = blobWaveforms.get(mediaItem.blob);
    if (existing) return existing;
    const pending = decodeWaveform(mediaItem.blob, mediaItem.id).catch(() => null);
    blobWaveforms.set(mediaItem.blob, pending);
    return pending;
  }

  const url = mediaItem.remoteUrl ?? mediaItem.originalUrl;
  if (!url) return Promise.resolve(null);
  const key = `${mediaItem.id}:${url}`;
  const existing = urlWaveforms.get(key);
  if (existing) return existing;
  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => decodeWaveform(blob, mediaItem.id))
    .catch((error) => {
      console.error("[TimelineWaveform] Failed to load waveform source", {
        mediaId: mediaItem.id,
        error,
      });
      return null;
    });
  urlWaveforms.set(key, pending);
  return pending;
}

export function TimelineWaveform({
  clip,
  mediaItem,
  pixelsPerSecond,
  trackHeight,
}: TimelineWaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurferInstance | null>(null);
  const loadSequenceRef = useRef<Promise<void>>(Promise.resolve());
  const loadRequestRef = useRef(0);
  const [multiResolution, setMultiResolution] = useState<TimelineWaveformData | null>(null);
  const [loadedSamplesPerSecond, setLoadedSamplesPerSecond] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const scrollX = useTimelineStore((state) => state.scrollX);
  const viewportWidth = useTimelineStore((state) => state.viewportWidth);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setShowLoading(false);
    const loadingTimer = window.setTimeout(() => {
      if (active) setShowLoading(true);
    }, 300);
    void requestWaveform(mediaItem).then((waveform) => {
      if (!active) return;
      window.clearTimeout(loadingTimer);
      setShowLoading(false);
      setMultiResolution(waveform);
      setFailed(!waveform);
    });
    return () => {
      active = false;
      window.clearTimeout(loadingTimer);
    };
  }, [mediaItem]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const channelStyle = {
      waveColor: "rgba(226, 232, 240, 0.82)",
      progressColor: "rgba(226, 232, 240, 0.82)",
    };
    const wavesurfer = WaveSurfer.create({
      container,
      height: "auto",
      fillParent: true,
      interact: false,
      hideScrollbar: true,
      normalize: false,
      cursorWidth: 0,
      splitChannels: [channelStyle, channelStyle],
      ...channelStyle,
    });
    wavesurferRef.current = wavesurfer;
    wavesurfer.on("error", (error: Error) => {
      console.error("[TimelineWaveform] WaveSurfer peak rendering failed", {
        clipId: clip.id,
        mediaId: mediaItem.id,
        error,
      });
      setFailed(true);
    });
    return () => {
      wavesurferRef.current = null;
      wavesurfer.destroy();
    };
  }, [clip.id, mediaItem.id]);

  const displayWidth = Math.max(1, clip.duration * pixelsPerSecond);
  const clipLeft = clip.startTime * pixelsPerSecond;
  const visibleStart = Math.max(0, Math.min(displayWidth, scrollX - clipLeft));
  const visibleLeftInViewport = Math.max(0, clipLeft - scrollX);
  const visibleWidth = Math.max(
    1,
    Math.min(displayWidth - visibleStart, viewportWidth - visibleLeftInViewport),
  );
  const sourceRange = Math.max(clip.outPoint - clip.inPoint, Number.EPSILON);
  const sourcePixelsPerSecond = displayWidth / sourceRange;
  const selected = multiResolution
    ? selectWaveformResolution(multiResolution, sourcePixelsPerSecond)
    : null;

  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer || !selected) return;
    const requestId = ++loadRequestRef.current;
    setLoadedSamplesPerSecond(null);
    const channels = applyClipAmplitude(
      sliceClipChannels(selected, {
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        reversed: clip.reversed,
      }),
      {
        duration: clip.duration,
        volume: clip.volume,
        muted: clip.muted,
        fade: clip.fade,
        automation: clip.automation,
      },
    );
    const load = loadSequenceRef.current
      .catch(() => undefined)
      .then(() => wavesurfer.load("", channels, clip.duration));
    loadSequenceRef.current = load;
    void load.then(() => {
      if (loadRequestRef.current === requestId) {
        setLoadedSamplesPerSecond(selected.samplesPerSecond);
      }
    }).catch((error) => {
      console.error("[TimelineWaveform] Failed to render decoded peaks", {
        clipId: clip.id,
        mediaId: mediaItem.id,
        error,
      });
      setFailed(true);
    });
  }, [
    clip.automation,
    clip.duration,
    clip.fade,
    clip.id,
    clip.inPoint,
    clip.muted,
    clip.outPoint,
    clip.reversed,
    clip.volume,
    mediaItem.id,
    selected,
  ]);

  useEffect(() => {
    if (loadedSamplesPerSecond === null) return;
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) return;
    wavesurfer.zoom(pixelsPerSecond);
    wavesurfer.setScroll(visibleStart);
  }, [loadedSamplesPerSecond, pixelsPerSecond, visibleStart]);

  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) return;
    wavesurfer.setOptions({ height: "auto" });
  }, [trackHeight]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute inset-y-0 overflow-hidden"
        style={{ left: visibleStart, width: visibleWidth }}
      >
        <div
          ref={containerRef}
          data-testid={`timeline-waveform-${clip.id}`}
          data-samples-per-second={selected?.samplesPerSecond}
          className="h-full w-full"
          aria-label={`Waveform for ${mediaItem.name}`}
        />
      </div>
      {showLoading && !failed && (
        <span className="absolute inset-0 flex items-center justify-center text-[8px] text-slate-200">
          Loading waveform…
        </span>
      )}
      {failed && (
        <span className="absolute inset-0 flex items-center justify-center text-[8px] text-red-100">
          Waveform unavailable
        </span>
      )}
    </div>
  );
}
