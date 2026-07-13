import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertValidMediaId, resolveContainedPath } from "./storage-validation";

const PENDING_DIRECTORY = ".openreel-pending-media";
export const MAX_PENDING_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;
export const DEFAULT_PENDING_MEDIA_TTL_MS = 24 * 60 * 60 * 1_000;

export interface PendingMediaEntry {
  readonly mediaId: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly uploadedAt: number;
  readonly contentPath: string;
  readonly entryDirectory: string;
}

interface StoredPendingMediaMetadata {
  readonly version: 1;
  readonly mediaId: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly uploadedAt: number;
}

export function pendingMediaRoot(projectDir: string): string {
  return join(projectDir, PENDING_DIRECTORY);
}

export function pendingUploadTempDirectory(projectDir: string): string {
  return join(pendingMediaRoot(projectDir), ".uploading");
}

export function isSupportedPendingMediaType(mimeType: string): boolean {
  return /^(?:video|audio|image)\/[a-z0-9.+-]+$/i.test(mimeType);
}

function entryDirectory(projectDir: string, mediaId: string): string {
  assertValidMediaId(mediaId);
  return resolveContainedPath(pendingMediaRoot(projectDir), mediaId);
}

export async function storePendingUpload(
  projectDir: string,
  mediaId: string,
  tempPath: string,
  originalFilename: string,
  mimeType: string,
  byteSize: number,
): Promise<PendingMediaEntry> {
  assertValidMediaId(mediaId);
  if (!isSupportedPendingMediaType(mimeType)) throw new TypeError(`Unsupported media type: ${mimeType || "unknown"}`);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_PENDING_MEDIA_BYTES) {
    throw new RangeError("Pending media byte size is invalid");
  }
  const uploaded = await stat(tempPath);
  if (!uploaded.isFile() || uploaded.size !== byteSize) throw new Error("Pending upload byte size validation failed");

  const directory = entryDirectory(projectDir, mediaId);
  if (await readPendingMedia(projectDir, mediaId)) {
    throw new Error(`Pending media ${mediaId} already exists`);
  }
  await mkdir(pendingMediaRoot(projectDir), { recursive: true });
  const replacement = join(pendingMediaRoot(projectDir), `.replacement-${mediaId}-${crypto.randomUUID()}`);
  try {
    await mkdir(replacement);
    const contentPath = join(replacement, "content");
    await rename(tempPath, contentPath);
    const metadata: StoredPendingMediaMetadata = {
      version: 1,
      mediaId,
      originalFilename,
      mimeType,
      byteSize,
      uploadedAt: Date.now(),
    };
    await writeFile(join(replacement, "metadata.json"), JSON.stringify(metadata), { flag: "wx" });
    await rename(replacement, directory);
    return { ...metadata, contentPath: join(directory, "content"), entryDirectory: directory };
  } finally {
    await rm(replacement, { recursive: true, force: true });
  }
}

export async function readPendingMedia(projectDir: string, mediaId: string): Promise<PendingMediaEntry | null> {
  const directory = entryDirectory(projectDir, mediaId);
  try {
    const metadata = JSON.parse(await readFile(join(directory, "metadata.json"), "utf8")) as StoredPendingMediaMetadata;
    const contentPath = join(directory, "content");
    const content = await stat(contentPath);
    if (metadata.version !== 1 || metadata.mediaId !== mediaId || !isSupportedPendingMediaType(metadata.mimeType)
      || !content.isFile() || content.size !== metadata.byteSize) {
      throw new Error(`Invalid pending media entry ${mediaId}`);
    }
    return { ...metadata, contentPath, entryDirectory: directory };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listPendingMedia(projectDir: string): Promise<PendingMediaEntry[]> {
  let names: string[];
  try {
    names = await readdir(pendingMediaRoot(projectDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: PendingMediaEntry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue;
    try {
      const entry = await readPendingMedia(projectDir, name);
      if (entry) entries.push(entry);
    } catch {
      // Invalid entries stay outside saved membership and are removable through cleanup.
    }
  }
  return entries;
}

export async function removePendingMedia(projectDir: string, mediaId: string): Promise<void> {
  await rm(entryDirectory(projectDir, mediaId), { recursive: true, force: true });
}

export async function cleanupExpiredPendingMedia(
  projectDir: string,
  now = Date.now(),
  ttlMs = DEFAULT_PENDING_MEDIA_TTL_MS,
): Promise<string[]> {
  const removed: string[] = [];
  for (const entry of await listPendingMedia(projectDir)) {
    if (now - entry.uploadedAt < ttlMs) continue;
    await removePendingMedia(projectDir, entry.mediaId);
    removed.push(entry.mediaId);
  }
  const root = pendingMediaRoot(projectDir);
  const partials = await readdir(root).catch(() => []);
  for (const name of partials) {
    const currentReplacement = name.startsWith(".replacement-");
    const legacyReplacement = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.[0-9a-f]{8}-[0-9a-f-]{27}\.replacement$/i.test(name);
    if (!currentReplacement && !legacyReplacement) continue;
    const path = resolveContainedPath(root, name);
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs >= ttlMs) await rm(path, { recursive: true, force: true });
  }
  const uploading = pendingUploadTempDirectory(projectDir);
  for (const name of await readdir(uploading).catch(() => [])) {
    const path = resolveContainedPath(uploading, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs >= ttlMs) await rm(path, { force: true });
  }
  return removed;
}
