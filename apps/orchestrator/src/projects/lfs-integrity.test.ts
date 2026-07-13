import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { verifyGitLfsPayloads } from "./lfs-integrity";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function gitLfsAvailable(): Promise<boolean> {
  try {
    await git(process.cwd(), ["lfs", "version"]);
    return true;
  } catch {
    return false;
  }
}

test("reports semantic identity and OID when a committed LFS object's payload is missing", async (t) => {
  if (!(await gitLfsAvailable())) {
    t.skip("Git LFS is unavailable");
    return;
  }

  const repoDir = await mkdtemp(join(tmpdir(), "openreel-lfs-integrity-"));
  try {
    await git(repoDir, ["init", "--quiet"]);
    await git(repoDir, ["config", "user.email", "openreel@example.invalid"]);
    await git(repoDir, ["config", "user.name", "OpenReel Tests"]);
    await git(repoDir, ["lfs", "install", "--local"]);
    await mkdir(join(repoDir, "media"));
    await writeFile(join(repoDir, ".gitattributes"), "media/** filter=lfs diff=lfs merge=lfs -text\n");
    await writeFile(join(repoDir, "media", "media-1.mp4"), "original-video-payload");
    await git(repoDir, ["add", ".gitattributes", "media/media-1.mp4"]);
    await git(repoDir, ["commit", "--quiet", "-m", "fixture"]);

    const pointer = await git(repoDir, ["show", "HEAD:media/media-1.mp4"]);
    const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(pointer)?.[1];
    assert.ok(oid);
    const commonDir = (await git(repoDir, ["rev-parse", "--git-common-dir"])).trim();
    const objectPath = join(repoDir, commonDir, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid);

    // Retain the pointer in the worktree while making the real payload unavailable.
    await writeFile(join(repoDir, "media", "media-1.mp4"), pointer);
    await rm(objectPath);

    const [result] = await verifyGitLfsPayloads(repoDir, [
      {
        mediaId: "media-1",
        semanticFilename: "Interview master.mp4",
        relativePhysicalPath: "media/media-1.mp4",
      },
    ]);

    assert.deepEqual(result, {
      mediaId: "media-1",
      semanticFilename: "Interview master.mp4",
      relativePhysicalPath: "media/media-1.mp4",
      oid: `sha256:${oid}`,
      pointerSize: "original-video-payload".length,
      local: { state: "missing", actualSize: null },
      remote: { state: "local-only", remote: null },
    });
    assert.notEqual((await readFile(join(repoDir, "media", "media-1.mp4"))).byteLength, result.pointerSize);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("verifies local LFS object size and content hash without treating a pointer as payload", async (t) => {
  if (!(await gitLfsAvailable())) {
    t.skip("Git LFS is unavailable");
    return;
  }

  const repoDir = await mkdtemp(join(tmpdir(), "openreel-lfs-integrity-"));
  try {
    await git(repoDir, ["init", "--quiet"]);
    await git(repoDir, ["config", "user.email", "openreel@example.invalid"]);
    await git(repoDir, ["config", "user.name", "OpenReel Tests"]);
    await git(repoDir, ["lfs", "install", "--local"]);
    await mkdir(join(repoDir, "media"));
    await writeFile(join(repoDir, ".gitattributes"), "media/** filter=lfs diff=lfs merge=lfs -text\n");
    await writeFile(join(repoDir, "media", "media-2.wav"), "audio-payload");
    await git(repoDir, ["add", ".gitattributes", "media/media-2.wav"]);
    await git(repoDir, ["commit", "--quiet", "-m", "fixture"]);

    const [result] = await verifyGitLfsPayloads(repoDir, [
      {
        mediaId: "media-2",
        semanticFilename: "Clean dialogue.wav",
        relativePhysicalPath: "media/media-2.wav",
      },
    ]);

    assert.equal(result.local.state, "verified");
    assert.equal(result.local.actualSize, "audio-payload".length);
    assert.match(result.oid, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(result.remote, { state: "local-only", remote: null });

    const entry = {
      mediaId: "media-2",
      semanticFilename: "Clean dialogue.wav",
      relativePhysicalPath: "media/media-2.wav",
    };
    for (const state of ["durable", "upload-required", "unreachable"] as const) {
      let checkedOid = "";
      const [remoteResult] = await verifyGitLfsPayloads(repoDir, [entry], {
        remote: "archive",
        checkRemoteObject: async (_repo, remote, oid) => {
          assert.equal(remote, "archive");
          checkedOid = oid;
          return state;
        },
      });
      assert.equal(checkedOid, result.oid);
      assert.deepEqual(remoteResult.remote, { state, remote: "archive" });
    }
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});
