import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LFS_POINTER_VERSION = "https://git-lfs.github.com/spec/v1";

export interface LfsManifestIdentity {
  readonly mediaId: string;
  readonly semanticFilename: string;
  readonly relativePhysicalPath: string;
}

export type LfsLocalVerification =
  | { readonly state: "verified"; readonly actualSize: number }
  | { readonly state: "missing"; readonly actualSize: null }
  | { readonly state: "size-mismatch"; readonly actualSize: number }
  | { readonly state: "oid-mismatch"; readonly actualSize: number };

export type LfsRemoteVerification =
  | { readonly state: "local-only"; readonly remote: null }
  | { readonly state: "durable"; readonly remote: string }
  | { readonly state: "upload-required"; readonly remote: string }
  | { readonly state: "unreachable"; readonly remote: string };

export interface LfsPayloadVerification extends LfsManifestIdentity {
  readonly oid: `sha256:${string}`;
  readonly pointerSize: number;
  readonly local: LfsLocalVerification;
  readonly remote: LfsRemoteVerification;
}

export interface LfsVerificationOptions {
  /** A configured Git remote whose LFS endpoint must already contain each object. */
  readonly remote?: string | null;
  /** Injectable remote probe for deterministic tests and deployment-specific LFS APIs. */
  readonly checkRemoteObject?: LfsRemoteObjectCheck;
  /** Resolve pointers from the current index before ref update, or from HEAD. */
  readonly pointerSource?: "HEAD" | "index";
}

export type LfsRemoteObjectCheck = (
  repoDir: string,
  remote: string,
  oid: `sha256:${string}`,
) => Promise<"durable" | "upload-required" | "unreachable">;

interface LfsPointerMetadata {
  readonly oid: `sha256:${string}`;
  readonly size: number;
}

async function git(repoDir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoDir,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function checkPointerWithGitLfs(repoDir: string, pointer: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("git", ["lfs", "pointer", "--check", "--strict", "--stdin"], {
      cwd: repoDir,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || `git lfs pointer exited with status ${code}`));
    });
    child.stdin.end(pointer);
  });
}

async function committedPointer(
  repoDir: string,
  entry: LfsManifestIdentity,
  source: "HEAD" | "index",
): Promise<LfsPointerMetadata> {
  const pointer = await git(repoDir, ["show", source === "index" ? `:${entry.relativePhysicalPath}` : `HEAD:${entry.relativePhysicalPath}`]);

  // Git LFS plumbing performs the authoritative syntax check. Parsing only
  // extracts the two fields needed to locate and verify the payload.
  await checkPointerWithGitLfs(repoDir, pointer);
  const lines = new Map(
    pointer
      .trimEnd()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(" ");
        return [line.slice(0, separator), line.slice(separator + 1)] as const;
      }),
  );
  const oid = lines.get("oid");
  const size = Number(lines.get("size"));
  if (
    lines.get("version") !== LFS_POINTER_VERSION ||
    !oid?.match(/^sha256:[0-9a-f]{64}$/) ||
    !Number.isSafeInteger(size) ||
    size < 0
  ) {
    throw new Error(
      `Invalid Git LFS pointer for media ${entry.mediaId} (${entry.semanticFilename}) at ${entry.relativePhysicalPath}`,
    );
  }
  return { oid: oid as `sha256:${string}`, size };
}

async function localObjectPath(repoDir: string, oid: `sha256:${string}`): Promise<string> {
  const commonDirValue = (await git(repoDir, ["rev-parse", "--git-common-dir"])).trim();
  const commonDir = isAbsolute(commonDirValue) ? commonDirValue : resolve(repoDir, commonDirValue);
  const hash = oid.slice("sha256:".length);
  return join(commonDir, "lfs", "objects", hash.slice(0, 2), hash.slice(2, 4), hash);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function verifyLocalObject(
  repoDir: string,
  pointer: LfsPointerMetadata,
): Promise<LfsLocalVerification> {
  const objectPath = await localObjectPath(repoDir, pointer.oid);
  let objectStat;
  try {
    objectStat = await stat(objectPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "missing", actualSize: null };
    }
    throw error;
  }
  if (!objectStat.isFile() || objectStat.size !== pointer.size) {
    return { state: "size-mismatch", actualSize: objectStat.size };
  }
  const actualOid = await hashFile(objectPath);
  if (`sha256:${actualOid}` !== pointer.oid) {
    return { state: "oid-mismatch", actualSize: objectStat.size };
  }
  return { state: "verified", actualSize: objectStat.size };
}

async function verifyRemoteObject(
  repoDir: string,
  oid: `sha256:${string}`,
  remote: string | null | undefined,
  checkRemoteObject: LfsRemoteObjectCheck = checkRemoteObjectWithGitLfs,
): Promise<LfsRemoteVerification> {
  if (!remote) return { state: "local-only", remote: null };
  const state = await checkRemoteObject(repoDir, remote, oid);
  return { state, remote };
}

async function checkRemoteObjectWithGitLfs(
  repoDir: string,
  remote: string,
  oid: `sha256:${string}`,
): Promise<"durable" | "upload-required" | "unreachable"> {
  try {
    // ls-remote establishes actual remote reachability. Git LFS's object-id
    // dry-run then reports whether the endpoint would require this upload.
    await git(repoDir, ["ls-remote", "--exit-code", remote, "HEAD"]);
    const output = await git(repoDir, [
      "lfs",
      "push",
      "--dry-run",
      "--object-id",
      remote,
      oid.slice("sha256:".length),
    ]);
    return /\bpush\b/.test(output) ? "upload-required" : "durable";
  } catch {
    return "unreachable";
  }
}

/**
 * Verifies committed Git LFS pointers against the real local object store and,
 * when configured, the remote LFS endpoint. Results intentionally remain
 * separate from the canonical media-manifest digest because availability is
 * machine- and deployment-dependent.
 */
export async function verifyGitLfsPayloads(
  repoDir: string,
  entries: readonly LfsManifestIdentity[],
  options: LfsVerificationOptions = {},
): Promise<LfsPayloadVerification[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const pointer = await committedPointer(repoDir, entry, options.pointerSource ?? "HEAD");
      const [local, remote] = await Promise.all([
        verifyLocalObject(repoDir, pointer),
        verifyRemoteObject(repoDir, pointer.oid, options.remote, options.checkRemoteObject),
      ]);
      return {
        ...entry,
        oid: pointer.oid,
        pointerSize: pointer.size,
        local,
        remote,
      };
    }),
  );
}
