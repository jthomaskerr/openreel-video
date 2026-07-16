import type { Project } from "./types/project";

type SaveProjectMediaItem = Omit<Project["mediaLibrary"]["items"][number], "blob" | "fileHandle">;

type SaveProjectSnapshot = Omit<Project, "mediaLibrary"> & {
  readonly mediaLibrary: {
    readonly items: readonly SaveProjectMediaItem[];
  };
};

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export interface ProjectBaseRevision {
  readonly commitSha: string;
  readonly treeSha: string;
  readonly projectBlobSha: string;
  readonly sourceModifiedAt: number;
}

export interface RequiredMediaManifestEntry {
  readonly mediaId: string;
  readonly semanticFilename: string;
  readonly relativePhysicalPath: string;
  readonly expectedByteSize: number;
  readonly lfsOid?: string;
}

export interface ProjectSaveLfsPayloadVerification {
  readonly mediaId: string;
  readonly semanticFilename: string;
  readonly relativePhysicalPath: string;
  readonly oid: `sha256:${string}`;
  readonly pointerSize: number;
  readonly local:
    | { readonly state: "verified"; readonly actualSize: number }
    | { readonly state: "missing"; readonly actualSize: null }
    | { readonly state: "size-mismatch" | "oid-mismatch"; readonly actualSize: number };
  readonly remote:
    | { readonly state: "local-only"; readonly remote: null }
    | {
        readonly state: "durable" | "upload-required" | "unreachable";
        readonly remote: string;
      };
}

export interface ProjectSaveRequest {
  readonly projectId: string;
  readonly baseRevision: ProjectBaseRevision;
  readonly project: SaveProjectSnapshot;
  readonly requiredMediaManifest: readonly RequiredMediaManifestEntry[];
  readonly saveIntent?: "autosave" | "user" | "retry" | "recovery";
  readonly destructiveIntent?: boolean;
}

export interface ProjectSaveReceipt {
  readonly saved: true;
  readonly projectId: string;
  readonly persistedAt: number | null;
  readonly sourceModifiedAt: number;
  readonly commitSha: string | null;
  readonly treeSha: string | null;
  readonly projectBlobSha: string | null;
  readonly mediaManifestDigest: string | null;
  readonly lfsPayloads: readonly ProjectSaveLfsPayloadVerification[];
  readonly committed?: boolean;
  readonly commitDueAt: number | null;
}

export type ProjectPersistenceState =
  | "clean"
  | "waiting"
  | "committing"
  | "retry-wait"
  | "settled-metadata-only";

export interface ProjectPersistenceStatusResponse {
  readonly projectId: string;
  readonly state: ProjectPersistenceState;
  readonly sourceModifiedAt: number;
  readonly commitDueAt: number | null;
  readonly error: string | null;
  readonly receipt: ProjectSaveReceipt | null;
}

export interface ProjectSaveMediaIncompleteResponse {
  readonly saved: false;
  readonly code: "MEDIA_INCOMPLETE";
  readonly projectId: string;
  readonly missingItems: readonly RequiredMediaManifestEntry[];
}

export interface ProjectSaveConflictResponse {
  readonly saved: false;
  readonly code: "PROJECT_CONFLICT";
  readonly projectId: string;
  readonly submittedBaseRevision: ProjectBaseRevision;
  readonly currentBaseRevision: ProjectBaseRevision;
}

export interface ProjectSaveDestructiveChangeRequiresIntentResponse {
  readonly saved: false;
  readonly code: "DESTRUCTIVE_CHANGE_REQUIRES_INTENT";
  readonly projectId: string;
  readonly submittedBaseRevision: ProjectBaseRevision;
  readonly currentBaseRevision: ProjectBaseRevision;
  readonly mediaCountDelta: number;
  readonly clipCountDelta: number;
  readonly trackCountDelta: number;
  readonly serializedStructuralSizeDelta: number;
}

export function serializeRequiredMediaManifest(
  entries: readonly RequiredMediaManifestEntry[],
): string {
  const canonicalEntries = entries
    .map((entry) => ({
      mediaId: entry.mediaId,
      semanticFilename: normalizePathSeparators(entry.semanticFilename),
      relativePhysicalPath: normalizePathSeparators(entry.relativePhysicalPath),
      expectedByteSize: entry.expectedByteSize,
      ...(entry.lfsOid === undefined ? {} : { lfsOid: entry.lfsOid }),
    }))
    .sort((left, right) => compareStrings(left.mediaId, right.mediaId));

  const seenMediaIds = new Set<string>();
  const seenRelativePaths = new Set<string>();

  for (const entry of canonicalEntries) {
    if (seenMediaIds.has(entry.mediaId)) {
      throw new Error(`Duplicate mediaId in required media manifest: ${entry.mediaId}`);
    }
    seenMediaIds.add(entry.mediaId);

    if (seenRelativePaths.has(entry.relativePhysicalPath)) {
      throw new Error(
        `Duplicate relativePhysicalPath in required media manifest: ${entry.relativePhysicalPath}`,
      );
    }
    seenRelativePaths.add(entry.relativePhysicalPath);
  }

  return JSON.stringify(canonicalEntries);
}
