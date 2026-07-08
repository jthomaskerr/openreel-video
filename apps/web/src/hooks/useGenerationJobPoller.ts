import { useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import { getResultUrl, pollTaskOnce, type TaskRecord } from "../services/kieai/image-generation";
import { pollJob, type JobResult } from "../services/wavespeed";
import { useGenerationJobStore, type GenerationJob } from "../stores/generation-job-store";
import { useProjectStore } from "../stores/project-store";
import { placeGeneratedAssetOnTimeline } from "../features/music-video/timeline/place-generated-asset";

const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface GenerationPollerProjectStore {
  readonly project: Project;
  getMediaItem: (mediaId: string) => MediaItem | undefined;
  addAssetVersion: (sourceMediaId: string, item: MediaItem, blob: Blob) => Promise<ActionResult>;
  addTrack: (trackType: Track["type"], position?: number) => Promise<ActionResult>;
  addClip: (
    trackId: string,
    mediaId: string,
    startTime: number,
    options?: { duration?: number; metadata?: Record<string, unknown> },
  ) => Promise<ActionResult>;
}

export interface GenerationJobActions {
  updateStatus: (id: string, status: GenerationJob["status"]) => void;
  complete: (id: string, outputUrl: string) => void;
  fail: (id: string, error?: string) => void;
}

export interface ProcessGenerationJobDeps {
  job: GenerationJob;
  projectStore: GenerationPollerProjectStore;
  jobActions: GenerationJobActions;
  pollWavespeedJob: (providerJobId: string) => Promise<JobResult>;
  pollKieaiTask: (providerJobId: string) => Promise<TaskRecord>;
  getKieaiResultUrl: (record: TaskRecord) => string;
  fetchOutputBlob: (outputUrl: string) => Promise<Blob>;
}

export async function processGenerationJobOnce({
  job,
  projectStore,
  jobActions,
  pollWavespeedJob,
  pollKieaiTask,
  getKieaiResultUrl,
  fetchOutputBlob,
}: ProcessGenerationJobDeps): Promise<void> {
  if (job.status !== "queued" && job.status !== "running") return;
  if (job.status === "queued") jobActions.updateStatus(job.id, "running");

  try {
    const providerResult = await pollProvider(job, pollWavespeedJob, pollKieaiTask, getKieaiResultUrl);
    if (providerResult.status === "running") return;
    if (providerResult.status === "failed") {
      jobActions.fail(job.id, providerResult.error);
      return;
    }

    const sourceMediaId = findSourceMediaId(job);
    if (!sourceMediaId) {
      jobActions.fail(job.id, "Completed generation has no source media to version");
      return;
    }

    const sourceMedia = projectStore.getMediaItem(sourceMediaId);
    if (!sourceMedia) {
      jobActions.fail(job.id, `Source media ${sourceMediaId} was not found`);
      return;
    }

    const outputBlob = await fetchOutputBlob(providerResult.outputUrl);
    const mediaType = inferMediaType(providerResult.outputUrl, outputBlob, job);
    const versionItem = createVersionMediaItem(job, sourceMedia, outputBlob, providerResult.outputUrl, mediaType);
    const versionResult = await projectStore.addAssetVersion(sourceMedia.id, versionItem, outputBlob);
    if (!versionResult.success) {
      jobActions.fail(job.id, versionResult.error?.message ?? "Failed to save generated asset version");
      return;
    }

    const shotId = typeof job.inputs.shotId === "string" ? job.inputs.shotId : undefined;
    const startTime = typeof job.inputs.startTime === "number" ? job.inputs.startTime : undefined;
    const duration = typeof job.inputs.duration === "number" ? job.inputs.duration : undefined;
    if (shotId && startTime !== undefined && duration !== undefined) {
      const placement = await placeGeneratedAssetOnTimeline(projectStore, {
        mediaId: versionItem.id,
        shotId,
        startTime,
        duration,
        providerJobId: job.providerJobId,
      });
      if (!placement.success) {
        jobActions.fail(job.id, placement.error?.message ?? "Failed to place generated asset on timeline");
        return;
      }
    }

    jobActions.complete(job.id, providerResult.outputUrl);
  } catch (error) {
    jobActions.fail(job.id, error instanceof Error ? error.message : "Generation polling failed");
  }
}

export function useGenerationJobPoller(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  const jobs = useGenerationJobStore((state) => state.jobs);
  const updateStatus = useGenerationJobStore((state) => state.updateStatus);
  const complete = useGenerationJobStore((state) => state.complete);
  const fail = useGenerationJobStore((state) => state.fail);
  const projectStore = useProjectStore();

  useEffect(() => {
    const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
    if (activeJobs.length === 0) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      for (const job of activeJobs) {
        void processGenerationJobOnce({
          job,
          projectStore,
          jobActions: { updateStatus, complete, fail },
          pollWavespeedJob: pollJob,
          pollKieaiTask: pollTaskOnce,
          getKieaiResultUrl: getResultUrl,
          fetchOutputBlob,
        });
      }
    };

    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobs, projectStore, updateStatus, complete, fail, intervalMs]);
}

