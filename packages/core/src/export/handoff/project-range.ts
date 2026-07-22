import type { Project } from "../../types/project";
import type { Clip, Track } from "../../types/timeline";
import type { ExportRange } from "../types";
import { frameRangeFromSeconds, secondsToFrameIndex } from "./timebase";
import type { FrameRange, ProjectedClip, ProjectedTrack, Timebase } from "./types";

export interface ProjectRangeProjection {
  readonly frameRange: FrameRange;
  readonly tracks: readonly ProjectedTrack[];
  readonly clips: readonly ProjectedClip[];
}

function trackIsAudible(track: Track): boolean {
  return track.type !== "audio" || !track.muted;
}

function trackIsVisible(track: Track): boolean {
  return track.type !== "video" || !track.hidden;
}

function clipIsEnabled(clip: Clip, track: Track): boolean {
  if (!trackIsVisible(track) || !trackIsAudible(track)) return false;
  return !(track.type === "audio" && clip.muted);
}

function clipKind(clip: Clip): ProjectedClip["kind"] | null {
  if (clip.type === "video" || clip.type === "audio" || clip.type === "image") return clip.type;
  return null;
}

export function projectRange(project: Project, range: ExportRange, timebase: Timebase): ProjectRangeProjection {
  const selectedFrames = frameRangeFromSeconds(range, timebase);
  const tracks: ProjectedTrack[] = [];
  const clips: ProjectedClip[] = [];
  let includedVideoTrackIndex = 0;
  let includedAudioTrackIndex = 0;

  project.timeline.tracks.forEach((track, trackIndex) => {
    if (track.type !== "video" && track.type !== "audio") return;
    if (!trackIsVisible(track) || !trackIsAudible(track)) return;

    tracks.push({ id: track.id, name: track.name, type: track.type, index: trackIndex });
    const lane = track.type === "video" ? includedVideoTrackIndex++ : -(++includedAudioTrackIndex);

    for (const clip of track.clips) {
      const kind = clipKind(clip);
      if (!kind || !clipIsEnabled(clip, track)) continue;

      const intersectionStart = Math.max(clip.startTime, range.startTime);
      const intersectionEnd = Math.min(clip.startTime + clip.duration, range.endTime);
      if (intersectionEnd <= intersectionStart) continue;

      const absoluteStartFrame = secondsToFrameIndex(intersectionStart, timebase);
      const absoluteEndFrame = secondsToFrameIndex(intersectionEnd, timebase);
      if (absoluteEndFrame <= absoluteStartFrame) continue;

      const startFrame = absoluteStartFrame - selectedFrames.startFrame;
      const endFrame = absoluteEndFrame - selectedFrames.startFrame;
      const durationFrames = endFrame - startFrame;
      const sourceTrimSeconds = intersectionStart - clip.startTime;
      const sourceStartFrame = secondsToFrameIndex(clip.inPoint + sourceTrimSeconds, timebase);

      clips.push({
        clipId: clip.id,
        trackId: track.id,
        mediaId: clip.mediaId,
        trackIndex,
        lane,
        timelineRange: { startFrame, endFrame, durationFrames },
        sourceStartFrame,
        sourceDurationFrames: durationFrames,
        enabled: true,
        kind,
        mediaReferenceId: clip.mediaId,
      });
    }
  });

  clips.sort(
    (left, right) =>
      left.trackIndex - right.trackIndex ||
      left.timelineRange.startFrame - right.timelineRange.startFrame ||
      left.clipId.localeCompare(right.clipId),
  );

  return { frameRange: selectedFrames, tracks, clips };
}
