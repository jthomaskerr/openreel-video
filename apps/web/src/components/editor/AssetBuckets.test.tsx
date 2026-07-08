import { cleanup, render, screen, within, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRef, type RefObject } from "react";
import type { MediaItem } from "@openreel/core";
import { AssetBuckets, type AssetBucketsHandle, type GroupBy } from "./AssetBuckets";

beforeEach(() => {
  window.scrollTo = () => undefined;
});

afterEach(cleanup);

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
      fileSize: 0
        },
    thumbnailUrl: null,
    ...overrides
        };
}

const Row = ({ item }: { item: MediaItem }) => (
  <div role="listitem" aria-label={item.name}>
    {item.name}
  </div>
);

function renderBuckets({
  items,
  groupBy,
  ref
        }: {
  items: MediaItem[];
  groupBy: GroupBy;
  ref?: RefObject<AssetBucketsHandle>;
}) {
  render(
    <AssetBuckets
      ref={ref}
      items={items}
      viewMode="list"
      searchQuery=""
      groupBy={groupBy}
      selectedItemIds={new Set()}
      MediaRow={Row}
    />,
  );
}

function bucketScope(label: RegExp | string) {
  const button = screen.getByRole("button", { name: label });
  const bucket = button.parentElement;
  if (!bucket) {
    throw new Error(`Expected bucket container for ${String(label)}`);
  }
  return within(bucket);
}

function bucketLabels() {
  return screen.getAllByRole("button").map((button) =>
    (button.textContent?.replace(/\s+/g, " ").trim() ?? "").replace(/^(.*?)(\d+)$/, "$1 $2").replace(/\s+/g, " ").trim(),
  );
}

function expectAbsent(name: string) {
  expect(screen.queryByRole("listitem", { name })).toBeNull();
}

