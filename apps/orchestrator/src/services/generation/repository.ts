import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  schemaVersion: 2;
  jobId: string;
  idempotencyKey: string;
  state: "claimed" | "failed" | "completed" | "needs-attention";
  outcome: PlacementOutcome;
  ownerToken: string;
  ownerEpoch: number;
  phase: "reserved" | "invocation-armed" | "reconciling" | "terminal";
  claimedAt: number;
  lastRenewedAt: number;
  leaseExpiresAt: number;
  replaySafe?: boolean;
  terminalAt?: number;
}

export type PlacementOutcome = "pending" | "applied" | "not-applied" | "unknown";
export type PlacementRecovery =
  | { kind: "owner-live"; claim: PlacementClaim }
  | { kind: "safe-retry"; claim: PlacementClaim }
  | { kind: "reconcile"; claim: PlacementClaim }
  | { kind: "resolved"; claim: PlacementClaim };

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
  readonly placementLeaseTtlMs: number;
  renewPlacement(jobId: string, idempotencyKey: string, ownerToken: string): Promise<PlacementClaim>;
  markPlacementInvocationStarted(jobId: string, idempotencyKey: string, ownerToken: string): Promise<PlacementClaim>;
  recoverPlacement(jobId: string, idempotencyKey: string): Promise<PlacementRecovery>;
  reconcilePlacement(jobId: string, idempotencyKey: string, ownerToken: string, outcome: PlacementOutcome, options?: { replaySafe?: boolean }): Promise<PlacementClaim>;
}

export interface FileGenerationJobRepositoryOptions {
  lockTtlMs?: number;
  placementLeaseTtlMs?: number;
  now?: () => number;
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
  readonly lockTtlMs: number;
  readonly placementLeaseTtlMs: number;
  readonly now: () => number;

  constructor(readonly directory: string, options?: FileGenerationJobRepositoryOptions | number, legacyNow?: () => number) {
    if (typeof options === "number") {
      this.lockTtlMs = options;
      this.placementLeaseTtlMs = options;
      this.now = legacyNow ?? (() => Date.now());
    } else {
      this.lockTtlMs = options?.lockTtlMs ?? 30_000;
      this.placementLeaseTtlMs = options?.placementLeaseTtlMs ?? 30_000;
      this.now = options?.now ?? (() => Date.now());
    }
    if (this.lockTtlMs <= 0 || this.placementLeaseTtlMs <= 0) throw new GenerationRepositoryError("generation-repository-invalid-ttl");
  }

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
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async removeLockIfOwned(path: string, lockToken: string) {
    try {
      const current = JSON.parse(await readFile(path, "utf8")) as { lockToken?: string; processToken?: string };
      const token = current.lockToken ?? current.processToken;
      if (token === lockToken) await rm(path, { force: true });
    } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
  }

  private async publishFileLock(path: string, lockToken: string) {
    const candidate = `${path}.${lockToken}.candidate`;
    try {
      const handle = await open(candidate, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ lockToken, processToken: this.processToken, pid: process.pid, claimedAt: this.now() }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(candidate, path);
        return true;
      } catch (cause) {
        if (cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST") return false;
        throw cause;
      }
    } finally {
      await rm(candidate, { force: true });
    }
  }

  private async reclaimStaleCorruptLock(path: string) {
    try {
      const before = await stat(path);
      if (Date.now() - before.mtimeMs < this.lockTtlMs) return;
      try {
        JSON.parse(await readFile(path, "utf8"));
        return;
      } catch {
        // New writers publish complete records atomically. Only an unchanged,
        // stale record from the legacy create-then-write protocol is reclaimable.
      }
      const after = await stat(path);
      if (before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs) {
        await rm(path, { force: true });
      }
    } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
  }

  private processIsLive(pid: number) {
    try { process.kill(pid, 0); return true; }
    catch (cause) { return Boolean(cause && typeof cause === "object" && "code" in cause && cause.code === "EPERM"); }
  }

