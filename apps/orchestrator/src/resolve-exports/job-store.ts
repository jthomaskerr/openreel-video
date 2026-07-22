import crypto from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  ResolveExportJobSchema,
  ResolveImportResultSchema,
  type HandoffSelection,
  type ResolveExportJob,
  type ResolveImportResult,
} from "@openreel/core/export/handoff/index";
import { createInfrastructureNonce, isDurableId } from "@openreel/core/identity/durable-id";
import { assertValidProjectId } from "../projects/storage-validation";

const SHA256 = /^[a-f0-9]{64}$/;
const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/;
const EARLIEST_JOURNAL_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_JOURNAL_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const TRANSACTION_KINDS = new Set<ResolveTransactionKind>(["start", "cancel", "redeem", "import-result"]);

function sameSha256(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

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

export type ResolveTransactionKind = "start" | "cancel" | "redeem" | "import-result";

export interface ResolveTransactionWrite {
  readonly path: string;
  readonly beforeBase64: string | null;
  readonly beforeSha256: string | null;
  readonly afterBase64: string;
  readonly afterSha256: string;
}

export interface ResolveTransactionJournal {
  readonly version: 1;
  readonly transactionId: string;
  readonly kind: ResolveTransactionKind;
  readonly projectId: string;
  readonly jobId: string;
  readonly baseCommitSha: string;
  readonly writes: readonly ResolveTransactionWrite[];
  readonly publishedPaths: readonly string[];
  readonly preparedAt: string;
}

export interface PrepareResolveTransaction {
  readonly transactionId: string;
  readonly kind: ResolveTransactionKind;
  readonly projectId: string;
  readonly jobId: string;
  readonly baseCommitSha: string;
  readonly writes: readonly { readonly path: string; readonly bytes: Uint8Array }[];
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
  if (!isDurableId(jobId, "resolve-job")) {
    throw new ResolveJobStoreError(
      "INVALID_RESOLVE_JOB_PATH",
      "Resolve job identifier is invalid",
      { jobId },
    );
  }
}

function validateTransactionId(transactionId: string): void {
  if (!isDurableId(transactionId, "resolve-transaction")) {
    throw new ResolveJobStoreError(
      "INVALID_RESOLVE_JOB_PATH",
      "Resolve transaction identifier is invalid",
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

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && hasOnlyKeys(value, expected);
}

function canonicalBase64(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

function verifiedImage(base64: string, digest: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (!sameSha256(actual, digest)) throw new Error("journal image digest mismatch");
  return bytes;
}

function validJournalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString() === value
    && timestamp >= EARLIEST_JOURNAL_TIMESTAMP
    && timestamp <= Date.now() + MAX_JOURNAL_FUTURE_SKEW_MS;
}

function validTransactionPath(jobId: string, path: unknown): path is string {
  if (path === "project.json") return true;
  if (typeof path !== "string") return false;
  const prefix = `exports/resolve/${jobId}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return Boolean(name) && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");
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
    if (
      (identifiers.projectId !== undefined && job.projectId !== identifiers.projectId)
      || (identifiers.jobId !== undefined && job.id !== identifiers.jobId)
    ) throw new Error("persisted job is rebound to another location");
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

  async #safeJobDirectory(
    projectId: string,
    jobId: string,
    create: boolean,
  ): Promise<string | null> {
    const lexical = this.jobDirectory(projectId, jobId);
    const projectRoot = this.options.projectDir(projectId);
    try {
      const rootStats = await lstat(projectRoot);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("unsafe project root");
      const trustedRoot = await realpath(projectRoot);
      let current = projectRoot;
      for (const component of ["exports", "resolve", jobId]) {
        current = join(current, component);
        try {
          const stats = await lstat(current);
          if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("unsafe managed component");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          if (!create) return null;
          try {
            await mkdir(current);
          } catch (mkdirError) {
            if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
          }
          const created = await lstat(current);
          if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("unsafe managed component");
        }
        const resolved = await realpath(current);
        if (resolved !== trustedRoot && !resolved.startsWith(`${trustedRoot}/`)) {
          throw new Error("managed component escaped project root");
        }
      }
      return lexical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return null;
      throw new ResolveJobStoreError(
        "INVALID_RESOLVE_JOB_PATH",
        "Resolve job path is not confined to the project store",
        { projectId, jobId },
      );
    }
  }

  async #safeTransactionsDirectory(
    projectId: string,
    jobId: string,
    create: boolean,
  ): Promise<string | null> {
    const jobDirectory = await this.#safeJobDirectory(projectId, jobId, create);
    if (!jobDirectory) return null;
    const path = join(jobDirectory, ".transactions");
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("unsafe transaction directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ResolveJobStoreError(
          "INVALID_RESOLVE_JOB_PATH",
          "Resolve transaction path is not confined to the project store",
          { projectId, jobId },
        );
      }
      if (!create) return null;
      await mkdir(path);
    }
    const resolvedJob = await realpath(jobDirectory);
    const resolved = await realpath(path);
    if (!resolved.startsWith(`${resolvedJob}/`)) {
      throw new ResolveJobStoreError(
        "INVALID_RESOLVE_JOB_PATH",
        "Resolve transaction path escaped the job directory",
        { projectId, jobId },
      );
    }
    return path;
  }

  async #transactionTarget(
    projectId: string,
    jobId: string,
    relativePath: string,
    createParent: boolean,
  ): Promise<string> {
    if (relativePath === "project.json") {
      const projectRoot = this.options.projectDir(projectId);
      const root = await lstat(projectRoot);
      if (root.isSymbolicLink() || !root.isDirectory()) {
        throw new ResolveJobStoreError("INVALID_RESOLVE_JOB_PATH", "Project root is unsafe", { projectId, jobId });
      }
      return join(projectRoot, "project.json");
    }
    const prefix = `exports/resolve/${jobId}/`;
    if (!relativePath.startsWith(prefix)) {
      throw new ResolveJobStoreError(
        "INVALID_RESOLVE_JOB_PATH",
        "Resolve transaction path is outside its job",
        { projectId, jobId },
      );
    }
    const name = relativePath.slice(prefix.length);
    validateArtifactName(name);
    const directory = await this.#safeJobDirectory(projectId, jobId, createParent);
    if (!directory) {
      throw new ResolveJobStoreError("RESOLVE_JOB_NOT_FOUND", "Resolve job directory does not exist", { projectId, jobId });
    }
    return join(directory, name);
  }

  async #readBeforeImage(path: string, identifiers: { projectId: string; jobId: string }): Promise<Buffer | null> {
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new ResolveJobStoreError(
          "INVALID_RESOLVE_JOB_PATH",
          "Resolve transaction target is not a regular file",
          identifiers,
        );
      }
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  #parseJournal(
    value: unknown,
    expected: { readonly projectId: string; readonly jobId: string; readonly transactionId: string },
  ): ResolveTransactionJournal {
    const identifiers = { projectId: expected.projectId, jobId: expected.jobId };
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
      const candidate = value as Record<string, unknown>;
      if (!hasExactKeys(candidate, [
        "version",
        "transactionId",
        "kind",
        "projectId",
        "jobId",
        "baseCommitSha",
        "writes",
        "publishedPaths",
        "preparedAt",
      ])) throw new Error("invalid journal keys");
      if (
        candidate.version !== 1
        || candidate.transactionId !== expected.transactionId
        || candidate.projectId !== expected.projectId
        || candidate.jobId !== expected.jobId
        || !isDurableId(expected.transactionId, "resolve-transaction")
        || !isDurableId(expected.jobId, "resolve-job")
        || typeof candidate.kind !== "string"
        || !TRANSACTION_KINDS.has(candidate.kind as ResolveTransactionKind)
        || typeof candidate.baseCommitSha !== "string"
        || !FULL_COMMIT_SHA.test(candidate.baseCommitSha)
        || !validJournalTimestamp(candidate.preparedAt)
      ) throw new Error("invalid journal identity");
      assertValidProjectId(expected.projectId);
      if (!Array.isArray(candidate.writes) || candidate.writes.length === 0) {
        throw new Error("invalid journal writes");
      }

      const writes = candidate.writes.map((value): ResolveTransactionWrite => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid write");
        const write = value as Record<string, unknown>;
        if (!hasExactKeys(write, ["path", "beforeBase64", "beforeSha256", "afterBase64", "afterSha256"])) {
          throw new Error("invalid write keys");
        }
        if (!validTransactionPath(expected.jobId, write.path)) throw new Error("invalid write path");
        if (!canonicalBase64(write.afterBase64) || typeof write.afterSha256 !== "string" || !SHA256.test(write.afterSha256)) {
          throw new Error("invalid after image");
        }
        verifiedImage(write.afterBase64, write.afterSha256);
        if (write.beforeBase64 === null || write.beforeSha256 === null) {
          if (write.beforeBase64 !== null || write.beforeSha256 !== null) throw new Error("incomplete before image");
        } else {
          if (
            !canonicalBase64(write.beforeBase64)
            || typeof write.beforeSha256 !== "string"
            || !SHA256.test(write.beforeSha256)
          ) throw new Error("invalid before image");
          verifiedImage(write.beforeBase64, write.beforeSha256);
        }
        return {
          path: write.path,
          beforeBase64: write.beforeBase64,
          beforeSha256: write.beforeSha256,
          afterBase64: write.afterBase64,
          afterSha256: write.afterSha256,
        };
      });
      const writePaths = writes.map((write) => write.path);
      if (new Set(writePaths).size !== writePaths.length) throw new Error("duplicate write path");
      if (!Array.isArray(candidate.publishedPaths)) throw new Error("invalid published paths");
      const publishedPaths = candidate.publishedPaths.map((path) => {
        if (typeof path !== "string" || !writePaths.includes(path)) throw new Error("invalid published path");
        return path;
      });
      if (new Set(publishedPaths).size !== publishedPaths.length) throw new Error("duplicate published path");

      return {
        version: 1,
        transactionId: expected.transactionId,
        kind: candidate.kind as ResolveTransactionKind,
        projectId: expected.projectId,
        jobId: expected.jobId,
        baseCommitSha: candidate.baseCommitSha,
        writes,
        publishedPaths,
        preparedAt: candidate.preparedAt,
      };
    } catch {
      throw new ResolveJobStoreError(
        "RESOLVE_JOB_CORRUPT",
        "Resolve transaction journal is invalid",
        identifiers,
      );
    }
  }

  async #journalPath(journal: Pick<ResolveTransactionJournal, "projectId" | "jobId" | "transactionId">, create: boolean) {
    validateTransactionId(journal.transactionId);
    const directory = await this.#safeTransactionsDirectory(journal.projectId, journal.jobId, create);
    if (!directory) return null;
    return join(directory, `${journal.transactionId}.json`);
  }

  async #writeJournal(journal: ResolveTransactionJournal): Promise<void> {
    const validated = this.#parseJournal(journal, {
      projectId: journal.projectId,
      jobId: journal.jobId,
      transactionId: journal.transactionId,
    });
    const path = await this.#journalPath(validated, true);
    await this.#atomicWrite(path!, `${JSON.stringify(validated, null, 2)}\n`);
  }

  async prepareTransaction(input: PrepareResolveTransaction): Promise<ResolveTransactionJournal> {
    validateTransactionId(input.transactionId);
    validateJobId(input.jobId);
    assertValidProjectId(input.projectId);
    if (new Set(input.writes.map((write) => write.path)).size !== input.writes.length) {
      throw new ResolveJobStoreError("RESOLVE_JOB_CORRUPT", "Resolve transaction contains duplicate paths", {
        projectId: input.projectId,
        jobId: input.jobId,
      });
    }
    const writes: ResolveTransactionWrite[] = [];
    for (const write of input.writes) {
      const target = await this.#transactionTarget(input.projectId, input.jobId, write.path, true);
      const before = await this.#readBeforeImage(target, { projectId: input.projectId, jobId: input.jobId });
      const after = Buffer.from(write.bytes);
      writes.push({
        path: write.path,
        beforeBase64: before?.toString("base64") ?? null,
        beforeSha256: before
          ? crypto.createHash("sha256").update(before).digest("hex")
          : null,
        afterBase64: after.toString("base64"),
        afterSha256: crypto.createHash("sha256").update(after).digest("hex"),
      });
    }
    const journal: ResolveTransactionJournal = {
      version: 1,
      transactionId: input.transactionId,
      kind: input.kind,
      projectId: input.projectId,
      jobId: input.jobId,
      baseCommitSha: input.baseCommitSha,
      writes,
      publishedPaths: [],
      preparedAt: new Date().toISOString(),
    };
    await this.#writeJournal(journal);
    return journal;
  }

  async publishTransaction(
    initial: ResolveTransactionJournal,
    afterPublish?: (path: string) => void | Promise<void>,
  ): Promise<ResolveTransactionJournal> {
    let journal = this.#parseJournal(initial, {
      projectId: initial.projectId,
      jobId: initial.jobId,
      transactionId: initial.transactionId,
    });
    const afterImages = new Map(
      journal.writes.map((write) => [write.path, verifiedImage(write.afterBase64, write.afterSha256)]),
    );
    for (const write of journal.writes) {
      const target = await this.#transactionTarget(journal.projectId, journal.jobId, write.path, true);
      await this.#atomicWrite(target, afterImages.get(write.path)!);
      const publishedHash = crypto.createHash("sha256").update(await readFile(target)).digest("hex");
      if (publishedHash !== write.afterSha256) {
        throw new ResolveJobStoreError(
          "RESOLVE_JOB_CORRUPT",
          "Published Resolve transaction bytes failed verification",
          { projectId: journal.projectId, jobId: journal.jobId },
        );
      }
      journal = {
        ...journal,
        publishedPaths: [...journal.publishedPaths, write.path],
      };
      await this.#writeJournal(journal);
      await afterPublish?.(write.path);
    }
    return journal;
  }

  async restoreTransaction(
    initial: ResolveTransactionJournal,
    generation: "before" | "after",
  ): Promise<void> {
    const journal = this.#parseJournal(initial, {
      projectId: initial.projectId,
      jobId: initial.jobId,
      transactionId: initial.transactionId,
    });
    const images = new Map(journal.writes.map((write) => {
      const encoded = generation === "after" ? write.afterBase64 : write.beforeBase64;
      const digest = generation === "after" ? write.afterSha256 : write.beforeSha256;
      return [write.path, encoded === null ? null : verifiedImage(encoded, digest!)] as const;
    }));
    for (const write of journal.writes) {
      const target = await this.#transactionTarget(journal.projectId, journal.jobId, write.path, true);
      const bytes = images.get(write.path)!;
      if (bytes === null) {
        await rm(target, { force: true });
        await syncDirectory(dirname(target));
      } else {
        await this.#atomicWrite(target, bytes);
      }
    }
  }

  async completeTransaction(initial: ResolveTransactionJournal): Promise<void> {
    const journal = this.#parseJournal(initial, {
      projectId: initial.projectId,
      jobId: initial.jobId,
      transactionId: initial.transactionId,
    });
    const path = await this.#journalPath(journal, false);
    if (!path) return;
    await rm(path, { force: true });
    const transactionsDirectory = dirname(path);
    await syncDirectory(transactionsDirectory);
    if ((await readdir(transactionsDirectory)).length === 0) {
      await rmdir(transactionsDirectory);
      await syncDirectory(dirname(transactionsDirectory));
    }
  }

  async listTransactions(): Promise<ResolveTransactionJournal[]> {
    const journals: ResolveTransactionJournal[] = [];
    for (const projectId of await this.options.listProjectIds()) {
      const resolveRoot = join(this.options.projectDir(projectId), "exports", "resolve");
      let jobIds: string[];
      try {
        const stats = await lstat(resolveRoot);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new ResolveJobStoreError("INVALID_RESOLVE_JOB_PATH", "Resolve export root is unsafe", { projectId });
        }
        jobIds = await readdir(resolveRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const jobId of jobIds.filter((entry) => isDurableId(entry, "resolve-job")).sort()) {
        const directory = await this.#safeTransactionsDirectory(projectId, jobId, false);
        if (!directory) continue;
        for (const filename of (await readdir(directory)).filter((entry) => entry.endsWith(".json")).sort()) {
          const transactionId = filename.slice(0, -".json".length);
          try {
            const raw = JSON.parse(await readFile(join(directory, filename), "utf8")) as unknown;
            journals.push(this.#parseJournal(raw, { projectId, jobId, transactionId }));
          } catch (error) {
            if (error instanceof ResolveJobStoreError && error.code === "RESOLVE_JOB_CORRUPT") throw error;
            throw new ResolveJobStoreError(
              "RESOLVE_JOB_CORRUPT",
              "Resolve transaction journal is invalid",
              { projectId, jobId },
            );
          }
        }
      }
    }
    return journals;
  }

  artifactPath(projectId: string, jobId: string, name: string): string {
    validateArtifactName(name);
    return join(this.jobDirectory(projectId, jobId), name);
  }

  async #atomicWrite(path: string, bytes: string | Uint8Array): Promise<void> {
    await this.options.beforeWrite?.(path);
    const directory = dirname(path);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${createInfrastructureNonce()}.tmp`);
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
      const cleanup = await Promise.allSettled([
        ...(handle ? [handle.close()] : []),
        rm(temporary, { force: true }),
      ]);
      const failures = cleanup
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "Resolve atomic-write cleanup failed");
      }
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
    const persisted = this.persistedRecord(record);
    const directory = await this.#safeJobDirectory(record.job.projectId, record.job.id, true);
    await this.#atomicWrite(
      join(directory!, "job.json"),
      `${JSON.stringify(persisted, null, 2)}\n`,
    );
    return persisted;
  }

  persistedRecord(record: PersistedResolveExportJob): PersistedResolveExportJob {
    return parseRecord(
      { ...record, job: publicJobForPersistence(record.job) },
      { projectId: record.job.projectId, jobId: record.job.id },
    );
  }

  recordBytes(record: PersistedResolveExportJob): Buffer {
    return Buffer.from(`${JSON.stringify(this.persistedRecord(record), null, 2)}\n`, "utf8");
  }

  describeArtifact(jobId: string, name: string, bytes: string | Uint8Array): ResolveExportArtifact {
    validateJobId(jobId);
    validateArtifactName(name);
    const payload = Buffer.from(bytes);
    return {
      path: `exports/resolve/${jobId}/${name}`,
      mediaType: name.endsWith(".fcpxml") ? "application/xml"
        : name.endsWith(".md") ? "text/markdown"
          : "application/json",
      byteLength: payload.byteLength,
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
    };
  }

  async save(record: PersistedResolveExportJob): Promise<PersistedResolveExportJob> {
    const key = `${record.job.projectId}:${record.job.id}`;
    return this.#exclusive(key, () => this.#saveUnlocked(record));
  }

  async #loadUnlocked(projectId: string, jobId: string): Promise<PersistedResolveExportJob | null> {
    const directory = await this.#safeJobDirectory(projectId, jobId, false);
    if (!directory) return null;
    const path = join(directory, "job.json");
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
      for (const jobId of names.filter((name) => isDurableId(name, "resolve-job")).sort()) {
        const candidate = await this.load(projectId, jobId);
        if (candidate && sameSha256(candidate.launchToken.sha256, sha256)) return candidate;
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
    validateArtifactName(name);
    const directory = await this.#safeJobDirectory(projectId, jobId, true);
    const path = join(directory!, name);
    await this.#atomicWrite(path, bytes);
    // Re-read after the file handle is closed and the rename is durable so the
    // recorded digest proves the bytes consumers will actually receive.
    const payload = await readFile(path);
    return this.describeArtifact(jobId, name, payload);
  }

  async readVerifiedArtifact(
    projectId: string,
    jobId: string,
    name: string,
    expected: ResolveExportArtifact,
  ): Promise<Buffer> {
    const identifiers = { projectId, jobId };
    try {
      validateArtifactName(name);
      validateJobId(jobId);
      assertValidProjectId(projectId);
      const expectedPath = `exports/resolve/${jobId}/${name}`;
      if (
        expected.path !== expectedPath
        || isAbsolute(expected.path)
        || expected.path.split("/").some((component) => component === ".." || component === ".")
        || !Number.isSafeInteger(expected.byteLength)
        || expected.byteLength < 0
        || !SHA256.test(expected.sha256)
      ) throw new Error("invalid artifact metadata");

      const directory = await this.#safeJobDirectory(projectId, jobId, false);
      if (!directory) throw new Error("missing job directory");
      const resolvedDirectory = await realpath(directory);
      const target = join(directory, name);
      const targetStats = await lstat(target);
      if (targetStats.isSymbolicLink() || !targetStats.isFile()) throw new Error("unsafe artifact target");
      const resolvedTarget = await realpath(target);
      const confinedRelative = relative(resolvedDirectory, resolvedTarget);
      if (
        confinedRelative !== name
        || isAbsolute(confinedRelative)
        || confinedRelative === ".."
        || confinedRelative.startsWith(`..${sep}`)
      ) throw new Error("artifact escaped job directory");

      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      const handle = await open(target, constants.O_RDONLY | noFollow);
      let bytes: Buffer;
      try {
        const openedStats = await handle.stat();
        if (!openedStats.isFile()) throw new Error("artifact is not a regular file");
        bytes = await handle.readFile();
      } finally {
        await handle.close();
      }
      if (bytes.byteLength !== expected.byteLength || !sameSha256(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        expected.sha256,
      )) throw new Error("artifact bytes do not match metadata");
      return bytes;
    } catch {
      throw new ResolveJobStoreError(
        "RESOLVE_JOB_CORRUPT",
        "Resolve artifact failed integrity verification",
        identifiers,
      );
    }
  }

  async removeArtifact(projectId: string, jobId: string, name: string): Promise<void> {
    validateArtifactName(name);
    const directory = await this.#safeJobDirectory(projectId, jobId, false);
    if (directory) await rm(join(directory, name), { force: true });
  }

  async removeJob(projectId: string, jobId: string): Promise<void> {
    const directory = await this.#safeJobDirectory(projectId, jobId, false);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
