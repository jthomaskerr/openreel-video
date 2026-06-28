import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MediaItem } from "@openreel/core";
import { ReferenceImagePicker } from "./ReferenceImagePicker";

function media(id: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: { duration: 0, width: 16, height: 16, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 1 },
    thumbnailUrl: null,
    waveformData: null,
    ...overrides,
  };
}

describe("ReferenceImagePicker", () => {
  it("shows selected images as cards with thumbnails and names", () => {
    const onChange = vi.fn();
    render(
      <ReferenceImagePicker
        mediaItems={[
          media("img-1", { thumbnailUrl: "data:image/png,thumb1" }),
          media("img-2", { thumbnailUrl: "data:image/png,thumb2" }),
          media("vid-1", { type: "video" }),
        ]}
        selectedIds={["img-1", "img-2"]}
        onChange={onChange}
      />,
    );

    // Both image cards shown
    expect(screen.getByText("img-1.png")).toBeInTheDocument();
    expect(screen.getByText("img-2.png")).toBeInTheDocument();
    // Video not shown
    expect(screen.queryByText("vid-1.mp4")).not.toBeInTheDocument();
    // Count shown
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("removes a reference image when X is clicked", () => {
    const onChange = vi.fn();
    render(
      <ReferenceImagePicker
        mediaItems={[media("img-1")]}
        selectedIds={["img-1"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove img-1.png/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows empty state when no references selected", () => {
    render(
      <ReferenceImagePicker mediaItems={[]} selectedIds={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/no reference images selected/i)).toBeInTheDocument();
  });

  it("uploads images and accepts image files", () => {
    const onUpload = vi.fn();
    const { container } = render(
      <ReferenceImagePicker mediaItems={[]} selectedIds={[]} onChange={vi.fn()} onUpload={onUpload} />,
    );

    // Open add dropdown
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    // Find the hidden file input
    const fileInputs = container.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThan(0);
    const file = new File(["image"], "ref.png", { type: "image/png" });
    fireEvent.change(fileInputs[0], { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("adds an image from library and fires onChange", () => {
    const onChange = vi.fn();
    render(
      <ReferenceImagePicker
        mediaItems={[media("img-1"), media("img-2")]}
        selectedIds={["img-1"]}
        onChange={onChange}
      />,
    );

    // Open add dropdown
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    // Click "img-2" from the library list
    fireEvent.click(screen.getByText("img-2.png"));
    expect(onChange).toHaveBeenCalledWith(["img-1", "img-2"]);
  });

  it("calls onRequestGenerate when Generate is clicked", () => {
    const onGenerate = vi.fn();
    render(
      <ReferenceImagePicker
        mediaItems={[]}
        selectedIds={[]}
        onChange={vi.fn()}
        onRequestGenerate={onGenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByText(/generate new/i));
    expect(onGenerate).toHaveBeenCalled();
  });
});
