import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGeneratedImage: vi.fn(),
  convertImportedImage: vi.fn(),
  updateGeneratedImageDraft: vi.fn(),
}));

vi.mock("../../../stores/project-store", () => {
  const state = {
    project: {
      id: "project-1",
      generatedImageDefinitions: [],
      mediaLibrary: { items: [] },
      timeline: { tracks: [] },
    },
    createGeneratedImage: mocks.createGeneratedImage,
    convertImportedImage: mocks.convertImportedImage,
    updateGeneratedImageDraft: mocks.updateGeneratedImageDraft,
  };
  return {
    useProjectStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

vi.mock("./ProjectGeneratedImageEditor", () => ({
  ProjectGeneratedImageEditor: ({ definitionId, placement }: { definitionId: string; placement: string }) => (
    <div data-testid="project-generated-image-editor" data-definition-id={definitionId} data-placement={placement} />
  ),
}));

import { GenerateAssetDialog } from "./GenerateAssetDialog";

describe("GenerateAssetDialog compatibility shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGeneratedImage.mockResolvedValue({
      success: true,
      definitionId: "definition-new",
      mediaId: "media-new",
    });
    mocks.updateGeneratedImageDraft.mockResolvedValue({ success: true });
  });

  it("creates one definition and renders the shared modal editor", async () => {
    const { rerender } = render(
      <GenerateAssetDialog open onClose={vi.fn()} shot={{ prompt: "Rainy neon street" } as never} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Preparing image editor");
    expect(await screen.findByTestId("project-generated-image-editor")).toHaveAttribute(
      "data-definition-id",
      "definition-new",
    );
    expect(screen.getByTestId("project-generated-image-editor")).toHaveAttribute(
      "data-placement",
      "modal",
    );
    expect(mocks.createGeneratedImage).toHaveBeenCalledTimes(1);
    expect(mocks.updateGeneratedImageDraft).toHaveBeenCalledWith({
      definitionId: "definition-new",
      patch: { prompt: "Rainy neon street" },
    });

    rerender(<GenerateAssetDialog open onClose={vi.fn()} shot={{ prompt: "Rainy neon street" } as never} />);
    await waitFor(() => expect(mocks.createGeneratedImage).toHaveBeenCalledTimes(1));
  });

  it("reuses an existing definition instead of creating a second placeholder", async () => {
    render(<GenerateAssetDialog open onClose={vi.fn()} definitionId="definition-existing" />);

    expect(await screen.findByTestId("project-generated-image-editor")).toHaveAttribute(
      "data-definition-id",
      "definition-existing",
    );
    expect(mocks.createGeneratedImage).not.toHaveBeenCalled();
  });

  it("does not create duplicate definitions when launch context changes during preparation", async () => {
    let resolveCreation!: (value: {
      success: true;
      definitionId: string;
      mediaId: string;
    }) => void;
    mocks.createGeneratedImage.mockReturnValue(
      new Promise((resolve) => {
        resolveCreation = resolve;
      }),
    );
    const { rerender } = render(
      <GenerateAssetDialog open onClose={vi.fn()} shot={{ prompt: "First prompt" } as never} />,
    );

    rerender(
      <GenerateAssetDialog open onClose={vi.fn()} shot={{ prompt: "Updated prompt" } as never} />,
    );
    expect(mocks.createGeneratedImage).toHaveBeenCalledTimes(1);

    resolveCreation({ success: true, definitionId: "definition-new", mediaId: "media-new" });
    expect(await screen.findByTestId("project-generated-image-editor")).toHaveAttribute(
      "data-definition-id",
      "definition-new",
    );
  });
});
