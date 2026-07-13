import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import type { MediaItem, Project, ProjectBaseRevision, ProjectSaveRequest } from "@openreel/core";
import { serializeRequiredMediaManifest } from "../../../../packages/core/src/project-persistence";
import { config } from "../env";
import { GitStore } from "./git-store";
import { buildRequiredMediaManifest } from "./media-manifest";
import { ProjectStore } from "./project-store";
import { readPendingMedia, storePendingUpload } from "./pending-media";
import {
  executeSaveTransaction,
  recoverInterruptedSave,
  SaveTransactionError,
  SimulatedSaveProcessCrash,
} from "./save-transaction";
import { ensureSafeTestProjectRoot } from "./test-project-root";

const execFileAsync = promisify(execFile);

process.env.GIT_AUTHOR_NAME ??= "OpenReel Tests";
process.env.GIT_AUTHOR_EMAIL ??= "openreel-tests@example.com";
process.env.GIT_COMMITTER_NAME ??= "OpenReel Tests";
process.env.GIT_COMMITTER_EMAIL ??= "openreel-tests@example.com";

interface Fixture {
  fixtureRoot: string;
  repoDir: string;
  gitStore: GitStore;
  store: ProjectStore;
  project: Project;
  baseRevision: ProjectBaseRevision;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd })).stdout;
}

async function fixture(): Promise<Fixture> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openreel-save-transaction-"));
  const repoDir = await mkdtemp(join(fixtureRoot, "repo-"));
  await ensureSafeTestProjectRoot(repoDir, { assignedTempRoot: fixtureRoot, userProjectsRoot: config.projectsRepo });
  const gitStore = new GitStore(repoDir);
  const store = new ProjectStore(gitStore);
  const project = await store.createProject("Atomic Save");
  const receipt = await gitStore.commit(project.id, "test: create project", {
    allowlist: ["project.json"],
    expectedEntries: [{ status: "A", path: "project.json" }],
  });
  assert.ok(receipt.commitSha && receipt.treeSha && receipt.projectBlobSha);
  return {
    fixtureRoot,
    repoDir,
    gitStore,
    store,
    project,
    baseRevision: {
      commitSha: receipt.commitSha,
      treeSha: receipt.treeSha,
      projectBlobSha: receipt.projectBlobSha,
      sourceModifiedAt: project.modifiedAt,
    },
  };
}

async function state(f: Fixture) {
  const worktree = f.store.projectDir(f.project.id);
  return {
    json: await readFile(join(worktree, "project.json")),
    index: await f.store.listProjects(),
    status: await git(worktree, ["status", "--porcelain=v1", "-z"]),
    head: (await git(worktree, ["rev-parse", "HEAD"])).trim(),
    lfsRefs: await git(f.repoDir, ["for-each-ref", "--format=%(refname):%(objectname)", "refs/lfs"]),
  };
}

function request(f: Fixture, project: Project, baseRevision = f.baseRevision): ProjectSaveRequest {
  return {
    projectId: project.id,
    baseRevision,
    project,
    requiredMediaManifest: buildRequiredMediaManifest(project),
  };
}

async function assertUnchanged(f: Fixture, before: Awaited<ReturnType<typeof state>>) {
  const after = await state(f);
  assert.deepEqual(after.json, before.json, "authoritative project JSON bytes changed");
  assert.deepEqual(after.index, before.index, "project index changed");
  assert.equal(after.status, before.status, "worktree status changed");
  assert.equal(after.head, before.head, "HEAD changed");
  assert.equal(after.lfsRefs, before.lfsRefs, "LFS refs changed");
}

function media(id: string, name: string, size: number): MediaItem {
  return {
    id, name, type: "video", fileHandle: null, blob: null, thumbnailUrl: null,
    metadata: { duration: 1, width: 1, height: 1, frameRate: 30, codec: "h264", sampleRate: 48_000, channels: 2, fileSize: size },
  };
}

