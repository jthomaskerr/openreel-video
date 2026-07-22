import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HandoffSelection, Project, ResolveImportResult } from "@openreel/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GitCommitTransaction, GitProjectTransaction } from "../projects/git-store";
import type { ProjectMediaManifestSnapshot } from "../projects/media-manifest";
import { ResolveExportJobStore } from "./job-store";
import {
  ResolveExportService,
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

const FIXED_JOB_ID = "11111111-1111-4111-8111-111111111111";

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
    requestId: "33333333-3333-4333-8333-333333333333",
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
    ["confirmed-revision", new Map([["project.json", confirmedProjectBytes.toString("utf8")]])],
  ]);
  let head = "confirmed-revision";
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
    const nextSha = `commit-${commitCount}`;
    const nextSnapshot = new Map(snapshots.get(head));
    for (const path of transaction.allowlist) {
      nextSnapshot.set(path, await readFile(join(projectDir, path), "utf8"));
    }
    snapshots.set(nextSha, nextSnapshot);
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
  const git = {
    readConfirmedReceipt: vi.fn(async () => {
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
    }),
    getProjectAtCommit: vi.fn(async (_projectId: string, sha: string) => {
      const bytes = snapshots.get(sha)?.get("project.json");
      return bytes ? JSON.parse(bytes) as Project : null;
    }),
    readFileAtCommit: vi.fn(async (_projectId: string, sha: string, path: string) =>
      snapshots.get(sha)?.get(path) ?? null),
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
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  let now = Date.parse("2026-07-22T00:00:00.000Z");
  let crashAt: ResolveTransactionPoint | null = options.crashAt ?? null;
  const createService = (serviceJobs = createJobs()) => new ResolveExportService({
    projects,
    git,
    jobs: serviceJobs,
    now: () => now,
    randomUUID: () => uuids.shift() ?? "44444444-4444-4444-8444-444444444444",
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
    service,
    newService: () => createService(),
    setCrashAt: (point: ResolveTransactionPoint | null) => { crashAt = point; },
    setNow: (value: number) => { now = value; },
  };
}

async function startReady(input?: Awaited<ReturnType<typeof fixture>>) {
  const f = input ?? await fixture();
  const job = await f.service.start("vintage-tokyo", "confirmed-revision", selection);
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

describe("ResolveExportService", () => {
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

    await expect(f.service.start("vintage-tokyo", "confirmed-revision", selection))
      .rejects.toMatchObject({ code: "WORKTREE_REVISION_MISMATCH", projectId: "vintage-tokyo" });
  });

  test("rejects incomplete required media with stable identifiers", async () => {
    const f = await fixture({ complete: false });
    await expect(f.service.start("vintage-tokyo", "confirmed-revision", selection))
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
    await expect(f.service.start("vintage-tokyo", "confirmed-revision", selection))
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
});
