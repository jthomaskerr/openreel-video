import type { MediaItem, Track } from "@openreel/core";
import { getMediaStatus, MediaStatus } from "@openreel/core";
import { getEffectiveThumbnailUrl } from "@openreel/core/media";

/** ── Color theme helpers ─────────────────────────────────────────── */

export interface PlaceholderColors {
  background: string;
  border: string;
  warningTriangle: string;
  warningText: string;
  labelText: string;
  labelBg: string;
  noThumbnailIconColor: string;
}

export function resolvePlaceholderColors(isDark: boolean): PlaceholderColors {
  return isDark
    ? {
        background: "#18181b",
        border: "#3f3f46",
        warningTriangle: "#facc15",
        warningText: "#facc15",
        labelText: "#fcd34d",
        labelBg: "rgba(0,0,0,0.55)",
        noThumbnailIconColor: "#3f3f46",
      }
    : {
        background: "#f4f4f5",
        border: "#d4d4d8",
        warningTriangle: "#ca8a04",
        warningText: "#a16207",
        labelText: "#a16207",
        labelBg: "rgba(255,255,255,0.75)",
        noThumbnailIconColor: "#d4d4d8",
      };
}

/** ── Drawing primitives ──────────────────────────────────────────── */

function drawWarningTriangle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const half = size / 2;
  const h = (Math.sqrt(3) / 2) * size;
  const topY = cy - h * 0.55;
  const botY = cy + h * 0.45;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx - half, botY);
  ctx.lineTo(cx + half, botY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Exclamation mark
  const exWidth = Math.max(2, size * 0.08);
  const exTop = topY + h * 0.25;
  const exBot = botY - h * 0.22;
  const exDotR = Math.max(1.5, size * 0.08);
  ctx.fillStyle = "#000000";
  ctx.fillRect(cx - exWidth / 2, exTop, exWidth, exBot - exTop);
  ctx.beginPath();
  ctx.arc(cx, exBot + exDotR * 2, exDotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  colors: PlaceholderColors,
  canvasWidth: number,
): void {
  const fontSize = Math.max(10, Math.min(14, canvasWidth * 0.02));
  ctx.font = `bold ${fontSize}px Inter, -apple-system, sans-serif`;
  const metrics = ctx.measureText(text);
  const paddingX = 6;
  const paddingY = 4;
  const boxW = metrics.width + paddingX * 2;
  const boxH = fontSize * 1.3 + paddingY * 2;
  const boxX = cx - boxW / 2;
  const boxY = cy - boxH / 2;

  ctx.fillStyle = colors.labelBg;
  safeRoundRect(ctx, boxX, boxY, boxW, boxH, 4);
  ctx.fillStyle = colors.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
}

function safeRoundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // arcTo is not available in all canvas envs (e.g. jsdom); fall back to simple rect
  if (typeof (ctx as CanvasRenderingContext2D).arcTo === "function") {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    (ctx as CanvasRenderingContext2D).arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    (ctx as CanvasRenderingContext2D).arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    (ctx as CanvasRenderingContext2D).arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    (ctx as CanvasRenderingContext2D).arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
    return;
  }
  // Fallback: simple rounded rect via quadratic curves or just a rect
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
}

/** ── Main renderer ───────────────────────────────────────────────── */

export interface MissingVideoPlaceholderInputs {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** The clip that references the missing video. */
  clip: Track["clips"][number];
  /** The resolved MediaItem (will be missing/error). */
  mediaItem: MediaItem | undefined;
  /** All media items in the project library, for thumbnail fallback lookup. */
  allMediaItems: readonly MediaItem[];
  /** Canvas dimensions. */
  canvasWidth: number;
  canvasHeight: number;
  /** Whether dark mode is active. */
  isDark: boolean;
  /** Optional: media name override (defaults to mediaItem.name). */
  mediaNameOverride?: string;
}

