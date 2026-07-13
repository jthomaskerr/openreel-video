import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { createMediaImageBitmap } from "./media-image-source";

function imageItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "image-1",
    name: "image.png",
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 5,
      width: 1920,
      height: 1080,
      frameRate: 0,
      codec: "png",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    thumbnailUrl: null,
    ...overrides,
  };
}

describe("createMediaImageBitmap", () => {
  it("decodes a freshly imported image Blob without fetching", async () => {
    const blob = new Blob(["pixels"], { type: "image/png" });
    const bitmap = {} as ImageBitmap;
    const fetchMedia = vi.fn();
    const createBitmap = vi.fn().mockResolvedValue(bitmap);

    await expect(
      createMediaImageBitmap(imageItem({ blob }), fetchMedia, createBitmap),
    ).resolves.toBe(bitmap);

    expect(fetchMedia).not.toHaveBeenCalled();
    expect(createBitmap).toHaveBeenCalledWith(blob);
  });

  it("fetches and decodes a backend-backed image during playback", async () => {
    const downloaded = new Blob(["pixels"], { type: "image/png" });
    const bitmap = {} as ImageBitmap;
    const fetchMedia = vi.fn().mockResolvedValue(
      new Response(downloaded, { status: 200 }),
    );
    const createBitmap = vi.fn().mockResolvedValue(bitmap);

    await expect(
      createMediaImageBitmap(
        imageItem({ remoteUrl: "/api/projects/p/media/image.png" }),
        fetchMedia,
        createBitmap,
      ),
    ).resolves.toBe(bitmap);

    expect(fetchMedia).toHaveBeenCalledWith("/api/projects/p/media/image.png");
    expect(createBitmap).toHaveBeenCalledWith(downloaded);
  });

  it("uses the durable thumbnail when it is the only image source", async () => {
    const downloaded = new Blob(["preview"], { type: "image/jpeg" });
    const fetchMedia = vi.fn().mockResolvedValue(new Response(downloaded));
    const createBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

    await createMediaImageBitmap(
      imageItem({ thumbnailUrl: "https://cdn.example.com/image.jpg" }),
      fetchMedia,
      createBitmap,
    );

    expect(fetchMedia).toHaveBeenCalledWith("https://cdn.example.com/image.jpg");
  });

  it("fails explicitly when no source is available", async () => {
    await expect(
      createMediaImageBitmap(imageItem(), vi.fn(), vi.fn()),
    ).rejects.toThrow("has no loadable source");
  });
});
