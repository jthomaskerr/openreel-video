import "../../../test/install-local-storage-mock";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@openreel/ui";
import type { MediaItem } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { mediaAvailabilityRuntime } from "../../../services/media-verification";
import { AssetInspectorWithTabs } from "./AssetInspectorWithTabs";

function mediaFixture(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "resolve-media-1",
    name: "resolve-reference.mov",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 8,
      width: 1920,
      height: 1080,
      frameRate: 24,
      codec: "prores",
      sampleRate: 48000,
      channels: 2,
      fileSize: 1024,
    },
    thumbnailUrl: null,
    ...overrides,
  };
}

function renderInspector(item: MediaItem) {
  const project = createEmptyProject("Resolve reference test");
  useProjectStore.setState({
    project: { ...project, mediaLibrary: { items: [item] } },
  });

  return render(
    <TooltipProvider delayDuration={0}>
      <AssetInspectorWithTabs item={item} />
    </TooltipProvider>,
  );
}

describe("AssetInspectorWithTabs external media protection", () => {
  beforeEach(() => {
    vi.spyOn(mediaAvailabilityRuntime, "get").mockImplementation(
      (_projectId, mediaId) => ({
        mediaId,
        status: "available",
        evidence: {
          authoritative: true,
          mapping: "present",
          object: "present",
        },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    useProjectStore.getState().loadProject(createEmptyProject("Reset"));
    useUIStore.getState().setInspectedAsset(null);
    vi.restoreAllMocks();
  });

  it("explains why Resolve-referenced media cannot be deleted without disabling edits", async () => {
    const item = mediaFixture({ externallyReferenced: true });
    renderInspector(item);

    const deleteButton = screen.getByRole("button", { name: /delete asset/i });
    expect(deleteButton).toBeDisabled();
    expect(
      screen.getByText(/referenced by an external Resolve project/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^replace$/i })).toBeEnabled();
    expect(screen.getByPlaceholderText("Add a description...")).toBeEnabled();

    fireEvent.focus(deleteButton.parentElement ?? deleteButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /referenced by an external Resolve project/i,
    );
  });

  it("keeps deletion available for media that is not externally referenced", () => {
    renderInspector(mediaFixture({ externallyReferenced: false }));

    expect(
      screen.getByRole("button", { name: /delete asset/i }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/referenced by an external Resolve project/i),
    ).toBeNull();
  });
});
