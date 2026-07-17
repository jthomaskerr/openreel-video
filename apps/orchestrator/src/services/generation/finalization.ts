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
const FINALIZATION_LOCKS = new KeyedLock();

function errorFrom(error: unknown, fallback = "generation-finalization-failed"): GenerationError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^generation-[a-z0-9-]+$/.test(message) ? message : fallback;
  return { code, message, retryable: true };
}

function completed(job: GenerationJob, checkpoint: GenerationCheckpointName) {
  return job.checkpoints[checkpoint]?.status === "completed";
}

function idempotencyKey(jobId: string, stage: string) {
  return `generation:${jobId}:${stage}`;
}

function outputMediaId(job: GenerationJob) {
  const candidate = job.providerInputs.placeholderMediaId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : job.output?.mediaId ?? `generated:${job.id}`;
}

function isLocalUrl(value: string) {
  return /^(?:blob:|local:|file:)/i.test(value);
}

function shotId(job: GenerationJob) {
  return job.context.entryContext.kind === "unplaced-shot" ? job.context.entryContext.shotId : undefined;
}

/** Resumable, idempotent finalization. Provider submission is deliberately not a port here. */
export class GenerationFinalizer {
  private readonly locks = FINALIZATION_LOCKS;
  constructor(private readonly repository: GenerationJobRepository, private readonly ports: FinalizationPorts) {}
  private now() { return this.ports.clock?.() ?? Date.now(); }

  async finalize(jobId: string, signal?: CompletionSignal): Promise<GenerationJob> {
    return this.locks.run(jobId, async () => {
      let job = await this.requireJob(jobId);
      const providerJobId = signal?.providerJobId ?? job.attempts.at(-1)?.providerJobId;
      if (!providerJobId) return this.rejectCompletion(job, "generation-provider-id-missing", "Provider completion did not include a provider job ID");
      const activeAttempt = job.attempts.at(-1);
      if (job.status === "canceled" || (signal && (signal.provider !== job.provider || providerJobId !== job.providerJobId || providerJobId !== activeAttempt?.providerJobId))) {
        return this.rejectCompletion(job, "generation-completion-not-owned", "Provider completion is no longer owned by this generation job");
      }
      let downloaded: DownloadedGenerationOutput | undefined;
      try {
        const durableMediaId = outputMediaId(job);
        if (isLocalUrl(durableMediaId)) return this.fail(job, "output-downloaded", { code: "generation-local-url-forbidden", message: "Local media identity cannot cross a durable generation boundary", retryable: false });
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
            const output: GenerationOutput = { mediaId: outputMediaId(job), versionId: `pending:${job.id}`, mimeType: downloaded.mimeType, byteLength: downloaded.bytes.byteLength, sha256: createHash("sha256").update(downloaded.bytes).digest("hex"), ...metadata };
            await this.repository.update(job.id, (current) => ({ ...current, output }));
            await this.mark(job.id, "output-inspected", { status: "completed", timestamp: this.now() });
          }
        }
        job = await this.requireJob(job.id);
        const completionKey = idempotencyKey(job.id, "finalization");
      const claimResult = await this.repository.claimFinalization({
        jobId: job.id,
        providerInstanceId: job.providerInstanceId,
        providerJobId,
          outputIdentity: JSON.stringify({ providerJobId, outputMediaIds: [outputMediaId(job)] }),
          idempotencyKey: completionKey,
        });
        if (!claimResult.acquired) {
          if (claimResult.claim.state === "completed") return this.requireJob(job.id);
          return this.waitForFinalization(job.id);
        }
        if (!completed(job, "placeholder-finalized")) {
          const output = job.output!;
          const ids = await this.ports.placeholder.finalize({ job, output, idempotencyKey: idempotencyKey(job.id, "placeholder-finalized") });
          if (isLocalUrl(ids.mediaId) || isLocalUrl(ids.versionId)) throw new Error("generation-local-url-forbidden");
          await this.repository.update(job.id, (current) => ({ ...current, output: { ...current.output!, ...ids } }));
          await this.mark(job.id, "placeholder-finalized", { status: "completed", timestamp: this.now() });
        }
        job = await this.requireJob(job.id);
        const currentShotId = shotId(job);
        if (currentShotId && this.ports.shot && !completed(job, "shot-linked")) {
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
            await this.repository.update(job.id, (current) => ({ ...current, placement: { policy: current.context.placementPolicy, status: "failed", error: errorFrom(error, "generation-placement-failed") }, status: "succeeded" }));
          }
        }
        await this.repository.completeFinalization(job.id, completionKey, claimResult.claim.ownerToken);
        return this.repository.update(job.id, (current) => ({ ...current, status: "succeeded", updatedAt: this.now() }));
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
    try {
      const current = await this.requireJob(jobId);
      await this.ports.placement.place({ job: current, output: current.output!, idempotencyKey: idempotencyKey(jobId, "placement-applied") });
      await this.mark(jobId, "placement-applied", { status: "completed", timestamp: this.now() });
      return this.repository.update(jobId, (currentJob) => ({ ...currentJob, status: "succeeded", placement: { policy: currentJob.context.placementPolicy, status: "applied", appliedAt: this.now() }, updatedAt: this.now() }));
    } catch (error) {
      const failure = errorFrom(error, "generation-placement-failed");
      await this.mark(jobId, "placement-applied", { status: "failed", timestamp: this.now(), error: failure });
      return this.repository.update(jobId, (current) => ({ ...current, status: "succeeded", placement: { policy: current.context.placementPolicy, status: "failed", error: failure }, updatedAt: this.now() }));
    }
  }

  private async mark(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState) {
    await this.repository.compareAndSetCheckpoint(id, checkpoint, state);
  }
  private async requireJob(id: string) { const job = await this.repository.get(id); if (!job) throw new Error("generation-not-found"); return job; }
  private async waitForFinalization(id: string) {
    for (let attempt = 0; attempt < 100_000; attempt += 1) {
      const claim = await this.repository.getFinalizationClaim(id);
      if (claim?.state === "completed") {
        const completedJob = await this.requireJob(id);
        if (["completed", "succeeded"].includes(completedJob.status)) return completedJob;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return this.fail(await this.requireJob(id), "placeholder-finalized", { code: "generation-finalization-claim-timeout", message: "Finalization claim did not complete", retryable: true });
  }
  private rejectCompletion(job: GenerationJob, code: string, message: string) { return { ...job, error: { code, message, retryable: false } }; }
  private async fail(job: GenerationJob, checkpoint: GenerationCheckpointName, error: GenerationError) {
    await this.repository.compareAndSetCheckpoint(job.id, checkpoint, { status: "failed", timestamp: this.now(), error });
    return this.repository.update(job.id, (current) => ({ ...current, status: "failed", error }));
  }
}
