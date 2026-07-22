export interface TransportAudioTimingInput {
  clipSpeed: number;
  transportRate: number;
  timelineOffset: number;
  timelineDuration: number;
  timelineDelay: number;
}

export interface TransportAudioTiming {
  sourcePlaybackRate: number;
  sourceOffset: number;
  sourceDuration: number;
  contextDelay: number;
}

export function resolveTransportAudioTiming({
  clipSpeed,
  transportRate,
  timelineOffset,
  timelineDuration,
  timelineDelay,
}: TransportAudioTimingInput): TransportAudioTiming {
  const speed = Number.isFinite(clipSpeed) ? Math.max(0.1, clipSpeed) : 1;
  const rate = Number.isFinite(transportRate)
    ? Math.max(0.1, transportRate)
    : 1;
  const offset = Number.isFinite(timelineOffset) ? Math.max(0, timelineOffset) : 0;
  const duration = Number.isFinite(timelineDuration)
    ? Math.max(0, timelineDuration)
    : 0;
  const delay = Number.isFinite(timelineDelay) ? Math.max(0, timelineDelay) : 0;

  return {
    sourcePlaybackRate: speed * rate,
    sourceOffset: offset * speed,
    sourceDuration: duration * speed,
    contextDelay: delay / rate,
  };
}
