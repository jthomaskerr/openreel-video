import { useEffect } from "react";
import {
  acceptGenerationProviderResponse,
  isGenerationPollingActive,
  parseGenerationJob,
  shouldResumeGenerationAfterReload,
  type GenerationJob,
} from "@openreel/music-video-domain/generation";
import { getProductionGenerationRuntime, useGenerationJobStore } from "../stores/generation-job-store";

export const DEFAULT_POLL_INTERVAL_MS = 3_000;

export interface ProcessGenerationJobDeps {
  job: GenerationJob;
  synchronize: (job: GenerationJob) => Promise<GenerationJob>;
  current: (jobId: string) => GenerationJob | undefined;
}

/**
 * Synchronizes one full authoritative server job. Provider polling, output
 * download, finalization, source inference, and placement never run here.
 */
export async function processGenerationJobOnce(deps: ProcessGenerationJobDeps): Promise<void> {
  const { job } = deps;
  if (!isGenerationPollingActive(job.status) || !shouldResumeGenerationAfterReload(job)) return;
  const authoritative = parseGenerationJob(await deps.synchronize(job));
  const current = deps.current(job.id);
  if (!current || !isGenerationPollingActive(current.status)) return;
  if (current.attempt !== job.attempt || current.providerJobId !== job.providerJobId) return;
  if (authoritative.id !== current.id
    || authoritative.projectId !== current.projectId
    || authoritative.context.projectId !== current.context.projectId) {
    throw new Error("generation-status-ownership-mismatch");
  }
  if (!acceptGenerationProviderResponse(current, authoritative.projectId, authoritative.attempt, authoritative.providerJobId ?? "")) return;
}

function currentJob(jobId: string): GenerationJob | undefined {
  const record = useGenerationJobStore.getState().records.find((candidate) => candidate.kind === "v2" && candidate.job.id === jobId);
  return record?.kind === "v2" ? record.job : undefined;
}

export function useGenerationJobPoller(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  const runtime = getProductionGenerationRuntime();
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const jobs = useGenerationJobStore.getState().records.flatMap((record) => record.kind === "v2" ? [record.job] : []);
      await Promise.all(jobs.map(async (job) => {
        try {
          await processGenerationJobOnce({
            job,
            synchronize: async (candidate) => {
              const synchronized = await runtime.synchronize(candidate);
              return cancelled ? candidate : synchronized;
            },
            current: currentJob,
          });
        } catch (cause) {
          console.error("[GenerationPoller] authoritative status synchronization failed", {
            jobId: job.id,
            projectId: job.projectId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }));
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, intervalMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [intervalMs, runtime]);
}