async function pollProvider(
  job: GenerationJob,
  pollWavespeedJob: (providerJobId: string) => Promise<JobResult>,
  pollKieaiTask: (providerJobId: string) => Promise<TaskRecord>,
  getKieaiResultUrl: (record: TaskRecord) => string,
): Promise<{ status: "running" } | { status: "failed"; error?: string } | { status: "completed"; outputUrl: string }> {
  if (job.provider === "wavespeed") {
    const result = await pollWavespeedJob(job.providerJobId);
    if (result.status === "completed" && result.outputUrl) {
      return { status: "completed", outputUrl: result.outputUrl };
    }
    if (result.status === "failed") return { status: "failed", error: result.error };
    return { status: "running" };
  }

  const record = await pollKieaiTask(job.providerJobId);
  if (record.state === "success") return { status: "completed", outputUrl: getKieaiResultUrl(record) };
  if (record.state === "fail") return { status: "failed", error: record.failMsg };
  return { status: "running" };
}

async function fetchOutputBlob(outputUrl: string): Promise<Blob> {
  const response = await fetch(outputUrl);
  if (!response.ok) throw new Error(`Failed to download generated output: HTTP ${response.status}`);
  return response.blob();
}

function findSourceMediaId(job: GenerationJob): string | null {
  if (job.linkedMediaIds[0]) return job.linkedMediaIds[0];
  return typeof job.inputs.sourceMediaId === "string" ? job.inputs.sourceMediaId : null;
}

function inferMediaType(outputUrl: string, blob: Blob, job: GenerationJob): "image" | "video" {
  if (job.inputs.outputType === "video") return "video";
  if (blob.type.startsWith("video/")) return "video";
  if (/\.(mp4|mov|webm)(\?|$)/i.test(outputUrl)) return "video";
  return "image";
}

function createVersionMediaItem(
  job: GenerationJob,
  sourceMedia: MediaItem,
  blob: Blob,
  outputUrl: string,
  type: "image" | "video",
): MediaItem {
  const extension = type === "video" ? "mp4" : "png";
  return {
    id: uuidv4(),
    name: `${sourceMedia.name.replace(/\.[^.]+$/, "")}_${job.provider}.${extension}`,
    type,
    fileHandle: null,
    blob,
    metadata: {
      duration: type === "video" ? sourceMedia.metadata.duration : 0,
      width: sourceMedia.metadata.width,
      height: sourceMedia.metadata.height,
      frameRate: type === "video" ? sourceMedia.metadata.frameRate : 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: blob.size,
    },
    thumbnailUrl: type === "image" ? outputUrl : sourceMedia.thumbnailUrl,
    originalUrl: outputUrl,
    assetGroupId: sourceMedia.assetGroupId ?? sourceMedia.id,
    isCurrent: true,
    generationMeta: {
      provider: job.provider,
      model: job.model,
      prompt: job.prompt,
      inputs: job.inputs,
      jobId: job.providerJobId,
    },
  };
}