  private async withFileLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    await this.init();
    const path = join(this.locksDir(), `${key}.lock`);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const lockToken = randomUUID();
      if (await this.publishFileLock(path, lockToken)) {
        try { return await task(); } finally { await this.removeLockIfOwned(path, lockToken); }
      }
      try {
        const lock = JSON.parse(await readFile(path, "utf8")) as { lockToken?: string; processToken?: string; pid?: number; claimedAt?: number };
        const ownerToken = lock.lockToken ?? lock.processToken;
        const ownerIsLive = typeof lock.pid === "number" ? this.processIsLive(lock.pid) : typeof lock.claimedAt === "number" && this.now() - lock.claimedAt <= this.lockTtlMs;
        if (!ownerIsLive && ownerToken) await this.removeLockIfOwned(path, ownerToken);
      } catch (lockError) {
        if (lockError && typeof lockError === "object" && "code" in lockError && lockError.code === "ENOENT") continue;
        await this.reclaimStaleCorruptLock(path);
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
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
      if (existing?.state === "claimed" || existing?.state === "completed" || existing?.state === "needs-attention" || existing?.state === "failed" && existing.replaySafe === false) return { claim: existing, acquired: false };
      const now = this.now();
      const claim: PlacementClaim = { schemaVersion: 2, jobId, idempotencyKey, state: "claimed", outcome: "pending", ownerToken: randomUUID(), ownerEpoch: (existing?.ownerEpoch ?? 0) + 1, phase: "reserved", claimedAt: now, lastRenewedAt: now, leaseExpiresAt: now + this.placementLeaseTtlMs };
      await this.atomic(path, claim);
      return { claim, acquired: true };
    });
  }

  async getPlacementClaim(jobId: string) { return this.readPlacementClaim(this.placementFile(jobId)); }

  async renewPlacement(jobId: string, idempotencyKey: string, ownerToken: string) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId);
      const claim = await this.readPlacementClaim(path);
      const now = this.now();
      if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (claim.ownerToken !== ownerToken || claim.state !== "claimed" || claim.phase === "terminal" || now >= claim.leaseExpiresAt) throw new GenerationRepositoryError("generation-placement-claim-fenced");
      const renewed: PlacementClaim = {
        ...claim,
        lastRenewedAt: Math.max(claim.lastRenewedAt, now),
        leaseExpiresAt: Math.max(claim.leaseExpiresAt, now + this.placementLeaseTtlMs),
      };
      await this.atomic(path, renewed);
      return renewed;
    });
  }

  async markPlacementInvocationStarted(jobId: string, idempotencyKey: string, ownerToken: string) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId);
      const claim = await this.readPlacementClaim(path);
      const now = this.now();
      if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (claim.ownerToken !== ownerToken || claim.state !== "claimed" || now >= claim.leaseExpiresAt || !["reserved", "invocation-armed"].includes(claim.phase)) throw new GenerationRepositoryError("generation-placement-claim-fenced");
      if (claim.phase === "invocation-armed") return claim;
      const armed: PlacementClaim = {
        ...claim,
        phase: "invocation-armed",
        lastRenewedAt: Math.max(claim.lastRenewedAt, now),
        leaseExpiresAt: Math.max(claim.leaseExpiresAt, now + this.placementLeaseTtlMs),
      };
      await this.atomic(path, armed);
      return armed;
    });
  }

  async recoverPlacement(jobId: string, idempotencyKey: string): Promise<PlacementRecovery> {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId);
      const claim = await this.readPlacementClaim(path);
      if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (claim.phase === "terminal") {
        if (claim.outcome === "unknown" || claim.outcome === "not-applied" && claim.replaySafe === false) {
          const now = this.now();
          const reconciling: PlacementClaim = { ...claim, state: "claimed", outcome: "pending", ownerToken: randomUUID(), ownerEpoch: claim.ownerEpoch + 1, phase: "reconciling", claimedAt: now, lastRenewedAt: now, leaseExpiresAt: now + this.placementLeaseTtlMs, replaySafe: false, terminalAt: undefined };
          await this.atomic(path, reconciling);
          return { kind: "reconcile", claim: reconciling };
        }
        return { kind: "resolved", claim };
      }
      const now = this.now();
      if (now < claim.leaseExpiresAt) return { kind: "owner-live", claim };
      if (claim.phase === "reserved") {
        const retryable: PlacementClaim = { ...claim, state: "failed", outcome: "not-applied", phase: "terminal", replaySafe: true, terminalAt: now };
        await this.atomic(path, retryable);
        return { kind: "safe-retry", claim: retryable };
      }
      const reconciling: PlacementClaim = { ...claim, ownerToken: randomUUID(), ownerEpoch: claim.ownerEpoch + 1, phase: "reconciling", claimedAt: now, lastRenewedAt: now, leaseExpiresAt: now + this.placementLeaseTtlMs, replaySafe: false };
      await this.atomic(path, reconciling);
      return { kind: "reconcile", claim: reconciling };
    });
  }

  async reconcilePlacement(jobId: string, idempotencyKey: string, ownerToken: string, outcome: PlacementOutcome, options?: { replaySafe?: boolean }) {
    return this.withFileLock(`placement-${jobId}`, async () => {
      const path = this.placementFile(jobId);
      const claim = await this.readPlacementClaim(path);
      if (!claim || claim.idempotencyKey !== idempotencyKey) throw new GenerationRepositoryError("generation-placement-claim-mismatch");
      if (claim.ownerToken !== ownerToken) throw new GenerationRepositoryError("generation-placement-claim-fenced");
      if (claim.phase !== "terminal" && this.now() >= claim.leaseExpiresAt) throw new GenerationRepositoryError("generation-placement-claim-fenced");
      const replaySafe = outcome === "not-applied" ? options?.replaySafe ?? claim.phase === "reserved" : undefined;
      const state: PlacementClaim["state"] = outcome === "applied" ? "completed" : outcome === "not-applied" ? replaySafe ? "failed" : "needs-attention" : outcome === "unknown" ? "needs-attention" : "claimed";
      if (claim.state === state && claim.outcome === outcome) return claim;
      if (claim.phase === "terminal") throw new GenerationRepositoryError("generation-placement-claim-fenced");
      const terminal = outcome !== "pending";
      const reconciled: PlacementClaim = { ...claim, state, outcome, ...(terminal ? { phase: "terminal", terminalAt: this.now() } : {}), ...(outcome === "not-applied" ? { replaySafe } : {}) };
      await this.atomic(path, reconciled);
      return reconciled;
    });
  }

  private async readPlacementClaim(path: string): Promise<PlacementClaim | undefined> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<PlacementClaim> & Pick<PlacementClaim, "jobId" | "idempotencyKey" | "state" | "ownerToken" | "claimedAt">;
      const outcome = parsed.outcome ?? (parsed.state === "completed" ? "applied" : parsed.state === "failed" ? "not-applied" : parsed.state === "needs-attention" ? "unknown" : "pending");
      const phase = parsed.phase ?? (parsed.state === "claimed" && outcome === "pending" ? "invocation-armed" : "terminal");
      return {
        ...parsed,
        schemaVersion: 2,
        outcome,
        ownerEpoch: parsed.ownerEpoch ?? 1,
        phase,
        lastRenewedAt: parsed.lastRenewedAt ?? parsed.claimedAt,
        leaseExpiresAt: parsed.leaseExpiresAt ?? parsed.claimedAt + this.placementLeaseTtlMs,
        ...(outcome === "not-applied" ? { replaySafe: parsed.replaySafe ?? false } : {}),
      } as PlacementClaim;
    }
    catch (cause) { if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined; throw new GenerationRepositoryError("generation-placement-claim-corrupt"); }
  }
}
