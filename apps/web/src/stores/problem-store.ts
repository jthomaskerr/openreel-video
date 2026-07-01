import { create } from "zustand";

// ── Problem type — generalizes ImportError ──────────────────────────

export type ProblemKind =
  | "missing_media"
  | "block_failed"
  | "image_failed"
  | "import_error"
  | "generation_failed";

// ── Resolve actions — what the user can do about a problem ──────────

export type ResolveActionId =
  | "link_file"
  | "remove_media"
  | "retry_generation"
  | "dismiss";

export interface ResolveAction {
  id: ResolveActionId;
  label: string;
  /** If true, executing this action marks the problem resolved */
  resolves: boolean;
}

// ── Resolve actions per kind ────────────────────────────────────────

export const RESOLVE_ACTIONS_BY_KIND: Record<ProblemKind, ResolveAction[]> = {
  missing_media: [
    { id: "link_file",    label: "Link File", resolves: true },
    { id: "remove_media", label: "Remove",    resolves: true },
  ],
  block_failed: [
    { id: "remove_media", label: "Remove", resolves: true },
  ],
  image_failed: [
    { id: "link_file",    label: "Link File", resolves: true },
    { id: "remove_media", label: "Remove",    resolves: true },
  ],
  import_error: [
    { id: "remove_media", label: "Remove", resolves: true },
  ],
  generation_failed: [
    { id: "retry_generation", label: "Retry",  resolves: false },
    { id: "remove_media",     label: "Remove", resolves: true  },
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
  projectId?: string;
  /** ID of the media item this problem relates to */
  mediaId?: string;
}

// ── Problem input (before adding id/timestamp/resolved) ────────────

export interface ProblemInput {
  kind: ProblemKind;
  message: string;
  label: string;
  trackName?: string;
  projectId?: string;
  mediaId?: string;
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
