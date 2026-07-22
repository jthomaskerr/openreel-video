import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HandoffSelection, Project, ResolveImportResult } from "@openreel/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GitCommitTransaction, GitProjectTransaction } from "../projects/git-store";
import type { ProjectMediaManifestSnapshot } from "../projects/media-manifest";
import { ResolveExportJobStore } from "./job-store";
import {
  ResolveExportService,
  ResolveArtifactCapabilityStore,
  RESOLVE_ARTIFACT_CAPABILITY_LIMIT,
  ResolveSimulatedProcessCrash,
  type ResolveTransactionPoint,
} from "./service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function media(id: string, name: string): object {
  return {
    id,
    name,
    type: "video",
    fileHandle: null,
    blob: null,
    thumbnailUrl: null,
    metadata: {
      duration: 2,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48_000,
      channels: 2,
      fileSize: 42,
    },
  };
}

function projectFixture(): Project {
  return {
    id: "vintage-tokyo",
    name: "Vintage Tokyo",
    description: "A summer edit",
    createdAt: 1,
    modifiedAt: 2,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
    mediaLibrary: { items: [media("media-1", "street.mov"), media("media-2", "train.mov")] },
    generatedImageDefinitions: [],
    timeline: {
      duration: 2,
      markers: [],
      subtitles: [],
      tracks: [{
        id: "video-track",
        name: "Video",
        type: "video",
        clips: [{
          id: "clip-1",
          type: "video",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          effects: [],
          audioEffects: [],
          transform: {
            position: { x: 0.5, y: 0.5 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          volume: 1,
          keyframes: [],
        }],
        transitions: [],
        locked: false,
        visible: true,
        muted: false,
        solo: false,
      }],
    },
  } as unknown as Project;
}

function audit(complete = true): ProjectMediaManifestSnapshot {
  return {
    mediaManifestDigest: complete ? "manifest-digest" : null,
    requiredMediaManifest: [{
      mediaId: "media-1",
      semanticFilename: "street.mov",
      relativePhysicalPath: "media/street.mov",
      expectedByteSize: 42,
      lfsOid: `sha256:${"c".repeat(64)}`,
    }],
    lfsPayloads: complete ? [{
      mediaId: "media-1",
      semanticFilename: "street.mov",
      relativePhysicalPath: "media/street.mov",
      oid: `sha256:${"c".repeat(64)}`,
      pointerSize: 42,
      local: { state: "verified", actualSize: 42 },
      remote: { state: "local-only", remote: null },
    }] : [],
    missingEntries: complete ? [] : [{
      mediaId: "media-1",
      semanticFilename: "street.mov",
      relativePhysicalPath: "media/street.mov",
      expectedByteSize: 42,
      actualFilename: null,
    }],
    duplicateIssues: [],
    filenameMismatches: [],
    byteSizeMismatches: [],
    danglingClips: [],
  } as ProjectMediaManifestSnapshot;
}

const selection: HandoffSelection = {
  projectId: "vintage-tokyo",
  projectModifiedAt: 2,
  target: "resolve",
  range: { startTime: 0, endTime: 2 },
};

const FIXED_JOB_ID = "resolve-job-test-1";
const CONFIRMED_REVISION = "a".repeat(40);

function jobPath(name: string): string {
  return `exports/resolve/${FIXED_JOB_ID}/${name}`;
}

const JOB_TRANSITION_CRASH_POINTS = [
  `after-publish:${jobPath("job.json")}`,
  "after-git-stage",
  "after-git-tree",
  "before-ref-update",
  "after-ref-update",
] satisfies readonly ResolveTransactionPoint[];

const IMPORT_RESULT_CRASH_POINTS = [
  `after-publish:${jobPath("job.json")}`,
  `after-publish:${jobPath("result.json")}`,
  "after-publish:project.json",
  "after-git-stage",
  "after-git-tree",
  "before-ref-update",
  "after-ref-update",
] satisfies readonly ResolveTransactionPoint[];

function importResult(overrides: Partial<ResolveImportResult> = {}): ResolveImportResult {
  return {
    requestId: "resolve-request-test-1",
    status: "completed",
    resolveVersion: "21.0.3",
    resolveBuild: "21.0.30007",
    projectName: "Vintage Tokyo",
    timelineName: "Vintage Tokyo",
    durationFrames: 60,
    trackCounts: { video: 1 },
    clipCounts: { video: 1 },
    offlineMediaIds: [],
    referencedMediaIds: ["media-1"],
    saved: true,
    artifactSha256: "b".repeat(64),
    ...overrides,
  };
}

interface FixtureOptions {
  complete?: boolean;
  commitFails?: boolean;
  commitFailsAfter?: number;
  resultWriteFails?: boolean;
  crashAt?: ResolveTransactionPoint;
}

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "openreel-resolve-service-"));
  roots.push(root);
  const projectDir = join(root, "vintage-tokyo");
  await mkdir(join(projectDir, "media"), { recursive: true });
  const confirmedProjectBytes = Buffer.from(JSON.stringify(projectFixture(), null, 2), "utf8");
  await writeFile(join(projectDir, "project.json"), confirmedProjectBytes);
  await writeFile(join(projectDir, "media", "street.mov"), "canonical-media");
  const commits: Array<{ message: string; transaction: GitCommitTransaction }> = [];
  const snapshots = new Map<string, Map<string, string>>([
    [CONFIRMED_REVISION, new Map([["project.json", confirmedProjectBytes.toString("utf8")]])],
  ]);
  const parents = new Map<string, string | null>([[CONFIRMED_REVISION, null]]);
  let head = CONFIRMED_REVISION;
  let commitCount = 0;
  const commit = vi.fn(async (message: string, transaction: GitCommitTransaction) => {
    commits.push({ message, transaction });
    commitCount += 1;
    if (options.commitFails || (options.commitFailsAfter !== undefined && commitCount > options.commitFailsAfter)) {
      throw new Error("git failed");
    }
    await transaction.hooks?.afterStage?.();
    await transaction.hooks?.afterTree?.();
    await transaction.hooks?.beforeRefUpdate?.();
    const nextSha = commitCount.toString(16).padStart(40, "0");
    const nextSnapshot = new Map(snapshots.get(head));
    for (const path of transaction.allowlist) {
      nextSnapshot.set(path, await readFile(join(projectDir, path), "utf8"));
    }
    snapshots.set(nextSha, nextSnapshot);
    parents.set(nextSha, head);
    head = nextSha;
    await transaction.hooks?.afterRefUpdate?.();
    const projectBytes = Buffer.from(nextSnapshot.get("project.json")!, "utf8");
    const projectBlobSha = createHash("sha1")
      .update(Buffer.from(`blob ${projectBytes.byteLength}\0`, "utf8"))
      .update(projectBytes)
      .digest("hex");
    return {
      commitSha: nextSha,
      treeSha: `tree-${nextSha}`,
      projectBlobSha,
      mediaManifestDigest: "manifest-digest",
    };
  });
  const gitTransaction: GitProjectTransaction = {
    commit,
    stage: vi.fn(async () => undefined),
    unstage: vi.fn(async () => undefined),
  };
  let transactionTail = Promise.resolve();
  const currentReceipt = async () => {
    const projectBytes = Buffer.from(snapshots.get(head)!.get("project.json")!, "utf8");
    const projectBlobSha = createHash("sha1")
      .update(Buffer.from(`blob ${projectBytes.byteLength}\0`, "utf8"))
      .update(projectBytes)
      .digest("hex");
    return {
      commitSha: head,
      treeSha: `tree-${head}`,
      projectBlobSha,
      mediaManifestDigest: "manifest-digest",
    };
  };
  const isAncestor = (ancestor: string, descendant: string): boolean => {
    let cursor: string | null | undefined = descendant;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = parents.get(cursor);
    }
    return false;
  };
  const git = {
    readConfirmedReceipt: vi.fn(currentReceipt),
    readConfirmedReceiptStrict: vi.fn(async () => ({ status: "present" as const, value: await currentReceipt() })),
    getProjectAtCommit: vi.fn(async (_projectId: string, sha: string) => {
      const bytes = snapshots.get(sha)?.get("project.json");
      return bytes ? JSON.parse(bytes) as Project : null;
    }),
    readFileAtCommit: vi.fn(async (_projectId: string, sha: string, path: string) =>
      snapshots.get(sha)?.get(path) ?? null),
    readFileAtCommitStrict: vi.fn(async (_projectId: string, sha: string, path: string) => {
      const value = snapshots.get(sha)?.get(path);
      return value === undefined
        ? { status: "absent" as const }
        : { status: "present" as const, value };
    }),
    isCommitAncestor: vi.fn(async (_projectId: string, ancestor: string, descendant: string) =>
      isAncestor(ancestor, descendant)),
    commit: vi.fn(async (_projectId: string, message: string, transaction: GitCommitTransaction) =>
      commit(message, transaction)),
    withProjectTransaction: async <T>(
      _projectId: string,
      operation: (transaction: GitProjectTransaction) => Promise<T>,
    ): Promise<T> => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await operation(gitTransaction);
      } finally {
        release();
      }
    },
  };
  const projects = {
    projectDir: (projectId: string) => join(root, projectId),
    loadProject: vi.fn(async (projectId: string) =>
      JSON.parse(await readFile(join(root, projectId, "project.json"), "utf8")) as Project),
    auditSnapshot: vi.fn(async () => audit(options.complete ?? true)),
    listProjects: vi.fn(async () => [{ id: "vintage-tokyo" }]),
  };
  const createJobs = () => new ResolveExportJobStore({
    projectDir: projects.projectDir,
    listProjectIds: async () => ["vintage-tokyo"],
    beforeWrite: options.resultWriteFails
      ? (path) => {
        if (path.endsWith("result.json")) throw new Error("result write failed");
      }
      : undefined,
  });
  const jobs = createJobs();
  let resolveJobSequence = 0;
  let resolveTransactionSequence = 0;
  let nonceSequence = 0;
  let now = Date.parse("2026-07-22T00:00:00.000Z");
  let crashAt: ResolveTransactionPoint | null = options.crashAt ?? null;
  const createService = (serviceJobs = createJobs()) => new ResolveExportService({
    projects,
    git,
    jobs: serviceJobs,
    now: () => now,
    createDurableId: (kind) => kind === "resolve-job"
      ? `resolve-job-test-${++resolveJobSequence}`
      : `resolve-transaction-test-${++resolveTransactionSequence}`,
    createInfrastructureNonce: () => `nonce-test-${++nonceSequence}`,
    onTransactionPoint: (point) => {
      if (point === crashAt) throw new ResolveSimulatedProcessCrash(point);
    },
  });
  const service = createService(jobs);
  return {
    root,
    projectDir,
    projects,
    git,
    gitTransaction,
    commits,
    jobs,
    service,
    newService: () => createService(),
    advanceConflictingHead: (path: string, value: string) => {
      const nextSha = (commitCount + 1_000).toString(16).padStart(40, "0");
      const nextSnapshot = new Map(snapshots.get(head));
      nextSnapshot.set(path, value);
      snapshots.set(nextSha, nextSnapshot);
      parents.set(nextSha, head);
      head = nextSha;
    },
    setCrashAt: (point: ResolveTransactionPoint | null) => { crashAt = point; },
    setNow: (value: number) => { now = value; },
  };
}

