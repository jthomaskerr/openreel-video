import { create } from "zustand";

export type PersistencePhase = "idle" | "pending" | "saving" | "persisted" | "failed";

interface PersistenceStatusState {
  phase: PersistencePhase;
  projectId: string | null;
  persistedAt: number | null;
  persistedModifiedAt: number | null;
  error: string | null;
  phaseStartedAt: number | null;
  markPending: (projectId: string) => void;
  markSaving: (projectId: string) => void;
  markPersisted: (projectId: string, persistedAt: number, persistedModifiedAt: number) => void;
  markFailed: (projectId: string, error: string) => void;
  reset: () => void;
}

export const usePersistenceStatusStore = create<PersistenceStatusState>((set) => ({
  phase: "idle",
  projectId: null,
  persistedAt: null,
  persistedModifiedAt: null,
  error: null,
  phaseStartedAt: null,
  markPending: (projectId) => set({ phase: "pending", projectId, error: null, phaseStartedAt: Date.now() }),
  markSaving: (projectId) => set({ phase: "saving", projectId, error: null, phaseStartedAt: Date.now() }),
  markPersisted: (projectId, persistedAt, persistedModifiedAt) =>
    set({ phase: "persisted", projectId, persistedAt, persistedModifiedAt, error: null, phaseStartedAt: null }),
  markFailed: (projectId, error) => set({ phase: "failed", projectId, error, phaseStartedAt: null }),
  reset: () => set({
    phase: "idle",
    projectId: null,
    persistedAt: null,
    persistedModifiedAt: null,
    error: null,
    phaseStartedAt: null,
  }),
}));
