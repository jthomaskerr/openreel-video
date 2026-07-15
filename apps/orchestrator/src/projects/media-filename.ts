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
const MAX_BASENAME_BYTES = 255;

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
}

function fitBasename(basename: string, suffix = ""): string {
  const parsed = parse(basename);
  const ext = parsed.ext === "." ? "" : parsed.ext;
  const reservedBytes = Buffer.byteLength(`${suffix}${ext}`, "utf8");
  if (reservedBytes >= MAX_BASENAME_BYTES) {
    return truncateUtf8(`${parsed.name}${suffix}${ext}`, MAX_BASENAME_BYTES);
  }
  return `${truncateUtf8(parsed.name, MAX_BASENAME_BYTES - reservedBytes)}${suffix}${ext}`;
}

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

  if (stem === "") return fitBasename(ext ? `${UNNAMED_STEM}${ext}` : UNNAMED_STEM);
  return fitBasename(`${stem}${ext}`);
}

function appendCollisionSuffix(basename: string, attempt: number): string {
  const parsed = parse(basename);
  const ext = parsed.ext === "." ? "" : parsed.ext;
  const numberedStem = /^(.*) ([1-9]\d*)$/.exec(parsed.name);
  const existingSuffix = numberedStem ? Number(numberedStem[2]) : 0;
  const canIncrement = Number.isSafeInteger(existingSuffix + attempt);
  const stem = numberedStem && canIncrement ? numberedStem[1] : parsed.name;
  const suffixNumber = canIncrement ? existingSuffix + attempt : attempt;
  return fitBasename(`${stem}${ext}`, suffixNumber === 0 ? "" : ` ${suffixNumber}`);
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