async function startReady(input?: Awaited<ReturnType<typeof fixture>>) {
  const f = input ?? await fixture();
  const job = await f.service.start("vintage-tokyo", CONFIRMED_REVISION, selection);
  const persisted = JSON.parse(await readFile(
    join(f.projectDir, "exports", "resolve", job.id, "job.json"),
    "utf8",
  )) as { artifacts: Array<{ path: string; sha256: string }> };
  const artifactSha256 = persisted.artifacts.find((artifact) => artifact.path.endsWith(".fcpxml"))!.sha256;
  return { ...f, job, artifactSha256, token: job.bridgeLaunchUrl!.split("/").at(-1)! };
}

async function startImporting(input?: Awaited<ReturnType<typeof fixture>>) {
  const ready = await startReady(input);
  await ready.service.redeem(ready.token);
  return ready;
}

type ServiceFixture = Awaited<ReturnType<typeof fixture>>;

async function pendingRecoveryState(f: ServiceFixture) {
  const transactionsDirectory = join(f.projectDir, jobPath(".transactions"));
  const [journalName] = await readdir(transactionsDirectory);
  if (!journalName) throw new Error("pending recovery journal is missing");
  const journalPath = join(transactionsDirectory, journalName);
  return {
    journalPath,
    journalBytes: await readFile(journalPath, "utf8"),
    jobBytes: await readFile(join(f.projectDir, jobPath("job.json")), "utf8"),
    projectBytes: await readFile(join(f.projectDir, "project.json"), "utf8"),
    unstageCalls: vi.mocked(f.gitTransaction.unstage).mock.calls.length,
  };
}

