import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_PLAYBACK_BACKGROUND,
  paintPlaybackBackground,
} from "./playback-canvas";

describe("paintPlaybackBackground", () => {
  it("clears a playback gap to black when there is no video or image frame", () => {
    const context = {
      fillStyle: "#ff00ff",
      fillRect: vi.fn(),
    };

    paintPlaybackBackground(context, 1920, 1080, false, "#ffffff");

    expect(context.fillStyle).toBe(EMPTY_PLAYBACK_BACKGROUND);
    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
  });

  it("keeps the configured preview background behind an active media frame", () => {
    const context = {
      fillStyle: "#ff00ff",
      fillRect: vi.fn(),
    };

    paintPlaybackBackground(context, 1280, 720, true, "#f4f4f5");

    expect(context.fillStyle).toBe("#f4f4f5");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 720);
  });
});
