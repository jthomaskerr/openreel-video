/**
 * Generation job store
 *
 * Single persistent store covering KieAI and WaveSpeed generation jobs.
 * Jobs survive dialog closes and page refreshes; polling lives outside dialogs.
 *
 * Lifecycle:
 *   queued → running → completed (outputUrl set)
 *   queued → running → failed   ← user can retry
 *   queued → canceled
 *   failed | canceled → (retry with new providerJobId) → queued (history preserved)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GenerationProvider = "kieai" | "wavespeed";

export type GenerationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

/** One previous failed/canceled attempt, preserved across retries */
export interface GenerationJobAttempt {
  /** Provider-assigned job/task ID used in that attempt */
  providerJobId: string;
  /** "failed" or "canceled" — why this attempt was retired */
  status: "failed" | "canceled";
  /** Error message when status is "failed" */
  error?: string;
  /** Unix timestamp (ms) when the attempt ended */
  endedAt: number;
}

export interface GenerationJob {
  /** Local logical identifier — stable across retries */
  id: string;
  /** Which provider submitted this job */
  provider: GenerationProvider;
  /** Provider-assigned job/task ID for the current attempt */
  providerJobId: string;
  /** Model identifier (e.g. "wan/t2v-13B" or KieAI model constant) */
  model: string;
  /** Text prompt — convenience alias; also present in inputs */
  prompt: string;
  /** Full inputs object passed to the provider */
  inputs: Record<string, unknown>;
  /** Project this job belongs to */
  projectId: string;
  /** Linked shot/asset IDs in the project */
  linkedMediaIds: string[];
  status: GenerationJobStatus;
  /** Set on successful completion */
  outputUrl?: string;
  /** Set on failure */
  error?: string;
  /** Unix timestamp (ms) when first enqueued */
  createdAt: number;
  /** Unix timestamp (ms) of the last status change */
  updatedAt: number;
  /** Previous failed/canceled attempts; grows on each retry */
  retryHistory: GenerationJobAttempt[];
}

export interface EnqueueParams {
  provider: GenerationProvider;
  providerJobId: string;
  model: string;
  prompt: string;
  inputs: Record<string, unknown>;
  projectId: string;
  linkedMediaIds: string[];
}

interface GenerationJobStore {
  jobs: GenerationJob[];
  /** Add a new generation job (starts in "queued" status) */
  enqueue: (params: EnqueueParams) => void;
  /** Update status for a job (use complete/fail/cancel for terminal transitions) */
  updateStatus: (id: string, status: GenerationJobStatus) => void;
  /** Mark completed and store the output URL */
  complete: (id: string, outputUrl: string) => void;
  /** Mark failed with an optional error message */
  fail: (id: string, error?: string) => void;
  /** Mark canceled */
  cancel: (id: string) => void;
  /**
   * Retry a failed or canceled job.
   * Pushes the current providerJobId into retryHistory,
   * then resets the job to "queued" with newProviderJobId.
   */
  retry: (id: string, newProviderJobId: string) => void;
  getJobsForProject: (projectId: string) => GenerationJob[];
}

export const useGenerationJobStore = create<GenerationJobStore>()(
  persist(
    (set, get) => ({
      jobs: [],

      enqueue: (params) => {
        const now = Date.now();
        const job: GenerationJob = {
          ...params,
          id: crypto.randomUUID(),
          status: "queued",
          createdAt: now,
          updatedAt: now,
          retryHistory: [],
        };
        set((s) => ({ jobs: [...s.jobs, job] }));
      },

      updateStatus: (id, status) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...j, status, updatedAt: Date.now() } : j,
          ),
        })),

      complete: (id, outputUrl) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? { ...j, status: "completed", outputUrl, updatedAt: Date.now() }
              : j,
          ),
        })),

      fail: (id, error?) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? { ...j, status: "failed", error, updatedAt: Date.now() }
              : j,
          ),
        })),

      cancel: (id) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? { ...j, status: "canceled", updatedAt: Date.now() }
              : j,
          ),
        })),

      retry: (id, newProviderJobId) => {
        const now = Date.now();
        set((s) => ({
          jobs: s.jobs.map((j) => {
            if (j.id !== id) return j;
            if (j.status !== "failed" && j.status !== "canceled") return j;
            const attempt: GenerationJobAttempt = {
              providerJobId: j.providerJobId,
              status: j.status === "canceled" ? "canceled" : "failed",
              error: j.error,
              endedAt: now,
            };
            return {
              ...j,
              providerJobId: newProviderJobId,
              status: "queued",
              error: undefined,
              updatedAt: now,
              retryHistory: [...j.retryHistory, attempt],
            };
          }),
        }));
      },

      getJobsForProject: (projectId) =>
        get().jobs.filter((j) => j.projectId === projectId),
    }),
    { name: "generation-jobs" },
  ),
);
