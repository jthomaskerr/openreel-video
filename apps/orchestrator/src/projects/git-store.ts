import { execFile } from "node:child_process";
import type { ExecException } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import type { Project } from "@openreel/core";
import { assertValidProjectId } from "./storage-validation";

const execFileAsync = promisify(execFile);

const SYSTEM_GIT_CANDIDATES = process.platform === "win32"
  ? []
  : ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];

export function resolveGitExecutable(
  configured = process.env.OPENREEL_GIT_BINARY,
  systemCandidates: readonly string[] = SYSTEM_GIT_CANDIDATES,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const override = configured?.trim();
  if (override) return override;
  return systemCandidates.find((candidate) => fileExists(candidate)) ?? "git";
}

const GITATTRIBUTES = `# git-lfs tracks all media files
media/** filter=lfs diff=lfs merge=lfs -text
`;

interface ConfigFile {
  remote: string;
}

export interface GitStagedNameStatusEntry {
  status: string;
  path: string;
  fromPath?: string;
}

export interface GitCommitReceipt {
  commitSha: string | null;
  treeSha: string | null;
  projectBlobSha: string | null;
  mediaManifestDigest: string | null;
}

export interface GitCommitTransaction {
  allowlist: readonly string[];
  expectedEntries: readonly GitStagedNameStatusEntry[];
  hooks?: GitCommitLifecycleHooks;
}

export interface GitCommitLifecycleHooks {
  readonly afterStage?: () => void | Promise<void>;
  readonly afterTree?: () => void | Promise<void>;
  readonly beforeRefUpdate?: () => void | Promise<void>;
  readonly afterRefUpdate?: () => void | Promise<void>;
}

export interface GitProjectTransaction {
  readonly commit: (message: string, transaction: GitCommitTransaction) => Promise<GitCommitReceipt>;
  readonly stage: (paths: readonly string[]) => Promise<void>;
  readonly unstage: (paths: readonly string[]) => Promise<void>;
}

function isAbsoluteLike(pathname: string): boolean {
  return (
    isAbsolute(pathname) ||
    pathname.startsWith("//") ||
    /^[A-Za-z]:[\\/]/.test(pathname)
  );
}

function normalizeCommitPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) throw new Error("Commit path cannot be empty");

  const candidate = trimmed.replace(/\\/g, "/");
  if (candidate.includes("\0")) throw new Error(`Commit path contains a null byte: ${pathname}`);
  if (isAbsoluteLike(candidate)) throw new Error(`Absolute commit paths are not allowed: ${pathname}`);

  const segments = candidate.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment === ".git")) {
    throw new Error(`Unsafe commit path is not allowed: ${pathname}`);
  }

  const normalized = normalize(candidate).replace(/\\/g, "/");
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("/.git/") ||
    normalized.endsWith("/.git")
  ) {
    throw new Error(`Unsafe commit path is not allowed: ${pathname}`);
  }

  return normalized;
}

function normalizeCommitPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const path of paths) {
    const entry = normalizeCommitPath(path);
    if (seen.has(entry)) {
      throw new Error(`Duplicate commit path is not allowed: ${entry}`);
    }
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}

function normalizeExpectedEntry(entry: GitStagedNameStatusEntry): GitStagedNameStatusEntry {
  const status = entry.status.trim();
  if (!status) throw new Error("Git status cannot be empty");
  const path = normalizeCommitPath(entry.path);
  const fromPath = entry.fromPath === undefined ? undefined : normalizeCommitPath(entry.fromPath);
  const isRenameLike = status.startsWith("R") || status.startsWith("C");
  if (isRenameLike && !fromPath) {
    throw new Error(`Git status ${status} requires a fromPath`);
  }
  if (!isRenameLike && fromPath !== undefined) {
    throw new Error(`Git status ${status} cannot include a fromPath`);
  }
  return fromPath === undefined ? { status, path } : { status, path, fromPath };
}

