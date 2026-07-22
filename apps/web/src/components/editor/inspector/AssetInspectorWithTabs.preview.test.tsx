import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MediaItem } from "@openreel/core";
import { AssetInspectorWithTabs } from "./AssetInspectorWithTabs";
import { mediaAvailabilityRuntime } from "../../../services/media-verification";

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
      fileSize: 1024
    },
    thumbnailUrl: null,
    ...overrides
  };
}

describe("AssetInspectorWithTabs preview", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the persisted thumbnailUrl in the preview area", () => {
    render(<AssetInspectorWithTabs item={makeVideoItem({ thumbnailUrl: "data:image/jpeg,persisted" })} />);

    const img = screen.getByRole("img", { name: /shot\.mp4/ });
    expect(img).toHaveAttribute("src", "data:image/jpeg,persisted");
  });

  it("previews video from the main inspector thumbnail controls", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<AssetInspectorWithTabs item={makeVideoItem({
      originalUrl: "https://cdn.example.test/shot.mp4",
      thumbnailUrl: "data:image/jpeg,persisted",
    })} />);

    const video = screen.getByLabelText("Video preview for shot.mp4");
    expect(video).toHaveAttribute("src", "https://cdn.example.test/shot.mp4");
    expect(video).toHaveAttribute("poster", "data:image/jpeg,persisted");

    fireEvent.click(screen.getByRole("button", { name: "Play video preview" }));
    expect(play).toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Pause video preview" }));
    expect(pause).toHaveBeenCalled();
  });

  it("shows the missing-file placeholder when thumbnailUrl is absent", () => {
    vi.spyOn(mediaAvailabilityRuntime, "get").mockReturnValue({
      mediaId: "video-1",
      status: "confirmed_missing",
      evidence: { authoritative: true, mapping: "absent", object: "absent" },
    });
    render(<AssetInspectorWithTabs item={makeVideoItem({ blob: null, sourceFile: { name: "missing.mp4", size: 0, lastModified: 0 } })} />);

    expect(screen.getByText("Missing")).toBeInTheDocument();
  });
});
