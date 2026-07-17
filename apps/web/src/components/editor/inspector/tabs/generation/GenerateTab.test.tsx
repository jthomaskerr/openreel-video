import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import GenerateTab from "./GenerateTab";
import { useGenerationDraftStore } from "../../../../../features/generation/drafts";
import { readReferenceEditorRouteFromModalData } from "../../../../../features/references/navigation";

const mockedProjectStore = vi.hoisted(() => ({
  state: {
    project: {
      timeline: { tracks: [] },
      generatedImageDefinitions: [],
    },
    getMediaItem: (_mediaId: string): MediaItem | undefined => undefined,
  },
}));

const mockedUIStore = vi.hoisted(() => {
  const state = {
    activeModal: null as string | null,
    modalData: null as Record<string, unknown> | null,
    inspectedAsset: null as unknown,
    inspectorSelection: null as unknown,
    referenceEditorInspectorRoute: null as unknown,
    sidebarTab: "inspector" as "inspector" | "edit",
  };

  return {
    state,
    openModal(modalId: string, data?: Record<string, unknown>) {
      state.activeModal = modalId;
      state.modalData = data ?? null;
    },
    closeModal() {
      state.activeModal = null;
      state.modalData = null;
    },
    clearSelection: vi.fn(),
    setInspectedAsset(asset: unknown) {
      state.inspectedAsset = asset;
      state.inspectorSelection = null;
      state.referenceEditorInspectorRoute = null;
      if (asset) state.sidebarTab = "inspector";
    },
    setInspectorSelection(selection: unknown) {
      state.inspectedAsset = null;
      state.inspectorSelection = selection;
      state.referenceEditorInspectorRoute = null;
      if (selection) state.sidebarTab = "inspector";
    },
    setReferenceEditorInspectorRoute(route: unknown) {
      state.inspectedAsset = null;
      state.inspectorSelection = null;
      state.referenceEditorInspectorRoute = route;
      if (route) state.sidebarTab = "edit";
    },
    setSidebarTab(tab: "inspector" | "edit") {
      state.sidebarTab = tab;
    },
  };
});

vi.mock("../../../../../stores/project-store", () => {
  const useProjectStore = Object.assign(
    (selector?: (state: typeof mockedProjectStore.state) => unknown) =>
      selector ? selector(mockedProjectStore.state) : mockedProjectStore.state,
    {
      getState: () => mockedProjectStore.state,
    },
  );

  return { useProjectStore };
});

vi.mock("../../../../../stores/ui-store", () => {
  const useUIStore = Object.assign(
    (selector?: (state: typeof mockedUIStore) => unknown) =>
      selector ? selector(mockedUIStore as never) : mockedUIStore,
    {
      getState: () => mockedUIStore,
    },
  );

  return { useUIStore };
});

function image(
  id: string,
  overrides: Partial<Omit<MediaItem, "thumbnailUrl">> & {
    thumbnailUrl?: string | null;
  } = {},
): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 1024,
      height: 1024,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    ...overrides,
    thumbnailUrl: overrides.thumbnailUrl ?? null,
  };
}

