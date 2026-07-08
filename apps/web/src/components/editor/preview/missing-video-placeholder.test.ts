import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  drawMissingVideoPlaceholderSync,
  resolvePlaceholderColors,
} from "./missing-video-placeholder";
import type { MissingVideoPlaceholderInputs } from "./missing-video-placeholder";
import { getMediaStatus, MediaStatus } from "@openreel/core";
import { getEffectiveThumbnailUrl } from "@openreel/core/media";

// Mock the thumbnail utility
vi.mock("@openreel/core/media", () => ({
  getEffectiveThumbnailUrl: vi.fn(),
}));

// Mock getMediaStatus
vi.mock("@openreel/core", () => ({
  getMediaStatus: vi.fn(),
  MediaStatus: {
    OK: "OK",
    MISSING: "MISSING",
    UNREALIZED: "UNREALIZED",
    PENDING: "PENDING",
    ERROR: "ERROR",
  },
}));

function createMockCtx(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  return canvas.getContext("2d")!;
}

function createInputs(
  overrides: Partial<MissingVideoPlaceholderInputs> = {},
): MissingVideoPlaceholderInputs {
  return {
    ctx: createMockCtx(),
    clip: {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      type: "video",
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    } as unknown as MissingVideoPlaceholderInputs["clip"],
    mediaItem: {
      id: "media-1",
      name: "missing-video.mp4",
      type: "video",
      blob: null as unknown as Blob,
      thumbnailUrl: null,
    } as unknown as MissingVideoPlaceholderInputs["mediaItem"],
    allMediaItems: [],
    canvasWidth: 1920,
    canvasHeight: 1080,
    isDark: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMediaStatus).mockReturnValue(MediaStatus.MISSING);
  vi.mocked(getEffectiveThumbnailUrl).mockReturnValue(null);
});

describe("missing-video-placeholder", () => {
  // ── 1. draws thumbnail when mediaItem.thumbnailUrl exists ──────
  it("draws thumbnail when mediaItem.thumbnailUrl exists (via getEffectiveThumbnailUrl)", () => {
    const mockUrl = "blob:thumb-1";
    vi.mocked(getEffectiveThumbnailUrl).mockReturnValue(mockUrl);

    const inputs = createInputs({
      mediaItem: {
        id: "media-1",
        name: "missing-video.mp4",
        type: "video",
        blob: null as unknown as Blob,
        thumbnailUrl: mockUrl,
      } as unknown as MissingVideoPlaceholderInputs["mediaItem"],
    });

    // drawMissingVideoPlaceholderSync returns the resolved thumbnailUrl
    const result = drawMissingVideoPlaceholderSync(inputs);

    expect(result.thumbnailUrl).toBe(mockUrl);
    expect(() => drawMissingVideoPlaceholderSync(inputs)).not.toThrow();
  });

  // ── 2. draws warning symbol/label ──────────────────────────────
  it("draws warning text/label for missing media", () => {
    const inputs = createInputs();

    // Verify that rendering does not throw
    expect(() => drawMissingVideoPlaceholderSync(inputs)).not.toThrow();
  });

  // ── 3. falls back to clip.metadata.referenceAssetIds ────────────
  it("calls getEffectiveThumbnailUrl with clip metadata for referenceAssetIds fallback", () => {
    const inputs = createInputs({
      clip: {
        ...createInputs().clip,
        metadata: {
          referenceAssetIds: ["ref-asset-1"],
        } as unknown as Record<string, unknown>,
      },
    });

    vi.mocked(getEffectiveThumbnailUrl).mockReturnValue(
      "blob:reference-thumb",
    );

    drawMissingVideoPlaceholderSync(inputs);

    // Should have called getEffectiveThumbnailUrl with the metadata
    expect(getEffectiveThumbnailUrl).toHaveBeenCalledWith(
      inputs.mediaItem,
      inputs.allMediaItems,
      inputs.clip.metadata,
    );
  });

  // ── 4. falls back to referenceImageUrl ─────────────────────────
  it("resolves thumbnail via referenceImageUrl in clip metadata", () => {
    const inputs = createInputs({
      clip: {
        ...createInputs().clip,
        metadata: {
          referenceImageUrl: "https://example.com/ref.jpg",
        } as unknown as Record<string, unknown>,
      },
    });

    vi.mocked(getEffectiveThumbnailUrl).mockReturnValue(
      "https://example.com/ref.jpg",
    );

    const result = drawMissingVideoPlaceholderSync(inputs);

    expect(result.thumbnailUrl).toBe("https://example.com/ref.jpg");
    expect(getEffectiveThumbnailUrl).toHaveBeenCalled();
  });

  it("falls back to referenceImageUrls[0]", () => {
    const inputs = createInputs({
      clip: {
        ...createInputs().clip,
        metadata: {
          referenceImageUrls: ["https://example.com/img1.jpg"],
        } as unknown as Record<string, unknown>,
      },
    });

    vi.mocked(getEffectiveThumbnailUrl).mockReturnValue(
      "https://example.com/img1.jpg",
    );

    const result = drawMissingVideoPlaceholderSync(inputs);

    expect(result.thumbnailUrl).toBe("https://example.com/img1.jpg");
    expect(getEffectiveThumbnailUrl).toHaveBeenCalled();
  });

  // ── 5. draws warning-only placeholder when no thumbnail exists ──
  it("draws warning-only placeholder when no thumbnail exists", () => {
    vi.mocked(getEffectiveThumbnailUrl).mockReturnValue(null);

    const inputs = createInputs();

    const result = drawMissingVideoPlaceholderSync(inputs);

    expect(result.thumbnailUrl).toBeNull();
    expect(() => drawMissingVideoPlaceholderSync(inputs)).not.toThrow();
  });

  // ── 6. resolvePlaceholderColors returns dark/light variants ───
  it("resolvePlaceholderColors returns correct dark mode colors", () => {
    const dark = resolvePlaceholderColors(true);
    expect(dark.background).toBe("#18181b");
    expect(dark.warningTriangle).toBe("#facc15");
  });

  it("resolvePlaceholderColors returns correct light mode colors", () => {
    const light = resolvePlaceholderColors(false);
    expect(light.background).toBe("#f4f4f5");
    expect(light.warningTriangle).toBe("#ca8a04");
  });
});
