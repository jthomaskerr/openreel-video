import type { MediaItem, Track } from "@openreel/core";

export function startPlaybackAudioWarmup(
  warmup: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  void warmup().catch(onError);
}

export function startPlaybackAudioResume(
  resume: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  void resume().catch(onError);
}

export type AudioPlaybackClip = {
  track: Track;
  clip: Track["clips"][number];
};

type GetMediaItem = (mediaId: string) => MediaItem | undefined;

const isClipInPlaybackWindow = (
  clip: Track["clips"][number],
  time: number,
  lookAheadSeconds: number,
): boolean =>
  clip.startTime + clip.duration > time && clip.startTime <= time + lookAheadSeconds;

const mediaItemHasAudio = (mediaItem: MediaItem | undefined): boolean => {
  if (!mediaItem) return false;
  if (mediaItem.type === "audio") return true;
  if (mediaItem.type !== "video") return false;

  return (
    mediaItem.metadata.channels > 0 ||
    mediaItem.metadata.sampleRate > 0 ||
    (mediaItem.metadata.audioTrackCount ?? 0) > 0
  );
};

const hasLinkedAudioClip = (
  tracks: Track[],
  videoClip: Track["clips"][number],
  time: number,
  lookAheadSeconds: number,
): boolean =>
  tracks.some(
    (track) =>
      track.type === "audio" &&
      track.clips.some(
        (clip) =>
          clip.mediaId === videoClip.mediaId &&
          Math.abs(clip.startTime - videoClip.startTime) < 0.01 &&
          isClipInPlaybackWindow(clip, time, lookAheadSeconds),
      ),
  );

export function getAudioPlaybackClips(
  tracks: Track[],
  getMediaItem: GetMediaItem,
  time: number,
  lookAheadSeconds = 0,
): AudioPlaybackClip[] {
  const audioClips: AudioPlaybackClip[] = [];

  for (const track of tracks) {
    if (
      track.hidden ||
      track.muted ||
      (track.type !== "audio" && track.type !== "video")
    ) {
      continue;
    }

    for (const clip of track.clips) {
      if (clip.muted) continue;
      if (!isClipInPlaybackWindow(clip, time, lookAheadSeconds)) continue;
      if (!mediaItemHasAudio(getMediaItem(clip.mediaId))) continue;
      if (track.type === "video" && hasLinkedAudioClip(tracks, clip, time, lookAheadSeconds)) {
        continue;
      }

      audioClips.push({ track, clip });
    }
  }

  return audioClips;
}
