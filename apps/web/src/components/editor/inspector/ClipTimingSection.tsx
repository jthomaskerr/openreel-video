import React, { useCallback, useMemo } from "react";
import type { Keyframe } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";
import { InspectorSection } from "./shell/InspectorSection";

interface ClipTimingLike {
  id: string;
  startTime: number;
  duration: number;
  keyframes?: Keyframe[];
}

interface ClipTimingSectionProps {
  clip: ClipTimingLike;
}

const MIN_DURATION_SECONDS = 0.1;

const clampTime = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
const clampDuration = (value: number): number =>
  Number.isFinite(value) ? Math.max(MIN_DURATION_SECONDS, value) : MIN_DURATION_SECONDS;

function adjustExitKeyframes(
  keyframes: readonly Keyframe[] | undefined,
  oldDuration: number,
  newDuration: number,
): Keyframe[] | undefined {
  if (!keyframes) return undefined;
  return keyframes.map((keyframe) => {
    if (keyframe.id.startsWith("kf-exit-")) {
      const relativeTime = keyframe.time - oldDuration;
      return { ...keyframe, time: newDuration + relativeTime };
    }
    return keyframe;
  });
}

export const ClipTimingSection: React.FC<ClipTimingSectionProps> = ({ clip }) => {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const titleEngine = useEngineStore((state) => state.getTitleEngine());
  const graphicsEngine = useEngineStore((state) => state.getGraphicsEngine());

  const startTime = clampTime(clip.startTime);
  const duration = clampDuration(clip.duration);
  const endTime = startTime + duration;

  const formatted = useMemo(
    () => ({
      start: startTime.toFixed(2),
      duration: duration.toFixed(2),
      end: endTime.toFixed(2),
      playhead: playheadPosition.toFixed(2),
    }),
    [duration, endTime, playheadPosition, startTime],
  );

  const updateTiming = useCallback(
    (updates: { startTime?: number; duration?: number }) => {
      const projectClip = useProjectStore.getState().getClip(clip.id);
      const currentStart = clampTime(projectClip?.startTime ?? clip.startTime);
      const currentDuration = clampDuration(projectClip?.duration ?? clip.duration);
      const nextStart = clampTime(updates.startTime ?? currentStart);
      const nextDuration = clampDuration(updates.duration ?? currentDuration);
      const keyframes = adjustExitKeyframes(
        projectClip?.keyframes ?? clip.keyframes,
        currentDuration,
        nextDuration,
      );

      if (projectClip) {
        useProjectStore.setState((state) => ({
          project: {
            ...state.project,
            timeline: {
              ...state.project.timeline,
              tracks: state.project.timeline.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((timelineClip) =>
                  timelineClip.id === clip.id
                    ? {
                        ...timelineClip,
                        startTime: nextStart,
                        duration: nextDuration,
                        outPoint: timelineClip.inPoint + nextDuration,
                        ...(keyframes ? { keyframes } : {}),
                      }
                    : timelineClip,
                ),
              })),
            },
            modifiedAt: Date.now(),
          },
        }));
        return;
      }

      const textClip = titleEngine?.getTextClip(clip.id);
      if (titleEngine && textClip) {
        const textKeyframes = adjustExitKeyframes(textClip.keyframes, textClip.duration, nextDuration);
        titleEngine.updateTextClip(clip.id, {
          startTime: nextStart,
          duration: nextDuration,
        });
        if (textKeyframes) {
          useProjectStore.getState().updateTextClipKeyframes(clip.id, textKeyframes);
        }
        useProjectStore.setState((state) => ({
          project: { ...state.project, modifiedAt: Date.now() },
        }));
        return;
      }

      const graphicClip =
        graphicsEngine?.getShapeClip(clip.id) ??
        graphicsEngine?.getSVGClip(clip.id) ??
        graphicsEngine?.getStickerClip(clip.id);
      if (graphicClip) {
        const graphicKeyframes = adjustExitKeyframes(
          graphicClip.keyframes,
          graphicClip.duration,
          nextDuration,
        );
        const graphicUpdates = { startTime: nextStart, duration: nextDuration };
        if (graphicClip.type === "sticker" || graphicClip.type === "emoji") {
          graphicsEngine?.updateStickerClip(clip.id, graphicUpdates);
        } else if (graphicClip.type === "svg") {
          graphicsEngine?.updateSVGClip(clip.id, graphicUpdates);
        } else {
          graphicsEngine?.updateShapeClip(clip.id, graphicUpdates);
        }
        if (graphicKeyframes) {
          useProjectStore.getState().updateClipKeyframes(clip.id, graphicKeyframes);
        }
        useProjectStore.setState((state) => ({
          project: { ...state.project, modifiedAt: Date.now() },
        }));
      }
    },
    [clip.duration, clip.id, clip.keyframes, clip.startTime, graphicsEngine, titleEngine],
  );

  const updateStart = useCallback(
    (nextStartValue: number) => {
      const nextStart = clampTime(nextStartValue);
      const nextEnd = Math.max(endTime, nextStart + MIN_DURATION_SECONDS);
      updateTiming({ startTime: nextStart, duration: nextEnd - nextStart });
    },
    [endTime, updateTiming],
  );

  const updateDuration = useCallback(
    (nextDurationValue: number) => {
      updateTiming({ duration: clampDuration(nextDurationValue) });
    },
    [updateTiming],
  );

  const updateEnd = useCallback(
    (nextEndValue: number) => {
      const nextEnd = Math.max(clampTime(nextEndValue), startTime + MIN_DURATION_SECONDS);
      updateTiming({ duration: nextEnd - startTime });
    },
    [startTime, updateTiming],
  );

  return (
    <div className="px-3 pt-3">
      <InspectorSection title="Timing" defaultOpen sectionId="timing">
        <div className="space-y-2 rounded-lg border border-border/60 bg-background-secondary/40 p-2.5">
          <label className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px] text-text-secondary">
            <span>Start</span>
            <Input
              aria-label="Clip start time"
              type="number"
              min={0}
              step="0.01"
              value={formatted.start}
              onChange={(event) => updateStart(parseFloat(event.target.value))}
              className="h-7 bg-background-tertiary border-border text-text-primary text-right text-[10px]"
            />
            <button
              type="button"
              aria-label={`Set clip start to playhead at ${formatted.playhead} seconds`}
              onClick={() => updateStart(playheadPosition)}
              className="h-7 rounded border border-border bg-background-tertiary px-2 text-[10px] text-text-secondary transition-colors hover:text-text-primary hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Set
            </button>
          </label>

          <label className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px] text-text-secondary">
            <span>End</span>
            <Input
              aria-label="Clip end time"
              type="number"
              min={MIN_DURATION_SECONDS}
              step="0.01"
              value={formatted.end}
              onChange={(event) => updateEnd(parseFloat(event.target.value))}
              className="h-7 bg-background-tertiary border-border text-text-primary text-right text-[10px]"
            />
            <button
              type="button"
              aria-label={`Set clip end to playhead at ${formatted.playhead} seconds`}
              onClick={() => updateEnd(playheadPosition)}
              className="h-7 rounded border border-border bg-background-tertiary px-2 text-[10px] text-text-secondary transition-colors hover:text-text-primary hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Set
            </button>
          </label>

          <label className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px] text-text-secondary">
            <span>Duration</span>
            <Input
              aria-label="Clip duration"
              type="number"
              min={MIN_DURATION_SECONDS}
              step="0.01"
              value={formatted.duration}
              onChange={(event) => updateDuration(parseFloat(event.target.value))}
              className="h-7 bg-background-tertiary border-border text-text-primary text-right text-[10px]"
            />
            <span className="w-10 text-right text-[9px] text-text-muted">sec</span>
          </label>
        </div>
      </InspectorSection>
    </div>
  );
};
