import { StorageEngine } from "@openreel/core";
import type { MediaRecord, MediaMetadata } from "@openreel/core";

const storage = new StorageEngine();

export async function saveMediaBlob(
  projectId: string,
  mediaId: string,
  blob: Blob,
  metadata: MediaMetadata,
): Promise<void> {
  const record: MediaRecord = {
    id: mediaId,
    projectId,
    blob,
    metadata,
  };

  await storage.saveMedia(record);
}

export async function loadMediaBlob(mediaId: string): Promise<Blob | null> {
  const record = await storage.loadMedia(mediaId);
  return record?.blob || null;
}

export async function loadMediaRecord(
  mediaId: string,
): Promise<MediaRecord | null> {
  return storage.loadMedia(mediaId);
}

export async function loadProjectMedia(
  projectId: string,
): Promise<MediaRecord[]> {
  return storage.getMediaByProject(projectId);
}

export async function deleteMediaBlob(mediaId: string): Promise<void> {
  await storage.deleteMedia(mediaId);
}

export async function deleteProjectMedia(projectId: string): Promise<void> {
  const records = await storage.getMediaByProject(projectId);
  for (const record of records) {
    await storage.deleteMedia(record.id);
  }
}

export async function saveFileHandle(name: string, size: number, handle: FileSystemFileHandle): Promise<void> {
  await storage.saveFileHandle(name, size, handle);
}

export async function loadFileHandle(name: string, size: number): Promise<FileSystemFileHandle | null> {
  return storage.loadFileHandle(name, size);
}

export async function saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await storage.saveDirectoryHandle(projectId, handle);
}

export async function loadDirectoryHandle(projectId: string): Promise<{ handle: FileSystemDirectoryHandle; folderName: string } | null> {
  return storage.loadDirectoryHandle(projectId);
}

/** A file found during recursive directory scanning. */
export interface FoundFileEntry {
  file: File;
  handle: FileSystemFileHandle;
  ambiguous?: boolean;
}

export function addRelinkCandidate(
  fileMap: Map<string, FoundFileEntry>,
  entry: FoundFileEntry,
): void {
  const key = `${entry.file.name.toLowerCase()}:${entry.file.size}`;
  const existing = fileMap.get(key);
  if (existing) {
    fileMap.set(key, { ...existing, ambiguous: true });
    return;
  }
  fileMap.set(key, { ...entry, ambiguous: false });
}

/**
 * Recursively scan a directory handle, collecting all files with their handles.
 * Directories are traversed breadth-first; file name collisions are resolved
 * by keeping the first file found (shallower nesting wins).
 */
export async function scanDirectoryRecursive(
  dirHandle: FileSystemDirectoryHandle,
): Promise<Map<string, FoundFileEntry>> {
  const fileMap = new Map<string, FoundFileEntry>();
  const pending: FileSystemDirectoryHandle[] = [dirHandle];

  while (pending.length > 0) {
    const current = pending.shift()!;
    try {
      for await (const [, handle] of current as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === "file") {
          const fh = handle as FileSystemFileHandle;
          const file = await fh.getFile();
          addRelinkCandidate(fileMap, { file, handle: fh });
        } else if (handle.kind === "directory") {
          pending.push(handle as FileSystemDirectoryHandle);
        }
      }
    } catch (error) {
      console.warn("[MediaStorage] Could not scan a relink directory", {
        directory: current.name,
        error,
      });
      continue;
    }
  }

  return fileMap;
}

export async function getStorageStats(): Promise<{
  used: number;
  quota: number;
  mediaCount: number;
}> {
  const usage = await storage.getStorageUsage();
  return {
    used: usage.used,
    quota: usage.quota,
    mediaCount: usage.mediaItems,
  };
}

export async function clearAllStorage(): Promise<void> {
  await storage.clearAllData();

  const databasesToDelete = ["openreel-autosave", "openreel-projects", "openreel-templates"];
  await Promise.allSettled(
    databasesToDelete.map(
      (dbName) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve();
        }),
    ),
  );
}
