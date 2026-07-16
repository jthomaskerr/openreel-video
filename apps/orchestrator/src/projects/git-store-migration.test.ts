import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import type { Project } from "@openreel/core";
import { config } from "../env";
import { GitStore } from "./git-store";
import { ProjectStore } from "./project-store";
import { ensureSafeTestProjectRoot } from "./test-project-root";

const execFileAsync = promisify(execFile);

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

function projectFixture(id: string, name: string): Project {
  const now = Date.now();
  return {
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  };
}

async function makeStore(): Promise<{ fixtureRoot: string; repoDir: string; gitStore: GitStore; projectStore: ProjectStore }> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openreel-git-store-test-"));
  const repoDir = await mkdtemp(join(fixtureRoot, "repo-"));
  await ensureSafeTestProjectRoot(repoDir, {
    assignedTempRoot: fixtureRoot,
    userProjectsRoot: config.projectsRepo,
  });
  const gitStore = new GitStore(repoDir);
  const projectStore = new ProjectStore(gitStore);
  await gitStore.ensureSharedRepo();
  return { fixtureRoot, repoDir, gitStore, projectStore };
}

function commitProjectJsonTransaction(status: "A" | "M" = "M", includeAttributes = false) {
  return includeAttributes
    ? {
        allowlist: [".gitattributes", "project.json"],
        expectedEntries: [
          { status: "A", path: ".gitattributes" },
          { status, path: "project.json" },
        ],
      }
    : {
        allowlist: ["project.json"],
        expectedEntries: [{ status, path: "project.json" }],
      };
}

function commitAttributesTransaction() {
  return {
    allowlist: [".gitattributes"],
    expectedEntries: [{ status: "A", path: ".gitattributes" }],
  };
}

async function writeLegacyProject(repoDir: string, relativeDir: string, id: string, name: string): Promise<void> {
  const projectDir = join(repoDir, relativeDir);
  await mkdir(join(projectDir, "media"), { recursive: true });
  await writeFile(join(projectDir, "project.json"), JSON.stringify(projectFixture(id, name), null, 2), "utf-8");
  await writeFile(join(projectDir, "media", "media-1.txt"), "legacy media", "utf-8");
}

