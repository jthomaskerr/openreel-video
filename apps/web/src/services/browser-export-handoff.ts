import {
  getExportEngine,
  type HandoffDiagnosticEvent,
  type MediaAvailabilityHint,
  type MediaItem,
  type WrittenArtifact,
} from "@openreel/core";
import { loadMediaBlob } from "./media-storage";
import { requestMediaVerification } from "./media-verification";
import type { DirectoryWriter, HandoffDependencies, ResolvedMediaSource } from "./export-handoff";

type PermissionAwareFileHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};

function mediaTypeFor(media: MediaItem, blob?: Blob): string {
  if (blob?.type) return blob.type;
  if (media.type === "audio") return "audio/*";
  if (media.type === "image") return "image/*";
  if (media.type === "srt") return "text/plain";
  return "video/quicktime";
}

async function permittedFile(handle: FileSystemFileHandle): Promise<File | null> {
  const permissionHandle = handle as PermissionAwareFileHandle;
  let permission = await permissionHandle.queryPermission({ mode: "read" });
  if (permission === "prompt") permission = await permissionHandle.requestPermission({ mode: "read" });
  return permission === "granted" ? handle.getFile() : null;
}

function sourceFromBlob(media: MediaItem, blob: Blob): ResolvedMediaSource {
  return {
    mediaId: media.id,
    fileName: media.name,
    mediaType: mediaTypeFor(media, blob),
    byteLength: blob.size,
    stream: () => blob.stream(),
  };
}

async function resolveMedia(
  projectId: string,
  media: MediaItem,
  signal: AbortSignal,
): Promise<{ hint: MediaAvailabilityHint; source?: ResolvedMediaSource }> {
  if (signal.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
  if (media.blob && media.blob.size > 0) {
    return {
      hint: { available: true, source: "blob", mediaType: mediaTypeFor(media, media.blob), byteLength: media.blob.size },
      source: sourceFromBlob(media, media.blob),
    };
  }
  const persisted = await loadMediaBlob(media.id);
  if (persisted && persisted.size > 0) {
    return {
      hint: { available: true, source: "persisted-blob", mediaType: mediaTypeFor(media, persisted), byteLength: persisted.size },
      source: sourceFromBlob(media, persisted),
    };
  }
  if (media.fileHandle) {
    const file = await permittedFile(media.fileHandle);
    if (file && file.size > 0) {
      return {
        hint: { available: true, source: "file-handle", mediaType: mediaTypeFor(media, file), byteLength: file.size },
        source: sourceFromBlob(media, file),
      };
    }
  }
  const remoteUrl = media.remoteUrl ?? media.originalUrl;
  if (remoteUrl) {
    const verification = await requestMediaVerification(projectId, [media.id], signal);
    if (verification.outcomes[0]?.status === "available") {
      const response = await fetch(remoteUrl, { signal, credentials: "same-origin" });
      if (!response.ok || !response.body) throw new Error(`Verified media ${media.id} could not be opened`);
      const byteLength = Number(response.headers.get("content-length") ?? media.metadata.fileSize ?? 0);
      const mediaType = response.headers.get("content-type") ?? mediaTypeFor(media);
      return {
        hint: { available: true, source: "verified-url", mediaType, byteLength },
        source: {
          mediaId: media.id,
          fileName: media.name,
          mediaType,
          byteLength,
          stream: () => response.body!,
        },
      };
    }
  }
  return { hint: { available: false } };
}

function safeSegments(relativePath: string): string[] {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    throw new Error("Artifact path contains invalid URL encoding");
  }
  const segments = decoded.replace(/\\/g, "/").split("/");
  if (
    relativePath.startsWith("/") ||
    /^[A-Za-z]:/.test(decoded) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Artifact path must stay inside the selected handoff directory");
  }
  return segments;
}

function artifactKind(relativePath: string): WrittenArtifact["kind"] {
  if (relativePath.endsWith(".fcpxml")) return "fcpxml";
  if (relativePath.endsWith(".md")) return "report";
  if (relativePath.endsWith(".mov")) return "movie";
  return "media";
}

function artifactMediaType(relativePath: string): string {
  if (relativePath.endsWith(".fcpxml")) return "application/xml";
  if (relativePath.endsWith(".md")) return "text/markdown";
  if (relativePath.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}

class BrowserDirectoryWriter implements DirectoryWriter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async write(
    relativePath: string,
    body: string | ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<WrittenArtifact> {
    const segments = safeSegments(relativePath);
    const fileName = segments.pop()!;
    let directory = this.root;
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    let byteLength = 0;
    try {
      if (typeof body === "string") {
        const bytes = new TextEncoder().encode(body);
        byteLength = bytes.byteLength;
        await writable.write(bytes);
      } else {
        const reader = body.getReader();
        while (true) {
          if (signal.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
          const next = await reader.read();
          if (next.done) break;
          byteLength += next.value.byteLength;
          const chunk = new Uint8Array(next.value.byteLength);
          chunk.set(next.value);
          await writable.write(chunk);
        }
      }
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => undefined);
      throw error;
    }
    return {
      kind: artifactKind(relativePath),
      relativePath,
      mediaType: artifactMediaType(relativePath),
      byteLength,
      sha256: "unavailable-for-streamed-output",
    };
  }

  async close(): Promise<void> {
    // Individual File System Access API writable handles are closed per artifact.
  }
}

async function createResolveDirectory(name: string): Promise<DirectoryWriter> {
  if (!("showDirectoryPicker" in window)) {
    throw new DOMException("Directory export requires a Chromium browser with File System Access support", "NotSupportedError");
  }
  const parent = await (window as Window & { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
  let collision = false;
  try {
    await parent.getDirectoryHandle(name);
    collision = true;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
  if (collision && !window.confirm(`The folder “${name}” already exists. Continue and replace matching files?`)) {
    throw new DOMException("Existing handoff folder was not confirmed", "AbortError");
  }
  return new BrowserDirectoryWriter(await parent.getDirectoryHandle(name, { create: true }));
}

async function openMovie(fileName: string, mediaType: string): Promise<FileSystemWritableFileStream> {
  if (!("showSaveFilePicker" in window)) {
    throw new DOMException("Movie export requires the browser save-file picker", "NotSupportedError");
  }
  const handle = await (
    window as Window & {
      showSaveFilePicker(options: unknown): Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker({
    suggestedName: fileName,
    types: [{ description: "iMovie-compatible QuickTime movie", accept: { [mediaType]: [".mov"] } }],
  });
  return handle.createWritable();
}

function emitSafeDiagnostic(event: HandoffDiagnosticEvent): void {
  console.warn(event.name, {
    target: event.target,
    stage: event.stage,
    fields: event.fields,
  });
}

export function createBrowserHandoffDependencies(projectId: string): HandoffDependencies {
  const cache = new Map<string, ResolvedMediaSource>();
  return {
    mediaResolver: {
      async inspect(media, signal) {
        const resolved = await resolveMedia(projectId, media, signal);
        if (resolved.source) cache.set(media.id, resolved.source);
        return resolved.hint;
      },
      async open(media, signal) {
        const cached = cache.get(media.id);
        if (cached) return cached;
        const resolved = await resolveMedia(projectId, media, signal);
        if (!resolved.source) throw new Error(`Required media ${media.id} is unavailable`);
        cache.set(media.id, resolved.source);
        return resolved.source;
      },
    },
    resolveDestination: { createProjectDirectory: createResolveDirectory },
    movieDestination: { open: openMovie },
    exportEngine: getExportEngine(),
    emitDiagnostic: emitSafeDiagnostic,
  };
}
