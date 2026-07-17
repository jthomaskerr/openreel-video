import { describe, expect, it, vi } from "vitest";

import { getOrLoadCachedAudioBuffer } from "./load-audio-buffer";

describe("getOrLoadCachedAudioBuffer", () => {
  it("reuses a known no-audio result on the second playback attempt", async () => {
    const cache = new Map<string, AudioBuffer | null>();
    const inFlight = new Map<string, Promise<AudioBuffer | null>>();
    const load = vi.fn(async () => null);

    await expect(
      getOrLoadCachedAudioBuffer(cache, inFlight, "silent-video:0", load),
    ).resolves.toBeNull();
    await expect(
      getOrLoadCachedAudioBuffer(cache, inFlight, "silent-video:0", load),
    ).resolves.toBeNull();

    expect(load).toHaveBeenCalledOnce();
  });

  it("shares an in-flight decode when playback restarts during audio warmup", async () => {
    const cache = new Map<string, AudioBuffer | null>();
    const inFlight = new Map<string, Promise<AudioBuffer | null>>();
    let finishLoad!: (result: AudioBuffer | null) => void;
    const load = vi.fn(
      () =>
        new Promise<AudioBuffer | null>((resolve) => {
          finishLoad = resolve;
        }),
    );

    const firstPlayback = getOrLoadCachedAudioBuffer(
      cache,
      inFlight,
      "clip-with-audio:0",
      load,
    );
    const secondPlayback = getOrLoadCachedAudioBuffer(
      cache,
      inFlight,
      "clip-with-audio:0",
      load,
    );

    expect(load).toHaveBeenCalledOnce();
    finishLoad(null);
    await expect(Promise.all([firstPlayback, secondPlayback])).resolves.toEqual([
      null,
      null,
    ]);
    expect(inFlight.has("clip-with-audio:0")).toBe(false);
  });
});
