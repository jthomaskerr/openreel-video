import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, open } from "node:fs/promises";
import { join } from "node:path";
import { parseGenerationJob, serializeGenerationJob, type GenerationCheckpointName, type GenerationCheckpointState, type GenerationJob } from "@openreel/music-video-domain/generation";

export class GenerationRepositoryError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "GenerationRepositoryError"; }
}

export interface SubmissionClaim {
  jobId: string;
  attemptNumber: number;
  idempotencyKey: string;
  providerJobId?: string;
  state: "claimed" | "submitted" | "failed";
  ownerToken: string;
  claimedAt: number;
}

export interface FinalizationClaim {
  jobId: string;
  providerInstanceId: string;
  providerJobId: string;
  outputIdentity: string;
  idempotencyKey: string;
  state: "claimed" | "failed" | "completed";
  ownerToken: string;
  claimedAt: number;
}

export interface PlacementClaim {
  jobId: string;
  idempotencyKey: string;
  state: "claimed" | "failed" | "completed" | "needs-attention";
  ownerToken: string;
  claimedAt: number;
}

export type PlacementRecoveryOutcome = "succeeded" | "failed" | "unknown";

export interface GenerationJobRepository {
  create(job: GenerationJob): Promise<GenerationJob>;
  get(id: string): Promise<GenerationJob | undefined>;
  update(id: string, mutate: (job: GenerationJob) => GenerationJob): Promise<GenerationJob>;
  compareAndSetCheckpoint(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState): Promise<boolean>;
  findByProviderCompletion(provider: string, providerJobId: string, providerInstanceId: string): Promise<GenerationJob | undefined>;
  listActive(projectId: string): Promise<GenerationJob[]>;
  beginSubmission(jobId: string, attemptNumber: number, idempotencyKey: string): Promise<{ claim: SubmissionClaim; acquired: boolean }>;
  getSubmissionClaim(jobId: string, attemptNumber: number): Promise<SubmissionClaim | undefined>;
  recordProviderSubmission(jobId: string, attemptNumber: number, providerJobId: string): Promise<SubmissionClaim>;
  repairSubmissionIdentity(jobId: string, attemptNumber: number, providerJobId: string): Promise<SubmissionClaim>;
  releaseSubmission(jobId: string, attemptNumber: number, failed: boolean): Promise<void>;
  getFinalizationClaim(jobId: string): Promise<FinalizationClaim | undefined>;
  repairFinalization(jobId: string, ownerToken: string): Promise<FinalizationClaim>;
  claimFinalization(input: { jobId: string; providerInstanceId: string; providerJobId: string; outputIdentity: string; idempotencyKey: string }): Promise<{ claim: FinalizationClaim; acquired: boolean }>;
  completeFinalization(jobId: string, idempotencyKey: string, ownerToken: string): Promise<void>;
  releaseFinalization(jobId: string, ownerToken: string): Promise<void>;
  claimPlacement(jobId: string, idempotencyKey: string): Promise<{ claim: PlacementClaim; acquired: boolean }>;
  getPlacementClaim(jobId: string): Promise<PlacementClaim | undefined>;
  reconcilePlacement(jobId: string, idempotencyKey: string, ownerToken: string, outcome: PlacementRecoveryOutcome): Promise<PlacementClaim>;
  repairPlacement(jobId: string, ownerToken: string): Promise<PlacementClaim>;
  completePlacement(jobId: string, idempotencyKey: string, ownerToken: string): Promise<void>;
  releasePlacement(jobId: string, ownerToken: string): Promise<void>;
}

type FileClaim = SubmissionClaim;
const CHECKPOINT_NAMES: GenerationCheckpointName[] = ["output-claimed", "output-downloaded", "output-verified", "output-inspected", "placeholder-finalized", "shot-linked", "placement-applied"];

