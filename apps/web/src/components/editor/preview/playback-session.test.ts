import { describe, expect, it, vi } from "vitest";

import { refreshActivePlaybackAfterWarmup } from "./playback-session";

describe("refreshActivePlaybackAfterWarmup", () => {
  it("does not let a paused playback session start the shared clock", async () => {
    let active = true;
    let finishWarmup!: () => void;
    const warmup = new Promise<void>((resolve) => {
      finishWarmup = resolve;
    });

    const refresh = vi.fn();
    refreshActivePlaybackAfterWarmup(
      () => warmup,
      () => active,
      refresh,
    );
    active = false;
    finishWarmup();
    await warmup;
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns immediately and refreshes audio when warmup finishes", async () => {
    let finishWarmup!: () => void;
    const warmup = new Promise<void>((resolve) => {
      finishWarmup = resolve;
    });
    const refresh = vi.fn();

    const result = refreshActivePlaybackAfterWarmup(
      () => warmup,
      () => true,
      refresh,
    );

    expect(result).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    finishWarmup();
    await warmup;
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
