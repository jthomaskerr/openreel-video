import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { config } from "../env";
import { GitStore } from "./git-store";
import { ensureSafeTestProjectRoot } from "./test-project-root";

const execFileAsync = promisify(execFile);

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

async function makeGitStore(): Promise<{ fixtureRoot: string; repoDir: string; gitStore: GitStore }> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openreel-git-store-race-test-"));
  const repoDir = await mkdtemp(join(fixtureRoot, "repo-"));
  await ensureSafeTestProjectRoot(repoDir, {
    assignedTempRoot: fixtureRoot,
    userProjectsRoot: config.projectsRepo,
  });
  const gitStore = new GitStore(repoDir);
  await gitStore.ensureSharedRepo();
  return { fixtureRoot, repoDir, gitStore };
}

async function branchCount(repoDir: string, branch: string): Promise<number> {
  const { stdout } = await execFileAsync("git", ["branch", "--list", branch], { cwd: repoDir });
  return stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

test("concurrent ensureWorktree calls for a brand new project do not race on branch creation", async () => {
  const { fixtureRoot, repoDir, gitStore } = await makeGitStore();
  try {
    const projectId = "concurrent-project-a";

    // Two overlapping calls, as happens when a React StrictMode double-invoke
    // (or any duplicate autosave trigger) fires two near-simultaneous PUTs
    // for the same not-yet-existing project.
    const results = await Promise.allSettled([
      gitStore.ensureWorktree(projectId),
      gitStore.ensureWorktree(projectId),
    ]);

    for (const result of results) {
      assert.equal(result.status, "fulfilled", `ensureWorktree should not throw: ${JSON.stringify(result)}`);
    }

    const worktreeDir = join(repoDir, projectId);
    assert.equal(existsSync(join(worktreeDir, ".git")), true, "worktree should exist");
    assert.equal(await branchCount(repoDir, `project/${projectId}`), 1, "exactly one branch should exist");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("ensureWorktree racing a commit for the same new project does not deadlock or fail", async () => {
  const { fixtureRoot, repoDir, gitStore } = await makeGitStore();
  try {
    const projectId = "concurrent-project-b";

    const results = await Promise.allSettled([
      gitStore.ensureWorktree(projectId),
      gitStore.commit(projectId, "test: concurrent create"),
    ]);

    for (const result of results) {
      assert.equal(result.status, "fulfilled", `call should not throw: ${JSON.stringify(result)}`);
    }

    const worktreeDir = join(repoDir, projectId);
    assert.equal(existsSync(join(worktreeDir, ".git")), true, "worktree should exist");
    assert.equal(await branchCount(repoDir, `project/${projectId}`), 1, "exactly one branch should exist");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("many concurrent ensureWorktree calls for the same new project all succeed", async () => {
  const { fixtureRoot, repoDir, gitStore } = await makeGitStore();
  try {
    const projectId = "concurrent-project-c";

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => gitStore.ensureWorktree(projectId)),
    );

    for (const result of results) {
      assert.equal(result.status, "fulfilled", `ensureWorktree should not throw: ${JSON.stringify(result)}`);
    }

    assert.equal(await branchCount(repoDir, `project/${projectId}`), 1, "exactly one branch should exist");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