function normalizeExpectedEntries(entries: readonly GitStagedNameStatusEntry[]): GitStagedNameStatusEntry[] {
  return entries
    .map((entry) => normalizeExpectedEntry(entry))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function parseNameStatusEntryTokens(tokens: string[], index: number): [GitStagedNameStatusEntry, number] {
  const status = tokens[index];
  if (status === undefined) throw new Error("Unexpected end of cached diff while reading status");
  const firstPath = tokens[index + 1];
  if (firstPath === undefined) throw new Error("Unexpected end of cached diff while reading path");

  if (status.startsWith("R") || status.startsWith("C")) {
    const secondPath = tokens[index + 2];
    if (secondPath === undefined) throw new Error("Unexpected end of cached diff while reading rename destination");
    return [{ status, path: secondPath, fromPath: firstPath }, index + 3];
  }

  return [{ status, path: firstPath }, index + 2];
}

function parseCachedNameStatus(stdout: string): GitStagedNameStatusEntry[] {
  const tokens = stdout.split("\0");
  const entries: GitStagedNameStatusEntry[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === undefined || token.length === 0) break;
    const [entry, nextIndex] = parseNameStatusEntryTokens(tokens, index);
    entries.push(entry);
    index = nextIndex;
  }
  return entries;
}

function entriesToComparableStrings(entries: readonly GitStagedNameStatusEntry[]): string[] {
  return entries.map((entry) => JSON.stringify(entry));
}

