import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import type {
  Track,
  TextClip,
  ShapeClip,
  SVGClip,
  StickerClip,
} from "@openreel/core";
import { calculateSnap } from "./utils";
import {
  getMediaDropRejection,
  pointerToTimelineTime,
  type TimelineMediaType,
} from "./media-drop";
import type { ClipTrimUpdate } from "./trim-calculation";
import { ClipComponent } from "./ClipComponent";
import { TextClipComponent } from "./TextClipComponent";
import { ShapeClipComponent } from "./ShapeClipComponent";
import { KeyframeTrack } from "./KeyframeTrack";
import { TimelineEmptySpaceMenu } from "./TimelineEmptySpaceMenu";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;


interface TrackLaneProps {
  track: Track;
  isActive: boolean;
  allTracks: Track[];
  pixelsPerSecond: number;
  selectedClipIds: string[];
  textClips: TextClip[];
  shapeClips: GraphicClipUnion[];
  trackHeights: Map<string, number>;
  timelineRef: React.RefObject<HTMLDivElement>;
  onSelectClip: (clipId: string, addToSelection: boolean) => void;
  onDropMedia: (trackId: string, mediaId: string, startTime: number) => void;
  onMoveClip: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void;
  onMoveTextClip: (clipId: string, newStartTime: number) => void;
  onSnapIndicator: (time: number | null) => void;
  onTrimClip?: (clipId: string, update: ClipTrimUpdate) => void;
  onTrimTextClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  onTrimShapeClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  scrollX: number;
  trackHeight: number;
  onResizeTrack: (trackId: string, newHeight: number) => void;
  onKeyframeSelect?: (keyframeId: string, addToSelection: boolean) => void;
  onKeyframeMove?: (keyframeId: string, newTime: number) => void;
  onKeyframeDelete?: (keyframeId: string) => void;
  selectedKeyframeIds?: string[];
}

