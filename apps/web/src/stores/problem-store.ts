import { create } from "zustand";

// ── Problem type — generalizes ImportError ──────────────────────────

export type ProblemKind =
  | "block_failed"
  | "missing_media"
  | "image_failed"
  | "bridge_error"
  | "engine_error"
  | "import_error"
  | "export_error"
  | "effect_error"
  | "render_error"
  | "audio_error"
  | "text_error"
  | "graphics_error"
  | "photo_error"
  | "transition_error"
  | "playback_error"
  | "media_error"
  | "unknown_error";

// ── Resolve actions — what the user can do about a problem ──────────

export type ResolveActionId =
  | "link_file"
  | "remove_media"
  | "retry_import"
  | "retry_render"
  | "retry_export"
  | "restart_engine"
  | "reload_bridge"
  | "dismiss";

export interface ResolveAction {
  id: ResolveActionId;
  label: string;
  /** If true, executing this action marks the problem resolved */
  resolves: boolean;
}

// ── Resolve actions per kind — what actions are available ───────────

export const RESOLVE_ACTIONS_BY_KIND: Record<
  ProblemKind,
  ResolveAction[]
> = {
  missing_media: [
    { id: "link_file", label: "Link File", resolves: true },
    { id: "remove_media", label: "Remove", resolves: true },
    { id: "dismiss", label: "Ignore", resolves: true },
  ],
  block_failed: [
    { id: "retry_import", label: "Retry", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  image_failed: [
    { id: "retry_import", label: "Retry", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  bridge_error: [
    { id: "reload_bridge", label: "Reload Bridge", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  engine_error: [
    { id: "restart_engine", label: "Restart Engine", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  import_error: [
    { id: "retry_import", label: "Retry", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  export_error: [
    { id: "retry_export", label: "Retry Export", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  render_error: [
    { id: "retry_render", label: "Retry Render", resolves: false },
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  effect_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  audio_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  text_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  graphics_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  photo_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  transition_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  playback_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  media_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
  unknown_error: [
    { id: "dismiss", label: "Dismiss", resolves: true },
  ],
};

// ── Problem interface ──────────────────────────────────────────────

export interface Problem {
  id: string;
  kind: ProblemKind;
  message: string;
  label: string;
  trackName?: string;
  timestamp: number;
  resolved: boolean;
  /** The project this problem belongs to (null = global / unknown) */
  projectId?: string;
  /** The clip this problem relates to */
  clipId?: string;
}

// ── Problem input (before adding id/timestamp/resolved) ────────────

export interface ProblemInput {
  kind: ProblemKind;
  message: string;
  label: string;
  trackName?: string;
  projectId?: string;
  clipId?: string;
}

// ── Problem bus — for non-React code (bridges) to report problems ──

type ProblemListener = (problem: ProblemInput) => void;

const listeners = new Set<ProblemListener>();

export const problemBus = {
  report(problem: ProblemInput): string {
    const id = `problem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const fullProblem: Problem = {
      ...problem,
      id,
      timestamp: Date.now(),
      resolved: false,
    };
    useProblemStore.getState().addProblem(fullProblem);
    for (const listener of listeners) {
      try {
        listener(problem);
      } catch {
        /* swallow */
      }
    }
    return id;
  },

  resolve(id: string): void {
    useProblemStore.getState().resolveProblem(id);
  },

  resolveByKind(kind: ProblemKind): void {
    useProblemStore.getState().resolveByKind(kind);
  },

  subscribe(fn: ProblemListener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

// ── Callback for executing resolve actions (set by the UI layer) ───

let _resolveActionHandler:
  | ((actionId: ResolveActionId, problem: Problem) => void)
  | null = null;

export function setResolveActionHandler(
  handler: (actionId: ResolveActionId, problem: Problem) => void,
) {
  _resolveActionHandler = handler;
}

export function executeResolveAction(
  actionId: ResolveActionId,
  problem: Problem,
) {
  _resolveActionHandler?.(actionId, problem);
}

// ── Zustand store ──────────────────────────────────────────────────

interface ProblemState {
  problems: Problem[];
  addProblem: (problem: Problem) => void;
  resolveProblem: (id: string) => void;
  resolveByKind: (kind: ProblemKind) => void;
  clearResolved: () => void;
  clearAll: () => void;
}

export const useProblemStore = create<ProblemState>((set) => ({
  problems: [],

  addProblem: (problem: Problem) => {
    set((state) => {
      const now = Date.now();
      const duplicate = state.problems.find(
        (p) =>
          !p.resolved &&
          p.kind === problem.kind &&
          p.message === problem.message &&
          now - p.timestamp < 30000,
      );
      if (duplicate) {
        return {
          problems: state.problems.map((p) =>
            p.id === duplicate.id ? { ...p, timestamp: now } : p,
          ),
        };
      }
      return { problems: [...state.problems, problem] };
    });
  },

  resolveProblem: (id: string) => {
    set((state) => ({
      problems: state.problems.map((p) =>
        p.id === id ? { ...p, resolved: true } : p,
      ),
    }));
    setTimeout(() => {
      set((state) => ({
        problems: state.problems.filter((p) => p.id !== id || !p.resolved),
      }));
    }, 500);
  },

  resolveByKind: (kind: ProblemKind) => {
    const ids = useProblemStore
      .getState()
      .problems.filter((p) => p.kind === kind && !p.resolved)
      .map((p) => p.id);
    for (const id of ids) {
      useProblemStore.getState().resolveProblem(id);
    }
  },

  clearResolved: () => {
    set((state) => ({
      problems: state.problems.filter((p) => !p.resolved),
    }));
  },

  clearAll: () => {
    set({ problems: [] });
  },
}));

// ── Active (unresolved) problems selectors ─────────────────────────

export const useActiveProblems = () =>
  useProblemStore((state) => state.problems.filter((p) => !p.resolved));

export const useProblemCount = () =>
  useProblemStore(
    (state) => state.problems.filter((p) => !p.resolved).length,
  );

/** Only problems for a given project (or problems with no projectId) */
export const useProjectProblems = (projectId?: string) =>
  useProblemStore((state) =>
    state.problems.filter(
      (p) => !p.resolved && (!projectId || !p.projectId || p.projectId === projectId),
    ),
  );
