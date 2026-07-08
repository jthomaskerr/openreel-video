import { execFile } from "node:child_process";
import type { ExecException } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "@openreel/core";

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
    return join(this.repoDir, projectId);
  }

  // ── Locking ──────────────────────────────────────────────────────────────

  #withLock(projectId: string, fn: () => Promise<void>): Promise<void> {
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

  // ── Shared repo ──────────────────────────────────────────────────────────

  /**
   * Initialise the shared repo with git-lfs and .gitattributes.
   * Idempotent — safe to call multiple times.
   */
  async ensureSharedRepo(): Promise<void> {
    await mkdir(this.repoDir, { recursive: true });

    if (existsSync(join(this.repoDir, ".git"))) return;

    await this.git(["init"], this.repoDir);
    await this.git(["lfs", "install"], this.repoDir);

    await writeFile(join(this.repoDir, ".gitattributes"), GITATTRIBUTES, "utf-8");
    await this.git(["add", ".gitattributes"], this.repoDir);
    await this.git(
      ["commit", "-m", "init: openreel shared project repository with git-lfs"],
      this.repoDir,
    );
  }

  // ── Worktrees ────────────────────────────────────────────────────────────

  /**
   * Ensure a git worktree exists at <repoDir>/<slug> on branch project/<slug>.
   * Idempotent — safe to call on every save.
   */
  async ensureWorktree(projectId: string): Promise<void> {
    await this.ensureSharedRepo();

    const wtPath = this.worktreePath(projectId);
    if (existsSync(join(wtPath, ".git"))) return;

    // Create worktree without checking out files, then make a new branch
    await this.git(["worktree", "add", wtPath, "--no-checkout"], this.repoDir);
    await this.git(["checkout", "-b", `project/${projectId}`], wtPath);

    // Pre-create the media directory so multer doesn't race git
    await mkdir(join(wtPath, "media"), { recursive: true });
  }

  /** Remove a project's worktree and branch. */
  async deleteWorktree(projectId: string): Promise<void> {
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

  /**
   * Stage all changes and commit in the worktree. Fire-and-forget — never throws to caller.
   */
  commitAsync(projectId: string, message: string): void {
    this.#withLock(projectId, () => this.#commitInner(projectId, message)).catch((err) =>
      console.error(`[GitStore] commit failed for ${projectId}:`, err),
    );
  }

  async #commitInner(projectId: string, message: string): Promise<void> {
    const wtPath = this.worktreePath(projectId);

    // ensureWorktree is idempotent — only initialises if needed
    if (!existsSync(join(wtPath, ".git"))) {
      await this.ensureWorktree(projectId);
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