function digestEntries(entries: readonly GitStagedNameStatusEntry[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex")}`;
}

export class GitStore {
  /** Serialise git operations per project to prevent .git/index.lock races. */
  #locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repoDir: string,
    private readonly gitExecutable = resolveGitExecutable(),
  ) {}

  /** Filesystem path to a project's git worktree (slug-based directory directly under repoDir). */
  worktreePath(projectId: string): string {
    assertValidProjectId(projectId);
    return join(this.repoDir, projectId);
  }

  /**
   * Atomically reserve a collision-safe project slug across concurrent
   * orchestrator processes. Reservation directories are intentionally kept as
   * the durable identity registry, including after the worktree is created.
   */
  async reserveProjectSlug(baseSlug: string): Promise<string> {
    assertValidProjectId(baseSlug);
    await this.ensureSharedRepo();
    const reservationsDir = join(this.repoDir, ".openreel", "project-slugs");
    await mkdir(reservationsDir, { recursive: true });

    for (let suffix = 1; ; suffix += 1) {
      const candidate = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
      assertValidProjectId(candidate);

      // Existing repositories predate the reservation registry. Their
      // worktrees remain authoritative and must never be claimed again.
      if (existsSync(this.worktreePath(candidate))) continue;

      try {
        await mkdir(join(reservationsDir, candidate));
        return candidate;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
    }
  }

  // ── Locking ──────────────────────────────────────────────────────────────

  #withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    assertValidProjectId(projectId);
    const prev = this.#locks.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn); // run fn even if prev rejected
    const cleanup = next.catch(() => undefined).finally(() => {
      if (this.#locks.get(projectId) === cleanup) this.#locks.delete(projectId);
    });
    this.#locks.set(
      projectId,
      cleanup,
    );
    return next;
  }

  // ── Git helpers ──────────────────────────────────────────────────────────

  private async git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(this.gitExecutable, args, { cwd });
  }

  async #readHeadCommitSha(projectId: string): Promise<string | null> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);
    if (!existsSync(join(wtPath, ".git"))) return null;

    try {
      const { stdout } = await this.git(["rev-parse", "HEAD"], wtPath);
      const commitSha = stdout.trim();
      return commitSha.length > 0 ? commitSha : null;
    } catch {
      return null;
    }
  }

  async readConfirmedReceipt(projectId: string): Promise<GitCommitReceipt | null> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);
    if (!existsSync(join(wtPath, ".git"))) return null;

    try {
      const { stdout: commitShaRaw } = await this.git(["rev-parse", "HEAD"], wtPath);
      const commitSha = commitShaRaw.trim();
      if (!commitSha) return null;
      const mediaManifestDigest = await this.#resolveCommittedManifestDigest(projectId, commitSha);
      return await this.#resolveReceiptFromCommit(projectId, commitSha, mediaManifestDigest);
    } catch {
      return null;
    }
  }

  async readCommitTimestamp(projectId: string, commitSha: string): Promise<number | null> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);
    if (!existsSync(join(wtPath, ".git"))) return null;
    try {
      const { stdout } = await this.git(["show", "-s", "--format=%aI", commitSha], wtPath);
      const timestamp = Date.parse(stdout.trim());
      return Number.isFinite(timestamp) ? timestamp : null;
    } catch {
      return null;
    }
  }

  async #resolveReceiptFromCommit(
    projectId: string,
    commitSha: string,
    mediaManifestDigest: string | null,
  ): Promise<GitCommitReceipt> {
    const wtPath = this.worktreePath(projectId);
    const { stdout: treeShaRaw } = await this.git(["rev-parse", `${commitSha}^{tree}`], wtPath);
    const { stdout: projectBlobShaRaw } = await this.git(["rev-parse", `${commitSha}:project.json`], wtPath);
    return {
      commitSha: commitSha.trim(),
      treeSha: treeShaRaw.trim(),
      projectBlobSha: projectBlobShaRaw.trim(),
      mediaManifestDigest,
    };
  }

  async #resolveCommittedManifestDigest(projectId: string, commitSha: string): Promise<string | null> {
    const wtPath = this.worktreePath(projectId);
    try {
      const { stdout } = await this.git(
        ["diff-tree", "--root", "--no-commit-id", "--name-status", "-z", "-r", commitSha],
        wtPath,
      );
      const entries = normalizeExpectedEntries(parseCachedNameStatus(stdout));
      return digestEntries(entries);
    } catch {
      return null;
    }
  }

  private async branchExists(branch: string): Promise<boolean> {
    const { stdout } = await this.git(["branch", "--list", branch], this.repoDir);
    return stdout.trim().length > 0;
  }

  private execErrorOutput(err: unknown): string {
    const execErr = err as ExecException & { stdout?: string; stderr?: string };
    return `${execErr.message ?? ""} ${execErr.stdout ?? ""} ${execErr.stderr ?? ""}`;
  }

  private isMissingRegisteredWorktreeError(err: unknown): boolean {
    return this.execErrorOutput(err).includes("missing but already registered worktree");
  }

  private async pruneStaleWorktreeRegistration(wtPath: string): Promise<void> {
    await this.git(["worktree", "prune", "--expire", "now"], this.repoDir).catch(() => undefined);
    await this.git(["worktree", "remove", wtPath, "--force"], this.repoDir).catch(() => undefined);
  }

  private async isUsableWorktree(wtPath: string): Promise<boolean> {
    try {
      await this.git(["status", "--short"], wtPath);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureWorktreeAttributes(projectId: string): Promise<void> {
    assertValidProjectId(projectId);
    const attributesPath = join(this.worktreePath(projectId), ".gitattributes");
    let attributes = "";
    if (existsSync(attributesPath)) {
      try {
        attributes = await readFile(attributesPath, "utf-8");
      } catch {
        attributes = "";
      }
    }

    const lfsRule = "media/** filter=lfs diff=lfs merge=lfs -text";
    if (attributes.split(/\r?\n/).includes(lfsRule)) return;

    const repairedAttributes = attributes.trim().length > 0
      ? `${attributes.trimEnd()}\n${lfsRule}\n`
      : GITATTRIBUTES;
    await writeFile(attributesPath, repairedAttributes, "utf-8");
  }

  private async addExistingBranchWorktree(wtPath: string, branch: string): Promise<void> {
    try {
      await this.git(["worktree", "add", wtPath, branch], this.repoDir);
    } catch (err: unknown) {
      if (!this.isMissingRegisteredWorktreeError(err)) throw err;
      await this.pruneStaleWorktreeRegistration(wtPath);
      await this.git(["worktree", "add", wtPath, branch], this.repoDir);
    }
  }

  private async addWorktree(projectId: string, wtPath: string): Promise<void> {
    assertValidProjectId(projectId);
    const branch = `project/${projectId}`;
    if (await this.branchExists(branch)) {
      await this.addExistingBranchWorktree(wtPath, branch);
      return;
    }
    try {
      await this.git(["worktree", "add", "-b", branch, wtPath, "HEAD"], this.repoDir);
    } catch (err: unknown) {
      // Defensive fallback for a lost race outside this process's own lock
      // (e.g. a concurrent orchestrator process): if another writer created
      // the branch between our branchExists() check and this git call,
      // attach to it instead of failing the whole request.
      const output = this.execErrorOutput(err);
      if (output.includes("already exists") && (await this.branchExists(branch))) {
        await this.addExistingBranchWorktree(wtPath, branch);
        return;
      }
      if (this.isMissingRegisteredWorktreeError(err)) {
        await this.pruneStaleWorktreeRegistration(wtPath);
        await this.git(["worktree", "add", "-b", branch, wtPath, "HEAD"], this.repoDir);
        return;
      }
      throw err;
    }
  }

  private async promoteExistingDirectoryToWorktree(projectId: string, wtPath: string): Promise<void> {
    assertValidProjectId(projectId);
    const tempParent = await mkdtemp(join(tmpdir(), "openreel-worktree-promote-"));
    const tempContents = join(tempParent, projectId);

    await rename(wtPath, tempContents);
    try {
      await this.addWorktree(projectId, wtPath);
      await cp(tempContents, wtPath, {
        recursive: true,
        force: true,
        filter: (source) => !source.endsWith("/.git") && !source.endsWith("\\.git"),
      });
    } catch (err) {
      await rm(wtPath, { recursive: true, force: true }).catch(() => undefined);
      if (!existsSync(wtPath)) {
        await rename(tempContents, wtPath).catch(() => undefined);
      }
      throw err;
    } finally {
      await rm(tempParent, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── Shared repo ──────────────────────────────────────────────────────────

  /**
   * Initialise the shared repo with git-lfs and .gitattributes.
   * Idempotent — safe to call multiple times.
   */
  async ensureSharedRepo(): Promise<void> {
    await mkdir(this.repoDir, { recursive: true });

    const alreadyRepo = existsSync(join(this.repoDir, ".git"));
    if (!alreadyRepo) {
      await this.git(["init"], this.repoDir);
    }

    await this.git(["lfs", "install"], this.repoDir);

    const attributesPath = join(this.repoDir, ".gitattributes");
    let attributes = "";
    if (existsSync(attributesPath)) {
      try {
        attributes = await readFile(attributesPath, "utf-8");
      } catch {
        attributes = "";
      }
    }

    const lfsRule = "media/** filter=lfs diff=lfs merge=lfs -text";
    if (attributes.includes(lfsRule)) return;

    const repairedAttributes = attributes.trim().length > 0
      ? `${attributes.trimEnd()}\n${GITATTRIBUTES}`
      : GITATTRIBUTES;
    await writeFile(attributesPath, repairedAttributes, "utf-8");
    await this.git(["add", ".gitattributes"], this.repoDir);
    try {
      await this.git(
        [
          "commit",
          "-m",
          alreadyRepo
            ? "chore: repair openreel git-lfs attributes"
            : "init: openreel shared project repository with git-lfs",
        ],
        this.repoDir,
      );
    } catch (err: unknown) {
      const execErr = err as ExecException & { stdout?: string; stderr?: string };
      const output = `${execErr.message ?? ""} ${execErr.stdout ?? ""} ${execErr.stderr ?? ""}`;
      if (!output.includes("nothing to commit")) throw err;
    }
  }

  // ── Worktrees ────────────────────────────────────────────────────────────

  /**
   * Ensure a git worktree exists at <repoDir>/<slug> on branch project/<slug>.
   * Idempotent — safe to call on every save. Serialised per-project so
   * concurrent callers (e.g. two overlapping autosave pushes for a brand
   * new project) cannot both reach `git worktree add -b` for the same
   * not-yet-existing branch.
   */
  async ensureWorktree(projectId: string): Promise<void> {
    assertValidProjectId(projectId);
    await this.#withLock(projectId, () => this.#ensureWorktreeInner(projectId));
  }

  /**
   * Unlocked worktree-creation body. Only call this directly from within a
   * function already holding this project's lock (e.g. `#commitInner`) —
   * calling it re-entrantly through `ensureWorktree()`'s lock would deadlock
   * the per-project promise chain in `#withLock`.
   */
  async #ensureWorktreeInner(projectId: string): Promise<void> {
    await this.ensureSharedRepo();

    const wtPath = this.worktreePath(projectId);
    if (existsSync(join(wtPath, ".git"))) {
      if (await this.isUsableWorktree(wtPath)) {
        await mkdir(join(wtPath, "media"), { recursive: true });
        await this.ensureWorktreeAttributes(projectId);
        return;
      }
      await this.promoteExistingDirectoryToWorktree(projectId, wtPath);
    } else if (existsSync(wtPath)) {
      await this.promoteExistingDirectoryToWorktree(projectId, wtPath);
    } else {
      await this.addWorktree(projectId, wtPath);
    }

    // Pre-create the media directory so multer doesn't race git and ensure
    // media files remain tracked by Git LFS on every project branch/worktree.
    await mkdir(join(wtPath, "media"), { recursive: true });
    await this.ensureWorktreeAttributes(projectId);
  }

  /** Remove a project's worktree and branch. */
  async deleteWorktree(projectId: string): Promise<void> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);

    // Remove the worktree (cleans up the branch listing in main repo)
    if (existsSync(wtPath)) {
      try {
        await this.git(["worktree", "remove", wtPath, "--force"], this.repoDir);
      } catch {
        // fall through — may already be removed
      }
    }

    // Delete the branch from the main repo
    try {
      await this.git(["branch", "-D", `project/${projectId}`], this.repoDir);
    } catch {
      // branch may not exist
    }
  }

  // ── Commits ──────────────────────────────────────────────────────────────

  /** Stage the explicit allowlist and commit the worktree. */
  async commit(projectId: string, message: string, transaction: GitCommitTransaction): Promise<GitCommitReceipt> {
    assertValidProjectId(projectId);
    return this.#withLock(projectId, () => this.#commitInner(projectId, message, transaction));
  }

  /** Holds the same project lock used by every Git mutation and supplies non-reentrant operations. */
  async withProjectTransaction<T>(
    projectId: string,
    operation: (transaction: GitProjectTransaction) => Promise<T>,
  ): Promise<T> {
    assertValidProjectId(projectId);
    return this.#withLock(projectId, () => operation({
      commit: (message, transaction) => this.#commitInner(projectId, message, transaction),
      stage: async (paths) => {
        const normalized = normalizeCommitPaths(paths);
        if (normalized.length > 0) {
          await this.git(["add", "-A", "--", ...normalized], this.worktreePath(projectId));
        }
      },
      unstage: async (paths) => {
        const normalized = normalizeCommitPaths(paths);
        if (normalized.length > 0) {
          await this.git(["reset", "--", ...normalized], this.worktreePath(projectId));
        }
      },
    }));
  }

  /**
   * Stage the explicit allowlist and commit the worktree. Fire-and-forget — never throws to caller.
   */
  commitAsync(projectId: string, message: string, transaction: GitCommitTransaction): void {
    this.commit(projectId, message, transaction).catch((err) =>
      console.error(`[GitStore] commit failed for ${projectId}:`, err),
    );
  }

  async #commitInner(projectId: string, message: string, transaction: GitCommitTransaction): Promise<GitCommitReceipt> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);
    const allowlist = normalizeCommitPaths(transaction.allowlist);
    const expectedEntries = normalizeExpectedEntries(transaction.expectedEntries);

    // ensureWorktree is idempotent — only initialises if needed. #commitInner
    // already runs inside #withLock(projectId, ...) via commit(), so we call
    // the unlocked inner form directly to avoid deadlocking on our own lock.
    if (!existsSync(join(wtPath, ".git"))) {
      await this.#ensureWorktreeInner(projectId);
    } else {
      await this.ensureWorktreeAttributes(projectId);
    }

    if (allowlist.length > 0) {
      await this.git(["add", "-A", "--", ...allowlist], wtPath);
    }
    await transaction.hooks?.afterStage?.();

    const { stdout: cachedDiff } = await this.git(["diff", "--cached", "--name-status", "-z"], wtPath);
    const actualEntries = parseCachedNameStatus(cachedDiff);
    const normalizedActual = normalizeExpectedEntries(actualEntries);

    if (entriesToComparableStrings(normalizedActual).join("\n") !== entriesToComparableStrings(expectedEntries).join("\n")) {
      if (allowlist.length > 0) {
        await this.git(["reset", "--", ...allowlist], wtPath).catch((resetError) => {
          console.warn("[GitStore] failed to unstage mismatched commit entries", {
            projectId,
            error: resetError instanceof Error ? resetError.message : "unknown error",
          });
        });
      }
      throw new Error(
        `Cached diff did not match the expected allowlisted entries for ${projectId}\nExpected: ${JSON.stringify(expectedEntries)}\nActual: ${JSON.stringify(normalizedActual)}`,
      );
    }

    if (normalizedActual.length === 0) {
      const confirmed = await this.readConfirmedReceipt(projectId);
      return confirmed ?? {
        commitSha: null,
        treeSha: null,
        projectBlobSha: null,
        mediaManifestDigest: null,
      };
    }

    const expectedMediaManifestDigest = digestEntries(expectedEntries);
    const parentCommitSha = await this.#readHeadCommitSha(projectId);
    const stagedProjectBlobSha = expectedEntries.some((entry) => entry.path === "project.json" && !entry.status.startsWith("D"))
      ? await this.git(["rev-parse", ":project.json"], wtPath).then(({ stdout }) => stdout.trim()).catch(() => null)
      : null;

    try {
      const treeSha = (await this.git(["write-tree"], wtPath)).stdout.trim();
      await transaction.hooks?.afterTree?.();
      const commitArgs = ["commit-tree", treeSha, "-m", message, ...(parentCommitSha ? ["-p", parentCommitSha] : [])];
      const { stdout: commitShaRaw } = await execFileAsync(this.gitExecutable, commitArgs, { cwd: wtPath });
      const commitSha = commitShaRaw.trim();
      const actualMediaManifestDigest = await this.#resolveCommittedManifestDigest(projectId, commitSha);
      const receipt = await this.#resolveReceiptFromCommit(projectId, commitSha, actualMediaManifestDigest);
      await this.#verifyCommittedReceipt(projectId, receipt, treeSha, stagedProjectBlobSha, expectedMediaManifestDigest);
      await transaction.hooks?.beforeRefUpdate?.();
      await this.git(
        ["update-ref", `refs/heads/project/${projectId}`, commitSha, ...(parentCommitSha ? [parentCommitSha] : [])],
        this.repoDir,
      );
      await transaction.hooks?.afterRefUpdate?.();
      if (allowlist.length > 0) {
        await this.git(["reset", "--", ...allowlist], wtPath).catch((resetErr) => {
          console.warn(`[GitStore] failed to clear staged paths for ${projectId}:`, resetErr);
        });
      }
      return receipt;
    } catch (err: unknown) {
      const execErr = err as ExecException & { stdout?: string; stderr?: string };
      const output = `${execErr.message ?? ""} ${execErr.stdout ?? ""} ${execErr.stderr ?? ""}`;
      if (allowlist.length > 0) {
        await this.git(["reset", "--", ...allowlist], wtPath).catch((resetError) => {
          console.warn("[GitStore] failed to unstage aborted commit entries", {
            projectId,
            error: resetError instanceof Error ? resetError.message : "unknown error",
          });
        });
      }
      if (output.includes("nothing to commit")) {
        const confirmed = await this.readConfirmedReceipt(projectId);
        return confirmed ?? {
          commitSha: null,
          treeSha: null,
          projectBlobSha: null,
          mediaManifestDigest: null,
        };
      }
      throw err;
    }
  }

  async #verifyCommittedReceipt(
    projectId: string,
    receipt: GitCommitReceipt,
    expectedTreeSha: string,
    expectedProjectBlobSha: string | null,
    expectedMediaManifestDigest: string,
  ): Promise<void> {
    assertValidProjectId(projectId);
    if (!receipt.commitSha || !receipt.treeSha || !receipt.projectBlobSha) {
      throw new Error(`Commit receipt for ${projectId} is incomplete`);
    }
    const resolved = await this.#resolveReceiptFromCommit(projectId, receipt.commitSha, receipt.mediaManifestDigest);
    const resolvedManifestDigest = await this.#resolveCommittedManifestDigest(projectId, receipt.commitSha);
    if (resolved.commitSha !== receipt.commitSha) {
      throw new Error(`Verified commit SHA mismatch for ${projectId}`);
    }
    if (resolved.treeSha !== receipt.treeSha || receipt.treeSha !== expectedTreeSha) {
      throw new Error(`Verified tree SHA mismatch for ${projectId}`);
    }
    if (resolved.projectBlobSha !== receipt.projectBlobSha) {
      throw new Error(`Verified project blob SHA mismatch for ${projectId}`);
    }
    if (expectedProjectBlobSha !== null && receipt.projectBlobSha !== expectedProjectBlobSha) {
      throw new Error(`Verified staged project blob SHA mismatch for ${projectId}`);
    }
    if (resolvedManifestDigest !== receipt.mediaManifestDigest || resolvedManifestDigest !== expectedMediaManifestDigest) {
      throw new Error(`Verified staged manifest digest mismatch for ${projectId}`);
    }
  }

  // ── History ──────────────────────────────────────────────────────────────

  /** List commits touching project.json in the worktree. */
  async getHistory(projectId: string): Promise<string[]> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);
    if (!existsSync(join(wtPath, ".git"))) return [];

    const { stdout } = await this.git(
      ["log", "--format=%H %s %aI", "--", "project.json"],
      wtPath,
    );
    return stdout.trim().split("\n").filter(Boolean);
  }

  /** Retrieve project.json at a specific commit. */
  async getProjectAtCommit(projectId: string, sha: string): Promise<Project | null> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);
    if (!existsSync(join(wtPath, ".git"))) return null;

    try {
      const { stdout } = await this.git(["show", `${sha}:project.json`], wtPath);
      return JSON.parse(stdout) as Project;
    } catch {
      return null;
    }
  }

  async readFileAtCommit(projectId: string, sha: string, relativePath: string): Promise<string | null> {
    assertValidProjectId(projectId);
    const normalizedPath = normalizeCommitPath(relativePath);
    const wtPath = this.worktreePath(projectId);
    if (!existsSync(join(wtPath, ".git"))) return null;
    try {
      return (await this.git(["show", `${sha}:${normalizedPath}`], wtPath)).stdout;
    } catch {
      return null;
    }
  }

  // ── Remote config ────────────────────────────────────────────────────────

  /** Set the remote origin URL and push all branches. */
  async setRemote(url: string): Promise<void> {
    // Persist to config.json at repo root (not tracked by git — user-specific)
    const configPath = join(this.repoDir, "config.json");
    await writeFile(configPath, JSON.stringify({ remote: url }, null, 2), "utf-8");

    try {
      await this.git(["remote", "set-url", "origin", url], this.repoDir);
    } catch {
      await this.git(["remote", "add", "origin", url], this.repoDir);
    }

    // Push all branches to the remote
    try {
      await this.git(["push", "--all", "origin"], this.repoDir);
    } catch (err) {
      console.error("[GitStore] push --all failed:", err);
    }
  }

  /** Read the persisted config.json. */
  async getConfig(): Promise<ConfigFile> {
    const configPath = join(this.repoDir, "config.json");
    if (!existsSync(configPath)) return { remote: "" };
    try {
      const raw = await readFile(configPath, "utf-8");
      return JSON.parse(raw) as ConfigFile;
    } catch {
      return { remote: "" };
    }
  }
}
