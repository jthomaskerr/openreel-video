import { Film, Volume2, Image, Type, Shapes, Layers, Tag, FileText, Music2, Palette, User } from "lucide-react";
import type { Track } from "@openreel/core";
import type {
  SnapPoint,
  SnapResult,
  SnapSettings,
  ClipStyle,
  TrackInfo,
} from "./types";

export const calculateSnap = (
  rawTime: number,
  clipId: string,
  tracks: Track[],
  playheadPosition: number,
  snapSettings: SnapSettings,
  pixelsPerSecond: number,
  clipDuration?: number,
): SnapResult => {
  if (!snapSettings.enabled) {
    return { time: rawTime, snapped: false };
  }

  const thresholdSeconds = snapSettings.snapThreshold / pixelsPerSecond;
  const snapPoints: SnapPoint[] = [];

  if (snapSettings.snapToClips) {
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) continue;
        snapPoints.push({ time: clip.startTime, type: "clip-start" });
        snapPoints.push({
          time: clip.startTime + clip.duration,
          type: "clip-end",
        });
      }
    }
  }

  if (snapSettings.snapToPlayhead) {
    snapPoints.push({ time: playheadPosition, type: "playhead" });
  }

  if (snapSettings.snapToGrid) {
    const nearestGrid =
      Math.round(rawTime / snapSettings.gridSize) * snapSettings.gridSize;
    snapPoints.push({ time: nearestGrid, type: "grid" });
    if (clipDuration) {
      const endTime = rawTime + clipDuration;
      const nearestEndGrid =
        Math.round(endTime / snapSettings.gridSize) * snapSettings.gridSize;
      snapPoints.push({ time: nearestEndGrid, type: "grid" });
    }
  }

  const priorityOrder: Record<string, number> = {
    "clip-start": 0,
    "clip-end": 0,
    "playhead": 1,
    "grid": 2,
  };

  let closestPoint: SnapPoint | undefined;
  let closestDistance = Infinity;
  let closestPriority = Infinity;
  let snapFromEnd = false;

  for (const point of snapPoints) {
    const pointPriority = priorityOrder[point.type] ?? 2;

    const startDistance = Math.abs(point.time - rawTime);
    if (startDistance < thresholdSeconds) {
      const isBetter =
        pointPriority < closestPriority ||
        (pointPriority === closestPriority && startDistance < closestDistance);
      if (isBetter) {
        closestDistance = startDistance;
        closestPriority = pointPriority;
        closestPoint = point;
        snapFromEnd = false;
      }
    }

    if (clipDuration) {
      const clipEndTime = rawTime + clipDuration;
      const endDistance = Math.abs(point.time - clipEndTime);
      if (endDistance < thresholdSeconds) {
        const isBetter =
          pointPriority < closestPriority ||
          (pointPriority === closestPriority && endDistance < closestDistance);
        if (isBetter) {
          closestDistance = endDistance;
          closestPriority = pointPriority;
          closestPoint = point;
          snapFromEnd = true;
        }
      }
    }
  }

  if (closestPoint) {
    const snappedTime = snapFromEnd
      ? closestPoint.time - (clipDuration ?? 0)
      : closestPoint.time;
    return {
      time: Math.max(0, snappedTime),
      snapped: true,
      snapPoint: { ...closestPoint, time: closestPoint.time },
    };
  }

  return { time: rawTime, snapped: false };
};

export const METADATA_KIND_BADGE: Record<string, { label: string; Icon: typeof FileText; className: string }> = {
  character: { label: "CH", Icon: User, className: "bg-purple-500/25 text-purple-100 border-purple-300/40" },
  continuity_note: { label: "CH", Icon: User, className: "bg-purple-500/25 text-purple-100 border-purple-300/40" },
  note: { label: "NT", Icon: FileText, className: "bg-slate-500/25 text-slate-100 border-slate-300/40" },
  scene: { label: "SC", Icon: Film, className: "bg-orange-500/25 text-orange-100 border-orange-300/40" },
  section: { label: "SC", Icon: Film, className: "bg-orange-500/25 text-orange-100 border-orange-300/40" },
  style: { label: "ST", Icon: Palette, className: "bg-pink-500/25 text-pink-100 border-pink-300/40" },
  "music-video": { label: "MV", Icon: Music2, className: "bg-sky-500/25 text-sky-100 border-sky-300/40" },
  visual_motif: { label: "ST", Icon: Palette, className: "bg-pink-500/25 text-pink-100 border-pink-300/40" },
};

