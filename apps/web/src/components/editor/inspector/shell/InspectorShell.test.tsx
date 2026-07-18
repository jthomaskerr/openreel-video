import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorClipHeader } from "./InspectorClipHeader";
import { InspectorTabPanel } from "./InspectorTabPanel";

describe("InspectorClipHeader", () => {
  it("renders name, duration and type", () => {
    render(<InspectorClipHeader name="Scenic Clip" durationSeconds={15} typeLabel="video" />);
    expect(screen.getByText("Scenic Clip")).toBeInTheDocument();
    expect(screen.getByText("15.00s")).toBeInTheDocument();
    expect(screen.getByText("video")).toBeInTheDocument();
  });
});

describe("InspectorTabPanel", () => {
  it("renders children only when active matches tab", () => {
    const { rerender } = render(
      <InspectorTabPanel tab="color" active="transform">body</InspectorTabPanel>,
    );
    expect(screen.queryByText("body")).toBeNull();
    const hiddenPanel = screen.getByRole("tabpanel", { hidden: true });
    expect(hiddenPanel).toHaveAttribute("id", "inspector-panel-color");
    expect(hiddenPanel).toHaveAttribute("hidden");
    rerender(<InspectorTabPanel tab="color" active="color">body</InspectorTabPanel>);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("body");
    expect(panel).toHaveAttribute("id", "inspector-panel-color");
    expect(panel).toHaveAttribute("aria-labelledby", "inspector-tab-color");
  });
});
