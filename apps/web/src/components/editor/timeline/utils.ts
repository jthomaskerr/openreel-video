import { Film, Volume2, Image, Type, Shapes, Layers, Tag, FileText, Music2, Palette, User } from "lucide-react";
import type { Track } from "@openreel/core";
import type {
  SnapPoint,
  SnapResult,
  SnapSettings,
  ClipStyle,
  TrackInfo,
} from "./types";

const SNAP_PRIORITY: Record<SnapPoint["type"], number> = {
  "clip-start": 0,
  "clip-end": 0,
  playhead: 1,
  marker: 2,
  grid: 2,
};

interface SnapTarget {
  time: number;
  offset: number;
}

interface SelectedSnap {
  point: SnapPoint;
  targetOffset: number;
}

function buildSnapPoints(
  referenceTime: number,
  clipId: string,
  tracks: Track[],
  playheadPosition: number,
  snapSettings: SnapSettings,
  secondaryGridOffset?: number,
): SnapPoint[] {
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
      Math.round(referenceTime / snapSettings.gridSize) * snapSettings.gridSize;
    snapPoints.push({ time: nearestGrid, type: "grid" });
    if (secondaryGridOffset) {
      const secondaryTime = referenceTime + secondaryGridOffset;
      const nearestSecondaryGrid =
        Math.round(secondaryTime / snapSettings.gridSize) * snapSettings.gridSize;
      snapPoints.push({ time: nearestSecondaryGrid, type: "grid" });
    }
  }

  return snapPoints;
}

function selectSnapTarget(
  snapPoints: SnapPoint[],
  targets: SnapTarget[],
  thresholdSeconds: number,
): SelectedSnap | undefined {
  let selected: SelectedSnap | undefined;
  let closestDistance = Infinity;
  let closestPriority = Infinity;

  for (const point of snapPoints) {
    const pointPriority = SNAP_PRIORITY[point.type];

    for (const target of targets) {
      const distance = Math.abs(point.time - target.time);
      if (distance >= thresholdSeconds) continue;

      const isBetter =
        pointPriority < closestPriority ||
        (pointPriority === closestPriority && distance < closestDistance);
      if (isBetter) {
        closestDistance = distance;
        closestPriority = pointPriority;
        selected = { point, targetOffset: target.offset };
      }
    }
  }

  return selected;
}

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

  const snapPoints = buildSnapPoints(
    rawTime,
    clipId,
    tracks,
    playheadPosition,
    snapSettings,
    clipDuration,
  );
  const targets: SnapTarget[] = [{ time: rawTime, offset: 0 }];
  if (clipDuration) {
    targets.push({ time: rawTime + clipDuration, offset: clipDuration });
  }
  const selected = selectSnapTarget(
    snapPoints,
    targets,
    snapSettings.snapThreshold / pixelsPerSecond,
  );

  if (selected) {
    const snappedTime = selected.point.time - selected.targetOffset;
    return {
      time: Math.max(0, snappedTime),
      snapped: true,
      snapPoint: { ...selected.point, time: selected.point.time },
    };
  }

  return { time: rawTime, snapped: false };
};

export function calculateEdgeSnap(
  rawEdgeTime: number,
  clipId: string,
  tracks: Track[],
  playheadPosition: number,
  snapSettings: SnapSettings,
  pixelsPerSecond: number,
): SnapResult {
  if (!snapSettings.enabled) {
    return { time: rawEdgeTime, snapped: false };
  }

  const selected = selectSnapTarget(
    buildSnapPoints(
      rawEdgeTime,
      clipId,
      tracks,
      playheadPosition,
      snapSettings,
    ),
    [{ time: rawEdgeTime, offset: 0 }],
    snapSettings.snapThreshold / pixelsPerSecond,
  );

  if (!selected) {
    return { time: rawEdgeTime, snapped: false };
  }

  return {
    time: selected.point.time,
    snapped: true,
    snapPoint: { ...selected.point, time: selected.point.time },
  };
}

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
    case "subtitle":
      return {
        label: `S${index + 1}`,
        icon: FileText,
        color: "bg-rose-500",
        textColor: "text-rose-400",
        bgLight: "bg-rose-500/20",
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
    case "subtitle":
      return {
        bg: "bg-rose-600/25",
        border: "border-rose-500/60",
        text: "text-white/90",
        selectedText: "text-white",
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
