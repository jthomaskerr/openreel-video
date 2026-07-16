import type { Keyframe } from "@openreel/core";

export const MIN_CLIP_DURATION_SECONDS = 0.1;

export interface ClipTrimSnapshot {
  clipId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceDuration: number;
  keyframes: Keyframe[];
}

export interface ClipTrimUpdate {
  edge: "left" | "right";
  edgeTime: number;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  keyframes: Keyframe[];
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
}

function validateInputs(
  snapshot: ClipTrimSnapshot,
  candidateEdgeTime: number,
  minimumDuration: number,
): void {
  assertFiniteNonNegative("snapshot.startTime", snapshot.startTime);
  assertFiniteNonNegative("snapshot.duration", snapshot.duration);
  assertFiniteNonNegative("snapshot.inPoint", snapshot.inPoint);
  assertFiniteNonNegative("snapshot.outPoint", snapshot.outPoint);
  assertFiniteNonNegative("snapshot.sourceDuration", snapshot.sourceDuration);

  if (!Number.isFinite(candidateEdgeTime)) {
    throw new RangeError("candidateEdgeTime must be finite");
  }
  if (!Number.isFinite(minimumDuration) || minimumDuration <= 0) {
    throw new RangeError("minimumDuration must be finite and positive");
  }
  if (snapshot.duration < minimumDuration) {
    throw new RangeError("snapshot.duration must be at least minimumDuration");
  }
  if (snapshot.inPoint > snapshot.outPoint || snapshot.outPoint > snapshot.sourceDuration) {
    throw new RangeError("snapshot source bounds are invalid");
  }
  if (!Number.isFinite(snapshot.startTime + snapshot.duration)) {
    throw new RangeError("snapshot timeline end must be finite");
  }
  if (snapshot.keyframes.some((keyframe) => !Number.isFinite(keyframe.time))) {
    throw new RangeError("keyframe times must be finite");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function recalculateExitKeyframes(
  keyframes: Keyframe[],
  oldDuration: number,
  newDuration: number,
): Keyframe[] {
  return keyframes.map((keyframe) => {
    if (!keyframe.id.startsWith("kf-exit-")) {
      return keyframe;
    }

    const time = newDuration + (keyframe.time - oldDuration);
    if (!Number.isFinite(time)) {
      throw new RangeError("recalculated keyframe time must be finite");
    }
    return { ...keyframe, time };
  });
}

export function calculateClipTrim(
  snapshot: ClipTrimSnapshot,
  edge: "left" | "right",
  candidateEdgeTime: number,
  minimumDuration = MIN_CLIP_DURATION_SECONDS,
): ClipTrimUpdate {
  validateInputs(snapshot, candidateEdgeTime, minimumDuration);

  if (edge === "left") {
    const requestedDelta = candidateEdgeTime - snapshot.startTime;
    const minimumDelta = Math.max(-snapshot.startTime, -snapshot.inPoint);
    const maximumDelta = snapshot.duration - minimumDuration;
    const effectiveDelta = clamp(requestedDelta, minimumDelta, maximumDelta);
    const startTime = snapshot.startTime + effectiveDelta;
    const duration =
      effectiveDelta === maximumDelta
        ? minimumDuration
        : snapshot.duration - effectiveDelta;
    const inPoint = snapshot.inPoint + effectiveDelta;

    return {
      edge,
      edgeTime: startTime,
      startTime,
      duration,
      inPoint,
      outPoint: snapshot.outPoint,
      keyframes: recalculateExitKeyframes(snapshot.keyframes, snapshot.duration, duration),
    };
  }

  const maximumDuration = snapshot.sourceDuration - snapshot.inPoint;
  if (maximumDuration < minimumDuration) {
    throw new RangeError("source has less than minimumDuration available at inPoint");
  }

  const requestedDuration = candidateEdgeTime - snapshot.startTime;
  const duration = clamp(requestedDuration, minimumDuration, maximumDuration);
  const edgeTime = snapshot.startTime + duration;
  const outPoint = snapshot.inPoint + duration;

  return {
    edge,
    edgeTime,
    startTime: snapshot.startTime,
    duration,
    inPoint: snapshot.inPoint,
    outPoint,
    keyframes: recalculateExitKeyframes(snapshot.keyframes, snapshot.duration, duration),
  };
}