export const TrackLane: React.FC<TrackLaneProps> = ({
  track,
  isActive,
  allTracks,
  pixelsPerSecond,
  selectedClipIds,
  textClips,
  shapeClips,
  trackHeights,
  timelineRef,
  onSelectClip,
  onDropMedia,
  onMoveClip,
  onMoveTextClip,
  onSnapIndicator,
  onTrimClip,
  onTrimTextClip,
  onTrimShapeClip,
  trackHeight,
  onResizeTrack,
  onKeyframeSelect,
  onKeyframeMove,
  onKeyframeDelete,
  selectedKeyframeIds = [],
}) => {
  const { isTrackExpanded, playheadPosition } = useTimelineStore();
  const isExpanded = isTrackExpanded(track.id);
  const { snapSettings, setActiveTrack } = useUIStore();
  const [dropPreview, setDropPreview] = useState<{
    time: number;
    rejection: string | null;
  } | null>(null);
  const isDragOver = dropPreview !== null;
  const [isResizing, setIsResizing] = useState(false);
  const laneRef = useRef<HTMLDivElement>(null);
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);

  const clipsWithKeyframes = useMemo(() => {
    return track.clips.filter((clip) => clip.keyframes && clip.keyframes.length > 0);
  }, [track.clips]);

  const resolveDropTime = useCallback((clientX: number) => {
    const viewport = timelineRef.current;
    const lane = laneRef.current;
    const viewportLeft = viewport?.getBoundingClientRect().left
      ?? lane?.getBoundingClientRect().left;
    if (viewportLeft === undefined) return null;

    const rawTime = pointerToTimelineTime({
      clientX,
      viewportLeft,
      scrollLeft: viewport?.scrollLeft ?? 0,
      pixelsPerSecond,
    });
    return calculateSnap(
      rawTime,
      "",
      allTracks,
      playheadPosition,
      snapSettings,
      pixelsPerSecond,
    ).time;
  }, [timelineRef, pixelsPerSecond, allTracks, playheadPosition, snapSettings]);

  const getDraggedMediaType = useCallback((mediaId?: string): TimelineMediaType | null => {
    const { dragType, dragData } = useUIStore.getState();
    const draggedType = dragType === "media" ? dragData?.mediaType : undefined;
    if (
      draggedType === "video"
      || draggedType === "audio"
      || draggedType === "image"
      || draggedType === "srt"
    ) {
      return draggedType;
    }
    const item = mediaId
      ? useProjectStore.getState().project.mediaLibrary.items.find(candidate => candidate.id === mediaId)
      : undefined;
    return item?.type ?? null;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const time = resolveDropTime(e.clientX);
    if (time === null) return;
    const mediaType = getDraggedMediaType();
    const rejection = track.locked
      ? "Track is locked"
      : mediaType
        ? getMediaDropRejection(track, mediaType)
        : null;
    e.dataTransfer.dropEffect = rejection ? "none" : "copy";
    setDropPreview({ time, rejection });
  }, [getDraggedMediaType, resolveDropTime, track]);

  const handleDragLeave = useCallback(() => {
    setDropPreview(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropPreview(null);

      // Always consume a lane drop. Rejected drops must not bubble to the
      // timeline container and create a clip on a fallback track.
      if (track.locked) {
        toast.error("Cannot add media", "Track is locked");
        return;
      }

      // External OS file drop (e.g. from Windows Explorer)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const resolvedTime = resolveDropTime(e.clientX);
        if (resolvedTime === null) return;
        const { importMedia, addClip } = useProjectStore.getState();
        for (const file of Array.from(e.dataTransfer.files)) {
          try {
            const beforeIds = new Set(
              useProjectStore.getState().project.mediaLibrary.items.map(i => i.id)
            );
            const result = await importMedia(file);
            if (!result.success) {
              toast.error(
                "Could not import dropped media",
                result.error?.message ?? `${file.name} could not be imported.`,
              );
              continue;
            }
            if (result.success) {
              const newItem = useProjectStore
                .getState()
                .project.mediaLibrary.items.find(
                  (item) => item.id === result.actionId || !beforeIds.has(item.id),
                );
              if (newItem) {
                const rejection = getMediaDropRejection(track, newItem.type);
                if (rejection) {
                  toast.error("Cannot add media", rejection);
                  continue;
                }
                const TRACK_TO_CLIP_TYPE: Partial<Record<string, "metadata" | "audio" | "image">> = {
                  metadata: "metadata", audio: "audio", image: "image",
                };
                const MEDIA_TO_CLIP_TYPE: Partial<Record<string, "audio" | "image">> = {
                  audio: "audio", image: "image",
                };
                const clipResult = await addClip(track.id, newItem.id, resolvedTime, {
                  type: TRACK_TO_CLIP_TYPE[track.type] ?? MEDIA_TO_CLIP_TYPE[newItem.type] ?? "video",
                });
                if (!clipResult.success) {
                  toast.error(
                    "Could not add media to timeline",
                    clipResult.error?.message ?? `Failed to add ${file.name} to ${track.name}.`,
                  );
                  continue;
                }
                setActiveTrack(track.id);
                toast.success(`Added to ${track.name}`, file.name);
              } else {
                toast.error(
                  "Could not add media to timeline",
                  `The imported asset for ${file.name} could not be resolved.`,
                );
              }
            }
          } catch (err) {
            console.error("[TrackLane] External file drop failed:", err);
            toast.error(
              "External media drop failed",
              err instanceof Error ? err.message : "Unknown drop error",
            );
          }
        }
        return;
      }

      // Internal drag from assets panel
      try {
        const rawData = e.dataTransfer.getData("application/json");
        if (!rawData) return;

        const data = JSON.parse(rawData);
        if (
          !data ||
          typeof data !== "object" ||
          typeof data.mediaId !== "string" ||
          !data.mediaId.trim()
        ) {
          return;
        }

        const mediaType = getDraggedMediaType(data.mediaId);
        if (!mediaType) return;
        const rejection = getMediaDropRejection(track, mediaType);
        if (rejection) {
          toast.error("Cannot add media", rejection);
          return;
        }
        const resolvedTime = resolveDropTime(e.clientX);
        if (resolvedTime !== null) onDropMedia(track.id, data.mediaId, resolvedTime);
      } catch (error) {
        console.error("[TrackLane] Invalid internal media drop payload", error);
        toast.error(
          "Cannot add media",
          "The dragged media payload was invalid. Drag the asset again.",
        );
      }
    },
    [track, onDropMedia, setActiveTrack, resolveDropTime, getDraggedMediaType],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStartY.current = e.clientY;
      resizeStartHeight.current = trackHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [trackHeight],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizeStartY.current;
      const newHeight = resizeStartHeight.current + deltaY;
      onResizeTrack(track.id, newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, track.id, onResizeTrack]);

  return (
    <div className="relative">
      <div
        ref={laneRef}
        data-testid={`track-lane-${track.id}`}
        data-active-track={isActive ? "true" : "false"}
        data-drop-time={dropPreview?.time}
        aria-invalid={dropPreview?.rejection ? "true" : undefined}
        aria-current={isActive ? "true" : undefined}
        aria-label={`${track.name} timeline lane${isActive ? ", active track" : ""}`}
        role="region"
        style={{ height: trackHeight }}
        className={`border-b border-border/50 relative transition-colors ${
          isActive ? "ring-2 ring-inset ring-primary bg-primary/10" : ""
        } ${
          dropPreview?.rejection
            ? "bg-destructive/10 border-destructive/50"
            : isDragOver
              ? "bg-primary/10 border-primary/30"
            : "bg-background-secondary/20"
        }`}
        onPointerDown={() => setActiveTrack(track.id)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <TimelineEmptySpaceMenu trackId={track.id} />
        {/* All standard clips — video, audio, image, metadata — route through ClipComponent */}
        {track.type !== "text" && track.type !== "graphics" &&
          track.clips
          .filter((clip) => !textClips.some((tc) => tc.id === clip.id))
          .filter((clip) => !shapeClips.some((sc) => sc.id === clip.id))
          .map((clip) => (
            <ClipComponent
              key={clip.id}
              clip={clip}
              track={track}
              allTracks={allTracks}
              pixelsPerSecond={pixelsPerSecond}
              isSelected={selectedClipIds.includes(clip.id)}
              trackHeights={trackHeights}
              timelineRef={timelineRef}
              onSelect={onSelectClip}
              onMoveClip={onMoveClip}
              onSnapIndicator={onSnapIndicator}
              onTrimClip={onTrimClip}
            />
          ))}
        {textClips.map((textClip) => (
          <TextClipComponent
            key={textClip.id}
            textClip={textClip}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(textClip.id)}
            onSelect={onSelectClip}
            onTrim={onTrimTextClip}
            onMoveClip={onMoveTextClip}
          />
        ))}
        {shapeClips.map((shapeClip) => (
          <ShapeClipComponent
            key={shapeClip.id}
            shapeClip={shapeClip}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(shapeClip.id)}
            onSelect={onSelectClip}
            onTrim={onTrimShapeClip}
            onMoveClip={onMoveClip}
          />
        ))}
        {dropPreview && (
          <div className={`absolute inset-0 border-2 border-dashed rounded pointer-events-none flex items-center justify-center ${
            dropPreview.rejection ? "border-destructive/60" : "border-primary/50"
          }`}>
            <div
              data-testid="media-drop-position"
              className={`absolute top-0 bottom-0 w-px ${
                dropPreview.rejection ? "bg-destructive" : "bg-primary"
              }`}
              style={{ left: `${dropPreview.time * pixelsPerSecond}px` }}
            />
            <span className={`text-xs bg-background/80 px-2 py-1 rounded ${
              dropPreview.rejection ? "text-destructive" : "text-primary"
            }`}>
              {dropPreview.rejection ?? `Drop at ${dropPreview.time.toFixed(2)}s`}
            </span>
          </div>
        )}
      </div>
      <div
        className={`absolute bottom-0 left-0 right-0 h-1 cursor-row-resize hover:bg-primary/50 transition-colors z-10 ${
          isResizing ? "bg-primary" : ""
        }`}
        onMouseDown={handleResizeStart}
      />
      {isExpanded && clipsWithKeyframes.length > 0 && (
        <div className="absolute left-0 right-0" style={{ top: trackHeight }}>
          {clipsWithKeyframes.map((clip) => (
            <div
              key={`keyframes-${clip.id}`}
              className="relative"
              style={{ left: clip.startTime * pixelsPerSecond }}
            >
              <KeyframeTrack
                clip={clip}
                pixelsPerSecond={pixelsPerSecond}
                onKeyframeSelect={onKeyframeSelect ?? (() => {})}
                onKeyframeMove={onKeyframeMove ?? (() => {})}
                onKeyframeDelete={onKeyframeDelete ?? (() => {})}
                selectedKeyframeIds={selectedKeyframeIds}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
