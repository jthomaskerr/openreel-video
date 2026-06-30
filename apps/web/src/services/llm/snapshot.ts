import type {
  BlendMode,
  Clip,
  MediaItem,
  Project,
  ShapeClip,
  SVGClip,
  StickerClip,
  TextClip,
  Track,
} from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore, type PlaybackState } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

const MAX_MEDIA_LIBRARY_ITEMS = 50;
const MAX_TRACK_CLIPS = 100;

export interface SnapshotResolution {
  width: number;
  height: number;
}

export interface SnapshotProject {
  id: string;
  name: string;
  duration: number;
  frameRate: number;
  resolution: SnapshotResolution;
}

export interface SnapshotTrack {
  id: string;
  type: Track["type"];
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  clipCount: number;
}

export interface SnapshotClip {
  id: string;
  kind: "timeline" | "text" | "shape" | "svg" | "sticker";
  trackId: string;
  mediaId: string | null;
  mediaName: string | null;
  startTime: number;
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  speed: number | null;
  volume: number | null;
  blendMode: BlendMode | null;
  blendOpacity: number | null;
  effectTypes: string[];
  keyframeCount: number;
}

export interface SnapshotMediaItem {
  id: string;
  name: string;
  type: MediaItem["type"];
  duration: number;
}

export interface EditorStateSnapshot {
  project: SnapshotProject;
  tracks: SnapshotTrack[];
  clips: SnapshotClip[];
  selectedIds: string[];
  playheadTime: number;
  playbackState: PlaybackState;
  playbackRate: number;
  loopRange: {
    enabled: boolean;
    start: number;
    end: number;
  };
  mediaLibrary: {
    items: SnapshotMediaItem[];
    truncatedCount: number;
  };
  undoDepth: number;
  redoDepth: number;
}


function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)),
  );
}

function getMediaName(project: Project, mediaId: string | null | undefined): string | null {
  if (!mediaId) {
    return null;
  }

  return project.mediaLibrary.items.find((item) => item.id === mediaId)?.name ?? null;
}

function clipEffectTypes(clip: Clip): string[] {
  return uniqueStrings([
    ...clip.effects.map((effect) => effect.type),
    ...clip.audioEffects.map((effect) => effect.type),
  ]);
}

function snapshotTimelineClip(project: Project, clip: Clip): SnapshotClip {
  return {
    id: clip.id,
    kind: "timeline",
    trackId: clip.trackId,
    mediaId: clip.mediaId,
    mediaName: getMediaName(project, clip.mediaId),
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    speed: clip.speed ?? null,
    volume: clip.volume ?? null,
    blendMode: (clip.blendMode ?? null) as BlendMode | null,
    blendOpacity: clip.blendOpacity ?? null,
    effectTypes: clipEffectTypes(clip),
    keyframeCount: clip.keyframes.length,
  };
}

function snapshotTextClip(clip: TextClip): SnapshotClip {
  return {
    id: clip.id,
    kind: "text",
    trackId: clip.trackId,
    mediaId: null,
    mediaName: clip.text,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: null,
    outPoint: null,
    speed: null,
    volume: null,
    blendMode: (clip.blendMode ?? null) as BlendMode | null,
    blendOpacity: clip.blendOpacity ?? null,
    effectTypes: [],
    keyframeCount: clip.keyframes.length,
  };
}

function snapshotShapeClip(clip: ShapeClip): SnapshotClip {
  return {
    id: clip.id,
    kind: "shape",
    trackId: clip.trackId,
    mediaId: null,
    mediaName: clip.shapeType,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: null,
    outPoint: null,
    speed: null,
    volume: null,
    blendMode: (clip.blendMode ?? null) as BlendMode | null,
    blendOpacity: clip.blendOpacity ?? null,
    effectTypes: [],
    keyframeCount: clip.keyframes.length,
  };
}

function snapshotSVGClip(clip: SVGClip): SnapshotClip {
  return {
    id: clip.id,
    kind: "svg",
    trackId: clip.trackId,
    mediaId: null,
    mediaName: "svg",
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: null,
    outPoint: null,
    speed: null,
    volume: null,
    blendMode: (clip.blendMode ?? null) as BlendMode | null,
    blendOpacity: clip.blendOpacity ?? null,
    effectTypes: [],
    keyframeCount: clip.keyframes.length,
  };
}

