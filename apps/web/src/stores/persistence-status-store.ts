import { create } from "zustand";
import type { Project, ProjectBaseRevision, ProjectSaveReceipt } from "@openreel/core";

export type PersistencePhase = "idle" | "pending" | "saving" | "deferred" | "committing" | "retry-wait" | "persisted" | "incomplete" | "conflict" | "failed";

interface PersistenceStatusState {
  phase: PersistencePhase;
  projectId: string | null;
  persistedAt: number | null;
  persistedModifiedAt: number | null;
  error: string | null;
  phaseStartedAt: number | null;
  confirmedReceipt: ProjectSaveReceipt | null;
  baseRevision: ProjectBaseRevision | null;
  conflictingProject: Project | null;
  markPending: (projectId: string) => void;
  markSaving: (projectId: string) => void;
  markDeferred: (projectId: string, receipt: ProjectSaveReceipt) => void;
  markCommitState: (projectId: string, phase: "deferred" | "committing" | "retry-wait", error?: string | null) => void;
  markPersisted: (projectId: string, receipt: ProjectSaveReceipt) => void;
  markIncomplete: (projectId: string, error: string) => void;
  markConflict: (projectId: string, error: string, project: Project | null) => void;
  confirmReceipt: (projectId: string, receipt: ProjectSaveReceipt) => void;
  markFailed: (projectId: string, error: string) => void;
  reset: () => void;
}

type PersistenceConfirmation = Pick<
  PersistenceStatusState,
  "projectId" | "confirmedReceipt"
>;

export function isProjectDirty(
  project: Pick<Project, "id" | "modifiedAt">,
  status: PersistenceConfirmation,
): boolean {
  return status.projectId !== project.id
    || status.confirmedReceipt?.projectId !== project.id
    || status.confirmedReceipt.sourceModifiedAt !== project.modifiedAt;
}

export const usePersistenceStatusStore = create<PersistenceStatusState>((set) => ({
  phase: "idle",
  projectId: null,
  persistedAt: null,
  persistedModifiedAt: null,
  error: null,
  phaseStartedAt: null,
  confirmedReceipt: null,
  baseRevision: null,
  conflictingProject: null,
  markPending: (projectId) => set({ phase: "pending", projectId, error: null, phaseStartedAt: Date.now() }),
  markSaving: (projectId) => set({ phase: "saving", projectId, error: null, phaseStartedAt: Date.now() }),
  markDeferred: (projectId, receipt) => set((state) => ({
    phase: "deferred",
    projectId,
    persistedAt: receipt.persistedAt,
    persistedModifiedAt: receipt.sourceModifiedAt,
    confirmedReceipt: state.confirmedReceipt,
    baseRevision: receipt.commitSha && receipt.treeSha && receipt.projectBlobSha
      ? {
        commitSha: receipt.commitSha,
        treeSha: receipt.treeSha,
        projectBlobSha: receipt.projectBlobSha,
        sourceModifiedAt: receipt.sourceModifiedAt,
      }
      : state.baseRevision,
    error: null,
    phaseStartedAt: null,
  })),
  markCommitState: (projectId, phase, error = null) => set({
    phase,
    projectId,
    error,
    phaseStartedAt: null,
  }),
  markPersisted: (projectId, receipt) => set({
    phase: "persisted",
    projectId,
    persistedAt: receipt.persistedAt,
    persistedModifiedAt: receipt.sourceModifiedAt,
    confirmedReceipt: receipt,
    baseRevision: receipt.commitSha && receipt.treeSha && receipt.projectBlobSha
      ? {
          commitSha: receipt.commitSha,
          treeSha: receipt.treeSha,
          projectBlobSha: receipt.projectBlobSha,
          sourceModifiedAt: receipt.sourceModifiedAt,
        }
      : null,
    conflictingProject: null,
    error: null,
    phaseStartedAt: null,
  }),
  markIncomplete: (projectId, error) => set({ phase: "incomplete", projectId, error, phaseStartedAt: null }),
  markConflict: (projectId, error, project) => set({
    phase: "conflict",
    projectId,
    error,
    conflictingProject: project,
    phaseStartedAt: null,
  }),
  confirmReceipt: (projectId, receipt) => set({
    phase: "persisted",
    projectId,
    persistedAt: receipt.persistedAt,
    persistedModifiedAt: receipt.sourceModifiedAt,
    error: null,
    phaseStartedAt: null,
    confirmedReceipt: receipt,
    conflictingProject: null,
    baseRevision: receipt.commitSha && receipt.treeSha && receipt.projectBlobSha
      ? {
          commitSha: receipt.commitSha,
          treeSha: receipt.treeSha,
          projectBlobSha: receipt.projectBlobSha,
          sourceModifiedAt: receipt.sourceModifiedAt,
        }
      : null,
  }),
  markFailed: (projectId, error) => set({ phase: "failed", projectId, error, phaseStartedAt: null }),
  reset: () => set({
    phase: "idle",
    projectId: null,
    persistedAt: null,
    persistedModifiedAt: null,
    error: null,
    phaseStartedAt: null,
    confirmedReceipt: null,
    baseRevision: null,
    conflictingProject: null,
  }),
}));
