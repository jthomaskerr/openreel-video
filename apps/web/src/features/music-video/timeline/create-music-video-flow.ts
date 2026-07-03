import type { ActionResult } from "@openreel/core";
import { addTimelineClip, type TimelineClipStore } from "./timeline-clips";

/** Track name used for the music-video metadata track on the timeline. */
export const MUSIC_VIDEO_TRACK_NAME = "Music Video";

/** Timeline clip color for music-video clips. */
export const MUSIC_VIDEO_CLIP_COLOR = "#38bdf8";

/**
 * Minimum store surface the flow needs.
 * Extends TimelineClipStore (which provides project, addTrack, renameTrack,
 * addGeneratedMedia, addClip) with the two extra methods required for audio import.
 */
export interface MusicVideoFlowStore extends TimelineClipStore {
  /** Import a File into the project media library; returns actionId = new media ID. */
  importMedia: (file: File) => Promise<ActionResult>;
  /** Current total duration of the timeline (seconds). Used as fallback when audio duration is unavailable. */
  getTimelineDuration: () => number;
}

export interface CreateMusicVideoFlowInput {
  audioFile: File;
}

export interface CreateMusicVideoFlowResult {
  success: boolean;
  audioTrackId: string;
  audioClipId: string;
  metadataTrackId: string;
  metadataClipId: string;
  error?: ActionResult["error"];
}

/**
 * Import an audio file into the project and wire up both the audio timeline clip
 * and the full-duration music-video metadata clip in one atomic flow.
 *
 * Steps:
 *  1. Import the audio file into the media library.
 *  2. Resolve clip duration from media metadata; fall back to project timeline
 *     duration when the audio container reports 0 (e.g. live-recorded files).
 *     The clip remains adjustable by the user afterward.
 *  3. Find or create an audio track and place the clip at t=0.
 *  4. Create the full-duration music-video metadata clip via addTimelineClip.
 *
 * Returns all four created/found IDs so UI callers can immediately select the
 * metadata clip: useUIStore.select({ type: "clip", id: metadataClipId, trackId: metadataTrackId }).
 */
export async function createMusicVideoFlow(
  store: MusicVideoFlowStore,
  input: CreateMusicVideoFlowInput,
): Promise<CreateMusicVideoFlowResult> {
  // 1. Import audio into media library
  const importResult = await store.importMedia(input.audioFile);
  if (!importResult.success) {
    return {
      success: false,
      audioTrackId: "",
      audioClipId: "",
      metadataTrackId: "",
      metadataClipId: "",
      error: importResult.error,
    };
  }
  const mediaId = importResult.actionId!;

  // 2. Resolve duration
  //    Media metadata is preferred. If the container reports 0 or is missing, fall back to
  //    the current project timeline duration so the clip still occupies a visible span.
  const mediaItem = store.project.mediaLibrary.items.find((item) => item.id === mediaId);
  const audioDuration =
    mediaItem?.metadata.duration && mediaItem.metadata.duration > 0
      ? mediaItem.metadata.duration
      : store.getTimelineDuration();

  // 3. Ensure an audio track exists (reuse first existing one)
  const existingAudioTrack = store.project.timeline.tracks.find(
    (track) => track.type === "audio",
  );
  let audioTrackId: string;
  if (existingAudioTrack) {
    audioTrackId = existingAudioTrack.id;
  } else {
    const beforeIds = new Set(store.project.timeline.tracks.map((t) => t.id));
    const addResult = await store.addTrack("audio");
    if (!addResult.success) {
      return {
        success: false,
        audioTrackId: "",
        audioClipId: "",
        metadataTrackId: "",
        metadataClipId: "",
        error: addResult.error,
      };
    }
    const created = store.project.timeline.tracks.find(
      (t) => t.type === "audio" && !beforeIds.has(t.id),
    );
    if (!created) {
      return {
        success: false,
        audioTrackId: "",
        audioClipId: "",
        metadataTrackId: "",
        metadataClipId: "",
        error: { code: "TRACK_NOT_FOUND", message: "Audio track was added but could not be located" },
      };
    }
    audioTrackId = created.id;
  }

  // 4. Place audio clip at t=0
  const clipResult = await store.addClip(audioTrackId, mediaId, 0, {
    duration: audioDuration,
    type: "audio",
  });
  if (!clipResult.success) {
    return {
      success: false,
      audioTrackId,
      audioClipId: "",
      metadataTrackId: "",
      metadataClipId: "",
      error: clipResult.error,
    };
  }

  const audioClipId =
    store.project.timeline.tracks
      .find((t) => t.id === audioTrackId)
      ?.clips.find((c) => c.mediaId === mediaId && c.startTime === 0)?.id ?? null;
  if (!audioClipId) {
    return {
      success: false,
      audioTrackId,
      audioClipId: "",
      metadataTrackId: "",
      metadataClipId: "",
      error: { code: "CLIP_NOT_FOUND", message: "Audio clip was added but could not be located" },
    };
  }

  // 5. Create full-duration music-video metadata clip
  const metadataResult = await addTimelineClip(store, {
    trackName: MUSIC_VIDEO_TRACK_NAME,
    kind: "music-video",
    label: "Music Video",
    color: MUSIC_VIDEO_CLIP_COLOR,
    startTime: 0,
    duration: audioDuration,
  });
  if (!metadataResult.success) {
    return {
      success: false,
      audioTrackId,
      audioClipId,
      metadataTrackId: "",
      metadataClipId: "",
      error: metadataResult.error,
    };
  }

  return {
    success: true,
    audioTrackId,
    audioClipId,
    metadataTrackId: metadataResult.trackId,
    metadataClipId: metadataResult.clipId,
  };
}