function canonicalOutputIdentity(value: string, providerInstanceId: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new GenerationRepositoryError("generation-output-identity-durable-invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new GenerationRepositoryError("generation-output-identity-durable-invalid");
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (Array.isArray(record.outputMediaIds) && record.outputMediaIds.some((id) => typeof id === "string" && /^(?:blob:|local:|file:)/i.test(id))) throw new GenerationRepositoryError("generation-local-url-forbidden");
  if (![2, 3].includes(keys.length) || !keys.includes("providerJobId") || !keys.includes("outputMediaIds") || (keys.length === 3 && (!keys.includes("providerInstanceId") || record.providerInstanceId !== providerInstanceId)) || typeof record.providerJobId !== "string" || !record.providerJobId.trim() || !Array.isArray(record.outputMediaIds) || record.outputMediaIds.length === 0 || record.outputMediaIds.some((id) => typeof id !== "string" || !id.trim() || /^(?:https?:|blob:|local:|file:)/i.test(id))) throw new GenerationRepositoryError("generation-output-identity-durable-invalid");
  return JSON.stringify({ providerInstanceId, providerJobId: record.providerJobId, outputMediaIds: record.outputMediaIds });
}

/** Filesystem repository with durable CAS claims and rebuildable provider index. */
export class FileGenerationJobRepository implements GenerationJobRepository {
  private readonly processToken = randomUUID();
  constructor(readonly directory: string, readonly lockTtlMs = 30_000, readonly now = () => Date.now()) {}

  private file(id: string) { return join(this.directory, `${id}.json`); }
  private indexFile() { return join(this.directory, "provider-index.json"); }
  private locksDir() { return join(this.directory, ".locks"); }
  private submissionFile(id: string, attempt: number) { return join(this.directory, `submission-${id}-${attempt}.json`); }
  private finalizationFile(id: string) { return join(this.directory, `finalization-${id}.json`); }
  private placementFile(id: string) { return join(this.directory, `placement-${id}.json`); }

  private async init() { await mkdir(this.directory, { recursive: true }); await mkdir(this.locksDir(), { recursive: true }); }

  private async atomic(path: string, value: unknown) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(tmp, "w", 0o600);
    try { await handle.writeFile(typeof value === "string" ? value : JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, path);
  }

  private async withFileLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    await this.init();
    const path = join(this.locksDir(), `${key}.lock`);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const handle = await open(path, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify({ processToken: this.processToken, claimedAt: this.now() })); await handle.sync(); } finally { await handle.close(); }
        try { return await task(); } finally { await rm(path, { force: true }); }
      } catch (cause) {
        if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST")) throw cause;
        try {
          const lock = JSON.parse(await readFile(path, "utf8")) as { claimedAt?: number };
          if (typeof lock.claimedAt === "number" && this.now() - lock.claimedAt > this.lockTtlMs) await rm(path, { force: true });
        } catch { await rm(path, { force: true }); }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    throw new GenerationRepositoryError("generation-repository-lock-timeout");
  }

  private async readIndex(): Promise<Record<string, string>> {
    await this.init();
    try {
      const parsed: unknown = JSON.parse(await readFile(this.indexFile(), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid index");
      return parsed as Record<string, string>;
    } catch (cause) {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return this.rebuildIndex();
      return this.rebuildIndex(cause instanceof Error ? cause.message : String(cause));
    }
  }

  private async rebuildIndex(reason?: string): Promise<Record<string, string>> {
    const index: Record<string, string> = {};
    const names = (await readdir(this.directory)).filter((name: string) => name.endsWith(".json") && !name.startsWith("provider-index") && !name.startsWith("submission-") && !name.startsWith("finalization-") && !name.startsWith("placement-"));
    for (const name of names) {
      const job = await this.readJob(name.slice(0, -5));
      if (!job) continue;
      for (const attempt of job.attempts) if (attempt.providerJobId) {
        const key = `${job.providerInstanceId}:${job.provider}:${attempt.providerJobId}`;
        if (index[key] && index[key] !== job.id) throw new GenerationRepositoryError("generation-provider-id-conflict");
        index[key] = job.id;
      }
    }
    await this.atomic(this.indexFile(), index);
    void reason;
    return index;
  }

  private async readJob(id: string): Promise<GenerationJob | undefined> {
    try { return parseGenerationJob(JSON.parse(await readFile(this.file(id), "utf8"))); }
    catch (cause) {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined;
      if (cause instanceof Error && cause.message === "generation-local-url-forbidden") throw cause;
      throw new GenerationRepositoryError("generation-corrupt");
    }
  }

  async create(job: GenerationJob) {
    parseGenerationJob(job); await this.init();
    return this.withFileLock(`job-${job.id}`, async () => {
      return this.withFileLock("provider-index", async () => {
        const index = await this.readIndex();
        for (const attempt of job.attempts) if (attempt.providerJobId) {
          const key = `${job.providerInstanceId}:${job.provider}:${attempt.providerJobId}`;
          if (index[key] && index[key] !== job.id) throw new GenerationRepositoryError("generation-provider-id-conflict");
        }
        try { const handle = await open(this.file(job.id), "wx", 0o600); try { await handle.writeFile(serializeGenerationJob(job)); await handle.sync(); } finally { await handle.close(); } }
        catch (cause) { if (cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST") throw new GenerationRepositoryError("generation-id-conflict"); throw cause; }
        await this.rebuildIndex();
        return job;
      });
    });
  }

  async get(id: string) { await this.init(); return this.readJob(id); }

  async update(id: string, mutate: (job: GenerationJob) => GenerationJob) {
    return this.withFileLock(`job-${id}`, async () => {
      const existing = await this.readJob(id); if (!existing) throw new GenerationRepositoryError("generation-not-found");
      const next = parseGenerationJob(mutate(existing));
      await this.atomic(this.file(id), serializeGenerationJob(next));
      await this.withFileLock("provider-index", async () => this.rebuildIndex());
      return next;
    });
  }

  async compareAndSetCheckpoint(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState) {
    return this.withFileLock(`job-${id}`, async () => {
      const job = await this.readJob(id); if (!job) throw new GenerationRepositoryError("generation-not-found");
      if (job.checkpoints[checkpoint]?.status === "completed") return false;
      const checkpoints = Object.fromEntries(CHECKPOINT_NAMES.map((name) => [name, job.checkpoints[name] ?? { status: "pending" }])) as GenerationJob["checkpoints"];
      const next = parseGenerationJob({ ...job, checkpoints: { ...checkpoints, [checkpoint]: state } });
      await this.atomic(this.file(id), serializeGenerationJob(next)); return true;
    });
  }

  async findByProviderCompletion(provider: string, providerJobId: string, providerInstanceId: string) {
    if (!providerInstanceId?.trim()) throw new GenerationRepositoryError("generation-provider-instance-required");
    const index = await this.withFileLock("provider-index", async () => this.readIndex());
    const key = `${providerInstanceId}:${provider}:${providerJobId}`;
    const id = key ? index[key] : undefined;
    return id ? this.get(id) : undefined;
  }

  async listActive(projectId: string) {
    await this.init();
    const names = (await readdir(this.directory)).filter((name: string) => name.endsWith(".json") && !name.startsWith("provider-index") && !name.startsWith("submission-") && !name.startsWith("finalization-") && !name.startsWith("placement-"));
    const jobs = await Promise.all(names.map((name: string) => this.get(name.slice(0, -5))));
    return jobs.filter((job: GenerationJob | undefined): job is GenerationJob => !!job && job.context.projectId === projectId && !["completed", "failed", "canceled", "needs-attention", "succeeded"].includes(job.status));
  }

  async beginSubmission(jobId: string, attemptNumber: number, idempotencyKey: string): Promise<{ claim: SubmissionClaim; acquired: boolean }> {
    await this.init();
    const path = this.submissionFile(jobId, attemptNumber);
    const existing = await this.readClaim(path);
    if (existing) return { claim: existing, acquired: false };
    const claim: FileClaim = { jobId, attemptNumber, idempotencyKey, state: "claimed", claimedAt: this.now(), ownerToken: randomUUID() };
    try { const handle = await open(path, "wx", 0o600); try { await handle.writeFile(JSON.stringify(claim)); await handle.sync(); } finally { await handle.close(); } }
    catch (cause) { if (cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST") return { claim: (await this.readClaim(path))!, acquired: false }; throw cause; }
    return { claim, acquired: true };
  }

  async getSubmissionClaim(jobId: string, attemptNumber: number) { return this.readClaim(this.submissionFile(jobId, attemptNumber)); }

  private async readClaim(path: string): Promise<FileClaim | undefined> { try { return JSON.parse(await readFile(path, "utf8")) as FileClaim; } catch (cause) { if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined; throw new GenerationRepositoryError("generation-claim-corrupt"); } }

  async recordProviderSubmission(jobId: string, attemptNumber: number, providerJobId: string) {
    return this.withFileLock(`submission-${jobId}-${attemptNumber}`, async () => {
      const path = this.submissionFile(jobId, attemptNumber); const claim = await this.readClaim(path);
      if (!claim) throw new GenerationRepositoryError("generation-submission-claim-missing");
      if (claim.state !== "claimed") return claim;
      const next = { ...claim, providerJobId, state: "submitted" as const }; await this.atomic(path, next); return next;
    });
  }

  async repairSubmissionIdentity(jobId: string, attemptNumber: number, providerJobId: string) {
    return this.recordProviderSubmission(jobId, attemptNumber, providerJobId);
  }

  async releaseSubmission(jobId: string, attemptNumber: number, failed: boolean) {
    const path = this.submissionFile(jobId, attemptNumber); const claim = await this.readClaim(path);
    if (claim && failed) await this.atomic(path, { ...claim, state: "failed" });
  }

  async claimFinalization(input: { jobId: string; providerInstanceId: string; providerJobId: string; outputIdentity: string; idempotencyKey: string }) {
    return this.withFileLock(`finalization-${input.jobId}`, async () => {
      const job = await this.readJob(input.jobId);
      const providerInstanceId = job?.providerInstanceId ?? input.providerInstanceId;
      const outputIdentity = canonicalOutputIdentity(input.outputIdentity, providerInstanceId);
      const path = this.finalizationFile(input.jobId); const existing = await this.readFinalization(path);
      if (existing && existing.outputIdentity !== outputIdentity) throw new GenerationRepositoryError("generation-output-identity-conflict");
      if (existing?.state === "completed") return { claim: existing, acquired: false };
      if (existing?.state === "claimed") return { claim: existing, acquired: false };
      const claim: FinalizationClaim = { ...input, providerInstanceId, outputIdentity, state: "claimed", ownerToken: randomUUID(), claimedAt: this.now() };
      await this.atomic(path, claim);
      return { claim, acquired: true };
    });
  }

  private async readFinalization(path: string): Promise<FinalizationClaim | undefined> { try { return JSON.parse(await readFile(path, "utf8")) as FinalizationClaim; } catch (cause) { if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined; throw new GenerationRepositoryError("generation-claim-corrupt"); } }

  async getFinalizationClaim(jobId: string) { return this.readFinalization(this.finalizationFile(jobId)); }

  async repairFinalization(jobId: string, ownerToken: string) {
    return this.withFileLock(`finalization-${jobId}`, async () => {
      const path = this.finalizationFile(jobId); const claim = await this.readFinalization(path);
      if (!claim || claim.state !== "claimed" || claim.ownerToken !== ownerToken) throw new GenerationRepositoryError("generation-finalization-claim-fenced");
      const failed = { ...claim, state: "failed" as const }; await this.atomic(path, failed); return failed;
    });
  }

  async completeFinalization(jobId: string, idempotencyKey: string, ownerToken: string) {
    return this.withFileLock(`finalization-${jobId}`, async () => {
      const path = this.finalizationFile(jobId); const claim = await this.readFinalization(path); if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-finalization-claim-mismatch"); if (claim.state === "completed") return; if (claim.state !== "claimed" || claim.ownerToken !== ownerToken) throw new GenerationRepositoryError("generation-finalization-claim-fenced"); await this.atomic(path, { ...claim, state: "completed" });
    });
  }

  async releaseFinalization(jobId: string, ownerToken: string) {
    return this.withFileLock(`finalization-${jobId}`, async () => {
      const path = this.finalizationFile(jobId); const claim = await this.readFinalization(path); if (!claim || claim.ownerToken !== ownerToken || claim.state !== "claimed") return; await this.atomic(path, { ...claim, state: "failed" });
    });
  }

  async claimPlacement(jobId: string, idempotencyKey: string) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId);
      const existing = await this.readPlacementClaim(path);
      if (existing && existing.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (existing?.state === "claimed" || existing?.state === "completed" || existing?.state === "needs-attention") return { claim: existing, acquired: false };
      const claim: PlacementClaim = { jobId, idempotencyKey, state: "claimed", ownerToken: randomUUID(), claimedAt: this.now() };
      await this.atomic(path, claim);
      return { claim, acquired: true };
    });
  }

  async getPlacementClaim(jobId: string) { return this.readPlacementClaim(this.placementFile(jobId)); }

  async reconcilePlacement(jobId: string, idempotencyKey: string, ownerToken: string, outcome: PlacementRecoveryOutcome) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId);
      const claim = await this.readPlacementClaim(path);
      if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (claim.ownerToken !== ownerToken) throw new GenerationRepositoryError("generation-placement-claim-fenced");
      if (claim.state !== "claimed" && claim.state !== "completed" && claim.state !== "failed" && claim.state !== "needs-attention") throw new GenerationRepositoryError("generation-placement-claim-fenced");
      const state: PlacementClaim["state"] = outcome === "succeeded" ? "completed" : outcome === "failed" ? "failed" : "needs-attention";
      if (claim.state === state) return claim;
      if (claim.state !== "claimed") throw new GenerationRepositoryError("generation-placement-claim-fenced");
      const reconciled: PlacementClaim = { ...claim, state };
      await this.atomic(path, reconciled);
      return reconciled;
    });
  }

  async repairPlacement(jobId: string, ownerToken: string) {
    const claim = await this.getPlacementClaim(jobId);
    if (!claim) throw new GenerationRepositoryError("generation-placement-claim-fenced");
    return this.reconcilePlacement(jobId, claim.idempotencyKey, ownerToken, "failed");
  }

  async completePlacement(jobId: string, idempotencyKey: string, ownerToken: string) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId); const claim = await this.readPlacementClaim(path);
      if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (claim.state === "completed") return;
      if (claim.state !== "claimed" || claim.ownerToken !== ownerToken) throw new GenerationRepositoryError("generation-placement-claim-fenced");
      await this.atomic(path, { ...claim, state: "completed" });
    });
  }

  async releasePlacement(jobId: string, ownerToken: string) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId); const claim = await this.readPlacementClaim(path);
      if (!claim || claim.ownerToken !== ownerToken || claim.state !== "claimed") return;
      await this.atomic(path, { ...claim, state: "failed" });
    });
  }

  private async readPlacementClaim(path: string): Promise<PlacementClaim | undefined> {
    try { return JSON.parse(await readFile(path, "utf8")) as PlacementClaim; }
    catch (cause) { if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined; throw new GenerationRepositoryError("generation-placement-claim-corrupt"); }
  }
}
