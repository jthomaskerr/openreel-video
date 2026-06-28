import { describe, it, expect } from "vitest";
import { createMetadataMedia } from "./metadata-media";

describe("createMetadataMedia", () => {
  const opts = {
    kind: "verse",
    label: "Verse A",
    color: "#ff0000",
    duration: 4.5,
  } as const;

  it("returns an image MediaItem with a non-empty id", () => {
    const result = createMetadataMedia(opts);
    expect(result.item.id).toBeTruthy();
    expect(result.item.type).toBe("image");
  });

  it("returns a non-empty Blob usable for media storage", () => {
    const result = createMetadataMedia(opts);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe("image/png");
  });

  it("item.blob is the same Blob instance as the returned blob", () => {
    const result = createMetadataMedia(opts);
    expect(result.item.blob).toBe(result.blob);
  });

  it("carries duration in item.metadata.duration", () => {
    const result = createMetadataMedia(opts);
    expect(result.item.metadata.duration).toBe(opts.duration);
  });

  it("carries kind on the result", () => {
    const result = createMetadataMedia(opts);
    expect(result.kind).toBe("verse");
  });

  it("carries label on the result", () => {
    const result = createMetadataMedia(opts);
    expect(result.label).toBe("Verse A");
  });

  it("carries color on the result", () => {
    const result = createMetadataMedia(opts);
    expect(result.color).toBe("#ff0000");
  });

  it("carries duration on the result", () => {
    const result = createMetadataMedia(opts);
    expect(result.duration).toBe(4.5);
  });

  it("each call generates a distinct id", () => {
    const a = createMetadataMedia(opts);
    const b = createMetadataMedia(opts);
    expect(a.item.id).not.toBe(b.item.id);
  });

  it("fileHandle is null (local blob, no filesystem handle required)", () => {
    const result = createMetadataMedia(opts);
    expect(result.item.fileHandle).toBeNull();
  });

  it("encodes kind/label/color in sourceFile.folder for round-trip persistence", () => {
    const result = createMetadataMedia(opts);
    const raw = result.item.sourceFile?.folder;
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.kind).toBe("verse");
    expect(parsed.label).toBe("Verse A");
    expect(parsed.color).toBe("#ff0000");
  });

  it("accepts any string kind", () => {
    const result = createMetadataMedia({ ...opts, kind: "custom-section" });
    expect(result.kind).toBe("custom-section");
  });

  it("metadata fileSize matches the actual blob size", () => {
    const result = createMetadataMedia(opts);
    expect(result.item.metadata.fileSize).toBe(result.blob.size);
  });
});