test("pending media is LFS-audited from the index before one atomic snapshot commit", async () => {
  const f = await fixture();
  try {
    const worktree = f.store.projectDir(f.project.id);
    await mkdir(f.store.mediaDir(f.project.id), { recursive: true });
    await writeFile(join(f.store.mediaDir(f.project.id), "Interview.mp4"), "unrelated collision");
    const bytes = Buffer.from("pending-video");
    const uploadTemp = join(f.fixtureRoot, "pending-upload.tmp");
    await writeFile(uploadTemp, bytes);

    const headBeforeUpload = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    await storePendingUpload(
      worktree,
      "media-1",
      uploadTemp,
      "Interview.mp4",
      "video/mp4",
      bytes.length,
    );
    assert.equal((await git(worktree, ["rev-parse", "HEAD"])).trim(), headBeforeUpload, "upload created an orphan commit");

    const proposed: Project = {
      ...f.project,
      modifiedAt: f.project.modifiedAt + 1,
      mediaLibrary: { items: [media("media-1", "Interview.mp4", bytes.length)] },
    };
    const receipt = await executeSaveTransaction(f.store, f.gitStore, request(f, proposed));

    assert.notEqual(receipt.commitSha, headBeforeUpload);
    assert.equal(receipt.project.mediaLibrary.items[0]?.id, "media-1");
    assert.equal(receipt.project.mediaLibrary.items[0]?.name, "Interview 1.mp4");
    const committedProject = JSON.parse(await git(worktree, ["show", "HEAD:project.json"])) as Project;
    assert.equal(committedProject.mediaLibrary.items[0]?.id, "media-1");
    assert.equal(committedProject.mediaLibrary.items[0]?.name, "Interview 1.mp4");

    const pointer = await git(worktree, ["show", "HEAD:media/Interview 1.mp4"]);
    const expectedOid = createHash("sha256").update(bytes).digest("hex");
    assert.match(pointer, new RegExp(`oid sha256:${expectedOid}`));
    assert.match(pointer, new RegExp(`size ${bytes.length}`));
    assert.equal(receipt.lfsPayloads[0]?.oid, `sha256:${expectedOid}`);
    assert.deepEqual(receipt.lfsPayloads[0]?.local, { state: "verified", actualSize: bytes.length });
    assert.deepEqual(receipt.lfsPayloads[0]?.remote, { state: "local-only", remote: null });
    assert.equal(receipt.lfsPayloads[0]?.semanticFilename, "Interview 1.mp4");
    await assert.rejects(execFileAsync("git", ["show", "HEAD:media/Interview.mp4"], { cwd: worktree }));
    await execFileAsync("git", ["lfs", "fsck", "--objects"], { cwd: worktree });
    assert.equal((await git(worktree, ["rev-list", "--count", `${headBeforeUpload}..HEAD`])).trim(), "1");
  } finally {
    await rm(f.fixtureRoot, { recursive: true, force: true });
  }
});

test("recovery unstages and returns promoted media to pending before ref update", async () => {
  const f = await fixture();
  try {
    const worktree = f.store.projectDir(f.project.id);
    const bytes = Buffer.from("recoverable-video");
    const uploadTemp = join(f.fixtureRoot, "recoverable-upload.tmp");
    await writeFile(uploadTemp, bytes);
    await storePendingUpload(worktree, "media-1", uploadTemp, "Clip.mp4", "video/mp4", bytes.length);
    const headBefore = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    const proposed: Project = {
      ...f.project,
      modifiedAt: f.project.modifiedAt + 1,
      mediaLibrary: { items: [media("media-1", "Clip.mp4", bytes.length)] },
    };

    await assert.rejects(
      executeSaveTransaction(f.store, f.gitStore, request(f, proposed), { simulateCrashAt: "before-ref-update" }),
      SimulatedSaveProcessCrash,
    );
    assert.match(await git(worktree, ["diff", "--cached", "--name-only"]), /media\/Clip\.mp4/);

    await recoverInterruptedSave(f.store, f.gitStore, f.project.id);

    assert.equal((await git(worktree, ["rev-parse", "HEAD"])).trim(), headBefore);
    assert.equal(await git(worktree, ["diff", "--cached", "--name-only"]), "");
    const restored = await readPendingMedia(worktree, "media-1");
    assert.ok(restored);
    assert.equal(await readFile(restored.contentPath, "utf8"), bytes.toString());
    await assert.rejects(readFile(join(f.store.mediaDir(f.project.id), "Clip.mp4")), { code: "ENOENT" });
    assert.deepEqual(JSON.parse(await readFile(join(worktree, "project.json"), "utf8")), f.project);
  } finally {
    await rm(f.fixtureRoot, { recursive: true, force: true });
  }
});

