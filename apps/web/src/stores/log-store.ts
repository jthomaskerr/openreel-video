import { create } from "zustand";

// ── Log kind — broader than ProblemKind; includes infrastructure sources ──

export type LogKind = string;

// ── Log entry type — immutable global error record ───────────────────

export interface LogEntry {
  id: string;
  kind: LogKind;
  message: string;
  label: string;
  timestamp: number;
  projectId?: string;
  projectName?: string;
  clipId?: string;
  trackName?: string;
  source?: string;
}

// ── Log entry creation input — project/clip metadata optional ────────

export interface LogEntryInput {
  kind: LogKind;
  message: string;
  label: string;
  projectId?: string;
  projectName?: string;
  clipId?: string;
  trackName?: string;
  source?: string;
}

// ── Filter shape ─────────────────────────────────────────────────────

export interface LogFilter {
  /** Filter to specific problem kinds */
  kinds?: LogKind[];
  /** Filter to specific project IDs */
  projectIds?: string[];
  /** Filter to specific clip IDs */
  clipIds?: string[];
  /** Only show entries after this timestamp */
  since?: number;
  /** Only show entries before this timestamp */
  until?: number;
  /** Free-text search across message + label */
  search?: string;
}

// ── Store state ──────────────────────────────────────────────────────

interface LogState {
  entries: LogEntry[];
  addEntry: (input: LogEntryInput) => string;
  getFiltered: (filter: LogFilter) => LogEntry[];
  getProjectIds: () => string[];
  getClipIds: () => string[];
}

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],

  addEntry: (input: LogEntryInput): string => {
    const id = createDurableId("log");
    const entry: LogEntry = {
      id,
      kind: input.kind,
      message: input.message,
      label: input.label,
      timestamp: Date.now(),
      projectId: input.projectId,
      projectName: input.projectName,
      clipId: input.clipId,
      trackName: input.trackName,
      source: input.source,
    };
    set((state) => ({
      entries: [...state.entries, entry],
    }));
    return id;
  },

  getFiltered: (filter: LogFilter): LogEntry[] => {
    const { entries } = get();
    let result = entries;

    if (filter.kinds && filter.kinds.length > 0) {
      result = result.filter((e) => filter.kinds!.includes(e.kind));
    }
    if (filter.projectIds && filter.projectIds.length > 0) {
      result = result.filter(
        (e) => e.projectId && filter.projectIds!.includes(e.projectId),
      );
    }
    if (filter.clipIds && filter.clipIds.length > 0) {
      result = result.filter(
        (e) => e.clipId && filter.clipIds!.includes(e.clipId),
      );
    }
    if (filter.since != null) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until != null) {
      result = result.filter((e) => e.timestamp <= filter.until!);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q),
      );
    }

    return result;
  },

  getProjectIds: (): string[] => {
    const ids = new Set<string>();
    for (const e of get().entries) {
      if (e.projectId) ids.add(e.projectId);
    }
    return [...ids];
  },

  getClipIds: (): string[] => {
    const ids = new Set<string>();
    for (const e of get().entries) {
      if (e.clipId) ids.add(e.clipId);
    }
    return [...ids];
  },
}));

// ── Convenience: pipe an error to the log bus directly ────────────────

export const logBus = {
  entry(input: LogEntryInput): string {
    return useLogStore.getState().addEntry(input);
  },
};
import { createDurableId } from "@openreel/core";
