import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Clip, Project } from "@openreel/core";
import {
  serializeRequiredMediaManifest,
  type RequiredMediaManifestEntry,
} from "../../../../packages/core/src/project-persistence";
import {
  verifyGitLfsPayloads,
  type LfsPayloadVerification,
  type LfsVerificationOptions,
} from "./lfs-integrity";

interface MediaFileInfo {
  readonly filename: string;
  readonly byteSize: number;
}

export interface ProjectMediaManifestDuplicateIssue {
  readonly field: "mediaId" | "relativePhysicalPath";
  readonly value: string;
  readonly mediaIds: readonly string[];
  readonly semanticFilenames: readonly string[];
}

export interface ProjectMediaManifestMissingEntry extends RequiredMediaManifestEntry {
  readonly actualFilename: string | null;
}

export interface ProjectMediaManifestFilenameMismatch {
  readonly mediaId: string;
  readonly semanticFilename: string;
  readonly actualFilename: string;
  readonly relativePhysicalPath: string;
}

export interface ProjectMediaManifestByteSizeMismatch {
  readonly mediaId: string;
  readonly semanticFilename: string;
  readonly relativePhysicalPath: string;
  readonly expectedByteSize: number;
  readonly actualByteSize: number;
}

export interface ProjectMediaManifestDanglingClip {
  readonly clipId: string;
  readonly mediaId: string;
  readonly trackId: string;
  readonly clipType: Clip["type"];
}

export interface ProjectMediaManifestSnapshot {
  readonly mediaManifestDigest: string | null;
  readonly requiredMediaManifest: readonly RequiredMediaManifestEntry[];
  /** Availability evidence; excluded from mediaManifestDigest by design. */
  readonly lfsPayloads: readonly LfsPayloadVerification[];
  readonly missingEntries: readonly ProjectMediaManifestMissingEntry[];
  readonly duplicateIssues: readonly ProjectMediaManifestDuplicateIssue[];
  readonly filenameMismatches: readonly ProjectMediaManifestFilenameMismatch[];
  readonly byteSizeMismatches: readonly ProjectMediaManifestByteSizeMismatch[];
  readonly danglingClips: readonly ProjectMediaManifestDanglingClip[];
}

export interface ProjectMediaManifestAuditOptions extends LfsVerificationOptions {
  /** Worktree containing the committed LFS pointers for the manifest. */
  readonly lfsRepoDir?: string;
  /** Load-only compatibility: report dangling clips without rejecting the confirmed snapshot. */
  readonly allowDanglingClips?: boolean;
}

export class ProjectMediaManifestAuditError extends Error {
  constructor(
    readonly snapshot: ProjectMediaManifestSnapshot,
  ) {
    super("Project media manifest audit failed");
    this.name = "ProjectMediaManifestAuditError";
  }
}

function isVirtualMediaId(mediaId: string): boolean {
  return (
    mediaId.startsWith("text-") ||
    mediaId.startsWith("shape-") ||
    mediaId.startsWith("svg-") ||
    mediaId.startsWith("sticker-") ||
    mediaId.startsWith("emoji-")
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function mediaRelativePath(filename: string): string {
  return normalizePathSeparators(join("media", filename));
}

async function scanMediaDirectory(mediaDir: string): Promise<Map<string, MediaFileInfo>> {
  const entries = await readdir(mediaDir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile());
  const result = new Map<string, MediaFileInfo>();

  for (const entry of files) {
    const filename = entry.name;
    const fileStat = await stat(join(mediaDir, filename));
    result.set(filename, {
      filename,
      byteSize: fileStat.size,
    });
  }

  return result;
}

export function buildRequiredMediaManifest(project: Project): RequiredMediaManifestEntry[] {
  return project.mediaLibrary.items
    .filter((item) => !isVirtualMediaId(item.id))
    .map((item) => ({
      mediaId: item.id,
      semanticFilename: item.name,
      relativePhysicalPath: mediaRelativePath(item.name),
      expectedByteSize: item.metadata.fileSize,
    }))
    .sort((left, right) => compareStrings(left.mediaId, right.mediaId));
}

function detectDuplicateIssues(
  entries: readonly RequiredMediaManifestEntry[],
): ProjectMediaManifestDuplicateIssue[] {
  const byMediaId = new Map<string, RequiredMediaManifestEntry[]>();
  const byPath = new Map<string, RequiredMediaManifestEntry[]>();

  for (const entry of entries) {
    const mediaList = byMediaId.get(entry.mediaId) ?? [];
    mediaList.push(entry);
    byMediaId.set(entry.mediaId, mediaList);

    const pathList = byPath.get(entry.relativePhysicalPath) ?? [];
    pathList.push(entry);
    byPath.set(entry.relativePhysicalPath, pathList);
  }

  const duplicates: ProjectMediaManifestDuplicateIssue[] = [];

  for (const [mediaId, duplicateEntries] of byMediaId) {
    if (duplicateEntries.length < 2) continue;
    duplicates.push({
      field: "mediaId",
      value: mediaId,
      mediaIds: duplicateEntries.map((entry) => entry.mediaId),
      semanticFilenames: duplicateEntries.map((entry) => entry.semanticFilename),
    });
  }

  for (const [relativePhysicalPath, duplicateEntries] of byPath) {
    if (duplicateEntries.length < 2) continue;
    duplicates.push({
      field: "relativePhysicalPath",
      value: relativePhysicalPath,
      mediaIds: duplicateEntries.map((entry) => entry.mediaId),
      semanticFilenames: duplicateEntries.map((entry) => entry.semanticFilename),
    });
  }

  return duplicates;
}

function detectDanglingClips(project: Project): ProjectMediaManifestDanglingClip[] {
  const mediaIds = new Set(
    project.mediaLibrary.items
      .filter((item) => !isVirtualMediaId(item.id))
      .map((item) => item.id),
  );
  const dangling: ProjectMediaManifestDanglingClip[] = [];

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (isVirtualMediaId(clip.mediaId)) continue;
      if (mediaIds.has(clip.mediaId)) continue;
      dangling.push({
        clipId: clip.id,
        mediaId: clip.mediaId,
        trackId: track.id,
        clipType: clip.type,
      });
    }
  }

  return dangling;
}