describe("AssetBuckets grouping and controls", () => {
  it('renders a flat ungrouped list without bucket buttons when groupBy="none"', () => {
    renderBuckets({
      groupBy: "none",
      items: [
        media({ id: "video-1", name: "intro.mov", type: "video" }),
        media({ id: "image-1", name: "still.png", type: "image" }),
        media({ id: "audio-1", name: "dialog.wav", type: "audio" }),
      ]
        });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("listitem", { name: "intro.mov" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "still.png" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "dialog.wav" })).toBeInTheDocument();
  });

  it('keeps flat rows present when collapseAll and expandAll are called in groupBy="none" mode', async () => {
    const ref = createRef<AssetBucketsHandle>();

    renderBuckets({
      ref,
      groupBy: "none",
      items: [
        media({ id: "video-1", name: "intro.mov", type: "video" }),
        media({ id: "image-1", name: "still.png", type: "image" }),
      ]
        });

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("listitem", { name: "intro.mov" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "still.png" })).toBeInTheDocument();

    await act(async () => {
      ref.current?.collapseAll();
    });

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByRole("listitem", { name: "intro.mov" })).toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: "still.png" })).toBeInTheDocument();
    });

    await act(async () => {
      ref.current?.expandAll();
    });

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByRole("listitem", { name: "intro.mov" })).toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: "still.png" })).toBeInTheDocument();
    });
  });

  it('creates tagged buckets and an Untagged bucket when groupBy="tag"', () => {
    renderBuckets({
      groupBy: "tag",
      items: [
        media({ id: "untagged", name: "untagged shot", type: "image" }),
        media({ id: "alpha", name: "alpha shot", type: "image", tags: ["alpha"] }),
        media({ id: "shared", name: "shared shot", type: "image", tags: ["alpha", "beta"] }),
        media({ id: "beta", name: "beta shot", type: "image", tags: ["beta"] }),
      ]
        });

    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(bucketLabels()).toEqual(["Untagged 1", "#alpha 2", "#beta 2"]);
    expect(screen.getAllByRole("listitem", { name: "shared shot" })).toHaveLength(2);

    expect(bucketScope(/^Untagged 1$/).getByRole("listitem", { name: "untagged shot" })).toBeInTheDocument();
    expect(bucketScope(/^#alpha 2$/).getByRole("listitem", { name: "alpha shot" })).toBeInTheDocument();
    expect(bucketScope(/^#alpha 2$/).getByRole("listitem", { name: "shared shot" })).toBeInTheDocument();
    expect(bucketScope(/^#beta 2$/).getByRole("listitem", { name: "beta shot" })).toBeInTheDocument();
    expect(bucketScope(/^#beta 2$/).getByRole("listitem", { name: "shared shot" })).toBeInTheDocument();
  });

  it('creates Normal, Pending, Error, and Placeholder buckets when groupBy="status"', () => {
    renderBuckets({
      groupBy: "status",
      items: [
        media({ id: "normal", name: "normal clip", type: "video" }),
        media({ id: "pending", name: "pending clip", type: "video", generationMeta: { provider: "t", model: "t", status: "processing" } }),
        media({ id: "error", name: "error clip", type: "video", generationMeta: { provider: "t", model: "t", status: "failed" } }),
        media({ id: "placeholder", name: "placeholder clip", type: "video", blob: null, sourceFile: { name: "m.mp4", size: 0, lastModified: 0 } }),
      ]
        });

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(bucketLabels()).toEqual(["Normal 1", "Pending 1", "Error 1", "Placeholder 1"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    expect(bucketScope(/^Normal 1$/).getByRole("listitem", { name: "normal clip" })).toBeInTheDocument();
    expect(bucketScope(/^Pending 1$/).getByRole("listitem", { name: "pending clip" })).toBeInTheDocument();
    expect(bucketScope(/^Error 1$/).getByRole("listitem", { name: "error clip" })).toBeInTheDocument();
    expect(bucketScope(/^Placeholder 1$/).getByRole("listitem", { name: "placeholder clip" })).toBeInTheDocument();
  });

  it("collapseAll hides bucket contents and expandAll shows them again through the ref", async () => {
    const ref = createRef<AssetBucketsHandle>();

    renderBuckets({
      ref,
      groupBy: "status",
      items: [
        media({ id: "normal", name: "normal clip", type: "video" }),
        media({ id: "pending", name: "pending clip", type: "video", generationMeta: { provider: "t", model: "t", status: "processing" } }),
        media({ id: "error", name: "error clip", type: "video", generationMeta: { provider: "t", model: "t", status: "failed" } }),
        media({ id: "placeholder", name: "placeholder clip", type: "video", blob: null, sourceFile: { name: "m.mp4", size: 0, lastModified: 0 } }),
      ]
        });

    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    await act(async () => {
      ref.current?.collapseAll();
    });

    expect(bucketLabels()).toEqual(["Normal 1", "Pending 1", "Error 1", "Placeholder 1"]);
    await waitFor(() => {
      expectAbsent("normal clip");
      expectAbsent("pending clip");
      expectAbsent("error clip");
      expectAbsent("placeholder clip");
    });

    await act(async () => {
      ref.current?.expandAll();
    });

    expect(bucketLabels()).toEqual(["Normal 1", "Pending 1", "Error 1", "Placeholder 1"]);
    await waitFor(() => {
      expect(screen.getByRole("listitem", { name: "normal clip" })).toBeVisible();
      expect(screen.getByRole("listitem", { name: "pending clip" })).toBeVisible();
      expect(screen.getByRole("listitem", { name: "error clip" })).toBeVisible();
      expect(screen.getByRole("listitem", { name: "placeholder clip" })).toBeVisible();
    });
  });

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
        folder: JSON.stringify({ kind: "note", label: "Director note", color: "#94a3b8" })
        }
        });

    renderBuckets({
      groupBy: "type",
      items: [realImage, note]
        });

    expect(bucketScope(/^Images 1$/).getByRole("listitem", { name: "keyframe.png" })).toBeInTheDocument();
    expect(bucketScope(/^Images 1$/).queryByRole("listitem", { name: "note: Director note" })).toBeNull();
    expect(screen.getByRole("button", { name: /Notes 1/ })).toBeInTheDocument();
  });
});
