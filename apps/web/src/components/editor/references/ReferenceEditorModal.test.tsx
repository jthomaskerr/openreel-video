import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";

import {
  rememberReferenceInvoker,
  type ReferenceEditorRoute,
} from "../../../features/references/navigation";
import { ReferenceEditorModal } from "./ReferenceEditorModal";

let projectState: {
  project: {
    timeline: {
      tracks: Array<{
        id: string;
        clips: Array<{
          id: string;
          type?: string;
          metadata?: Record<string, unknown>;
        }>;
      }>;
    };
    generatedImageDefinitions: Array<{
      id: string;
      currentMediaVersionId?: string | null;
    }>;
  };
  getMediaItem: (mediaId: string) => MediaItem | undefined;
};

vi.mock("../../../stores/project-store", () => ({
  useProjectStore: (selector?: (state: typeof projectState) => unknown) =>
    selector ? selector(projectState) : projectState,
}));

vi.mock("../inspector/AssetInspectorWithTabs", () => ({
  AssetInspectorWithTabs: ({ item }: { item: MediaItem }) => (
    <div data-testid="asset-inspector-route">{item.id}</div>
  ),
}));

vi.mock("../inspector/CharacterMetadataInspector", () => ({
  CharacterMetadataInspector: ({ clip }: { clip: { id: string } }) => (
    <div data-testid="character-inspector-route">{clip.id}</div>
  ),
}));

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

function route(editor: ReferenceEditorRoute["editor"]): ReferenceEditorRoute {
  switch (editor) {
    case "character":
      return {
        editor: "character",
        title: "Character editor",
        target: { kind: "character", id: "character-1" },
        characterId: "character-1",
        clipId: "clip-character-1",
        trackId: "track-1",
      };
    case "generated-image":
      return {
        editor: "generated-image",
        title: "Generated image editor",
        target: { kind: "generated-image", definitionId: "definition-1" },
        definitionId: "definition-1",
        mediaId: "media-generated-1",
      };
    case "imported-image":
      return {
        editor: "imported-image",
        title: "Image inspector",
        target: { kind: "imported-image", mediaId: "media-imported-1" },
        mediaId: "media-imported-1",
      };
    case "missing":
      return {
        editor: "missing",
        title: "Reference unavailable",
        target: { kind: "missing", token: "@{character:character-1}" },
        issue: {
          code: "UNRESOLVED_REFERENCE",
          message: "The referenced item is no longer available.",
          details: {
            token: "@{character:character-1}",
          },
        },
      };
  }
}

function ModalHarness({ route: currentRoute }: { route: ReferenceEditorRoute }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button" data-testid="reference-trigger">
        Open reference
      </button>
      <ReferenceEditorModal
        open={open}
        route={currentRoute}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe("ReferenceEditorModal", () => {
  beforeEach(() => {
    projectState = {
      project: {
        timeline: {
          tracks: [
            {
              id: "track-1",
              clips: [
                {
                  id: "clip-character-1",
                  type: "metadata",
                  metadata: {
                    kind: "character",
                    characterId: "character-1",
                  },
                },
              ],
            },
          ],
        },
        generatedImageDefinitions: [
          {
            id: "definition-1",
            currentMediaVersionId: "media-generated-1",
          },
        ],
      },
      getMediaItem(mediaId: string) {
        return [
          image("media-imported-1", { title: "Mood board" }),
          image("media-generated-1", { title: "Generated still" }),
        ].find((item) => item.id === mediaId);
      },
    };
  });

  it("renders the character editor for character routes", () => {
    render(
      <ReferenceEditorModal
        open
        route={route("character")}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Character editor" })).toBeInTheDocument();
    expect(screen.getByTestId("character-inspector-route")).toHaveTextContent(
      "clip-character-1",
    );
  });

  it("renders the asset inspector for imported and generated image routes", () => {
    const { rerender } = render(
      <ReferenceEditorModal
        open
        route={route("imported-image")}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Image inspector" })).toBeInTheDocument();
    expect(screen.getByTestId("asset-inspector-route")).toHaveTextContent(
      "media-imported-1",
    );

    rerender(
      <ReferenceEditorModal
        open
        route={route("generated-image")}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Generated image editor" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("asset-inspector-route")).toHaveTextContent(
      "media-generated-1",
    );
  });

  it("shows structured recovery when the target disappears between open and render", () => {
    projectState.getMediaItem = () => undefined;

    render(
      <ReferenceEditorModal
        open
        route={route("imported-image")}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Reference unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("MEDIA_NOT_FOUND");
    expect(screen.getByText("media-imported-1")).toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the invoking trigger", async () => {
    render(<ModalHarness route={route("character")} />);

    const trigger = screen.getByTestId("reference-trigger");
    trigger.focus();
    rememberReferenceInvoker(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});
