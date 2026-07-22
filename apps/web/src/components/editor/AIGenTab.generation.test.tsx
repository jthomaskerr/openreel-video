import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./generate/GenerateAssetDialog", () => ({
  GenerateAssetDialog: ({
    open,
    onClose,
    clipId,
  }: {
    open: boolean;
    onClose: () => void;
    clipId?: string;
  }) => open ? (
    <div data-testid="generate-dialog" data-clip-id={clipId ?? "new-asset"}>
      <button type="button" onClick={onClose}>Close dialog</button>
    </div>
  ) : null,
}));
vi.mock("./generate/JobManagementPanel", () => ({ JobManagementPanel: () => null }));
vi.mock("./inspector/AutoCaptionPanel", () => ({ AutoCaptionPanel: () => null }));
vi.mock("./inspector/TextToSpeechPanel", () => ({ TextToSpeechPanel: () => null }));
vi.mock("./inspector/FilterPresetsPanel", () => ({ FilterPresetsPanel: () => null }));
vi.mock("./inspector/MusicLibraryPanel", () => ({ MusicLibraryPanel: () => null }));
vi.mock("./inspector/TemplatesBrowserPanel", () => ({ TemplatesBrowserPanel: () => null }));
vi.mock("./inspector/MultiCameraPanel", () => ({ MultiCameraPanel: () => null }));

import { AIGenTab } from "./AIGenTab";

describe("AIGenTab generation dialog context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears a previous clip context when the new-asset feature card is opened", () => {
    render(<AIGenTab />);

    act(() => {
      window.dispatchEvent(new CustomEvent("openreel:open-generate-asset-dialog", {
        detail: { clipId: "clip-1" },
      }));
    });
    expect(screen.getByTestId("generate-dialog")).toHaveAttribute("data-clip-id", "clip-1");

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Image\/Video/ }));

    expect(screen.getByTestId("generate-dialog")).toHaveAttribute("data-clip-id", "new-asset");
  });
});
