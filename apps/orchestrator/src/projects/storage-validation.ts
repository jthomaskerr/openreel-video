import { resolve, sep } from "node:path";

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function hasTraversalOrSeparators(value: string): boolean {
  return (
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".."
  );
}

/** Return whether a project id is safe for use as a git worktree directory. */
export function isValidProjectId(value: string): boolean {
  return !hasTraversalOrSeparators(value) && PROJECT_ID_PATTERN.test(value);
}

/** Return whether a media id is safe for use as the basename of a stored media file. */
export function isValidMediaId(value: string): boolean {
  return !hasTraversalOrSeparators(value) && MEDIA_ID_PATTERN.test(value);
}

/** Return whether a generated stored media filename is safe to serve from media/. */
export function isValidMediaFilename(value: string): boolean {
  return !hasTraversalOrSeparators(value) && !value.includes("\0");
}

export function assertValidProjectId(value: string): void {
  if (!isValidProjectId(value)) throw new Error("Invalid project id");
}

export function assertValidMediaId(value: string): void {
  if (!isValidMediaId(value)) throw new Error("Invalid media id");
}

export function assertValidMediaFilename(value: string): void {
  if (!isValidMediaFilename(value)) throw new Error("Invalid media filename");
}

/** Resolve child under base and reject paths that escape the base directory. */
export function resolveContainedPath(baseDir: string, childName: string): string {
  const basePath = resolve(baseDir);
  const childPath = resolve(basePath, childName);
  if (childPath !== basePath && !childPath.startsWith(`${basePath}${sep}`)) {
    throw new Error("Path escapes base directory");
  }
  return childPath;
}
