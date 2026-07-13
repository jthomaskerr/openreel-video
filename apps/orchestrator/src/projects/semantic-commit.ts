import type { Project } from "@openreel/core";

export interface SemanticChange { path: string; before: unknown; after: unknown }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "modifiedAt")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function collect(before: unknown, after: unknown, path: string, changes: SemanticChange[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      collect(before[index], after[index], `${path}[${index}]`, changes);
    }
    return;
  }
  if (before && after && typeof before === "object" && typeof after === "object" &&
      !Array.isArray(before) && !Array.isArray(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    for (const key of [...keys].sort()) {
      collect((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], path ? `${path}.${key}` : key, changes);
    }
    return;
  }
  changes.push({ path, before, after });
}

export function semanticProjectChanges(before: Project | null, after: Project): SemanticChange[] {
  if (!before) return [{ path: "project", before: undefined, after: canonical(after) }];
  const changes: SemanticChange[] = [];
  collect(canonical(before), canonical(after), "", changes);
  return changes;
}

function describe(change: SemanticChange): string {
  const verb = change.before === undefined ? "Add" : change.after === undefined ? "Remove" : "Update";
  return `${verb} ${change.path}`;
}

export function deterministicCommitMessage(changes: SemanticChange[], fileCount = 1): string {
  const headline = changes.length === 1 ? describe(changes[0]!).toLowerCase() : `update project with ${changes.length} semantic changes`;
  return `${headline}\n\n${changes.map((change) => `- ${describe(change)}`).join("\n")}\n\nFiles changed: ${fileCount}`;
}

export function buildSemanticCommitPrompt(diff: string, fileCount: number): string {
  return [
    "Write a Git commit message for the supplied staged diff.",
    "The first line must succinctly capture the substance of the commit.",
    `The body must list ALL semantic changes across ALL ${fileCount} changed files; omit no file and no semantic change.`,
    "Ignore timestamp-only, formatting-only, and generated metadata changes.",
    "Return only the commit message.",
    "",
    diff,
  ].join("\n");
}
