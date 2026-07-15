import { createHash } from "node:crypto";
import type {
  GenerationCheckpointName,
  GenerationCheckpointState,
  GenerationError,
  GenerationJob,
  GenerationOutput,
} from "@openreel/music-video-domain/generation";
import type { GenerationJobRepository } from "./repository.js";
import { KeyedLock } from "./lock.js";

export interface DownloadedGenerationOutput {
  bytes: Uint8Array;
  mimeType: string;
}

export interface GenerationOutputDownloader {
  download(input: { provider: string; providerJobId: string }): Promise<DownloadedGenerationOutput>;
}

export interface GenerationOutputVerifier {
  verify(input: { bytes: Uint8Array; mimeType: string; maxBytes: number }): Promise<void>;
}

export interface GenerationOutputInspector {
  inspect(input: { bytes: Uint8Array; mimeType: string }): Promise<Pick<GenerationOutput, "width" | "height" | "durationSeconds">>;
}

export interface PlaceholderFinalizer {
  finalize(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<Pick<GenerationOutput, "mediaId" | "versionId">>;
}

export interface ShotLinker {
  link(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<void>;
}

export interface TimelinePlacer {
  place(input: { job: GenerationJob; output: GenerationOutput; idempotencyKey: string }): Promise<void>;
}

export interface FinalizationPorts {
  download: GenerationOutputDownloader;
  verify: GenerationOutputVerifier;
  inspect: GenerationOutputInspector;
  placeholder: PlaceholderFinalizer;
  shot?: ShotLinker;
  placement?: TimelinePlacer;
  maxOutputBytes?: number;
  clock?: () => number;
}

export type CompletionSignal = { provider: string; providerJobId: string };

const CHECKPOINTS: GenerationCheckpointName[] = [
  "output-claimed",
  "output-downloaded",
  "output-verified",
  "output-inspected",
  "placeholder-finalized",
  "shot-linked",
  "placement-applied",
];

function errorFrom(error: unknown, fallback = "generation-finalization-failed"): GenerationError {
  const message = error instanceof Error ? error.message : String(error);
  return { code: fallback, message, retryable: true };
}

function completed(job: GenerationJob, checkpoint: GenerationCheckpointName) {
  return job.checkpoints[checkpoint]?.status === "completed";
}

function idempotencyKey(jobId: string, stage: string) {
  return `generation:${jobId}:${stage}`;
}

/** Resumable, idempotent finalization. Provider submission is deliberately not a port here. */
export class GenerationFinalizer {
  private readonly locks = new KeyedLock();
  constructor(private readonly repository: GenerationJobRepository, private readonly ports: FinalizationPorts) {}
  private now() { return this.ports.clock?.() ?? Date.now(); }

