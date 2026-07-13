import { parse } from "node:path";

export type UnicodeNormalizationForm = "NFC" | "NFD";

export interface MediaFilenamePolicy {
  readonly caseSensitive: boolean;
  readonly unicodeNormalization: UnicodeNormalizationForm;
}

export interface MediaFilenameResolution {
  readonly persistedBasename: string;
  readonly comparisonKey: string;
}

export type OccupiedMediaFilename =
  | string
  | Readonly<Pick<MediaFilenameResolution, "comparisonKey">>;

const UNNAMED_STEM = "untitled";

function toComparisonKey(value: string, policy: MediaFilenamePolicy): string {
  const normalized = value.normalize(policy.unicodeNormalization);
  return policy.caseSensitive ? normalized : normalized.toLowerCase();
}

function leafFilename(value: string, policy: MediaFilenamePolicy): string {
  return value.normalize(policy.unicodeNormalization).replaceAll("\\", "/").split("/").pop() ?? "";
}

function sanitizeStem(stem: string): string {
  return stem.replace(/^\.+/, "").replace(/\.+$/, "").trim();
}

function sanitizeLeafFilename(value: string, policy: MediaFilenamePolicy): string {
  const leaf = leafFilename(value, policy).trim();
  if (leaf === "" || leaf === "." || leaf === "..") return UNNAMED_STEM;

  const parsed = parse(leaf);
  const stem = sanitizeStem(parsed.name);
  const ext = parsed.ext === "." ? "" : parsed.ext;

  if (stem === "") return ext ? `${UNNAMED_STEM}${ext}` : UNNAMED_STEM;
  return `${stem}${ext}`;
}

function appendCollisionSuffix(basename: string, attempt: number): string {
  if (attempt === 0) return basename;
  const parsed = parse(basename);
  const ext = parsed.ext === "." ? "" : parsed.ext;
  return `${parsed.name} ${attempt}${ext}`;
}

export function sanitizeProjectFilename(
  desired: string,
  policy: MediaFilenamePolicy,
): MediaFilenameResolution {
  const persistedBasename = sanitizeLeafFilename(desired, policy);
  return {
    persistedBasename,
    comparisonKey: toComparisonKey(persistedBasename, policy),
  };
}

export function allocateMediaFilename(
  desired: string,
  occupied: Iterable<OccupiedMediaFilename>,
  policy: MediaFilenamePolicy,
): MediaFilenameResolution {
  const sanitized = sanitizeProjectFilename(desired, policy);
  const occupiedKeys = new Set<string>();

  for (const entry of occupied) {
    occupiedKeys.add(typeof entry === "string" ? sanitizeProjectFilename(entry, policy).comparisonKey : entry.comparisonKey);
  }

  let attempt = 0;
  for (;;) {
    const persistedBasename = appendCollisionSuffix(sanitized.persistedBasename, attempt);
    const comparisonKey = toComparisonKey(persistedBasename, policy);
    if (!occupiedKeys.has(comparisonKey)) {
      return { persistedBasename, comparisonKey };
    }
    attempt++;
  }
}