/**
 * Draw a missing-video placeholder frame.
 *
 * When a thumbnail is available (via getEffectiveThumbnailUrl), the thumbnail
 * is drawn as the visible frame with a warning overlay. When no thumbnail
 * exists, a non-blank warning placeholder is drawn instead.
 */
export function drawMissingVideoPlaceholder(
  inputs: MissingVideoPlaceholderInputs,
): void {
  const {
    ctx,
    clip,
    mediaItem,
    allMediaItems,
    canvasWidth,
    canvasHeight,
    isDark,
    mediaNameOverride,
  } = inputs;

  const colors = resolvePlaceholderColors(isDark);
  const thumbnailUrl = getEffectiveThumbnailUrl(
    mediaItem,
    allMediaItems,
    (clip as { metadata?: Record<string, unknown> }).metadata,
  );
  const mediaName =
    mediaNameOverride ?? mediaItem?.name ?? "Missing media";
  const isMissing =
    mediaItem ? getMediaStatus(mediaItem) === MediaStatus.MISSING : true;

  // Background
  ctx.fillStyle = colors.background;
  safeFillRect(ctx, 0, 0, canvasWidth, canvasHeight);

  if (thumbnailUrl) {
    // Will draw thumbnail asynchronously; draw warning overlay synchronously
    drawWarningOverlay(ctx, canvasWidth, canvasHeight, mediaName, isMissing, colors);
    // Kick off async thumbnail load — drawn immediately on next frame
    loadAndDrawThumbnail(thumbnailUrl, ctx, canvasWidth, canvasHeight);
  } else {
    // No thumbnail — draw warning-only placeholder
    drawWarningPlaceholder(ctx, canvasWidth, canvasHeight, mediaName, colors);
  }
}

/**
 * Synchronous version: draw the missing-video placeholder without async
 * thumbnail loading. Returns a status indicating whether a thumbnail
 * URL was resolved (caller can load it separately and should then draw
 * the warning overlay on top via drawWarningOverlay).
 */
export function drawMissingVideoPlaceholderSync(
  inputs: MissingVideoPlaceholderInputs,
): { thumbnailUrl: string | null; mediaName: string; isMissing: boolean; colors: PlaceholderColors } {
  const {
    ctx,
    clip,
    mediaItem,
    allMediaItems,
    canvasWidth,
    canvasHeight,
    isDark,
    mediaNameOverride,
  } = inputs;

  const colors = resolvePlaceholderColors(isDark);
  const thumbnailUrl = getEffectiveThumbnailUrl(
    mediaItem,
    allMediaItems,
    (clip as { metadata?: Record<string, unknown> }).metadata,
  );
  const mediaName =
    mediaNameOverride ?? mediaItem?.name ?? "Missing media";
  const isMissing =
    mediaItem ? getMediaStatus(mediaItem) === MediaStatus.MISSING : true;

  // Background fill
  ctx.fillStyle = colors.background;
  safeFillRect(ctx, 0, 0, canvasWidth, canvasHeight);

  if (!thumbnailUrl) {
    // No thumbnail — draw full warning placeholder
    drawWarningPlaceholder(ctx, canvasWidth, canvasHeight, mediaName, colors);
  }
  // When thumbnailUrl exists, the caller must:
  // 1. await loadAndDrawThumbnail(thumbnailUrl, ctx, w, h)
  // 2. drawWarningOverlay(ctx, w, h, mediaName, isMissing, colors)

  return { thumbnailUrl, mediaName, isMissing, colors };
}

/** ── Internal drawing helpers ────────────────────────────────────── */

