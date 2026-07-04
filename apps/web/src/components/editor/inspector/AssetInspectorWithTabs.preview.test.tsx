import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MediaItem } from "@openreel/core";
import { AssetInspectorWithTabs } from "./AssetInspectorWithTabs";

function makeVideoItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "video-1",
    name: "shot.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 5,
      width: 1920,
      height: 1080,
      frameRate: 24,
      codec: "h264",
      sampleRate: 0,
      channels: 0,
      fileSize: 1024,
    },
    thumbnailUrl: null,
    waveformData: null,
    ...overrides,
  };
}

describe("AssetInspectorWithTabs preview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the persisted thumbnailUrl in the preview area", () => {
    render(<AssetInspectorWithTabs item={makeVideoItem({ thumbnailUrl: "data:image/jpeg,persisted" })} />);

    const img = screen.getByRole("img", { name: /shot\.mp4/ });
    expect(img).toHaveAttribute("src", "data:image/jpeg,persisted");
  });

  it("shows the missing-file placeholder when thumbnailUrl is absent", () => {
    render(<AssetInspectorWithTabs item={makeVideoItem({ isPlaceholder: true })} />);

    expect(screen.getByText(/Missing file/)).toBeInTheDocument();
  });
});