describe("GenerateTab", () => {
  beforeEach(() => {
    useGenerationDraftStore.setState({ drafts: {} });
    mockedProjectStore.state = {
      project: {
        timeline: { tracks: [] },
        generatedImageDefinitions: [],
      },
      getMediaItem(mediaId: string) {
        return [image("media-imported-1", { title: "Mood board" })].find(
          (item) => item.id === mediaId,
        );
      },
    };
    mockedUIStore.state.activeModal = null;
    mockedUIStore.state.modalData = null;
    mockedUIStore.state.inspectedAsset = null;
    mockedUIStore.state.inspectorSelection = null;
    mockedUIStore.state.referenceEditorInspectorRoute = null;
    mockedUIStore.state.sidebarTab = "inspector";
    mockedUIStore.clearSelection.mockReset();
  });

  it("shows shot and asset contexts and filters incompatible models", () => {
    render(
      <GenerateTab
        context="shot"
        shotId="shot-1"
        projectId="project-1"
        models={[
          { id: "img", label: "Image", provider: "WaveSpeed", modes: ["image"] },
          { id: "vid", label: "Video", provider: "WaveSpeed", modes: ["video"] },
        ]}
        compatibleModelIds={["img"]}
        prompt="A portrait of @maya"
        references={[
          { id: "r1", label: "Maya", origins: ["character-primary", "user"] },
          { id: "r2", label: "Old ref", origins: ["source"], excluded: true },
        ]}
        timing={{ start: 3.25, end: 7.5, source: "timeline clip", reason: "timing comes from clip trim" }}
        audioReason="Audio is pulled from the linked clip because it fully covers the shot."
      />,
    );

    expect(screen.getByText("shot-aware generation")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Image/i })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Video/i })).toBeNull();
    expect(screen.getByText("@maya")).toHaveAttribute("aria-label", "Character mention 1: @maya");
    expect(screen.getByText("character-primary · user")).toBeTruthy();
    expect(screen.getByText("excluded")).toBeTruthy();
    expect(screen.getByText("timing comes from clip trim")).toBeTruthy();
    expect(screen.getByText(/Audio is pulled from the linked clip/)).toBeTruthy();
  });

  it("restores per-shot and new-asset drafts after selection changes", () => {
    useGenerationDraftStore.getState().saveDraft({ kind: "shot", shotId: "shot-2" }, { prompt: "restored prompt", modelId: "m" }, 10);
    useGenerationDraftStore.getState().saveDraft({ kind: "new-asset", draftId: "draft-1" }, { prompt: "asset prompt", modelId: "a" }, 11);

    const { rerender } = render(<GenerateTab shotId="shot-2" projectId="project-1" models={[{ id: "m", label: "Model" }]} />);
    expect(screen.getByDisplayValue("restored prompt")).toBeTruthy();

    rerender(<GenerateTab draftId="draft-1" projectId="project-1" models={[{ id: "a", label: "Asset" }]} />);
    expect(screen.getByDisplayValue("asset prompt")).toBeTruthy();
  });

  it("preserves compatible values on model switch and resets the visible selection list", () => {
    const onModelChange = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[
          { id: "m1", label: "Model 1" },
          { id: "m2", label: "Model 2" },
        ]}
        modelId="m1"
        prompt="Hello"
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByTestId("model-option-m2"));
    expect(onModelChange).toHaveBeenCalledWith("m2");
    expect(screen.getByDisplayValue("Hello")).toBeTruthy();
  });

  it("focuses the first invalid field and announces the error summary", () => {
    render(<GenerateTab projectId="project-1" models={[{ id: "m", label: "Model" }]} promptErrors={{ prompt: "Prompt is required" }} />);
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(screen.getByRole("alert")).toHaveTextContent("Fix the highlighted fields");
    expect(screen.getByLabelText("Prompt")).toHaveFocus();
  });

  it("prevents duplicate submit and exposes recovery actions in the job card", () => {
    const onSubmit = vi.fn();
    const onRetry = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[{ id: "m", label: "Model" }]}
        prompt="Generate this"
        onSubmit={onSubmit}
        job={{ id: "job-1", status: "failed", error: "save failed", message: "needs attention", progress: 20 }}
        onRetry={onRetry}
        onSaveRetry={vi.fn()}
        onPlacementRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByRole("button", { name: /Retry placement/i })).toBeTruthy();
  });

  it("supports roving focus with Home and End on the model list", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[
          { id: "m1", label: "First" },
          { id: "m2", label: "Second" },
          { id: "m3", label: "Third" },
        ]}
        modelId="m2"
      />,
    );

    const listbox = screen.getByRole("listbox", { name: /Generation models/i });
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "End" });
    expect(screen.getByTestId("model-option-m3")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "Home" });
    expect(screen.getByTestId("model-option-m1")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the narrow panel layout defensive", () => {
    render(<GenerateTab projectId="project-1" models={[{ id: "m", label: "Model" }]} />);
    expect(screen.getByTestId("generate-tab").className).toContain("min-w-0");
    expect(screen.getByTestId("generate-tab").className).toContain("overflow-x-hidden");
  });

  it("routes a reference card click to the modal and Shift-click to the inspector", () => {
    render(
      <GenerateTab
        context="shot"
        shotId="shot-1"
        projectId="project-1"
        models={[{ id: "img", label: "Image" }]}
        references={[
          {
            id: "r1",
            label: "Mood board",
            origins: ["user"],
            target: { kind: "imported-image", mediaId: "media-imported-1" },
          } as any,
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Mood board/i });

    fireEvent.click(trigger);

    expect(mockedUIStore.state.activeModal).toBe("reference-editor");
    expect(mockedUIStore.state.referenceEditorInspectorRoute).toBeNull();
    expect(
      readReferenceEditorRouteFromModalData(mockedUIStore.state.modalData),
    ).toMatchObject({
      editor: "imported-image",
      mediaId: "media-imported-1",
    });

    mockedUIStore.closeModal();
    mockedUIStore.setReferenceEditorInspectorRoute(null);

    fireEvent.click(trigger, { shiftKey: true });

    expect(mockedUIStore.state.activeModal).toBeNull();
    expect(mockedUIStore.state.modalData).toBeNull();
    expect(mockedUIStore.state.referenceEditorInspectorRoute).toMatchObject({
      editor: "imported-image",
      mediaId: "media-imported-1",
    });
  });
});