  async finalize(jobId: string, signal?: CompletionSignal): Promise<GenerationJob> {
    return this.locks.run(jobId, async () => {
      let job = await this.requireJob(jobId);
      const providerJobId = signal?.providerJobId ?? job.attempts.at(-1)?.providerJobId;
      if (!providerJobId) return this.fail(job, "output-claimed", { code: "generation-provider-id-missing", retryable: false });
      if (signal && (signal.provider !== job.provider || !job.attempts.some((a) => a.providerJobId === providerJobId))) {
        return this.fail(job, "output-claimed", { code: "generation-provider-id-mismatch", retryable: false });
      }
      if (!completed(job, "output-claimed")) {
        await this.mark(job.id, "output-claimed", { status: "completed", timestamp: this.now() });
        job = await this.requireJob(job.id);
      }

      let downloaded: DownloadedGenerationOutput | undefined;
      try {
        if (!completed(job, "output-inspected")) {
          if (!completed(job, "output-downloaded")) {
            downloaded = await this.ports.download.download({ provider: job.provider, providerJobId });
            await this.mark(job.id, "output-downloaded", { status: "completed", timestamp: this.now() });
          }
          // A retry after restart has no in-memory bytes. The downloader is intentionally replay-safe.
          if (!downloaded) downloaded = await this.ports.download.download({ provider: job.provider, providerJobId });
          if (!completed(job, "output-verified")) {
            await this.ports.verify.verify({ bytes: downloaded.bytes, mimeType: downloaded.mimeType, maxBytes: this.ports.maxOutputBytes ?? 200 * 1024 * 1024 });
            await this.mark(job.id, "output-verified", { status: "completed", timestamp: this.now() });
          }
          if (!completed(job, "output-inspected")) {
            const metadata = await this.ports.inspect.inspect({ bytes: downloaded.bytes, mimeType: downloaded.mimeType });
            const output: GenerationOutput = { mediaId: job.context.target.placeholderMediaId, versionId: `pending:${job.id}`, mimeType: downloaded.mimeType, byteLength: downloaded.bytes.byteLength, sha256: createHash("sha256").update(downloaded.bytes).digest("hex"), ...metadata };
            await this.repository.update(job.id, (current) => ({ ...current, output }));
            await this.mark(job.id, "output-inspected", { status: "completed", timestamp: this.now() });
          }
        }
        job = await this.requireJob(job.id);
        if (!completed(job, "placeholder-finalized")) {
          const output = job.output!;
          const ids = await this.ports.placeholder.finalize({ job, output, idempotencyKey: idempotencyKey(job.id, "placeholder-finalized") });
          await this.repository.update(job.id, (current) => ({ ...current, output: { ...current.output!, ...ids } }));
          await this.mark(job.id, "placeholder-finalized", { status: "completed", timestamp: this.now() });
        }
        job = await this.requireJob(job.id);
        if (job.context.shotId && this.ports.shot && !completed(job, "shot-linked")) {
          await this.ports.shot.link({ job, output: job.output!, idempotencyKey: idempotencyKey(job.id, "shot-linked") });
          await this.mark(job.id, "shot-linked", { status: "completed", timestamp: this.now() });
        }
        if (job.context.placementPolicy !== "none" && this.ports.placement && !completed(job, "placement-applied")) {
          try {
            await this.ports.placement.place({ job, output: job.output!, idempotencyKey: idempotencyKey(job.id, "placement-applied") });
            await this.mark(job.id, "placement-applied", { status: "completed", timestamp: this.now() });
            await this.repository.update(job.id, (current) => ({ ...current, placement: { policy: current.context.placementPolicy, status: "applied", appliedAt: this.now() } }));
          } catch (error) {
            await this.mark(job.id, "placement-applied", { status: "failed", timestamp: this.now(), error: errorFrom(error, "generation-placement-failed") });
            await this.repository.update(job.id, (current) => ({ ...current, placement: { policy: current.context.placementPolicy, status: "failed", error: errorFrom(error, "generation-placement-failed") }, status: "completed" }));
          }
        }
        return this.repository.update(job.id, (current) => ({ ...current, status: "completed", updatedAt: this.now() }));
      } catch (error) {
        const latest = await this.requireJob(job.id);
        const checkpoint = CHECKPOINTS.find((name) => latest.checkpoints[name]?.status !== "completed") ?? "output-inspected";
        return this.fail(latest, checkpoint, errorFrom(error));
      }
    });
  }

  async retryPlacement(jobId: string): Promise<GenerationJob> {
    const job = await this.requireJob(jobId);
    if (job.context.placementPolicy === "none" || !this.ports.placement) return job;
    await this.repository.update(jobId, (current) => ({ ...current, checkpoints: { ...current.checkpoints, "placement-applied": { status: "pending" } }, placement: { policy: current.context.placementPolicy, status: "pending" } }));
    return this.finalize(jobId);
  }

  private async mark(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState) { await this.repository.compareAndSetCheckpoint(id, checkpoint, state); }
  private async requireJob(id: string) { const job = await this.repository.get(id); if (!job) throw new Error("generation-not-found"); return job; }
  private async fail(job: GenerationJob, checkpoint: GenerationCheckpointName, error: GenerationError) {
    await this.repository.update(job.id, (current) => ({ ...current, status: "failed", error, checkpoints: { ...current.checkpoints, [checkpoint]: { status: "failed", timestamp: this.now(), error } } }));
    return this.requireJob(job.id);
  }
}
