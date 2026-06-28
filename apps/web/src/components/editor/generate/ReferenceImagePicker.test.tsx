import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MediaItem } from "@openreel/core";
import { ReferenceImagePicker } from "./ReferenceImagePicker";

function media(id: string, type: "image" | "video" = "image"): MediaItem {
  return {
    id,
    name: `${id}.${type === "image" ? "png" : "mp4"}`,
    type,
    fileHandle: null,
    blob: null,
    metadata: { duration: 0, width: 16, height: 16, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 1 },
    thumbnailUrl: null,
    waveformData: null,
  };
}

describe("ReferenceImagePicker", () => {
  it("lists only image media and toggles selection", () => {
    const onChange = vi.fn();
    render(
      <ReferenceImagePicker mediaItems={[media("image-1"), media("video-1", "video")]} selectedIds={[]} onChange={onChange} />,
    );

    expect(screen.getByText("image-1.png")).toBeInTheDocument();
    expect(screen.queryByText("video-1.mp4")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /select image-1.png/i }));
    expect(onChange).toHaveBeenCalledWith(["image-1"]);
  });

  it("uploads reference images", () => {
    const onUpload = vi.fn();
    const { container } = render(
      <ReferenceImagePicker mediaItems={[]} selectedIds={[]} onChange={vi.fn()} onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "ref.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onUpload).toHaveBeenCalledWith(file);
  });
});
