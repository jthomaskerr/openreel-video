import crypto from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ResolveExportJobSchema,
  ResolveImportResultSchema,
  type HandoffSelection,
  type ResolveExportJob,
  type ResolveImportResult,
} from "@openreel/core";
import { assertValidProjectId } from "../projects/storage-validation";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export interface ResolveExportArtifact {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface PersistedResolveExportJob {
  readonly version: 1;
  readonly job: ResolveExportJob;
  readonly selection: HandoffSelection;
  readonly launchToken: {
    readonly sha256: string;
    readonly expiresAt: string;
    readonly redeemedAt: string | null;
  };
  readonly artifacts: readonly ResolveExportArtifact[];
  readonly result?: ResolveImportResult;
}

export class ResolveJobStoreError extends Error {
  constructor(
    readonly code: "INVALID_RESOLVE_JOB_PATH" | "RESOLVE_JOB_NOT_FOUND" | "RESOLVE_JOB_CORRUPT",
    message: string,
    readonly identifiers: { readonly projectId?: string; readonly jobId?: string } = {},
  ) {
    super(message);
    this.name = "ResolveJobStoreError";
  }
}

export interface ResolveExportJobStoreOptions {
  readonly projectDir: (projectId: string) => string;
  readonly listProjectIds: () => Promise<readonly string[]>;
  /** Test seam for deterministic I/O failures. */
  readonly beforeWrite?: (path: string) => void | Promise<void>;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validateJobId(jobId: string): void {
  if (!JOB_ID.test(jobId)) {
    throw new ResolveJobStoreError(
      "INVALID_RESOLVE_JOB_PATH",
      "Resolve job identifier is invalid",
      { jobId },
    );
  }
}

function validateArtifactName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new ResolveJobStoreError("INVALID_RESOLVE_JOB_PATH", "Resolve artifact name is invalid");
  }
}

function publicJobForPersistence(job: ResolveExportJob): ResolveExportJob {
  const { bridgeLaunchUrl: _secretUrl, ...persisted } = job;
  return persisted;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function parseRecord(value: unknown, identifiers: { projectId?: string; jobId?: string }): PersistedResolveExportJob {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    const candidate = value as Record<string, unknown>;
    if (!hasOnlyKeys(candidate, ["version", "job", "selection", "launchToken", "artifacts", "result"])) {
      throw new Error("unknown job field");
    }
    if (candidate.version !== 1) throw new Error("unsupported version");
    const job = ResolveExportJobSchema.parse(candidate.job);
    if (job.bridgeLaunchUrl) throw new Error("persisted job contains a bearer token");
    const selection = candidate.selection as HandoffSelection;
    if (
      !selection || selection.projectId !== job.projectId || selection.target !== "resolve"
      || typeof selection.projectModifiedAt !== "number" || !selection.range
    ) throw new Error("invalid handoff selection");
    if (
      !hasOnlyKeys(selection as unknown as Record<string, unknown>, ["projectId", "projectModifiedAt", "target", "range"])
      || !hasOnlyKeys(selection.range as unknown as Record<string, unknown>, ["startTime", "endTime"])
    ) throw new Error("unknown handoff selection field");
    const launchToken = candidate.launchToken as PersistedResolveExportJob["launchToken"];
    if (
      !launchToken || !SHA256.test(launchToken.sha256)
      || !Number.isFinite(Date.parse(launchToken.expiresAt))
      || (launchToken.redeemedAt !== null && !Number.isFinite(Date.parse(launchToken.redeemedAt)))
    ) throw new Error("invalid launch token metadata");
    if (!hasOnlyKeys(launchToken as unknown as Record<string, unknown>, ["sha256", "expiresAt", "redeemedAt"])) {
      throw new Error("unknown launch token field");
    }
    if (!Array.isArray(candidate.artifacts)) throw new Error("invalid artifacts");
    const artifactPrefix = `exports/resolve/${job.id}/`;
    const artifacts = candidate.artifacts.map((artifact) => {
      if (!artifact || typeof artifact !== "object") throw new Error("invalid artifact");
      const entry = artifact as ResolveExportArtifact;
      if (!hasOnlyKeys(entry as unknown as Record<string, unknown>, ["path", "mediaType", "byteLength", "sha256"])) {
        throw new Error("unknown artifact field");
      }
      if (
        typeof entry.path !== "string" || !entry.path.startsWith(artifactPrefix)
        || entry.path.slice(artifactPrefix.length).includes("/") || entry.path.includes("..")
        || typeof entry.mediaType !== "string" || !Number.isSafeInteger(entry.byteLength)
        || !SHA256.test(entry.sha256)
      ) throw new Error("invalid artifact");
      return entry;
    });
    const result = candidate.result === undefined
      ? undefined
      : ResolveImportResultSchema.parse(candidate.result);
    return { version: 1, job, selection, launchToken, artifacts, result };
  } catch {
    throw new ResolveJobStoreError(
      "RESOLVE_JOB_CORRUPT",
      "Persisted Resolve job is invalid",
      identifiers,
    );
  }
}

