import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { config } from "../env";
import { GitStore } from "./git-store";
import { ProjectStore } from "./project-store";
import { ensureSafeTestProjectRoot } from "./test-project-root";

const execFileAsync = promisify(execFile);

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

async function makeStore(): Promise<{ fixtureRoot: string; repoDir: string; gitStore: GitStore; projectStore: ProjectStore }> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openreel-git-store-allowlist-"));
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

async function currentHead(repoDir: string, projectId: string): Promise<{ commitSha: string; treeSha: string; projectBlobSha: string }> {
  const { stdout: commitSha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: join(repoDir, projectId) });
  const { stdout: treeSha } = await execFileAsync("git", ["rev-parse", "HEAD^{tree}"], { cwd: join(repoDir, projectId) });
  const { stdout: projectBlobSha } = await execFileAsync("git", ["rev-parse", "HEAD:project.json"], { cwd: join(repoDir, projectId) });
  return {
    commitSha: commitSha.trim(),
    treeSha: treeSha.trim(),
    projectBlobSha: projectBlobSha.trim(),
  };
}

test("commit returns verified identities from the created commit", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Receipt Check");
    const receipt = await gitStore.commit(project.id, "test: create project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });

    const head = await currentHead(repoDir, project.id);
    assert.equal(receipt.commitSha, head.commitSha);
    assert.equal(receipt.treeSha, head.treeSha);
    assert.equal(receipt.projectBlobSha, head.projectBlobSha);
    assert.match(receipt.mediaManifestDigest ?? "", /^sha256:/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("dirty inspection supports project snapshots larger than Node's default child buffer", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Large Snapshot");
    const projectPath = join(repoDir, project.id, "project.json");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    saved.name = `Large Snapshot ${"x".repeat(1_100_000)}`;
    await writeFile(projectPath, JSON.stringify(saved, null, 2));
    await gitStore.commit(project.id, "test: create large snapshot project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });
    saved.name += " updated";
    saved.modifiedAt += 1;
    await writeFile(projectPath, JSON.stringify(saved, null, 2));

    const dirty = await gitStore.inspectDirtyProject(project.id);

    assert.equal(dirty?.semanticChanged, true);
    assert.equal(dirty?.sourceModifiedAt, saved.modifiedAt);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("cumulative commits ignore pending upload storage without deleting it", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Pending Upload Isolation");
    await gitStore.commit(project.id, "test: create pending upload project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });
    const worktreeDir = join(repoDir, project.id);
    const pendingEntryDir = join(
      worktreeDir,
      ".openreel-pending-media",
      "11111111-1111-4111-8111-111111111111",
    );
    const pendingContent = join(pendingEntryDir, "content");
    await mkdir(pendingEntryDir, { recursive: true });
    await writeFile(pendingContent, "pending bytes");
    const projectPath = join(worktreeDir, "project.json");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    saved.name = "Pending Upload Isolation Updated";
    saved.modifiedAt += 1;
    await writeFile(projectPath, JSON.stringify(saved, null, 2));

    const result = await gitStore.commitCumulativeProjectDiff(
      project.id,
      async () => undefined,
      () => true,
    );

    assert.equal(result.kind, "committed");
    assert.equal(await readFile(pendingContent, "utf8"), "pending bytes");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("cumulative commit ignores metadata-only drift and rejects unrelated paths", async () => {
  const { fixtureRoot, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Cumulative Commit");
    await gitStore.commit(project.id, "test: create project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });
    const projectPath = join(projectStore.projectDir(project.id), "project.json");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    saved.name = "Cumulative Commit Updated";
    saved.modifiedAt += 1;
    await writeFile(projectPath, JSON.stringify(saved, null, 2));
    assert.equal((await gitStore.inspectDirtyProject(project.id))?.semanticChanged, true);

    const committed = await gitStore.commitCumulativeProjectDiff(
      project.id,
      async () => undefined,
      () => true,
    );
    assert.equal(committed.kind, "committed");

    saved.modifiedAt += 1;
    await writeFile(projectPath, JSON.stringify(saved, null, 2));
    assert.equal((await gitStore.inspectDirtyProject(project.id))?.semanticChanged, false);
    const metadataOnly = await gitStore.commitCumulativeProjectDiff(
      project.id,
      async () => undefined,
      () => true,
    );
    assert.equal(metadataOnly.kind, "metadata-only");

    await writeFile(join(projectStore.projectDir(project.id), ".DS_Store"), "unexpected");
    await assert.rejects(
      gitStore.commitCumulativeProjectDiff(
        project.id,
        async () => undefined,
        () => true,
      ),
      /Unexpected project worktree path/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("expected cached entries are order-independent", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Order Independent");
    const worktree = join(repoDir, project.id);
    await mkdir(join(worktree, "media"), { recursive: true });
    await writeFile(join(worktree, "media", "z.jpeg"), "z");
    await writeFile(join(worktree, "media", "a.jpeg"), "a");

    const receipt = await gitStore.commit(project.id, "test: accept reordered entries", {
      allowlist: ["media/z.jpeg", "project.json", "media/a.jpeg"],
      expectedEntries: [
        { status: "A", path: "media/z.jpeg" },
        { status: "A", path: "project.json" },
        { status: "A", path: "media/a.jpeg" },
      ],
    });

    assert.ok(receipt.commitSha);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("empty allowlists return the last confirmed identities without inventing new ones", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("No-op Receipt");
    const initialReceipt = await gitStore.commit(project.id, "test: create project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });

    const noOpReceipt = await gitStore.commit(project.id, "test: no-op", {
      allowlist: [],
      expectedEntries: [],
    });

    const head = await currentHead(repoDir, project.id);
    assert.equal(noOpReceipt.commitSha, head.commitSha);
    assert.equal(noOpReceipt.treeSha, head.treeSha);
    assert.equal(noOpReceipt.projectBlobSha, head.projectBlobSha);
    assert.equal(noOpReceipt.commitSha, initialReceipt.commitSha);
    assert.equal(noOpReceipt.mediaManifestDigest, initialReceipt.mediaManifestDigest);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("mismatched expected entries abort commit confirmation and leave HEAD unchanged", async () => {
  const { fixtureRoot, repoDir, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Mismatch Check");
    await gitStore.commit(project.id, "test: create project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });

    const updated = await projectStore.saveProject({ ...project, name: "Mismatch Check Updated" });
    assert.equal(updated.name, "Mismatch Check Updated");

    const headBefore = await currentHead(repoDir, project.id);
    await assert.rejects(
      async () => {
        await gitStore.commit(project.id, "test: mismatched entries", {
          allowlist: ["project.json"],
          expectedEntries: [{ status: "A", path: "project.json" }],
        });
      },
      /Cached diff did not match/,
    );

    const headAfter = await currentHead(repoDir, project.id);
    assert.equal(headAfter.commitSha, headBefore.commitSha);
    assert.equal(headAfter.treeSha, headBefore.treeSha);
    assert.equal(headAfter.projectBlobSha, headBefore.projectBlobSha);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