export async function auditProjectMediaManifest(
  project: Project,
  mediaDir: string,
  options: ProjectMediaManifestAuditOptions = {},
): Promise<ProjectMediaManifestSnapshot> {
  const requiredMediaManifest = buildRequiredMediaManifest(project);
  const duplicateIssues = detectDuplicateIssues(requiredMediaManifest);
  const mediaFiles = await scanMediaDirectory(mediaDir);

  const missingEntries: ProjectMediaManifestMissingEntry[] = [];
  const filenameMismatches: ProjectMediaManifestFilenameMismatch[] = [];
  const byteSizeMismatches: ProjectMediaManifestByteSizeMismatch[] = [];

  for (const entry of requiredMediaManifest) {
    const actual = mediaFiles.get(entry.semanticFilename)
      ?? [...mediaFiles.values()].find((file) => basename(file.filename, extname(file.filename)) === entry.mediaId);
    if (!actual) {
      missingEntries.push({
        ...entry,
        actualFilename: null,
      });
      continue;
    }

    if (actual.filename !== entry.semanticFilename) {
      filenameMismatches.push({
        mediaId: entry.mediaId,
        semanticFilename: entry.semanticFilename,
        actualFilename: actual.filename,
        relativePhysicalPath: mediaRelativePath(actual.filename),
      });
    }

    if (actual.byteSize !== entry.expectedByteSize) {
      byteSizeMismatches.push({
        mediaId: entry.mediaId,
        semanticFilename: entry.semanticFilename,
        relativePhysicalPath: mediaRelativePath(actual.filename),
        expectedByteSize: entry.expectedByteSize,
        actualByteSize: actual.byteSize,
      });
    }
  }

  const danglingClips = detectDanglingClips(project);
  const lfsPayloads = options.lfsRepoDir
      ? await verifyGitLfsPayloads(options.lfsRepoDir, requiredMediaManifest, {
        remote: options.remote,
        checkRemoteObject: options.checkRemoteObject,
        pointerSource: options.pointerSource,
      })
    : [];

  const mediaManifestDigest =
    duplicateIssues.length === 0
      ? createHash("sha256")
          .update(serializeRequiredMediaManifest(requiredMediaManifest), "utf8")
          .digest("hex")
      : null;

  const snapshot: ProjectMediaManifestSnapshot = {
    mediaManifestDigest,
    requiredMediaManifest,
    lfsPayloads,
    missingEntries,
    duplicateIssues,
    filenameMismatches,
    byteSizeMismatches,
    danglingClips,
  };

  if (
    missingEntries.length > 0 ||
    duplicateIssues.length > 0 ||
    filenameMismatches.length > 0 ||
    byteSizeMismatches.length > 0 ||
    (!options.allowDanglingClips && danglingClips.length > 0) ||
    lfsPayloads.some(
      (payload) =>
        payload.local.state !== "verified" ||
        (options.remote != null && payload.remote.state !== "durable"),
    )
  ) {
    throw new ProjectMediaManifestAuditError(snapshot);
  }

  return snapshot;
}
