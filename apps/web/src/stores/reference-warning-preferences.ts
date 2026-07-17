export type ReferenceWarningClass = "reference-overflow" | "reference-excluded";

const STORAGE_KEY = "openreel-reference-warning-preferences";

let memorySuppressedWarnings = new Set<string>();

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readSuppressedWarnings(): Set<string> {
  if (!canUseLocalStorage()) {
    return new Set(memorySuppressedWarnings);
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeSuppressedWarnings(values: ReadonlySet<string>): void {
  memorySuppressedWarnings = new Set(values);
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...values].sort()));
  } catch {
    // Ignore storage failures. The in-memory fallback still scopes the current session.
  }
}

export function isReferenceWarningSuppressed(
  warningClass: ReferenceWarningClass | string,
): boolean {
  return readSuppressedWarnings().has(warningClass);
}

export function suppressReferenceWarning(
  warningClass: ReferenceWarningClass | string,
): void {
  const next = readSuppressedWarnings();
  next.add(warningClass);
  writeSuppressedWarnings(next);
}

export function clearReferenceWarningPreferences(): void {
  memorySuppressedWarnings = new Set();
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures while clearing tests or session state.
  }
}
