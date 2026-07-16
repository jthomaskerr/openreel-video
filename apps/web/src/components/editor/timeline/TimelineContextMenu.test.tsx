import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  captureTimelineContextMenuInvocation,
  TimelineContextMenu,
  TimelineContextMenuContent,
} from "./TimelineContextMenu";

describe("captureTimelineContextMenuInvocation", () => {
  it("captures viewport coordinates without applying timeline scroll or zoom", () => {
    const event = {
      clientX: 713,
      clientY: 241,
      pageX: 1713,
      pageY: 1241,
      offsetX: 87,
      offsetY: 19,
    };

    expect(captureTimelineContextMenuInvocation(event, 4)).toEqual({
      clientX: 713,
      clientY: 241,
      sequence: 4,
    });
  });
});

describe("TimelineContextMenu", () => {
  it("replaces stale coordinates when dismissed and reopened", async () => {
    render(
      <TimelineContextMenu trigger={<button type="button">Timeline target</button>}>
        <TimelineContextMenuContent>Timeline actions</TimelineContextMenuContent>
      </TimelineContextMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Timeline target" });
    fireEvent.contextMenu(trigger, { clientX: 120, clientY: 160 });

    let menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("data-timeline-context-client-x", "120");
    expect(menu).toHaveAttribute("data-timeline-context-client-y", "160");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.contextMenu(trigger, { clientX: 884, clientY: 612 });
    menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("data-timeline-context-client-x", "884");
    expect(menu).toHaveAttribute("data-timeline-context-client-y", "612");
  });

  it("configures viewport collision clamping for edge invocations", async () => {
    render(
      <TimelineContextMenu trigger={<button type="button">Edge target</button>}>
        <TimelineContextMenuContent>Edge actions</TimelineContextMenuContent>
      </TimelineContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Edge target" }), {
      clientX: window.innerWidth - 1,
      clientY: window.innerHeight - 1,
    });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute(
      "data-timeline-context-client-x",
      String(window.innerWidth - 1),
    );
    expect(menu).toHaveAttribute(
      "data-timeline-context-client-y",
      String(window.innerHeight - 1),
    );
    expect(menu).toHaveAttribute("data-timeline-context-collision-padding", "8");
  });
});
