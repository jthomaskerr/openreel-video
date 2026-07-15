export interface TimelineViewState {
  playheadPosition: number;
  scrollX: number;
  scrollY: number;
}

interface StoredTimelineViewState extends TimelineViewState {
  updatedAt: number;
}

interface TimelineViewStateEnvelope {
  version: 1;
  projects: Record<string, StoredTimelineViewState>;
}

export const TIMELINE_VIEW_STATE_STORAGE_KEY = "openreel-timeline-view-state";
const MAX_PERSISTED_PROJECTS = 50;

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function sanitizePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readEnvelope(storage: Storage): TimelineViewStateEnvelope {
  try {
    const value = JSON.parse(storage.getItem(TIMELINE_VIEW_STATE_STORAGE_KEY) ?? "null");
    if (value?.version === 1 && value.projects && typeof value.projects === "object") {
      return value as TimelineViewStateEnvelope;
    }
  } catch {
    // Ignore corrupt or inaccessible persisted UI state.
  }
  return { version: 1, projects: {} };
}

export function loadTimelineViewState(projectId: string): TimelineViewState | null {
  const storage = getStorage();
  if (!storage || !projectId) return null;

  const persisted = readEnvelope(storage).projects[projectId];
  if (!persisted) return null;

  const playheadPosition = sanitizePosition(persisted.playheadPosition);
  const scrollX = sanitizePosition(persisted.scrollX);
  const scrollY = sanitizePosition(persisted.scrollY);
  if (playheadPosition === null || scrollX === null || scrollY === null) return null;

  return { playheadPosition, scrollX, scrollY };
}

export function saveTimelineViewState(
  projectId: string,
  state: TimelineViewState,
): void {
  const storage = getStorage();
  if (!storage || !projectId) return;

  const playheadPosition = sanitizePosition(state.playheadPosition);
  const scrollX = sanitizePosition(state.scrollX);
  const scrollY = sanitizePosition(state.scrollY);
  if (playheadPosition === null || scrollX === null || scrollY === null) return;

  const envelope = readEnvelope(storage);
  envelope.projects[projectId] = {
    playheadPosition,
    scrollX,
    scrollY,
    updatedAt: Date.now(),
  };

  const projectEntries = Object.entries(envelope.projects)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSISTED_PROJECTS);

  try {
    storage.setItem(
      TIMELINE_VIEW_STATE_STORAGE_KEY,
      JSON.stringify({ version: 1, projects: Object.fromEntries(projectEntries) }),
    );
  } catch {
    // Persistence is best-effort and must never block editing.
  }
}
