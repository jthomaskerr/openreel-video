import type { MediaItem } from "@openreel/core";
import { isMediaBlob } from "./media-blob";

function isThumbnailableMediaType(type: MediaItem["type"]): boolean {
  return type === "video" || type === "image";
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
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (revokeSource) URL.revokeObjectURL(src);
      video.remove();
    };

    const finish = (thumbnailUrl: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(thumbnailUrl);
    };

    const capture = () => {
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
          finish(null);
          return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (thumbBlob) => {
            finish(thumbBlob ? URL.createObjectURL(thumbBlob) : null);
          },
          "image/jpeg",
          0.7,
        );
      } catch {
        finish(null);
      }
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    if (crossOrigin) {
      video.crossOrigin = "anonymous";
    }

    video.onloadeddata = () => {
      try {
        const seekTime = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.1, video.duration / 2)
          : 0;
        if (seekTime > 0) {
          video.currentTime = seekTime;
        } else {
          capture();
        }
      } catch {
        capture();
      }
    };

    video.onseeked = capture;
    video.onerror = () => finish(null);

    timeoutId = setTimeout(() => finish(null), 5000);
    video.src = src;
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
    return URL.createObjectURL(blob);
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
    return { ...item, blob: null };
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
