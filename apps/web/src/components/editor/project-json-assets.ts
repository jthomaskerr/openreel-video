import type { Clip, MediaItem, Project } from "@openreel/core";

export interface ProjectAssetFileMatch {
  readonly mediaId: string;
  readonly file: File;
  readonly sourceFolder?: string;
}

export interface ProjectJsonAssetFile {
  readonly file: File;
  readonly relativePath?: string;
}

interface AssetReference {
  readonly mediaId: string;
  readonly sourceFile?: MediaItem["sourceFile"];
  readonly paths: readonly string[];
}

type FileWithRelativePath = File & { readonly webkitRelativePath?: string };

const RELATIVE_PATH_KEYS = [
  "path",
  "localPath",
  "relativePath",
  "sourcePath",
  "sourceFilePath",
  "filePath",
  "url",
  "src",
] as const;

export function matchProjectJsonAssetFiles(
  project: Project,
  files: readonly ProjectJsonAssetFile[],
  jsonRelativePath?: string,
): ProjectAssetFileMatch[] {
  if (files.length === 0) return [];

  const filesByPath = new Map<string, File>();
  const filesByNameAndSize = new Map<string, File>();
  const filesByName = new Map<string, File | null>();

  for (const entry of files) {
    const { file } = entry;
    const relativePath = normalizeRelativePath(
      entry.relativePath || (file as FileWithRelativePath).webkitRelativePath || file.name,
    );
    if (relativePath) {
      filesByPath.set(relativePath, file);
    }

    filesByNameAndSize.set(nameAndSizeKey(file.name, file.size), file);

    const nameKey = file.name.toLowerCase();
    if (filesByName.has(nameKey)) {
      filesByName.set(nameKey, null);
    } else {
      filesByName.set(nameKey, file);
    }
  }

  const matches: ProjectAssetFileMatch[] = [];
  for (const reference of collectAssetReferences(project)) {
    const match = findMatchingFile(reference, filesByPath, filesByNameAndSize, filesByName, jsonRelativePath);
    if (match) {
      matches.push({
        mediaId: reference.mediaId,
        file: match,
        sourceFolder: sourceFolderFor(match, files),
      });
    }
  }

  return matches;
}

function collectAssetReferences(project: Project): AssetReference[] {
  const clipsByMediaId = new Map<string, Clip[]>();
  for (const track of project.timeline.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (!clip.mediaId) continue;
      const clips = clipsByMediaId.get(clip.mediaId) ?? [];
      clips.push(clip);
      clipsByMediaId.set(clip.mediaId, clips);
    }
  }

  return project.mediaLibrary.items.map((item) => {
    const paths = new Set<string>();
    addMediaItemPaths(paths, item);

    for (const clip of clipsByMediaId.get(item.id) ?? []) {
      addMetadataPaths(paths, clip.metadata);
    }

    return {
      mediaId: item.id,
      sourceFile: item.sourceFile,
      paths: [...paths],
    };
  });
}

function addMediaItemPaths(paths: Set<string>, item: MediaItem): void {
  if (item.sourceFile?.folder) {
    paths.add(`${item.sourceFile.folder}/${item.sourceFile.name}`);
  }
  if (item.sourceFile?.name) {
    paths.add(item.sourceFile.name);
  }
  addIfRelativePath(paths, item.originalUrl);
  addIfRelativePath(paths, item.thumbnailUrl ?? undefined);
  addIfRelativePath(paths, (item as MediaItem & { readonly remoteUrl?: string }).remoteUrl);
}

function addMetadataPaths(paths: Set<string>, metadata: Clip["metadata"]): void {
  if (!metadata) return;

  const rawSourceFile = metadata.sourceFile;
  if (rawSourceFile && typeof rawSourceFile === "object") {
    const sourceFile = rawSourceFile as Record<string, unknown>;
    const name = typeof sourceFile.name === "string" ? sourceFile.name : undefined;
    const folder = typeof sourceFile.folder === "string" ? sourceFile.folder : undefined;
    if (name && folder) paths.add(`${folder}/${name}`);
    if (name) paths.add(name);
  }

  for (const key of RELATIVE_PATH_KEYS) {
    addIfRelativePath(paths, metadata[key]);
  }
}

function addIfRelativePath(paths: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const normalized = normalizeRelativePath(value);
  if (normalized) paths.add(value);
}

function findMatchingFile(
  reference: AssetReference,
  filesByPath: ReadonlyMap<string, File>,
  filesByNameAndSize: ReadonlyMap<string, File>,
  filesByName: ReadonlyMap<string, File | null>,
  jsonRelativePath: string | undefined,
): File | null {
  for (const candidate of reference.paths) {
    const resolved = resolveAgainstJsonFile(candidate, jsonRelativePath);
    if (resolved) {
      const byPath = filesByPath.get(resolved);
      if (byPath) return byPath;
    }
  }

  if (reference.sourceFile) {
    const byNameAndSize = filesByNameAndSize.get(
      nameAndSizeKey(reference.sourceFile.name, reference.sourceFile.size),
    );
    if (byNameAndSize) return byNameAndSize;
  }

  for (const candidate of reference.paths) {
    const fileName = basename(candidate).toLowerCase();
    const byName = filesByName.get(fileName);
    if (byName) return byName;
  }

  return null;
}

function resolveAgainstJsonFile(candidate: string, jsonRelativePath: string | undefined): string | null {
  const normalized = normalizeRelativePath(candidate);
  if (!normalized) return null;

  const jsonPath = normalizeRelativePath(jsonRelativePath ?? "");
  const jsonDir = jsonPath?.includes("/") ? jsonPath.slice(0, jsonPath.lastIndexOf("/")) : "";
  return normalizeRelativePath(jsonDir ? `${jsonDir}/${normalized}` : normalized);
}

function normalizeRelativePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith("/") || /^[a-z]:[\\/]/i.test(trimmed)) return null;

  const parts: string[] = [];
  for (const part of trimmed.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.length > 0 ? parts.join("/").toLowerCase() : null;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function nameAndSizeKey(name: string, size: number): string {
  return `${name.toLowerCase()}:${size}`;
}

function sourceFolderFor(file: File, files: readonly ProjectJsonAssetFile[]): string | undefined {
  const entry = files.find((candidate) => candidate.file === file);
  const relativePath = entry?.relativePath || (file as FileWithRelativePath).webkitRelativePath;
  if (!relativePath || !relativePath.includes("/")) return undefined;
  return relativePath.slice(0, relativePath.lastIndexOf("/"));
}
