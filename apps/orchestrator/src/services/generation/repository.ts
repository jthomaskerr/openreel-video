import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, open } from "node:fs/promises";
import { join } from "node:path";
import { parseGenerationJob, type GenerationCheckpointName, type GenerationCheckpointState, type GenerationJob } from "@openreel/music-video-domain/generation";
import { KeyedLock } from "./lock.js";

export class GenerationRepositoryError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "GenerationRepositoryError"; }
}

export interface GenerationJobRepository {
  create(job: GenerationJob): Promise<GenerationJob>;
  get(id: string): Promise<GenerationJob | undefined>;
  update(id: string, mutate: (job: GenerationJob) => GenerationJob): Promise<GenerationJob>;
  compareAndSetCheckpoint(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState): Promise<boolean>;
  findByProviderCompletion(provider: string, providerJobId: string): Promise<GenerationJob | undefined>;
  listActive(projectId: string): Promise<GenerationJob[]>;
}

/** Crash-safe single-process JSON repository. Files are independently valid records. */
export class FileGenerationJobRepository implements GenerationJobRepository {
  private readonly lock = new KeyedLock();
  constructor(readonly directory: string) {}
  private file(id: string) { return join(this.directory, `${id}.json`); }
  private indexFile() { return join(this.directory, "provider-index.json"); }
  private async init() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) if (name.endsWith(".tmp")) await rm(join(this.directory, name), { force: true });
  }
  private async atomic(path: string, value: unknown) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(tmp, "w", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, path);
  }
  private async readIndex(): Promise<Record<string, string>> {
    try { return JSON.parse(await readFile(this.indexFile(), "utf8")) as Record<string, string>; } catch { return {}; }
  }
  async create(job: GenerationJob) {
    parseGenerationJob(job); await this.init();
    return this.lock.run(job.id, async () => {
      if (await this.get(job.id)) throw new GenerationRepositoryError("generation-id-conflict");
      const index = await this.readIndex();
      for (const attempt of job.attempts) if (attempt.providerJobId) {
        const key = `${job.provider}:${attempt.providerJobId}`;
        if (index[key] && index[key] !== job.id) throw new GenerationRepositoryError("generation-provider-id-conflict");
        index[key] = job.id;
      }
      await this.atomic(this.file(job.id), job); await this.atomic(this.indexFile(), index); return job;
    });
  }
  async get(id: string) { await this.init(); try { return parseGenerationJob(JSON.parse(await readFile(this.file(id), "utf8"))); } catch { return undefined; } }
  async update(id: string, mutate: (job: GenerationJob) => GenerationJob) {
    return this.lock.run(id, async () => {
      const existing = await this.get(id); if (!existing) throw new GenerationRepositoryError("generation-not-found");
      const next = parseGenerationJob(mutate(existing)); const index = await this.readIndex();
      for (const attempt of next.attempts) if (attempt.providerJobId) {
        const key = `${next.provider}:${attempt.providerJobId}`;
        if (index[key] && index[key] !== id) throw new GenerationRepositoryError("generation-provider-id-conflict"); index[key] = id;
      }
      await this.atomic(this.file(id), next); await this.atomic(this.indexFile(), index); return next;
    });
  }
  async compareAndSetCheckpoint(id: string, checkpoint: GenerationCheckpointName, state: GenerationCheckpointState) {
    const job = await this.get(id); if (!job) throw new GenerationRepositoryError("generation-not-found");
    if (job.checkpoints[checkpoint]?.status === "completed") return false;
    await this.update(id, (current) => ({ ...current, checkpoints: { ...current.checkpoints, [checkpoint]: state } })); return true;
  }
  async findByProviderCompletion(provider: string, providerJobId: string) { const id = (await this.readIndex())[`${provider}:${providerJobId}`]; return id ? this.get(id) : undefined; }
  async listActive(projectId: string) {
    await this.init(); const names = (await readdir(this.directory)).filter((n) => n.endsWith(".json") && n !== "provider-index.json"); const jobs = await Promise.all(names.map((n) => this.get(n.slice(0, -5))));
    return jobs.filter((j): j is GenerationJob => !!j && j.context.projectId === projectId && !["completed", "failed", "canceled", "needs-attention"].includes(j.status));
  }
}
