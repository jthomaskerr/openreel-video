import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ResolvePreviewClip,
  ResolvePreviewClipGroup,
  ResolvePreviewMiniTimeline,
  ResolvePreviewRender,
} from "@openreel/core";
import { ClipGroups } from "./ClipGroups";
import { MediaClipPreview } from "./MediaClipPreview";
import { MiniTimeline } from "./MiniTimeline";
import { RenderedOutputPreview } from "./RenderedOutputPreview";

const videoClip: ResolvePreviewClip = {
  id: "video-1",
  mediaId: "media-video-1",
  label: "Shibuya Crossing",
  startFrame: 10,
  endFrame: 40,
  preview: {
    status: "ready",
    kind: "video",
    url: "/api/projects/vintage-tokyo/media/media-video-1",
    thumbnailUrl: "/api/projects/vintage-tokyo/media/media-video-1/thumbnail",
  },
};

const audioClip: ResolvePreviewClip = {
  id: "audio-1",
  mediaId: "media-audio-1",
  label: "Vintage Tokyo Master",
  startFrame: 0,
  endFrame: 100,
  preview: {
    status: "ready",
    kind: "audio",
    url: "/api/projects/vintage-tokyo/media/media-audio-1",
    waveformUrl: "/api/projects/vintage-tokyo/media/media-audio-1/waveform",
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RenderedOutputPreview", () => {
  it.each([
    {
      renderState: {
        status: "ready",
        mediaId: "render-1",
        previewUrl: "/api/projects/vintage-tokyo/media/render-1",
        updatedAt: Date.UTC(2026, 6, 22, 10),
        stale: false,
      } satisfies ResolvePreviewRender,
      expected: "Latest rendered output",
      reason: null,
    },
    {
      renderState: {
        status: "stale",
        mediaId: "render-1",
        previewUrl: "/api/projects/vintage-tokyo/media/render-1",
        updatedAt: Date.UTC(2026, 6, 21, 10),
        stale: true,
        reason: "The project changed after this render completed.",
      } satisfies ResolvePreviewRender,
      expected: "Latest rendered output",
      reason: "The project changed after this render completed.",
    },
    {
      renderState: {
        status: "missing",
        reason: "Render this project to preview its output.",
      } satisfies ResolvePreviewRender,
      expected: null,
      reason: "Render this project to preview its output.",
    },
  ])("renders the $renderState.status backend render state without substitution", ({ renderState, expected, reason }) => {
    render(<RenderedOutputPreview render={renderState} />);

    if (expected) {
      const media = screen.getByLabelText(expected);
      expect(media).toHaveAttribute("src", "/api/projects/vintage-tokyo/media/render-1");
      expect(media).not.toHaveAttribute("autoplay");
      expect(media).not.toHaveAttribute("controls");
      expect(screen.getByRole("button", { name: /play latest rendered output/i })).toBeVisible();
    } else {
      expect(screen.queryByLabelText("Latest rendered output")).not.toBeInTheDocument();
    }
    if (reason) expect(screen.getByText(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeVisible();
  });
});

describe("MediaClipPreview", () => {
  it("tracks video play, pause, ended, and playback errors with one labelled control", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<MediaClipPreview clip={videoClip} />);

    const container = screen.getByTestId("clip-video-1");
    const media = within(container).getByLabelText("Video preview for Shibuya Crossing");
    const poster = videoClip.preview.status === "ready" && videoClip.preview.kind === "video"
      ? videoClip.preview.thumbnailUrl
      : undefined;
    expect(media).toHaveAttribute("poster", poster);
    expect(media).not.toHaveAttribute("autoplay");
    expect(media).not.toHaveAttribute("controls");

    fireEvent.click(within(container).getByRole("button", { name: "Play Shibuya Crossing" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(await within(container).findByRole("button", { name: "Pause Shibuya Crossing" })).toBeVisible();

    fireEvent.click(within(container).getByRole("button", { name: "Pause Shibuya Crossing" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(within(container).getByRole("button", { name: "Play Shibuya Crossing" })).toBeVisible();

    fireEvent.click(within(container).getByRole("button", { name: "Play Shibuya Crossing" }));
    await within(container).findByRole("button", { name: "Pause Shibuya Crossing" });
    fireEvent.ended(media);
    expect(within(container).getByRole("button", { name: "Play Shibuya Crossing" })).toBeVisible();

    play.mockRejectedValueOnce(new Error("decoder unavailable"));
    fireEvent.click(within(container).getByRole("button", { name: "Play Shibuya Crossing" }));
    expect(await within(container).findByRole("alert")).toHaveTextContent(/could not play shibuya crossing/i);
  });

  it("renders playable audio with the backend waveform and handles media errors", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<MediaClipPreview clip={audioClip} />);

    const container = screen.getByTestId("clip-audio-1");
    expect(within(container).getByRole("img", { name: "Waveform for Vintage Tokyo Master" })).toHaveAttribute(
      "src",
      "/api/projects/vintage-tokyo/media/media-audio-1/waveform",
    );
    expect(within(container).getByLabelText("Audio preview for Vintage Tokyo Master")).not.toHaveAttribute("controls");
    fireEvent.click(within(container).getByRole("button", { name: "Play Vintage Tokyo Master" }));
    expect(await within(container).findByRole("button", { name: "Pause Vintage Tokyo Master" })).toBeVisible();

    fireEvent.error(within(container).getByLabelText("Audio preview for Vintage Tokyo Master"));
    expect(within(container).getByRole("alert")).toHaveTextContent(/audio preview.*unavailable/i);
  });
});

describe("ClipGroups", () => {
  it("groups clips in accessible disclosures and keeps unsupported and missing clips explicit", () => {
    const groups: ResolvePreviewClipGroup[] = [
      { type: "video", clips: [videoClip] },
      { type: "audio", clips: [audioClip] },
      {
        type: "unsupported",
        clips: [{
          id: "unsupported-1",
          label: "Adjustment layer",
          startFrame: 45,
          endFrame: 60,
          preview: { status: "missing", reason: "Adjustment layers cannot be previewed before export." },
        }],
      },
    ];

    render(<ClipGroups groups={groups} />);

    expect(screen.getByRole("button", { name: "Video, 1 clip" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Audio, 1 clip" })).toHaveAttribute("aria-expanded", "true");
    const unsupported = screen.getByRole("button", { name: "Unsupported, 1 clip" });
    expect(unsupported).toHaveAttribute("aria-controls", "resolve-clip-group-unsupported");
    expect(screen.getByText("Adjustment layers cannot be previewed before export.")).toBeVisible();

    unsupported.focus();
    fireEvent.click(unsupported);
    expect(unsupported).toHaveFocus();
    expect(unsupported).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Adjustment layers cannot be previewed before export.")).not.toBeInTheDocument();
    fireEvent.click(unsupported);
    expect(unsupported).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MiniTimeline", () => {
  it("renders track index order, exact gaps, and accessible frame equivalents", () => {
    const timeline: ResolvePreviewMiniTimeline = {
      durationFrames: 100,
      tracks: [
        { id: "audio-track", index: 1, type: "audio", clips: [{ id: "audio", label: "Score", startFrame: 50, endFrame: 100 }] },
        { id: "video-track", index: 0, type: "video", clips: [{ id: "video", label: "Opening", startFrame: 10, endFrame: 40 }] },
      ],
    };

    render(<MiniTimeline timeline={timeline} />);

    const tracks = screen.getAllByTestId(/^mini-timeline-track-/);
    expect(tracks.map((track) => track.getAttribute("data-track-index"))).toEqual(["0", "1"]);
    expect(screen.getByTestId("mini-timeline-clip-video")).toHaveStyle({ left: "10%", width: "30%" });
    expect(screen.getByTestId("mini-timeline-clip-audio")).toHaveStyle({ left: "50%", width: "50%" });
    expect(screen.getByText("Opening, frames 10 to 40")).toBeVisible();
    expect(screen.getByText("Score, frames 50 to 100")).toBeVisible();
  });

  it("bounds overflow math and explains a zero-duration timeline without NaN or Infinity", () => {
    const overflow: ResolvePreviewMiniTimeline = {
      durationFrames: 100,
      tracks: [{
        id: "video-track",
        index: 0,
        type: "video",
        clips: [
          { id: "partial", label: "Partial", startFrame: 90, endFrame: 130 },
          { id: "outside", label: "Outside", startFrame: 130, endFrame: 150 },
        ],
      }],
    };
    const { rerender } = render(<MiniTimeline timeline={overflow} />);

    expect(screen.getByTestId("mini-timeline-clip-partial")).toHaveStyle({ left: "90%", width: "10%" });
    expect(screen.getByTestId("mini-timeline-clip-outside")).toHaveStyle({ left: "100%", width: "0%" });
    expect(document.body.innerHTML).not.toMatch(/NaN|Infinity/);

    rerender(<MiniTimeline timeline={{ durationFrames: 0, tracks: overflow.tracks }} />);
    expect(screen.getByText("This project has no timeline duration to preview.")).toBeVisible();
    expect(document.body.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
