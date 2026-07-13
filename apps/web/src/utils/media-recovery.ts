import type { MediaItem } from "@openreel/core";
import { isMediaBlob } from "./media-blob";

function isThumbnailableMediaType(type: MediaItem["type"]): boolean {
  return type === "video" || type === "image";
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read thumbnail"));
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export function shouldRegenerateThumbnail(item: Pick<MediaItem, "thumbnailUrl" | "type">): boolean {
  return isThumbnailableMediaType(item.type) && (!item.thumbnailUrl || item.thumbnailUrl.startsWith("blob:"));
}

function generateVideoThumbnailFromSource(
  src: string,
  { revokeSource = false, crossOrigin = false }: { revokeSource?: boolean; crossOrigin?: boolean } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const sourceKind = src.startsWith("blob:") ? "blob" : src.startsWith("data:") ? "data" : "remote";
    const startedAt = performance.now();
    let settled = false;
    let captureStarted = false;
    let seekRequested = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const snapshot = () => ({
      sourceKind,
      readyState: video.readyState,
      networkState: video.networkState,
      duration: video.duration,
      currentTime: video.currentTime,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      mediaErrorCode: video.error?.code ?? null,
      mediaErrorMessage: video.error?.message ?? null,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (revokeSource) URL.revokeObjectURL(src);
      video.remove();
    };

    const finish = (thumbnailUrl: string | null, outcome: string, error?: unknown) => {
      if (settled) return;
      settled = true;
      const details = { outcome, ...snapshot(), error };
      if (thumbnailUrl) {
        console.info("[ThumbnailRecovery] video thumbnail generated", details);
      } else {
        console.warn("[ThumbnailRecovery] video thumbnail unavailable", details);
      }
      cleanup();
      resolve(thumbnailUrl);
    };

    const capture = () => {
      if (settled || captureStarted) return;
      captureStarted = true;
      try {
        const sourceWidth = video.videoWidth || 320;
        const sourceHeight = video.videoHeight || 180;
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(sourceWidth, 320);
        canvas.height = Math.max(
          1,
          Math.round((canvas.width / sourceWidth) * sourceHeight),
        );

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null, "canvas-context-unavailable");
          return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (thumbBlob) => {
            if (!thumbBlob) {
              finish(null, "canvas-to-blob-null");
              return;
            }
            void blobToDataUrl(thumbBlob)
              .then((url) => finish(url, "success"))
              .catch((error) => finish(null, "blob-to-data-url-failed", error));
          },
          "image/jpeg",
          0.7,
        );
      } catch (error) {
        finish(null, "canvas-capture-failed", error);
      }
    };

    video.muted = true;
    video.playsInline = true;
    // WebKit honors `metadata` strictly and may never emit loadeddata. We need a
    // decoded frame, so request media data explicitly and support its event order.
    video.preload = "auto";
    if (crossOrigin) {
      video.crossOrigin = "anonymous";
    }

    const requestSeekOrCapture = () => {
      if (settled || captureStarted || seekRequested) return;
      try {
        const seekTime = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.1, video.duration / 2)
          : 0;
        if (seekTime > 0) {
          seekRequested = true;
          video.currentTime = seekTime;
        } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          capture();
        }
      } catch (error) {
        console.warn("[ThumbnailRecovery] video seek failed; capturing current frame", {
          ...snapshot(),
          error,
        });
        capture();
      }
    };

    video.onloadedmetadata = () => {
      console.info("[ThumbnailRecovery] video loaded metadata", snapshot());
      requestSeekOrCapture();
    };
    video.onloadeddata = () => {
      console.info("[ThumbnailRecovery] video loaded data", snapshot());
      requestSeekOrCapture();
    };
    video.oncanplay = () => {
      console.info("[ThumbnailRecovery] video can play", snapshot());
      if (!seekRequested) capture();
    };
    video.onseeked = () => {
      console.info("[ThumbnailRecovery] video seeked", snapshot());
      capture();
    };
    video.onerror = () => finish(null, "media-error");

    console.info("[ThumbnailRecovery] video thumbnail requested", {
      sourceKind,
      crossOrigin,
      userAgent: navigator.userAgent,
    });
    timeoutId = setTimeout(() => finish(null, "timeout"), 5000);
    video.src = src;
    video.load();
  });
}

export async function generateThumbnailFromBlob(
  blob: Blob,
  type: MediaItem["type"],
): Promise<string | null> {
  if (type === "audio" || type === "srt") {
    return null;
  }

  if (type === "image") {
    return blobToDataUrl(blob);
  }

  const src = URL.createObjectURL(blob);
  return generateVideoThumbnailFromSource(src, { revokeSource: true });
}

export async function generateThumbnailFromUrl(
  url: string,
  type: MediaItem["type"],
): Promise<string | null> {
  if (type === "audio" || type === "srt") {
    return null;
  }

  if (type === "image") {
    return url;
  }

  return generateVideoThumbnailFromSource(url, { crossOrigin: true });
}

export async function restoreMediaItem(
  item: MediaItem,
  storedBlob: Blob | undefined,
): Promise<MediaItem> {
  const blob = isMediaBlob(storedBlob)
    ? storedBlob
    : isMediaBlob(item.blob)
      ? item.blob
      : null;

  if (!blob) {
    return {
      ...item,
      blob: null,
      thumbnailUrl: item.thumbnailUrl?.startsWith("blob:") ? null : item.thumbnailUrl,
      filmstripThumbnails: item.filmstripThumbnails?.some((thumb) => thumb.url.startsWith("blob:"))
        ? undefined
        : item.filmstripThumbnails,
    };
  }

  let thumbnailUrl = item.thumbnailUrl;

  if (!thumbnailUrl || thumbnailUrl.startsWith("blob:")) {
    thumbnailUrl = await generateThumbnailFromBlob(blob, item.type);
  }

  return {
    ...item,
    blob,
    thumbnailUrl,
    filmstripThumbnails: undefined,
  };
}
