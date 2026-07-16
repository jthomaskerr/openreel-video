import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import express from "express";
import type {
  Project,
  ProjectBaseRevision,
  ProjectPersistenceStatusResponse,
  ProjectSaveReceipt,
  ProjectSaveRequest,
} from "@openreel/core";
import { config } from "../env";
import { GitStore } from "./git-store";
import { ProjectCommitScheduler } from "./project-commit-scheduler";
import { ProjectStore } from "./project-store";
import { createProjectRouter } from "./routes";
import { ensureSafeTestProjectRoot } from "./test-project-root";

const execFileAsync = promisify(execFile);

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFileAsync("git", [...args], { cwd })).stdout;
}

function revision(receipt: ProjectSaveReceipt): ProjectBaseRevision {
  assert.ok(receipt.commitSha && receipt.treeSha && receipt.projectBlobSha);
  return {
    commitSha: receipt.commitSha,
    treeSha: receipt.treeSha,
    projectBlobSha: receipt.projectBlobSha,
    sourceModifiedAt: receipt.sourceModifiedAt,
  };
}

function request(project: Project, baseRevision: ProjectBaseRevision): ProjectSaveRequest {
  return {
    projectId: project.id,
    project,
    baseRevision,
    requiredMediaManifest: [],
  };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for background commit");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("PUTs are durable immediately and debounce into one cumulative Git commit", async () => {
  const fixtureRoot = await realpath(
    await mkdtemp(join(tmpdir(), "openreel-project-commit-debounce-")),
  );
  const repoDir = join(fixtureRoot, "projects");
  let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  let scheduler: ProjectCommitScheduler | null = null;
  try {
    await mkdir(repoDir);
    await ensureSafeTestProjectRoot(repoDir, {
      assignedTempRoot: fixtureRoot,
      userProjectsRoot: config.projectsRepo,
    });
    const gitStore = new GitStore(repoDir);
    const store = new ProjectStore(gitStore);
    await gitStore.ensureSharedRepo();
    const original = await store.createProject("Debounce Integration");
    const initialReceipt = await gitStore.commit(original.id, "test: create project", {
      allowlist: ["project.json"],
      expectedEntries: [{ status: "A", path: "project.json" }],
    });
    const confirmed = await gitStore.readConfirmedReceipt(original.id);
    assert.ok(confirmed);
    const initialPersistedAt = await gitStore.readCommitTimestamp(
      original.id,
      initialReceipt.commitSha!,
    );
    const initialSaveReceipt: ProjectSaveReceipt = {
      saved: true,
      committed: true,
      commitDueAt: null,
      projectId: original.id,
      persistedAt: initialPersistedAt,
      sourceModifiedAt: original.modifiedAt,
      commitSha: confirmed.commitSha,
      treeSha: confirmed.treeSha,
      projectBlobSha: confirmed.projectBlobSha,
      mediaManifestDigest: confirmed.mediaManifestDigest,
      lfsPayloads: [],
    };

    scheduler = new ProjectCommitScheduler({
      debounceMs: 1_000,
      retryDelayMs: 50,
      execute: async (projectId, _generation, shouldCommit) => {
        let audit: Awaited<ReturnType<ProjectStore["auditSnapshot"]>> | null = null;
        const result = await gitStore.commitCumulativeProjectDiff(
          projectId,
          async (project) => {
            audit = await store.auditSnapshot(project, { pointerSource: "index" });
          },
          shouldCommit,
        );
        if (result.kind === "metadata-only") return result;
        const project = await store.loadProject(projectId);
        const completedAudit = audit as Awaited<ReturnType<ProjectStore["auditSnapshot"]>> | null;
        assert.ok(project && completedAudit && result.receipt.commitSha);
        return {
          kind: "committed",
          receipt: {
            saved: true,
            committed: true,
            commitDueAt: null,
            projectId,
            persistedAt: await gitStore.readCommitTimestamp(
              projectId,
              result.receipt.commitSha,
            ),
            sourceModifiedAt: project.modifiedAt,
            commitSha: result.receipt.commitSha,
            treeSha: result.receipt.treeSha,
            projectBlobSha: result.receipt.projectBlobSha,
            mediaManifestDigest: completedAudit.mediaManifestDigest,
            lfsPayloads: completedAudit.lfsPayloads,
          },
        };
      },
    });

    const app = express();
    app.use(express.json());
    app.use("/api/projects", createProjectRouter(store, gitStore, scheduler));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/projects/${original.id}`;
    const worktree = store.projectDir(original.id);
    const initialHead = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    const initialCount = Number((await git(worktree, ["rev-list", "--count", "HEAD"])).trim());

    const first = { ...original, name: "First semantic save", modifiedAt: original.modifiedAt + 1 };
    const firstResponse = await fetch(baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request(first, revision(initialSaveReceipt))),
    });
    assert.equal(firstResponse.status, 200);
    const firstReceipt = await firstResponse.json() as ProjectSaveReceipt;
    assert.equal(firstReceipt.committed, false);
    assert.deepEqual(JSON.parse(await readFile(join(worktree, "project.json"), "utf8")), first);
    assert.equal((await git(worktree, ["rev-parse", "HEAD"])).trim(), initialHead);

    const metadataOnly = { ...first, modifiedAt: first.modifiedAt + 1 };
    const metadataResponse = await fetch(baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request(metadataOnly, revision(firstReceipt))),
    });
    const metadataReceipt = await metadataResponse.json() as ProjectSaveReceipt;
    assert.equal(metadataReceipt.commitDueAt, firstReceipt.commitDueAt);

    const latest = {
      ...metadataOnly,
      name: "Latest cumulative snapshot",
      modifiedAt: metadataOnly.modifiedAt + 1,
    };
    const latestResponse = await fetch(baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request(latest, revision(metadataReceipt))),
    });
    assert.equal(latestResponse.status, 200);
    const latestReceipt = await latestResponse.json() as ProjectSaveReceipt;
    assert.equal(latestReceipt.committed, false);
    assert.equal((await git(worktree, ["rev-parse", "HEAD"])).trim(), initialHead);

    await waitFor(() => scheduler!.getStatus(original.id)?.state === "clean");
    const statusResponse = await fetch(`${baseUrl}/persistence-status`);
    const status = await statusResponse.json() as ProjectPersistenceStatusResponse;
    assert.equal(status.state, "clean");
    assert.equal(status.sourceModifiedAt, latest.modifiedAt);
    assert.equal(status.receipt?.sourceModifiedAt, latest.modifiedAt);
    assert.equal(Number((await git(worktree, ["rev-list", "--count", "HEAD"])).trim()), initialCount + 1);
    assert.notEqual((await git(worktree, ["rev-parse", "HEAD"])).trim(), initialHead);
    assert.deepEqual(JSON.parse(await git(worktree, ["show", "HEAD:project.json"])), latest);
    assert.equal((await git(worktree, ["status", "--porcelain=v1"])).trim(), "");
    assert.equal((await git(worktree, ["diff", "--cached", "--name-only"])).trim(), "");
  } finally {
    scheduler?.dispose();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
