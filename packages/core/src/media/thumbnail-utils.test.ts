import { describe, expect, it } from "vitest";
import { getEffectiveThumbnailUrl, isVideoFileMissing } from "./thumbnail-utils";
import type { MediaItem } from "../types/project";

// ── Fixtures ───────────────────────────────────────────────────────────────

const BASE_METADATA = {
  duration: 10,
  width: 1920,
  height: 1080,
  frameRate: 30,
  codec: "h264",
  sampleRate: 0,
  channels: 0,
  fileSize: 1000,
};

function makeItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "item-1",
    name: "clip.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: BASE_METADATA,
    thumbnailUrl: null,
    waveformData: null,
    ...overrides,
  };
}

function makeImageItem(id: string, thumbnailUrl: string | null = null): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: { ...BASE_METADATA, duration: 0 },
    thumbnailUrl,
    waveformData: null,
  };
}

// ── isVideoFileMissing ─────────────────────────────────────────────────────

describe("isVideoFileMissing", () => {
  it("returns true when blob and originalUrl and remoteUrl are all absent", () => {
    expect(isVideoFileMissing(makeItem())).toBe(true);
  });

  it("returns false when blob is present", () => {
    expect(isVideoFileMissing(makeItem({ blob: new Blob(["data"]) }))).toBe(false);
  });

  it("returns false when originalUrl is present", () => {
    expect(isVideoFileMissing(makeItem({ originalUrl: "https://cdn.example.com/v.mp4" }))).toBe(false);
  });

  it("returns false when remoteUrl is present", () => {
    expect(isVideoFileMissing(makeItem({ remoteUrl: "https://cdn.example.com/v.mp4" }))).toBe(false);
  });
});

// ── getEffectiveThumbnailUrl ───────────────────────────────────────────────

