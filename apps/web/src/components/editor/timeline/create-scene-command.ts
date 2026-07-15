import { getSceneCreationDisabledReason } from "../../../stores/ui-store";

export interface TimelineTrackForSceneCreation {
  id: string;
  type: string;
  locked?: boolean;
}

export type CreateSceneMenuState =
  | { enabled: true; trackId: string }
  | { enabled: false; reason: string };

export function getCreateSceneMenuState(
  tracks: readonly TimelineTrackForSceneCreation[],
  activeTrackId: string | null,
): CreateSceneMenuState {
  const reason = getSceneCreationDisabledReason(tracks, activeTrackId);
  if (reason) return { enabled: false, reason };
  const activeTrack = tracks.find((track) => track.id === activeTrackId);
  if (!activeTrack) return { enabled: false, reason: "Select a video track to create a scene." };
  return { enabled: true, trackId: activeTrack.id };
}

export interface CreateSceneActivationGate {
  inFlight: boolean;
}

type SceneCreationResult =
  | { success: true; value: { sceneId: string; clipId: string } }
  | { success: false; error: { code: string; message: string } };

export type TimelineCreateSceneCommandResult =
  | { status: "created"; sceneId: string; clipId: string }
  | { status: "disabled"; reason: string }
  | { status: "duplicate" }
  | { status: "failed"; code: string; message: string };

export async function executeTimelineCreateSceneCommand(input: {
  tracks: readonly TimelineTrackForSceneCreation[];
  activeTrackId: string | null;
  playheadTime: number;
  gate: CreateSceneActivationGate;
  createAndPlaceScene: (request: {
    trackId: string;
    startTime: number;
  }) => Promise<SceneCreationResult>;
  onCreated: (result: {
    sceneId: string;
    clipId: string;
    trackId: string;
  }) => void;
  onFailed: (error: { code: string; message: string }) => void;
}): Promise<TimelineCreateSceneCommandResult> {
  if (input.gate.inFlight) return { status: "duplicate" };

  // Capture command coordinates exactly once before async work begins.
  const capturedTrackId = input.activeTrackId;
  const capturedPlayheadTime = input.playheadTime;
  const menuState = getCreateSceneMenuState(input.tracks, capturedTrackId);
  if (!menuState.enabled) {
    return { status: "disabled", reason: menuState.reason };
  }

  input.gate.inFlight = true;
  try {
    const result = await input.createAndPlaceScene({
      trackId: menuState.trackId,
      startTime: capturedPlayheadTime,
    });
    if (!result.success) {
      input.onFailed(result.error);
      return { status: "failed", ...result.error };
    }
    input.onCreated({
      ...result.value,
      trackId: menuState.trackId,
    });
    return { status: "created", ...result.value };
  } finally {
    input.gate.inFlight = false;
  }
}