export function getMetadataBadge(kind: string | undefined) {
  if (!kind) return { label: "--", Icon: FileText, className: "bg-slate-500/25 text-slate-100 border-slate-300/40" };
  return METADATA_KIND_BADGE[kind] ?? {
    label: kind.slice(0, 2).toUpperCase(),
    Icon: FileText,
    className: "bg-slate-500/25 text-slate-100 border-slate-300/40",
  };
}

/**
 * Generate an SVG path for a waveform, selecting only the samples that
 * correspond to [inPoint, inPoint + duration] in the source media.
 * waveformData is stored at `samplesPerSecond` (default 100).
 */
export const generateWaveformPath = (
  waveformData: Float32Array | number[],
  svgWidth: number,
  inPoint: number = 0,
  duration: number = -1,
  samplesPerSecond: number = 100,
): string => {
  if (!waveformData || waveformData.length === 0) return "M0,20 L100,20";

  const startIdx = Math.max(0, Math.round(inPoint * samplesPerSecond));
  const endIdx = duration > 0
    ? Math.min(waveformData.length, Math.round((inPoint + duration) * samplesPerSecond))
    : waveformData.length;
  const sliceLen = Math.max(1, endIdx - startIdx);

  const points: string[] = [];
  for (let x = 0; x < svgWidth; x++) {
    const sampleIdx = startIdx + Math.min(Math.floor((x / svgWidth) * sliceLen), sliceLen - 1);
    const value = Math.abs((waveformData[sampleIdx] as number) || 0);
    const y = 20 - value * 18;
    points.push(`${x === 0 ? "M" : "L"}${x},${y}`);
  }
  return points.join(" ");
};

export const formatTimecode = (
  timeInSeconds: number,
  frameRate: number = 30,
): string => {
  if (!isFinite(timeInSeconds) || isNaN(timeInSeconds) || timeInSeconds < 0) {
    return "00:00:00:00";
  }
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  const frames = Math.floor((timeInSeconds % 1) * frameRate);
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames
    .toString()
    .padStart(2, "0")}`;
};

export const getTrackInfo = (track: Track, index: number): TrackInfo => {
  switch (track.type) {
    case "video":
      return {
        label: `V${index + 1}`,
        icon: Film,
        color: "bg-primary",
        textColor: "text-primary",
        bgLight: "bg-primary/20",
      };
    case "audio":
      return {
        label: `A${index + 1}`,
        icon: Volume2,
        color: "bg-blue-500",
        textColor: "text-blue-400",
        bgLight: "bg-blue-500/20",
      };
    case "image":
      return {
        label: `I${index + 1}`,
        icon: Image,
        color: "bg-purple-500",
        textColor: "text-purple-400",
        bgLight: "bg-purple-500/20",
      };
    case "text":
      return {
        label: `T${index + 1}`,
        icon: Type,
        color: "bg-amber-500",
        textColor: "text-amber-400",
        bgLight: "bg-amber-500/20",
      };
    case "graphics":
      return {
        label: `G${index + 1}`,
        icon: Shapes,
        color: "bg-green-500",
        textColor: "text-green-400",
        bgLight: "bg-green-500/20",
      };
    case "metadata":
      return {
        label: `M${index + 1}`,
        icon: Tag,
        color: "bg-sky-500",
        textColor: "text-sky-400",
        bgLight: "bg-sky-500/20",
      };
    default:
      return {
        label: `?${index + 1}`,
        icon: Layers,
        color: "bg-gray-500",
        textColor: "text-gray-400",
        bgLight: "bg-gray-500/20",
      };
  }
};

export const getClipStyle = (trackType: string): ClipStyle => {
  // Clip palette matches the v2 mockup: video=cyan, audio=emerald,
  // image=purple/music, text=amber.
  switch (trackType) {
    case "video":
      return {
        bg: "bg-cyan-600/25",
        border: "border-cyan-500/60",
        text: "text-white/90",
        selectedText: "text-white",
      };
    case "audio":
      return {
        bg: "bg-emerald-600/25",
        border: "border-emerald-500/60",
        text: "text-white/85",
        selectedText: "text-white",
      };
    case "image":
      return {
        bg: "bg-violet-600/25",
        border: "border-violet-500/60",
        text: "text-white/85",
        selectedText: "text-white",
      };
    case "metadata":
      return {
        bg: "bg-sky-600/20",
        border: "border-sky-500/50",
        text: "text-sky-200/90",
        selectedText: "text-sky-100",
      };
    default:
      return {
        bg: "bg-bg-2",
        border: "border-border-strong",
        text: "text-fg-2",
        selectedText: "text-fg",
      };
  }
};
