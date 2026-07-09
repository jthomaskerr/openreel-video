import type { MediaItem } from "@openreel/core";

export type MediaItemWithRemoteUrl = MediaItem & {
  readonly remoteUrl?: string | null;
};

export function isMediaBlob(value: unknown): value is Blob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Blob;
  return (
    typeof candidate.size === "number" &&
    (
      typeof candidate.arrayBuffer === "function" ||
      typeof candidate.stream === "function" ||
      typeof candidate.text === "function" ||
      typeof candidate.slice === "function"
    )
  );
}

export async function readMediaBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  if (typeof Response !== "undefined") {
    return new Response(blob).arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read media blob"));
    reader.readAsArrayBuffer(blob);
  });
}

async function fetchBlobFromUrl(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.blob();
  } catch {
    return null;
  }
}

export async function getMediaItemBlob(
  item: MediaItemWithRemoteUrl,
): Promise<Blob | null> {
  if (isMediaBlob(item.blob)) {
    return item.blob;
  }

  if (item.fileHandle) {
    try {
      const file = await item.fileHandle.getFile();
      if (isMediaBlob(file)) return file;
    } catch {
      // Fall through to URL-backed sources.
    }
  }

  if (item.remoteUrl) {
    const blob = await fetchBlobFromUrl(item.remoteUrl);
    if (blob) return blob;
  }

  if (item.originalUrl) {
    const blob = await fetchBlobFromUrl(item.originalUrl);
    if (blob) return blob;
  }

  return null;
}
