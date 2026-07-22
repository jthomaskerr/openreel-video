import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  getLoopMarkerPercentages,
  PreviewTransportControls,
} from "./PreviewTransportControls";

function makeProps(overrides: Partial<React.ComponentProps<typeof PreviewTransportControls>> = {}) {
  return {
    playheadPosition: 3,
    duration: 12,
    revertToPlaybackStartOnStop: false,
    onRevertToPlaybackStartOnStopChange: vi.fn(),
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 0,
    onLoopEnabledChange: vi.fn(),
    onSetLoopStart: vi.fn(),
    onSetLoopEnd: vi.fn(),
    playbackRate: 1,
    onPlaybackRateChange: vi.fn(),
    ...overrides,
  };
}

describe("PreviewTransportControls", () => {
  it("updates the persisted rewind-on-stop preference", () => {
    const props = makeProps();
    render(<PreviewTransportControls {...props} />);

    fireEvent.click(screen.getByRole("switch", {
      name: "Revert to begin on stop",
    }));

    expect(props.onRevertToPlaybackStartOnStopChange).toHaveBeenCalledWith(true);
  });

  it("sets A and B from the current playhead", () => {
    const props = makeProps({ playheadPosition: 5.25 });
    render(<PreviewTransportControls {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Set loop start at playhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Set loop end at playhead" }));

    expect(props.onSetLoopStart).toHaveBeenCalledWith(5.25);
    expect(props.onSetLoopEnd).toHaveBeenCalledWith(5.25);
  });

  it("only enables looping for a valid A-B range", () => {
    const invalid = makeProps();
    const { rerender } = render(<PreviewTransportControls {...invalid} />);

    expect(screen.getByRole("button", { name: "Enable A-B loop" })).toBeDisabled();

    const valid = makeProps({ loopStart: 2, loopEnd: 6 });
    rerender(<PreviewTransportControls {...valid} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable A-B loop" }));

    expect(valid.onLoopEnabledChange).toHaveBeenCalledWith(true);
  });

  it("exposes and updates the full playback-rate range", () => {
    const props = makeProps();
    render(<PreviewTransportControls {...props} />);

    const slider = screen.getByRole("slider", { name: "Playback speed" });
    expect(slider).toHaveAttribute("min", "0.1");
    expect(slider).toHaveAttribute("max", "4");
    fireEvent.change(slider, { target: { value: "1.5" } });

    expect(props.onPlaybackRateChange).toHaveBeenCalledWith(1.5);
    expect(screen.getByText("1.0x")).toBeInTheDocument();
  });

  it("calculates scrub-bar marker positions", () => {
    const markers = getLoopMarkerPercentages(2, 6, 12);
    expect(markers?.start).toBeCloseTo(100 / 6);
    expect(markers?.end).toBe(50);
    expect(getLoopMarkerPercentages(2, 6, 0)).toBeNull();
  });
});
