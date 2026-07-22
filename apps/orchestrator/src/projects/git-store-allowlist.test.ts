import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("commit lifecycle hooks bracket the ref update and committed files remain readable", async () => {
  const { fixtureRoot, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Lifecycle Hooks");
    const events: string[] = [];
    const receipt = await gitStore.commit(project.id, "test: observe commit lifecycle", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
      hooks: {
        afterStage: () => { events.push("after-stage"); },
        afterTree: () => { events.push("after-tree"); },
        beforeRefUpdate: () => { events.push("before-ref-update"); },
        afterRefUpdate: () => { events.push("after-ref-update"); },
      },
    });

    assert.deepEqual(events, ["after-stage", "after-tree", "before-ref-update", "after-ref-update"]);
    assert.ok(receipt.commitSha);
    const committed = await gitStore.readFileAtCommit(project.id, receipt.commitSha, "project.json");
    assert.equal((JSON.parse(committed ?? "null") as { id?: string } | null)?.id, project.id);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("strict recovery reads distinguish absence, invalid revisions, and ancestry", async () => {
  const { fixtureRoot, gitStore, projectStore } = await makeStore();
  try {
    const project = await projectStore.createProject("Strict Recovery Reads");
    const base = await gitStore.commit(project.id, "test: create recovery base", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });
    assert.ok(base.commitSha);

    await projectStore.saveProject({ ...project, name: "Strict Recovery Reads Updated" });
    const descendant = await gitStore.commit(project.id, "test: create recovery descendant", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "M", path: "project.json" }],
    });
    assert.ok(descendant.commitSha);

    const receipt = await gitStore.readConfirmedReceiptStrict(project.id);
    assert.equal(receipt.status, "present");
    if (receipt.status === "present") assert.equal(receipt.value.commitSha, descendant.commitSha);
    assert.equal((await gitStore.readFileAtCommitStrict(project.id, descendant.commitSha, "missing.json")).status, "absent");
    await assert.rejects(
      gitStore.readFileAtCommitStrict(project.id, "invalid-sha", "project.json"),
      { code: "GIT_READ_FAILED", message: "Authoritative Git state could not be read" },
    );
    assert.equal(await gitStore.isCommitAncestor(project.id, base.commitSha, descendant.commitSha), true);
    assert.equal(await gitStore.isCommitAncestor(project.id, descendant.commitSha, base.commitSha), false);
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
