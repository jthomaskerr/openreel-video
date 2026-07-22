import { beforeEach, describe, expect, it, vi } from "vitest";
import { MasterTimelineClock } from "./master-timeline-clock";

function createClock(options: { suspended?: boolean; unresolvedResume?: boolean } = {}) {
  let wallTimeMs = 0;
  const audioContext = {
    currentTime: 0,
    state: options.suspended ? "suspended" : "running",
    resume: vi.fn(() =>
      options.unresolvedResume
        ? new Promise<void>(() => {})
        : Promise.resolve(),
    ),
  } as unknown as AudioContext;
  return {
    audioContext,
    advance: (seconds: number) => {
      wallTimeMs += seconds * 1000;
    },
    clock: new MasterTimelineClock({
      audioContext,
      now: () => wallTimeMs,
    }),
  };
}

describe("MasterTimelineClock transport", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("wraps continuously from B to A without stopping", async () => {
    const { advance, clock } = createClock();
    clock.setDuration(12);
    clock.setLoop(true, 2, 6);
    clock.seek(5);
    await clock.play();

    advance(2);

    expect(clock.currentTime).toBe(3);
    expect(clock.isPlaying).toBe(true);
    clock.stop();
  });

  it("advances the timeline at the selected playback rate", async () => {
    const { advance, clock } = createClock();
    clock.setDuration(12);
    clock.seek(1);
    clock.setPlaybackRate(2);
    await clock.play();

    advance(1);

    expect(clock.currentTime).toBe(3);
    clock.stop();
  });

  it("starts and advances when AudioContext resume remains unresolved", async () => {
    const { advance, audioContext, clock } = createClock({
      suspended: true,
      unresolvedResume: true,
    });
    clock.setDuration(5);

    await expect(clock.play()).resolves.toBeUndefined();
    advance(1.25);

    expect(audioContext.resume).toHaveBeenCalledOnce();
    expect(clock.currentTime).toBe(1.25);
    expect(clock.isPlaying).toBe(true);
    clock.stop();
  });

  it("preserves the duration when natural playback completes", async () => {
    let scheduledFrame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrame = callback;
        return 1;
      }),
    );
    const { advance, clock } = createClock();
    clock.setDuration(5);

    await clock.play();
    advance(5);
    scheduledFrame?.(0);

    expect(clock.currentTime).toBe(5);
    expect(clock.isPlaying).toBe(false);
  });
});
