import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GenerateTab from "./GenerateTab";
import { useGenerationDraftStore } from "../../../../../features/generation/drafts";

describe("GenerateTab", () => {
  beforeEach(() => { useGenerationDraftStore.setState({ drafts: {} }); });
  it("filters incompatible models and renders reference origins and token pills", () => {
    render(<GenerateTab shotId="s1" models={[{ id: "img", label: "Image", modes: ["image"] }, { id: "vid", label: "Video", modes: ["video"] }]} compatibleModelIds={["img"]} prompt="A portrait of @maya" references={[{ id: "r1", label: "Maya", origins: ["character-primary", "user"] }]} />);
    expect(screen.getByRole("option", { name: "Image" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Video" })).toBeNull();
    expect(screen.getByText("@maya")).toBeTruthy();
    expect(screen.getByText("character-primary · user")).toBeTruthy();
  });
  it("restores a per-shot draft and prevents duplicate submit", async () => {
    const onSubmit = vi.fn();
    useGenerationDraftStore.getState().saveDraft("shot:s2", { prompt: "restored prompt", modelId: "m" }, 10);
    render(<GenerateTab shotId="s2" models={[{ id: "m", label: "Model" }]} onSubmit={onSubmit} />);
    expect(screen.getByDisplayValue("restored prompt")).toBeTruthy();
    fireEvent.submit(screen.getByTestId("generate-tab"));
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it("focuses prompt and announces failures", () => {
    render(<GenerateTab models={[{ id: "m", label: "Model" }]} promptErrors={{ prompt: "Prompt is required" }} />);
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(screen.getByRole("alert")).toHaveTextContent("Prompt is required");
    expect(screen.getByLabelText("Prompt")).toHaveFocus();
  });
});