async function expectRecoveryStateUnchanged(
  f: ServiceFixture,
  before: Awaited<ReturnType<typeof pendingRecoveryState>>,
): Promise<void> {
  expect(await readFile(before.journalPath, "utf8")).toBe(before.journalBytes);
  expect(await readFile(join(f.projectDir, jobPath("job.json")), "utf8")).toBe(before.jobBytes);
  expect(await readFile(join(f.projectDir, "project.json"), "utf8")).toBe(before.projectBytes);
  expect(vi.mocked(f.gitTransaction.unstage)).toHaveBeenCalledTimes(before.unstageCalls);
}

async function expectSanitizedRecoveryFailure(service: ResolveExportService): Promise<void> {
  let caught: unknown;
  try {
    await service.recoveryDiagnostics();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    code: "RECOVERY_FAILED",
    projectId: "vintage-tokyo",
    jobId: FIXED_JOB_ID,
    message: "Resolve transaction recovery failed",
  });
  expect(JSON.stringify(caught)).not.toContain("sensitive-token");
  expect(JSON.stringify(caught)).not.toContain("/private/secret");
}

describe("ResolveExportService", () => {
  test("bounds job capabilities and evicts only the oldest entry at capacity", () => {
    const store = new ResolveArtifactCapabilityStore();
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    for (let index = 0; index < RESOLVE_ARTIFACT_CAPABILITY_LIMIT; index += 1) {
      store.issue("vintage-tokyo", `job-${index}`, digest(`token-${index}`), 10_000);
    }

    store.issue(
      "vintage-tokyo",
      `job-${RESOLVE_ARTIFACT_CAPABILITY_LIMIT - 1}`,
      digest("replacement"),
      10_000,
    );
    store.issue("vintage-tokyo", "new-job", digest("new-token"), 10_000);

    expect(store.authorize("vintage-tokyo", "job-0", digest("token-0"), 0)).toBe(false);
    expect(store.authorize("vintage-tokyo", "job-1", digest("token-1"), 0)).toBe(true);
    expect(store.authorize(
      "vintage-tokyo",
      `job-${RESOLVE_ARTIFACT_CAPABILITY_LIMIT - 1}`,
      digest(`token-${RESOLVE_ARTIFACT_CAPABILITY_LIMIT - 1}`),
      0,
    )).toBe(false);
    expect(store.authorize(
      "vintage-tokyo",
      `job-${RESOLVE_ARTIFACT_CAPABILITY_LIMIT - 1}`,
      digest("replacement"),
      0,
    )).toBe(true);
    expect(store.authorize("vintage-tokyo", "new-job", digest("new-token"), 0)).toBe(true);
  });

  test("locks the requested confirmed revision and rejects a stale revision before artifact writes", async () => {
    const f = await fixture();
    await expect(f.service.start("vintage-tokyo", "stale", selection))
      .rejects.toMatchObject({ code: "STALE_PROJECT_REVISION", projectId: "vintage-tokyo" });
    await expect(stat(join(f.projectDir, "exports"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects dirty worktree bytes even when modifiedAt matches the confirmed commit", async () => {
    const f = await fixture();
    const dirty = { ...projectFixture(), name: "Dirty Worktree", modifiedAt: selection.projectModifiedAt };
    await writeFile(join(f.projectDir, "project.json"), JSON.stringify(dirty, null, 2));

    await expect(f.service.start("vintage-tokyo", CONFIRMED_REVISION, selection))
      .rejects.toMatchObject({ code: "WORKTREE_REVISION_MISMATCH", projectId: "vintage-tokyo" });
  });

  test("rejects incomplete required media with stable identifiers", async () => {
    const f = await fixture({ complete: false });
    await expect(f.service.start("vintage-tokyo", CONFIRMED_REVISION, selection))
      .rejects.toMatchObject({ code: "MEDIA_INCOMPLETE", projectId: "vintage-tokyo", mediaIds: ["media-1"] });
  });

  test("writes and hashes only the exact committed Resolve artifacts without copying media", async () => {
    const f = await startReady();
    const directory = join(f.projectDir, "exports", "resolve", f.job.id);
    const names = (await readdir(directory)).sort();
    expect(names).toEqual(["Vintage Tokyo.fcpxml", "compatibility-report.md", "job.json", "manifest.json"]);
    expect(await readFile(join(f.projectDir, "media", "street.mov"), "utf8")).toBe("canonical-media");

    const committed = f.commits.at(-1)!.transaction;
    expect(committed.allowlist).toEqual(names.map((name) => `exports/resolve/${f.job.id}/${name}`));
    expect(committed.expectedEntries).toEqual(committed.allowlist.map((path) => ({ status: "A", path })));

    const redeemed = await f.service.redeem(f.token);
    for (const artifact of redeemed.artifacts) {
      const bytes = await readFile(join(f.projectDir, artifact.path));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    }
    expect(JSON.stringify(redeemed)).not.toContain(f.projectDir);
  });

  test("persists only a five-minute hash token and enforces expiry and single use", async () => {
    const used = await startReady();
    await expect(used.service.redeem(used.token)).resolves.toMatchObject({ jobId: used.job.id });
    await expect(used.service.redeem(used.token)).rejects.toMatchObject({ code: "LAUNCH_TOKEN_USED" });

    const expired = await startReady();
    expired.setNow(Date.parse("2026-07-22T00:05:00.000Z"));
    await expect(expired.service.redeem(expired.token)).rejects.toMatchObject({ code: "LAUNCH_TOKEN_EXPIRED" });
    const persisted = await readFile(
      join(expired.projectDir, "exports", "resolve", expired.job.id, "job.json"),
      "utf8",
    );
    expect(persisted).not.toContain(expired.token);
  });

  test("allows exactly one of two concurrent token redemptions", async () => {
    const f = await startReady();
    const outcomes = await Promise.allSettled([
      f.service.redeem(f.token),
      f.service.redeem(f.token),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) =>
      outcome.status === "rejected" && outcome.reason?.code === "LAUNCH_TOKEN_USED"))
      .toHaveLength(1);
  });

  test("cancels a ready job idempotently and rejects terminal completion cancellation", async () => {
    const cancelled = await startReady();
    await expect(cancelled.service.cancel(cancelled.job.id)).resolves.toMatchObject({ phase: "cancelled" });
    await expect(cancelled.service.cancel(cancelled.job.id)).resolves.toMatchObject({ phase: "cancelled" });

    const completed = await startImporting();
    await completed.service.recordImportResult(completed.job.id, importResult({ artifactSha256: completed.artifactSha256 }));
    await expect(completed.service.cancel(completed.job.id)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  test("accepts the same import result twice but rejects a conflicting result", async () => {
    const f = await startImporting();
    const result = importResult({ artifactSha256: f.artifactSha256 });
    await expect(f.service.recordImportResult(f.job.id, result)).resolves.toEqual(result);
    await expect(f.service.recordImportResult(f.job.id, result)).resolves.toEqual(result);
    await expect(f.service.recordImportResult(f.job.id, { ...result, saved: false }))
      .rejects.toMatchObject({ code: "IMPORT_RESULT_CONFLICT" });
  });

  test.each([
    ["completed", ["media-1"], true, false],
    ["failed", ["media-2"], false, true],
    ["failed-empty", [], false, false],
  ] as const)("marks only exact referenced IDs for %s results", async (_label, ids, media1, media2) => {
    const f = await startImporting();
    const result = importResult({
      status: _label === "completed" ? "completed" : "failed",
      saved: _label === "completed",
      referencedMediaIds: [...ids],
      artifactSha256: f.artifactSha256,
      failure: _label === "completed" ? undefined : { code: "EXPORT_FAILED", message: "failed" },
    });
    await f.service.recordImportResult(f.job.id, result);
    const project = JSON.parse(await readFile(join(f.projectDir, "project.json"), "utf8")) as Project;
    expect(project.mediaLibrary.items.find((item) => item.id === "media-1")?.externallyReferenced).toBe(media1 || undefined);
    expect(project.mediaLibrary.items.find((item) => item.id === "media-2")?.externallyReferenced).toBe(media2 || undefined);
  });

  test("rolls project and result bytes back when the exact Git transaction fails", async () => {
    const f = await startImporting(await fixture({ commitFailsAfter: 2 }));
    const before = await readFile(join(f.projectDir, "project.json"), "utf8");
    await expect(f.service.recordImportResult(
      f.job.id,
      importResult({ artifactSha256: f.artifactSha256 }),
    )).rejects.toMatchObject({ code: "IMPORT_RESULT_PERSIST_FAILED" });
    expect(await readFile(join(f.projectDir, "project.json"), "utf8")).toBe(before);
    await expect(stat(join(f.projectDir, "exports", "resolve", f.job.id, "result.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rolls project bytes back when result persistence fails before Git commit", async () => {
    const f = await startImporting(await fixture({ resultWriteFails: true }));
    const before = await readFile(join(f.projectDir, "project.json"), "utf8");
    await expect(f.service.recordImportResult(
      f.job.id,
      importResult({ artifactSha256: f.artifactSha256 }),
    )).rejects.toMatchObject({ code: "IMPORT_RESULT_PERSIST_FAILED" });
    expect(await readFile(join(f.projectDir, "project.json"), "utf8")).toBe(before);
  });

  test("rejects a result before the launch token is redeemed", async () => {
    const f = await startReady();
    await expect(f.service.recordImportResult(
      f.job.id,
      importResult({ artifactSha256: f.artifactSha256 }),
    )).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  test("never revives a cancelled job by redemption or result", async () => {
    const f = await startReady();
    await f.service.cancel(f.job.id);
    await expect(f.service.redeem(f.token))
      .rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
    await expect(f.service.recordImportResult(
      f.job.id,
      importResult({ artifactSha256: f.artifactSha256 }),
    )).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  test("rejects cancellation after import begins", async () => {
    const f = await startImporting();
    await expect(f.service.cancel(f.job.id))
      .rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  test.each([
    ["confirmed-ref receipt failure", async (f: ServiceFixture) => {
      f.git.readConfirmedReceiptStrict.mockRejectedValueOnce(
        new Error("sensitive-token receipt failure at /private/secret"),
      );
    }],
    ["committed-file read failure", async (f: ServiceFixture) => {
      f.git.readFileAtCommitStrict.mockRejectedValueOnce(
        new Error("sensitive-token git show failure at /private/secret"),
      );
    }],
    ["invalid current ref SHA", async (f: ServiceFixture) => {
      const receipt = await f.git.readConfirmedReceipt();
      f.git.readConfirmedReceiptStrict.mockResolvedValueOnce({
        status: "present",
        value: { ...receipt, commitSha: "invalid-sha" },
      });
    }],
    ["ancestry read failure", async (f: ServiceFixture) => {
      f.git.isCommitAncestor.mockRejectedValueOnce(
        new Error("sensitive-token merge-base failure at /private/secret"),
      );
    }],
    ["conflicting descendant", async (f: ServiceFixture) => {
      f.advanceConflictingHead(jobPath("job.json"), "conflicting descendant bytes");
    }],
  ] as const)("fails closed without mutation on %s", async (_label, inject) => {
    const f = await fixture({ crashAt: "after-ref-update" });
    await expect(f.service.start("vintage-tokyo", CONFIRMED_REVISION, selection))
      .rejects.toMatchObject({ point: "after-ref-update" });
    f.setCrashAt(null);
    await inject(f);
    const before = await pendingRecoveryState(f);

    await expectSanitizedRecoveryFailure(f.newService());
    await expectRecoveryStateUnchanged(f, before);
  });

  test("fails closed without mutation when a pending journal image is corrupt", async () => {
    const f = await fixture({ crashAt: "after-ref-update" });
    await expect(f.service.start("vintage-tokyo", CONFIRMED_REVISION, selection))
      .rejects.toMatchObject({ point: "after-ref-update" });
    f.setCrashAt(null);
    const pending = await pendingRecoveryState(f);
    const raw = JSON.parse(pending.journalBytes) as {
      writes: Array<{ path: string; afterBase64: string }>;
    };
    const jobWrite = raw.writes.find((write) => write.path === jobPath("job.json"));
    if (!jobWrite) throw new Error("pending job write is missing");
    jobWrite.afterBase64 = Buffer.from("tampered job bytes").toString("base64");
    await writeFile(pending.journalPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const before = await pendingRecoveryState(f);

    await expectSanitizedRecoveryFailure(f.newService());
    await expectRecoveryStateUnchanged(f, before);
  });

  test.each([
    `after-publish:${jobPath("Vintage Tokyo.fcpxml")}`,
    `after-publish:${jobPath("manifest.json")}`,
    `after-publish:${jobPath("compatibility-report.md")}`,
    `after-publish:${jobPath("job.json")}`,
    "after-git-stage",
    "after-git-tree",
    "before-ref-update",
    "after-ref-update",
  ] satisfies readonly ResolveTransactionPoint[])("recovers a start crash at %s", async (point) => {
    const f = await fixture({ crashAt: point });
    await expect(f.service.start("vintage-tokyo", CONFIRMED_REVISION, selection))
      .rejects.toMatchObject({ point });
    f.setCrashAt(null);

    const recovered = f.newService();
    const expectedAction = point === "after-ref-update" ? "rolled-forward" : "rolled-back";
    await expect(recovered.recoveryDiagnostics()).resolves.toEqual([
      expect.objectContaining({
        projectId: "vintage-tokyo",
        jobId: FIXED_JOB_ID,
        action: expectedAction,
      }),
    ]);
    if (expectedAction === "rolled-forward") {
      await expect(recovered.status(FIXED_JOB_ID)).resolves.toMatchObject({ phase: "ready" });
    } else {
      await expect(recovered.status(FIXED_JOB_ID)).rejects.toMatchObject({ code: "RESOLVE_JOB_NOT_FOUND" });
    }

    const idempotent = f.newService();
    await expect(idempotent.recoveryDiagnostics()).resolves.toEqual([]);
    if (expectedAction === "rolled-forward") {
      await expect(idempotent.status(FIXED_JOB_ID)).resolves.toMatchObject({ phase: "ready" });
    } else {
      await expect(idempotent.status(FIXED_JOB_ID)).rejects.toMatchObject({ code: "RESOLVE_JOB_NOT_FOUND" });
    }
  });

  test.each([
    ...JOB_TRANSITION_CRASH_POINTS.map((point) => ["cancel", point] as const),
    ...JOB_TRANSITION_CRASH_POINTS.map((point) => ["redeem", point] as const),
  ])("recovers a %s crash at %s", async (operation, point) => {
    const f = await startReady();
    f.setCrashAt(point);
    const mutation = operation === "cancel"
      ? f.service.cancel(FIXED_JOB_ID)
      : f.service.redeem(f.token);
    await expect(mutation).rejects.toMatchObject({ point });
    f.setCrashAt(null);

    const recovered = f.newService();
    const rolledForward = point === "after-ref-update";
    await expect(recovered.recoveryDiagnostics()).resolves.toEqual([
      expect.objectContaining({
        projectId: "vintage-tokyo",
        jobId: FIXED_JOB_ID,
        action: rolledForward ? "rolled-forward" : "rolled-back",
      }),
    ]);
    const expectedPhase = rolledForward
      ? operation === "cancel" ? "cancelled" : "importing"
      : "ready";
    await expect(recovered.status(FIXED_JOB_ID)).resolves.toMatchObject({ phase: expectedPhase });
    const record = JSON.parse(await readFile(
      join(f.projectDir, jobPath("job.json")),
      "utf8",
    )) as { launchToken: { redeemedAt: string | null } };
    if (operation === "redeem") {
      expect(Boolean(record.launchToken.redeemedAt)).toBe(rolledForward);
    }

    await expect(f.newService().recoveryDiagnostics()).resolves.toEqual([]);
  });

  test.each(IMPORT_RESULT_CRASH_POINTS)("recovers an import-result crash at %s", async (point) => {
    const f = await startImporting();
    f.setCrashAt(point);
    await expect(f.service.recordImportResult(
      FIXED_JOB_ID,
      importResult({ artifactSha256: f.artifactSha256 }),
    )).rejects.toMatchObject({ point });
    f.setCrashAt(null);

    const recovered = f.newService();
    const rolledForward = point === "after-ref-update";
    await expect(recovered.recoveryDiagnostics()).resolves.toEqual([
      expect.objectContaining({
        projectId: "vintage-tokyo",
        jobId: FIXED_JOB_ID,
        action: rolledForward ? "rolled-forward" : "rolled-back",
      }),
    ]);
    await expect(recovered.status(FIXED_JOB_ID)).resolves.toMatchObject({
      phase: rolledForward ? "completed" : "importing",
    });
    const project = JSON.parse(await readFile(join(f.projectDir, "project.json"), "utf8")) as Project;
    expect(project.mediaLibrary.items.find((item) => item.id === "media-1")?.externallyReferenced)
      .toBe(rolledForward ? true : undefined);
    if (rolledForward) {
      await expect(stat(join(f.projectDir, jobPath("result.json")))).resolves.toBeDefined();
    } else {
      await expect(stat(join(f.projectDir, jobPath("result.json"))))
        .rejects.toMatchObject({ code: "ENOENT" });
    }

    await expect(f.newService().recoveryDiagnostics()).resolves.toEqual([]);
  });

  test("serializes a cancel/redeem race to one legal ready transition", async () => {
    const f = await startReady();
    const outcomes = await Promise.allSettled([
      f.service.cancel(f.job.id),
      f.service.redeem(f.token),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) =>
      outcome.status === "rejected" && outcome.reason?.code === "INVALID_JOB_TRANSITION"))
      .toHaveLength(1);
    expect(["cancelled", "importing"]).toContain((await f.service.status(f.job.id)).phase);
  });

  test("serves only hash-matching artifact bytes for the redeemed job capability", async () => {
    const f = await startReady();
    const payload = await f.service.redeem(f.token);
    const artifact = payload.artifacts.find((candidate) => candidate.path.endsWith(".fcpxml"))!;
    const name = artifact.path.split("/").at(-1)!;

    const delivered = await f.service.readArtifact(
      payload.projectId,
      payload.jobId,
      name,
      payload.artifactAccessToken,
    );

    expect(delivered.mediaType).toBe(artifact.mediaType);
    expect(delivered.bytes).toHaveLength(artifact.byteLength);
    expect(createHash("sha256").update(delivered.bytes).digest("hex")).toBe(artifact.sha256);
    await expect(f.service.readArtifact(
      payload.projectId,
      payload.jobId,
      name,
      "wrong-capability",
    )).rejects.toMatchObject({ code: "ARTIFACT_CAPABILITY_EXPIRED" });
    await expect(f.service.readArtifact(
      "another-project",
      payload.jobId,
      name,
      payload.artifactAccessToken,
    )).rejects.toMatchObject({ code: "ARTIFACT_CAPABILITY_EXPIRED" });
    await expect(f.service.readArtifact(
      payload.projectId,
      "resolve-job-other",
      name,
      payload.artifactAccessToken,
    )).rejects.toMatchObject({ code: "ARTIFACT_CAPABILITY_EXPIRED" });
  });

  test("rejects traversal artifact metadata with a sanitized integrity error", async () => {
    const f = await startReady();
    const payload = await f.service.redeem(f.token);
    const jobFile = join(f.projectDir, jobPath("job.json"));
    const record = JSON.parse(await readFile(jobFile, "utf8")) as {
      artifacts: Array<{ path: string }>;
    };
    record.artifacts[0]!.path = `exports/resolve/${FIXED_JOB_ID}/../project.json`;
    await writeFile(jobFile, `${JSON.stringify(record, null, 2)}\n`);

    await expect(f.service.readArtifact(
      payload.projectId,
      payload.jobId,
      "job.json",
      payload.artifactAccessToken,
    )).rejects.toMatchObject({
      code: "ARTIFACT_INTEGRITY_FAILED",
      message: "Resolve artifact failed integrity verification",
      projectId: payload.projectId,
      jobId: payload.jobId,
    });
  });

  test("rejects symlink artifact targets and symlink job-directory components", async () => {
    const targetFixture = await startReady();
    const targetPayload = await targetFixture.service.redeem(targetFixture.token);
    const artifact = targetPayload.artifacts.find((candidate) => candidate.path.endsWith(".fcpxml"))!;
    const name = artifact.path.split("/").at(-1)!;
    const target = join(targetFixture.projectDir, artifact.path);
    const outside = join(targetFixture.root, "outside.fcpxml");
    await writeFile(outside, "outside");
    await rm(target);
    await symlink(outside, target);
    await expect(targetFixture.service.readArtifact(
      targetPayload.projectId,
      targetPayload.jobId,
      name,
      targetPayload.artifactAccessToken,
    )).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });

    const componentFixture = await startReady();
    const componentPayload = await componentFixture.service.redeem(componentFixture.token);
    const jobDirectory = join(componentFixture.projectDir, "exports", "resolve", componentPayload.jobId);
    const movedDirectory = join(componentFixture.root, "moved-job");
    await rename(jobDirectory, movedDirectory);
    await symlink(movedDirectory, jobDirectory);
    await expect(componentFixture.service.readArtifact(
      componentPayload.projectId,
      componentPayload.jobId,
      componentPayload.artifacts[0]!.path.split("/").at(-1)!,
      componentPayload.artifactAccessToken,
    )).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
  });

  test("rejects post-export artifact length and hash replacement", async () => {
    const lengthFixture = await startReady();
    const lengthPayload = await lengthFixture.service.redeem(lengthFixture.token);
    const lengthArtifact = lengthPayload.artifacts.find((candidate) => candidate.path.endsWith(".fcpxml"))!;
    await writeFile(join(lengthFixture.projectDir, lengthArtifact.path), "short");
    await expect(lengthFixture.service.readArtifact(
      lengthPayload.projectId,
      lengthPayload.jobId,
      lengthArtifact.path.split("/").at(-1)!,
      lengthPayload.artifactAccessToken,
    )).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });

    const hashFixture = await startReady();
    const hashPayload = await hashFixture.service.redeem(hashFixture.token);
    const hashArtifact = hashPayload.artifacts.find((candidate) => candidate.path.endsWith(".fcpxml"))!;
    await writeFile(join(hashFixture.projectDir, hashArtifact.path), Buffer.alloc(hashArtifact.byteLength, 0x78));
    await expect(hashFixture.service.readArtifact(
      hashPayload.projectId,
      hashPayload.jobId,
      hashArtifact.path.split("/").at(-1)!,
      hashPayload.artifactAccessToken,
    )).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
  });

  test("expires capabilities and replaces the prior capability for the same job", async () => {
    const f = await startReady();
    const first = await f.service.redeem(f.token);
    const artifact = first.artifacts[0]!;
    const name = artifact.path.split("/").at(-1)!;
    f.setNow(Date.parse("2026-07-22T00:05:00.000Z"));
    await expect(f.service.readArtifact(first.projectId, first.jobId, name, first.artifactAccessToken))
      .rejects.toMatchObject({ code: "ARTIFACT_CAPABILITY_EXPIRED" });

    await f.jobs.update(first.projectId, first.jobId, (record) => ({
      ...record,
      job: { ...record.job, phase: "ready" },
      launchToken: { ...record.launchToken, redeemedAt: null },
    }));
    f.setNow(Date.parse("2026-07-22T00:04:59.000Z"));
    const replacement = await f.service.redeem(f.token);
    await expect(f.service.readArtifact(first.projectId, first.jobId, name, first.artifactAccessToken))
      .rejects.toMatchObject({ code: "ARTIFACT_CAPABILITY_EXPIRED" });
    await expect(f.service.readArtifact(first.projectId, first.jobId, name, replacement.artifactAccessToken))
      .resolves.toMatchObject({ mediaType: artifact.mediaType });
  });
});
