import type { MediaItem } from "@openreel/core";

type FetchMedia = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type CreateBitmap = (image: ImageBitmapSource) => Promise<ImageBitmap>;

/**
 * Decode an image media item for canvas playback.
 *
 * Backend-backed and generated assets may only have a remote/original URL,
 * while freshly imported assets retain their Blob. Playback must support both
 * representations.
 */
export async function createMediaImageBitmap(
  item: MediaItem,
  fetchMedia: FetchMedia = fetch,
  createBitmap: CreateBitmap = createImageBitmap,
): Promise<ImageBitmap> {
  if (item.type !== "image") {
    throw new Error(`Cannot decode ${item.type} media as an image`);
  }

  let source = item.blob;
  if (!source) {
    const sourceUrl = item.remoteUrl ?? item.originalUrl ?? item.thumbnailUrl;
    if (!sourceUrl) {
      throw new Error(`Image media ${item.id} has no loadable source`);
    }

    const response = await fetchMedia(sourceUrl);
    if (!response.ok) {
      throw new Error(`Image media ${item.id} fetch failed: HTTP ${response.status}`);
    }
    source = await response.blob();
  }

  return createBitmap(source);
}