export function drawWarningOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  mediaName: string,
  isMissing: boolean,
  colors: PlaceholderColors,
): void {
  // Semi-transparent overlay strip at bottom — large enough to be readable
  const stripH = Math.max(60, canvasHeight * 0.14);
  ctx.fillStyle = "rgba(0,0,0,0.50)";
  safeFillRect(ctx, 0, canvasHeight - stripH, canvasWidth, stripH);

  // Warning triangle
  const triSize = Math.max(24, Math.min(40, canvasWidth * 0.04));
  const triX = Math.max(24, canvasWidth * 0.04);
  const triY = canvasHeight - stripH / 2;
  drawWarningTriangle(ctx, triX, triY, triSize, colors.warningTriangle);

  // Label
  const labelText = isMissing ? "Missing media / Link file" : mediaName;
  const fontSize = Math.max(13, Math.min(20, canvasWidth * 0.022));
  ctx.font = `bold ${fontSize}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = colors.warningText;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(labelText, triX + triSize + 10, triY - fontSize * 0.35);

  // Media name
  ctx.font = `${fontSize * 0.85}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = colors.labelBg;
  ctx.fillText(mediaName, triX + triSize + 10, triY + fontSize * 0.5);
}

/** Safe dashed-line helper that works in jsdom/node-canvas environments. */
function safeStrokeRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
}

function safeFillRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
}

function safeDashedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dashLen: number,
  gapLen: number,
): void {
  if (typeof (ctx as CanvasRenderingContext2D).setLineDash === "function") {
    (ctx as CanvasRenderingContext2D).setLineDash([dashLen, gapLen]);
    safeStrokeRect(ctx, x, y, w, h);
    (ctx as CanvasRenderingContext2D).setLineDash([]);
    return;
  }
  // Fallback: draw a simple solid border
  safeStrokeRect(ctx, x, y, w, h);
}

function drawWarningPlaceholder(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  mediaName: string,
  colors: PlaceholderColors,
): void {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  // Border (dashed where supported)
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2;
  safeDashedRect(ctx, 4, 4, canvasWidth - 8, canvasHeight - 8, 8, 4);

  // Large warning triangle
  const triSize = Math.max(40, Math.min(64, canvasWidth * 0.08));
  drawWarningTriangle(ctx, cx, cy - triSize * 0.6, triSize, colors.warningTriangle);

  // Label
  drawLabel(
    ctx,
    cx,
    cy + triSize * 0.9,
    mediaName || "Missing media",
    colors,
    canvasWidth,
  );

  // "Link file" subtext
  const subSize = Math.max(10, Math.min(14, canvasWidth * 0.017));
  ctx.font = `${subSize}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = colors.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Replace this placeholder with your content", cx, cy + triSize * 0.9 + 28);
}

const thumbnailLoadCache = new Map<string, HTMLImageElement>();

/**
 * Load a thumbnail image and draw it fitted onto the canvas.
 * Returns a Promise that resolves to true when the image is loaded and drawn,
 * or false if the load fails.
 *
 * Exported so callers (e.g. Preview.tsx) can await thumbnail drawing before
 * capturing an ImageBitmap — otherwise only the warning overlay is captured.
 */
export function loadAndDrawThumbnail(
  url: string,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): Promise<boolean> {
  const key = url;
  let img = thumbnailLoadCache.get(key);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    thumbnailLoadCache.set(key, img);
  }

  // If already loaded, draw immediately
  if (img.complete && img.naturalWidth > 0) {
    try {
      drawFittedImage(img, ctx, canvasWidth, canvasHeight);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  // Otherwise wait for load
  return new Promise<boolean>((resolve) => {
    const onLoad = () => {
      try {
        drawFittedImage(img!, ctx, canvasWidth, canvasHeight);
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    const onError = () => resolve(false);

    // Remove previous handlers to avoid stacking
    img.onload = null;
    img.onerror = null;
    img.onload = onLoad;
    img.onerror = onError;

    if (!img.src || img.src !== url) {
      img.src = url;
    }
  });
}

function drawFittedImage(
  img: HTMLImageElement,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Draw thumbnail centered and fitted
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  let drawWidth: number;
  let drawHeight: number;
  let offsetX = 0;
  let offsetY = 0;

  if (imgAspect > canvasAspect) {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * imgAspect;
    offsetX = (canvasWidth - drawWidth) / 2;
  } else {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / imgAspect;
    offsetY = (canvasHeight - drawHeight) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
}
