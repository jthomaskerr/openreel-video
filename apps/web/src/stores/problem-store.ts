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

export interface Problem {
  id: string;
  kind: ProblemKind;
  message: string;
  label: string;
  trackName?: string;
  timestamp: number;
  resolved: boolean;
}

// ── Problem bus — for non-React code (bridges) to report problems ──

type ProblemListener = (problem: Omit<Problem, "id" | "timestamp" | "resolved">) => void;

const listeners = new Set<ProblemListener>();

export const problemBus = {
  report(problem: Omit<Problem, "id" | "timestamp" | "resolved">): string {
    const id = `problem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const fullProblem: Problem = {
      ...problem,
      id,
      timestamp: Date.now(),
      resolved: false,
    };
    // Push to the Zustand store
    useProblemStore.getState().addProblem(fullProblem);
    // Notify all listeners (bridges may use this for custom handling)
    for (const listener of listeners) {
      try { listener(problem); } catch { /* swallow */ }
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
    return () => { listeners.delete(fn); };
  },
};

// ── Zustand store ────────────────────────────────────────────────────

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
      // Deduplicate: same message+kind in last 30s = update timestamp
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
    // Auto-remove resolved problems after a brief delay so the UI can animate
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

// ── Active (unresolved) problems selector ────────────────────────────

export const useActiveProblems = () =>
  useProblemStore((state) => state.problems.filter((p) => !p.resolved));

export const useProblemCount = () =>
  useProblemStore(
    (state) => state.problems.filter((p) => !p.resolved).length,
  );