test("absent media returns MEDIA_INCOMPLETE without mutating authoritative state", async () => {
  const f = await fixture();
  try {
    const before = await state(f);
    const proposed = { ...f.project, name: "Missing", mediaLibrary: { items: [media("media-1", "clip.mp4", 4)] } };
    await assert.rejects(executeSaveTransaction(f.store, f.gitStore, request(f, proposed)), (error: unknown) => {
      assert.ok(error instanceof SaveTransactionError);
      assert.equal(error.status, 409);
      assert.equal(error.body.code, "MEDIA_INCOMPLETE");
      return true;
    });
    await assertUnchanged(f, before);
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("two saves from one base serialize and the stale save returns PROJECT_CONFLICT", async () => {
  const f = await fixture();
  try {
    const first = { ...f.project, name: "First writer", modifiedAt: f.project.modifiedAt + 1 };
    const second = { ...f.project, name: "Second writer", modifiedAt: f.project.modifiedAt + 2 };
    const [a, b] = await Promise.allSettled([
      executeSaveTransaction(f.store, f.gitStore, request(f, first)),
      executeSaveTransaction(f.store, f.gitStore, request(f, second)),
    ]);
    assert.equal([a, b].filter((result) => result.status === "fulfilled").length, 1);
    const rejected = [a, b].find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(rejected?.reason instanceof SaveTransactionError);
    assert.equal(rejected.reason.body.code, "PROJECT_CONFLICT");
    const winnerState = await state(f);
    await assert.rejects(executeSaveTransaction(f.store, f.gitStore, request(f, { ...second, name: "Still stale" })), /PROJECT_CONFLICT/);
    await assertUnchanged(f, winnerState);
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("submitted staged-manifest mismatch is rejected before mutation", async () => {
  const f = await fixture();
  try {
    const before = await state(f);
    const proposed = { ...f.project, name: "Manifest mismatch", modifiedAt: f.project.modifiedAt + 1 };
    const bad = { ...request(f, proposed), requiredMediaManifest: [{ mediaId: "forged", semanticFilename: "forged.mp4", relativePhysicalPath: "media/forged.mp4", expectedByteSize: 1 }] };
    assert.notEqual(serializeRequiredMediaManifest(bad.requiredMediaManifest), serializeRequiredMediaManifest(buildRequiredMediaManifest(proposed)));
    await assert.rejects(executeSaveTransaction(f.store, f.gitStore, bad), /manifest/i);
    await assertUnchanged(f, before);
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("post-stage mismatch restores authoritative state after Git rejects the cached diff", async () => {
  const f = await fixture();
  try {
    const before = await state(f);
    const proposed = { ...f.project, name: "Staged mismatch", modifiedAt: f.project.modifiedAt + 1 };
    await assert.rejects(
      executeSaveTransaction(f.store, f.gitStore, request(f, proposed), {
        expectedEntries: [{ status: "A", path: "project.json" }],
      }),
      /Cached diff did not match/,
    );
    await assertUnchanged(f, before);
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("the shared Git project lock prevents a non-save commit from interleaving", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    let saveReachedCommit!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { saveReachedCommit = resolve; });
    const proposed = { ...f.project, name: "Locked save", modifiedAt: f.project.modifiedAt + 1 };
    const saving = executeSaveTransaction(f.store, f.gitStore, request(f, proposed), {
      beforeCommit: async () => { saveReachedCommit(); await gate; },
    });
    await reached;
    let competitorEntered = false;
    const competing = f.gitStore.commit(f.project.id, "test: non-save interleaving commit", {
      allowlist: [],
      expectedEntries: [],
    }).then(() => { competitorEntered = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(competitorEntered, false);
    release();
    await saving;
    await competing;
    assert.equal(competitorEntered, true);
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("recovery after process loss before ref update restores the base bytes and index", async () => {
  const f = await fixture();
  try {
    const before = await state(f);
    const proposed = { ...f.project, name: "Interrupted before ref", modifiedAt: f.project.modifiedAt + 1 };
    await assert.rejects(
      executeSaveTransaction(f.store, f.gitStore, request(f, proposed), { simulateCrashAt: "before-ref-update" }),
      SimulatedSaveProcessCrash,
    );
    await recoverInterruptedSave(f.store, f.gitStore, f.project.id);
    await assertUnchanged(f, before);
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("recovery after process loss after ref update keeps the confirmed bytes and HEAD", async () => {
  const f = await fixture();
  try {
    const proposed = { ...f.project, name: "Interrupted after ref", modifiedAt: f.project.modifiedAt + 1 };
    await assert.rejects(
      executeSaveTransaction(f.store, f.gitStore, request(f, proposed), { simulateCrashAt: "after-ref-update" }),
      SimulatedSaveProcessCrash,
    );
    const headAfterCommit = (await git(f.store.projectDir(f.project.id), ["rev-parse", "HEAD"])).trim();
    assert.notEqual(headAfterCommit, f.baseRevision.commitSha);
    await recoverInterruptedSave(f.store, f.gitStore, f.project.id);
    const recovered = await f.store.loadProject(f.project.id);
    assert.equal(recovered?.name, proposed.name);
    assert.equal((await git(f.store.projectDir(f.project.id), ["rev-parse", "HEAD"])).trim(), headAfterCommit);
    assert.equal(await git(f.store.projectDir(f.project.id), ["status", "--porcelain=v1", "-z"]), "");
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});

test("commit failure restores only transaction-owned project JSON and index state", async () => {
  const f = await fixture();
  try {
    const worktree = f.store.projectDir(f.project.id);
    await writeFile(join(worktree, "unrelated.txt"), "keep me");
    const before = await state(f);
    const proposed = { ...f.project, name: "Commit failure", modifiedAt: f.project.modifiedAt + 1 };
    await assert.rejects(
      executeSaveTransaction(f.store, f.gitStore, request(f, proposed), {
        commit: async () => { throw new Error("injected commit failure"); },
      }),
      /injected commit failure/,
    );
    await assertUnchanged(f, before);
    assert.equal(await readFile(join(worktree, "unrelated.txt"), "utf8"), "keep me");
  } finally { await rm(f.fixtureRoot, { recursive: true, force: true }); }
});
