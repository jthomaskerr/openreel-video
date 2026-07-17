import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExportProgressOverlay } from "./ExportProgressOverlay";
import type { ExportUIState } from "../../stores/ui-store";

const warmingState: ExportUIState = {
  isExporting: true,
  progress: 25,
  phase: "rendering...",
  estimatedTimeRemaining: null,
  framesPerSecond: null,
  estimateConfidence: "warming-up",
  backgroundDegraded: false,
};

const observedState: ExportUIState = {
  ...warmingState,
  estimateConfidence: "observed",
  estimatedTimeRemaining: 125,
  framesPerSecond: 28.4,
};

describe("ExportProgressOverlay", () => {
  it("shows measurement state before observed throughput", () => {
    render(<ExportProgressOverlay state={warmingState} />);
    expect(screen.getByText("Measuring export speed…")).toBeVisible();
  });

  it("shows live remaining time and fps", () => {
    render(<ExportProgressOverlay state={observedState} />);
    expect(screen.getByText("About 2m 5s remaining")).toBeVisible();
    expect(screen.getByText("28.4 fps")).toBeVisible();
  });

  it("shows and clears an actionable background warning", () => {
    const { rerender } = render(
      <ExportProgressOverlay state={{ ...observedState, backgroundDegraded: true }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Foregrounding the editor may speed it up",
    );

    rerender(<ExportProgressOverlay state={observedState} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
