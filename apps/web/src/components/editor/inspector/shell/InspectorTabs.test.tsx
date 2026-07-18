import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InspectorTabs } from "./InspectorTabs";
import { InspectorTabPanel } from "./InspectorTabPanel";
import { getTabsForClipType, type InspectorTabId } from "../clip-tabs.config";

vi.mock("@openreel/ui/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}));

describe("InspectorTabs", () => {
  const tabs = getTabsForClipType("video");

  it("renders a tab button per def", () => {
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(tabs.length);
  });

  it("marks the active tab aria-selected", () => {
    render(<InspectorTabs tabs={tabs} activeId="color" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: /Color/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Transform/ })).toHaveAttribute("aria-selected", "false");
  });

  it("exposes stable tab and panel relationships with one roving tab stop", () => {
    render(
      <>
        <InspectorTabs tabs={tabs} activeId="color" onSelect={() => {}} />
        {tabs.map((tab) => (
          <InspectorTabPanel key={tab.id} tab={tab.id} active="color">
            {tab.label} panel
          </InspectorTabPanel>
        ))}
      </>,
    );

    const renderedTabs = screen.getAllByRole("tab");
    expect(new Set(renderedTabs.map((tab) => tab.id)).size).toBe(renderedTabs.length);
    renderedTabs.forEach((tab) => {
      expect(tab.id).toMatch(/^inspector-tab-/);
      expect(tab).toHaveAttribute("aria-controls", tab.id.replace("inspector-tab-", "inspector-panel-"));
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    });
    expect(renderedTabs.filter((tab) => tab.tabIndex === 0)).toEqual([
      screen.getByRole("tab", { name: /Color/ }),
    ]);
  });

  it("calls onSelect with the tab id on click", () => {
    const onSelect = vi.fn();
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: /Effects/ }));
    expect(onSelect).toHaveBeenCalledWith("effects");
  });

  it("moves selection and DOM focus with Arrow, Home, and End keys", () => {
    function Harness() {
      const [activeId, setActiveId] = useState<InspectorTabId>("transform");
      return <InspectorTabs tabs={tabs} activeId={activeId} onSelect={setActiveId} />;
    }

    render(<Harness />);
    const transform = screen.getByRole("tab", { name: /Transform/ });
    transform.focus();

    fireEvent.keyDown(transform, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Color/ })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /Color/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: /Color/ }), { key: "ArrowLeft" });
    expect(transform).toHaveFocus();

    fireEvent.keyDown(transform, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /Generate/ })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: /Generate/ }), { key: "Home" });
    expect(transform).toHaveFocus();

    fireEvent.keyDown(transform, { key: "End" });
    expect(screen.getByRole("tab", { name: /Generate/ })).toHaveFocus();
    expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it("gives every tab a visible-focus, reduced-motion, and 44px target contract", () => {
    render(<InspectorTabs tabs={tabs} activeId="transform" onSelect={() => {}} />);

    expect(screen.getByRole("tablist", { name: "Inspector tabs" })).toHaveClass("max-w-full", "min-w-0");
    screen.getAllByRole("tab").forEach((tab) => {
      expect(tab).toHaveClass(
        "min-h-11",
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "motion-reduce:transition-none",
      );
    });
  });
});
