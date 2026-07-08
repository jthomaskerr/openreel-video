import { execFile } from "node:child_process";
import type { ExecException } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "@openreel/core";
import { assertValidProjectId } from "./storage-validation";

const execFileAsync = promisify(execFile);

const GITATTRIBUTES = `# git-lfs tracks all media files
media/** filter=lfs diff=lfs merge=lfs -text
`;

interface ConfigFile {
  remote: string;
}

export class GitStore {
  /** Serialise git operations per project to prevent .git/index.lock races. */
  #locks = new Map<string, Promise<void>>();

  constructor(private readonly repoDir: string) {}

  /** Filesystem path to a project's git worktree (slug-based directory directly under repoDir). */
  worktreePath(projectId: string): string {
    assertValidProjectId(projectId);
    return join(this.repoDir, projectId);
  }

  // ── Locking ──────────────────────────────────────────────────────────────

  #withLock(projectId: string, fn: () => Promise<void>): Promise<void> {
    assertValidProjectId(projectId);
    const prev = this.#locks.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn); // run fn even if prev rejected
    this.#locks.set(
      projectId,
      next.finally(() => {
        if (this.#locks.get(projectId) === next) this.#locks.delete(projectId);
      }),
    );
    return next;
  }

  // ── Git helpers ──────────────────────────────────────────────────────────

  private async git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, { cwd });
  }

  private async branchExists(branch: string): Promise<boolean> {
    const { stdout } = await this.git(["branch", "--list", branch], this.repoDir);
    return stdout.trim().length > 0;
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

  private async addWorktree(projectId: string, wtPath: string): Promise<void> {
    assertValidProjectId(projectId);
    const branch = `project/${projectId}`;
    if (await this.branchExists(branch)) {
      await this.git(["worktree", "add", wtPath, branch], this.repoDir);
      return;
    }
    try {
      await this.git(["worktree", "add", "-b", branch, wtPath, "HEAD"], this.repoDir);
    } catch (err: unknown) {
      // Defensive fallback for a lost race outside this process's own lock
      // (e.g. a concurrent orchestrator process): if another writer created
      // the branch between our branchExists() check and this git call,
      // attach to it instead of failing the whole request.
      const execErr = err as ExecException & { stdout?: string; stderr?: string };
      const output = `${execErr.message ?? ""} ${execErr.stdout ?? ""} ${execErr.stderr ?? ""}`;
      if (output.includes("already exists") && (await this.branchExists(branch))) {
        await this.git(["worktree", "add", wtPath, branch], this.repoDir);
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
      await mkdir(join(wtPath, "media"), { recursive: true });
      await this.ensureWorktreeAttributes(projectId);
      return;
    }

    if (existsSync(wtPath)) {
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

  /** Stage all changes and commit in the worktree. */
  async commit(projectId: string, message: string): Promise<void> {
    assertValidProjectId(projectId);
    await this.#withLock(projectId, () => this.#commitInner(projectId, message));
  }

  /**
   * Stage all changes and commit in the worktree. Fire-and-forget — never throws to caller.
   */
  commitAsync(projectId: string, message: string): void {
    this.commit(projectId, message).catch((err) =>
      console.error(`[GitStore] commit failed for ${projectId}:`, err),
    );
  }

  async #commitInner(projectId: string, message: string): Promise<void> {
    assertValidProjectId(projectId);
    const wtPath = this.worktreePath(projectId);

    // ensureWorktree is idempotent — only initialises if needed. #commitInner
    // already runs inside #withLock(projectId, ...) via commit(), so we call
    // the unlocked inner form directly to avoid deadlocking on our own lock.
    if (!existsSync(join(wtPath, ".git"))) {
      await this.#ensureWorktreeInner(projectId);
    } else {
      await this.ensureWorktreeAttributes(projectId);
    }

    await this.git(["add", "-A"], wtPath);
    try {
      await execFileAsync("git", ["commit", "-m", message], { cwd: wtPath });
    } catch (err: unknown) {
      const execErr = err as ExecException & { stdout?: string; stderr?: string };
      const output = `${execErr.message ?? ""} ${execErr.stdout ?? ""} ${execErr.stderr ?? ""}`;
      if (!output.includes("nothing to commit")) throw err;
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