function snapshotStickerClip(clip: StickerClip): SnapshotClip {
  return {
    id: clip.id,
    kind: "sticker",
    trackId: clip.trackId,
    mediaId: null,
    mediaName: clip.name ?? clip.type,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: null,
    outPoint: null,
    speed: null,
    volume: null,
    blendMode: (clip.blendMode ?? null) as BlendMode | null,
    blendOpacity: clip.blendOpacity ?? null,
    effectTypes: [],
    keyframeCount: clip.keyframes.length,
  };
}

function collectClips(project: Project): SnapshotClip[] {
  const titleEngine = useEngineStore.getState().getTitleEngine();
  const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
  const clips = new Map<string, SnapshotClip>();

  const add = (snapshotClip: SnapshotClip) => {
    if (!clips.has(snapshotClip.id)) {
      clips.set(snapshotClip.id, snapshotClip);
    }
  };

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips.slice(0, MAX_TRACK_CLIPS)) {
      add(snapshotTimelineClip(project, clip));
    }
  }

  if (titleEngine) {
    for (const clip of titleEngine.getAllTextClips()) {
      add(snapshotTextClip(clip));
    }
  }

  if (graphicsEngine) {
    for (const clip of graphicsEngine.getAllShapeClips()) {
      add(snapshotShapeClip(clip));
    }
    for (const clip of graphicsEngine.getAllSVGClips()) {
      add(snapshotSVGClip(clip));
    }
    for (const clip of graphicsEngine.getAllStickerClips()) {
      add(snapshotStickerClip(clip));
    }
  }

  return Array.from(clips.values()).sort((a, b) => {
    if (a.trackId === b.trackId) {
      return a.startTime - b.startTime || a.id.localeCompare(b.id);
    }
    return a.trackId.localeCompare(b.trackId);
  });
}

function getClipCountByTrack(clips: SnapshotClip[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    counts.set(clip.trackId, (counts.get(clip.trackId) ?? 0) + 1);
  }
  return counts;
}

function snapshotTrack(track: Track, clipCount: number): SnapshotTrack {
  return {
    id: track.id,
    type: track.type,
    name: track.name,
    locked: track.locked,
    hidden: track.hidden,
    muted: track.muted,
    clipCount,
  };
}

export function buildEditorSnapshot(): EditorStateSnapshot {
  const projectStore = useProjectStore.getState();
  const timelineStore = useTimelineStore.getState();
  const uiStore = useUIStore.getState();
  const project = projectStore.project;
  const clips = collectClips(project);
  const clipCounts = getClipCountByTrack(clips);
  const mediaItems = project.mediaLibrary.items
    .slice(0, MAX_MEDIA_LIBRARY_ITEMS)
    .map<SnapshotMediaItem>((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      duration: item.metadata.duration,
    }));

  return {
    project: {
      id: project.id,
      name: project.name,
      duration: projectStore.getTimelineDuration(),
      frameRate: project.settings.frameRate,
      resolution: {
        width: project.settings.width,
        height: project.settings.height,
      },
    },
    tracks: project.timeline.tracks.map((track) =>
      snapshotTrack(track, clipCounts.get(track.id) ?? 0),
    ),
    clips,
    selectedIds: uiStore.selectedItems.map((item) => item.id),
    playheadTime: timelineStore.playheadPosition,
    playbackState: timelineStore.playbackState,
    playbackRate: timelineStore.playbackRate,
    loopRange: {
      enabled: timelineStore.loopEnabled,
      start: timelineStore.loopStart,
      end: timelineStore.loopEnd,
    },
    mediaLibrary: {
      items: mediaItems,
      truncatedCount: Math.max(0, project.mediaLibrary.items.length - mediaItems.length),
    },
    undoDepth: projectStore.actionHistory.getUndoStackSize(),
    redoDepth: projectStore.actionHistory.getRedoStackSize(),
  };
}
