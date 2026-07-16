import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimelineEmptySpaceMenu } from "./TimelineEmptySpaceMenu";

describe("TimelineEmptySpaceMenu", () => {
  it("opens a fresh viewport-positioned new-track menu from empty lane space", async () => {
    render(<TimelineEmptySpaceMenu trackId="video-1" />);

    fireEvent.contextMenu(screen.getByTestId("timeline-empty-space-video-1"), {
      clientX: 412,
      clientY: 268,
    });

    const label = await screen.findByText("New Track");
    const content = label.closest("[role=menu]");
    expect(content).not.toBeNull();
    expect(content).toHaveAttribute("data-timeline-context-client-x", "412");
    expect(content).toHaveAttribute("data-timeline-context-client-y", "268");
    expect(screen.getByText("Video Track")).toBeInTheDocument();
    expect(screen.getByText("Audio Track")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("New Track")).not.toBeInTheDocument());
  });
});
