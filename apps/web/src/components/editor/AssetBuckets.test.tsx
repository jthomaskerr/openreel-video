import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";
import { AssetBuckets } from "./AssetBuckets";

function media(overrides: Partial<MediaItem> & Pick<MediaItem, "id" | "name" | "type">): MediaItem {
  return {
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 0,
      height: 0,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 0,
    },
    thumbnailUrl: null,
    waveformData: null,
    ...overrides,
  };
}

const Row = ({ item }: { item: MediaItem }) => <div>{item.name}</div>;

describe("AssetBuckets semantic filtering", () => {
  it("keeps metadata-backed clips out of the Images bucket", () => {
    const realImage = media({ id: "image-1", name: "keyframe.png", type: "image" });
    const note = media({
      id: "note-1",
      name: "note: Director note",
      type: "image",
      sourceFile: {
        name: "note: Director note",
        size: 68,
        lastModified: 1,
        folder: JSON.stringify({ kind: "note", label: "Director note", color: "#94a3b8" }),
      },
    });

    render(
      <AssetBuckets
        items={[realImage, note]}
        viewMode="list"
        searchQuery=""
        selectedItemIds={new Set()}
        onAddMedia={() => undefined}
        MediaRow={Row}
      />,
    );

    const imagesHeader = screen.getByRole("button", { name: /Images 1/ });
    const imagesSection = imagesHeader.closest("div")!;
    expect(within(imagesSection).getByText("keyframe.png")).toBeInTheDocument();
    expect(within(imagesSection).queryByText("note: Director note")).toBeNull();
    expect(screen.getByRole("button", { name: /Notes 1/ })).toBeInTheDocument();
  });
});