export class ResolveExportJobStore {
  readonly #locks = new Map<string, Promise<void>>();

  constructor(private readonly options: ResolveExportJobStoreOptions) {}

  jobDirectory(projectId: string, jobId: string): string {
    try {
      assertValidProjectId(projectId);
      validateJobId(jobId);
    } catch (error) {
      if (error instanceof ResolveJobStoreError) throw error;
      throw new ResolveJobStoreError(
        "INVALID_RESOLVE_JOB_PATH",
        "Resolve job path is invalid",
        { projectId, jobId },
      );
    }
    return join(this.options.projectDir(projectId), "exports", "resolve", jobId);
  }

  artifactPath(projectId: string, jobId: string, name: string): string {
    validateArtifactName(name);
    return join(this.jobDirectory(projectId, jobId), name);
  }

  async #atomicWrite(path: string, bytes: string | Uint8Array): Promise<void> {
    await this.options.beforeWrite?.(path);
    const directory = dirname(path);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
      await syncDirectory(directory);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.#locks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }

  async #saveUnlocked(record: PersistedResolveExportJob): Promise<PersistedResolveExportJob> {
    const persisted = parseRecord(
      { ...record, job: publicJobForPersistence(record.job) },
      { projectId: record.job.projectId, jobId: record.job.id },
    );
    await this.#atomicWrite(
      this.artifactPath(record.job.projectId, record.job.id, "job.json"),
      `${JSON.stringify(persisted, null, 2)}\n`,
    );
    return persisted;
  }

  async save(record: PersistedResolveExportJob): Promise<PersistedResolveExportJob> {
    const key = `${record.job.projectId}:${record.job.id}`;
    return this.#exclusive(key, () => this.#saveUnlocked(record));
  }

  async #loadUnlocked(projectId: string, jobId: string): Promise<PersistedResolveExportJob | null> {
    const path = this.artifactPath(projectId, jobId, "job.json");
    try {
      return parseRecord(JSON.parse(await readFile(path, "utf8")), { projectId, jobId });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof ResolveJobStoreError) throw error;
      throw new ResolveJobStoreError(
        "RESOLVE_JOB_CORRUPT",
        "Persisted Resolve job cannot be read",
        { projectId, jobId },
      );
    }
  }

  async load(projectId: string, jobId: string): Promise<PersistedResolveExportJob | null> {
    const key = `${projectId}:${jobId}`;
    return this.#exclusive(key, () => this.#loadUnlocked(projectId, jobId));
  }

  async find(jobId: string): Promise<PersistedResolveExportJob | null> {
    validateJobId(jobId);
    let match: PersistedResolveExportJob | null = null;
    for (const projectId of await this.options.listProjectIds()) {
      const candidate = await this.load(projectId, jobId);
      if (!candidate) continue;
      if (match) {
        throw new ResolveJobStoreError("RESOLVE_JOB_CORRUPT", "Resolve job identifier is duplicated", { jobId });
      }
      match = candidate;
    }
    return match;
  }

  async findByTokenHash(sha256: string): Promise<PersistedResolveExportJob | null> {
    if (!SHA256.test(sha256)) return null;
    for (const projectId of await this.options.listProjectIds()) {
      const resolveRoot = join(this.options.projectDir(projectId), "exports", "resolve");
      let names: string[];
      try {
        names = await readdir(resolveRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const jobId of names.filter((name) => JOB_ID.test(name)).sort()) {
        const candidate = await this.load(projectId, jobId);
        if (candidate?.launchToken.sha256 === sha256) return candidate;
      }
    }
    return null;
  }

  async update(
    projectId: string,
    jobId: string,
    updater: (record: PersistedResolveExportJob) => Promise<PersistedResolveExportJob> | PersistedResolveExportJob,
  ): Promise<PersistedResolveExportJob> {
    const key = `${projectId}:${jobId}`;
    return this.#exclusive(key, async () => {
      const current = await this.#loadUnlocked(projectId, jobId);
      if (!current) {
        throw new ResolveJobStoreError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { projectId, jobId });
      }
      return this.#saveUnlocked(await updater(current));
    });
  }

  async writeArtifact(
    projectId: string,
    jobId: string,
    name: string,
    bytes: string | Uint8Array,
  ): Promise<ResolveExportArtifact> {
    const path = this.artifactPath(projectId, jobId, name);
    await this.#atomicWrite(path, bytes);
    // Re-read after the file handle is closed and the rename is durable so the
    // recorded digest proves the bytes consumers will actually receive.
    const payload = await readFile(path);
    return {
      path: `exports/resolve/${jobId}/${name}`,
      mediaType: name.endsWith(".fcpxml") ? "application/xml"
        : name.endsWith(".md") ? "text/markdown"
          : "application/json",
      byteLength: payload.byteLength,
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
    };
  }

  async removeArtifact(projectId: string, jobId: string, name: string): Promise<void> {
    await rm(this.artifactPath(projectId, jobId, name), { force: true });
  }

  async removeJob(projectId: string, jobId: string): Promise<void> {
    await rm(this.jobDirectory(projectId, jobId), { recursive: true, force: true });
  }
}