describe("getEffectiveThumbnailUrl", () => {
  describe("own thumbnailUrl takes priority", () => {
    it("returns item.thumbnailUrl when present, regardless of generation status", () => {
      const item = makeItem({ thumbnailUrl: "data:image/jpeg,own-thumb" });
      expect(getEffectiveThumbnailUrl(item, [])).toBe("data:image/jpeg,own-thumb");
    });

    it("returns item.thumbnailUrl even when file is missing and clip metadata is provided", () => {
      const refItem = makeImageItem("ref-1", "data:image/jpeg,ref-thumb");
      const item = makeItem({ thumbnailUrl: "data:image/jpeg,own-thumb" });
      const clip = { referenceAssetIds: ["ref-1"] };
      expect(getEffectiveThumbnailUrl(item, [refItem], clip)).toBe("data:image/jpeg,own-thumb");
    });
  });

  describe("no fallback without clip metadata", () => {
    it("returns null when thumbnailUrl is absent and no clipMetadata supplied", () => {
      const item = makeItem();
      expect(getEffectiveThumbnailUrl(item, [])).toBeNull();
    });

    it("returns null when clipMetadata is null", () => {
      const item = makeItem();
      expect(getEffectiveThumbnailUrl(item, [], null)).toBeNull();
    });
  });

  describe("no fallback when file is present", () => {
    it("returns null even with clipMetadata when blob is present", () => {
      const refItem = makeImageItem("ref-1", "data:image/jpeg,ref-thumb");
      const item = makeItem({ blob: new Blob(["data"]) });
      const clip = { referenceAssetIds: ["ref-1"] };
      expect(getEffectiveThumbnailUrl(item, [refItem], clip)).toBeNull();
    });

    it("returns null when remoteUrl is present", () => {
      const refItem = makeImageItem("ref-1", "data:image/jpeg,ref-thumb");
      const item = makeItem({ remoteUrl: "https://cdn.example.com/v.mp4" });
      const clip = { referenceAssetIds: ["ref-1"] };
      expect(getEffectiveThumbnailUrl(item, [refItem], clip)).toBeNull();
    });
  });

  describe("referenceAssetIds fallback", () => {
    it("returns thumbnailUrl of first referenceAssetId that has one", () => {
      const ref1 = makeImageItem("ref-1", "data:image/jpeg,ref-1-thumb");
      const item = makeItem();
      const clip = { referenceAssetIds: ["ref-1"] };
      expect(getEffectiveThumbnailUrl(item, [ref1], clip)).toBe("data:image/jpeg,ref-1-thumb");
    });

    it("skips reference assets with no thumbnailUrl", () => {
      const ref1 = makeImageItem("ref-1", null); // no thumbnail
      const ref2 = makeImageItem("ref-2", "data:image/jpeg,ref-2-thumb");
      const item = makeItem();
      const clip = { referenceAssetIds: ["ref-1", "ref-2"] };
      expect(getEffectiveThumbnailUrl(item, [ref1, ref2], clip)).toBe(
        "data:image/jpeg,ref-2-thumb",
      );
    });

    it("skips unknown IDs and finds the next valid one", () => {
      const ref2 = makeImageItem("ref-2", "data:image/jpeg,ref-2-thumb");
      const item = makeItem();
      const clip = { referenceAssetIds: ["unknown-id", "ref-2"] };
      expect(getEffectiveThumbnailUrl(item, [ref2], clip)).toBe(
        "data:image/jpeg,ref-2-thumb",
      );
    });

    it("returns null when no referenceAssetId resolves to a thumbnail", () => {
      const ref1 = makeImageItem("ref-1", null);
      const item = makeItem();
      const clip = { referenceAssetIds: ["ref-1"] };
      expect(getEffectiveThumbnailUrl(item, [ref1], clip)).toBeNull();
    });
  });

  describe("referenceImageUrl fallback", () => {
    it("returns referenceImageUrl when no referenceAssetIds resolve", () => {
      const item = makeItem();
      const clip = { referenceImageUrl: "https://cdn.example.com/scene.jpg" };
      expect(getEffectiveThumbnailUrl(item, [], clip)).toBe(
        "https://cdn.example.com/scene.jpg",
      );
    });

    it("referenceAssetIds takes priority over referenceImageUrl", () => {
      const ref1 = makeImageItem("ref-1", "data:image/jpeg,ref-1-thumb");
      const item = makeItem();
      const clip = {
        referenceAssetIds: ["ref-1"],
        referenceImageUrl: "https://cdn.example.com/scene.jpg",
      };
      expect(getEffectiveThumbnailUrl(item, [ref1], clip)).toBe(
        "data:image/jpeg,ref-1-thumb",
      );
    });

    it("falls through to referenceImageUrl when referenceAssetIds yield nothing", () => {
      const item = makeItem();
      const clip = {
        referenceAssetIds: ["unknown-id"],
        referenceImageUrl: "https://cdn.example.com/scene.jpg",
      };
      expect(getEffectiveThumbnailUrl(item, [], clip)).toBe(
        "https://cdn.example.com/scene.jpg",
      );
    });
  });

  describe("referenceImageUrls fallback", () => {
    it("returns first entry of referenceImageUrls when other fallbacks yield nothing", () => {
      const item = makeItem();
      const clip = {
        referenceImageUrls: [
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/b.jpg",
        ],
      };
      expect(getEffectiveThumbnailUrl(item, [], clip)).toBe(
        "https://cdn.example.com/a.jpg",
      );
    });

    it("referenceImageUrl takes priority over referenceImageUrls", () => {
      const item = makeItem();
      const clip = {
        referenceImageUrl: "https://cdn.example.com/single.jpg",
        referenceImageUrls: ["https://cdn.example.com/a.jpg"],
      };
      expect(getEffectiveThumbnailUrl(item, [], clip)).toBe(
        "https://cdn.example.com/single.jpg",
      );
    });
  });

  describe("undefined item", () => {
    it("returns null for undefined item", () => {
      expect(getEffectiveThumbnailUrl(undefined, [])).toBeNull();
    });
  });

  describe("fallback priority order", () => {
    it("referenceAssetIds > referenceImageUrl > referenceImageUrls", () => {
      const ref1 = makeImageItem("ref-1", "data:image/jpeg,ref-1-thumb");
      const item = makeItem();
      const clip = {
        referenceAssetIds: ["ref-1"],
        referenceImageUrl: "https://cdn.example.com/single.jpg",
        referenceImageUrls: ["https://cdn.example.com/a.jpg"],
      };
      expect(getEffectiveThumbnailUrl(item, [ref1], clip)).toBe(
        "data:image/jpeg,ref-1-thumb",
      );
    });

    it("skips to referenceImageUrl when referenceAssetIds all miss", () => {
      const item = makeItem();
      const clip = {
        referenceAssetIds: [],
        referenceImageUrl: "https://cdn.example.com/single.jpg",
        referenceImageUrls: ["https://cdn.example.com/a.jpg"],
      };
      expect(getEffectiveThumbnailUrl(item, [], clip)).toBe(
        "https://cdn.example.com/single.jpg",
      );
    });
  });
});