test("migrated root and nested UUID projects are promoted to commit-capable worktrees", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const rootUuid = "11111111-1111-4111-8111-111111111111";
    const nestedUuid = "22222222-2222-4222-8222-222222222222";
    await writeLegacyProject(repoDir, rootUuid, rootUuid, "Legacy Root");
    await writeLegacyProject(repoDir, join("projects", nestedUuid), nestedUuid, "Legacy Nested");

    await projectStore.migrateUuidDirs();

    for (const slug of ["legacy-root", "legacy-nested"]) {
      const worktreeDir = join(repoDir, slug);
      assert.equal(existsSync(join(worktreeDir, ".git")), true, `${slug} should be a git worktree`);
      assert.equal(existsSync(join(worktreeDir, "media", "media-1.txt")), true, `${slug} media should be preserved`);

      const project = await projectStore.loadProject(slug);
      assert.ok(project, `${slug} project should load`);
      assert.equal(project.id, slug);

      await projectStore.saveProject({ ...project, name: `${project.name} Updated` });
      await gitStore.commit(
        slug,
        `test: commit ${slug} after migration`,
        commitProjectJsonTransaction(),
      );
      const { stdout } = await execFileAsync("git", ["log", "--oneline", "-1"], { cwd: worktreeDir });
      assert.match(stdout, new RegExp(`commit ${slug} after migration`));
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("missing registered slug worktrees are pruned and recreated", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Vintage Tokyo");
    await gitStore.commit(
      project.id,
      "test: create project",
      commitProjectJsonTransaction("A"),
    );

    const worktreeDir = join(repoDir, project.id);
    await rm(worktreeDir, { recursive: true, force: true });

    await gitStore.ensureWorktree(project.id);

    assert.equal(existsSync(join(worktreeDir, ".git")), true);
    await projectStore.saveProject({ ...project, name: "Vintage Tokyo Repaired" });
    await gitStore.commit(
      project.id,
      "test: commit after stale worktree repair",
      commitProjectJsonTransaction(),
    );
    const { stdout } = await execFileAsync("git", ["log", "--oneline", "-1"], { cwd: worktreeDir });
    assert.match(stdout, /commit after stale worktree repair/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("broken slug worktree git files are promoted to valid worktrees", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Broken Tokyo");
    await gitStore.commit(
      project.id,
      "test: create project",
      commitProjectJsonTransaction("A"),
    );

    const worktreeDir = join(repoDir, project.id);
    await writeFile(join(worktreeDir, "project.json"), JSON.stringify({ ...project, name: "Broken Tokyo Updated" }, null, 2), "utf-8");
    await rm(join(repoDir, ".git", "worktrees", project.id), { recursive: true, force: true });

    await gitStore.ensureWorktree(project.id);

    const repaired = await projectStore.loadProject(project.id);
    assert.ok(repaired);
    assert.equal(repaired.name, "Broken Tokyo Updated");
    await gitStore.commit(
      project.id,
      "test: commit after broken git repair",
      commitProjectJsonTransaction(),
    );
    const { stdout } = await execFileAsync("git", ["log", "--oneline", "-1"], { cwd: worktreeDir });
    assert.match(stdout, /commit after broken git repair/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("existing project worktrees repair the Git LFS media rule before commits", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("LFS Repair");
    await gitStore.commit(
      project.id,
      "test: create project",
      commitProjectJsonTransaction("A"),
    );

    const worktreeDir = join(repoDir, project.id);
    await execFileAsync("git", ["rm", ".gitattributes"], { cwd: worktreeDir });
    await execFileAsync("git", ["commit", "-m", "test: remove lfs attributes"], { cwd: worktreeDir });

    await gitStore.ensureWorktree(project.id);
    const repaired = await readFile(join(worktreeDir, ".gitattributes"), "utf-8");
    const lfsRule = "media/** filter=lfs diff=lfs merge=lfs -text";
    assert.equal(repaired.split(/\r?\n/).filter((line) => line === lfsRule).length, 1);

    await gitStore.commit(
      project.id,
      "test: repair lfs attributes",
      commitAttributesTransaction(),
    );
    const { stdout } = await execFileAsync("git", ["show", "--stat", "--oneline", "HEAD"], { cwd: worktreeDir });
    assert.match(stdout, /repair lfs attributes/);
    assert.match(stdout, /.gitattributes/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("project creation reserves deterministic immutable slugs", async () => {
  const { fixtureRoot, projectStore } = await makeStore();
  try {
    const first = await projectStore.createProject("Duplicate Name");
    const second = await projectStore.createProject("Duplicate Name");

    assert.equal(first.id, "duplicate-name");
    assert.equal(second.id, "duplicate-name-2");

    const renamed = await projectStore.renameProject(first.id, "Renamed Display Name");
    assert.equal(renamed?.id, first.id);
    assert.equal(renamed?.name, "Renamed Display Name");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("shared repository initialization preserves an existing pre-push hook", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openreel-git-store-hook-test-"));
  const repoDir = await mkdtemp(join(fixtureRoot, "repo-"));
  const hookPath = join(repoDir, ".git", "hooks", "pre-push");
  const customHook = "#!/bin/sh\n# custom hook owned by the user\n";

  try {
    await ensureSafeTestProjectRoot(repoDir, {
      assignedTempRoot: fixtureRoot,
      userProjectsRoot: config.projectsRepo,
    });
    await execFileAsync("git", ["init"], { cwd: repoDir });
    await execFileAsync("git", ["config", "core.hooksPath", ".git/hooks"], { cwd: repoDir });
    await writeFile(hookPath, customHook, { mode: 0o755 });

    const gitStore = new GitStore(repoDir);
    await gitStore.ensureSharedRepo();

    assert.equal(await readFile(hookPath, "utf-8"), customHook);
    const { stdout: cleanFilter } = await execFileAsync(
      "git",
      ["config", "--local", "--get", "filter.lfs.clean"],
      { cwd: repoDir },
    );
    assert.match(cleanFilter, /git-lfs clean/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("concurrent same-name creation cannot reserve the same slug", async () => {
  const { fixtureRoot, projectStore } = await makeStore();
  try {
    const projects = await Promise.all([
      projectStore.createProject("Concurrent Name"),
      projectStore.createProject("Concurrent Name"),
    ]);

    assert.deepEqual(
      projects.map(project => project.id).sort(),
      ["concurrent-name", "concurrent-name-2"],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
