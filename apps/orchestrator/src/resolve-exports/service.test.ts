import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HandoffSelection, Project, ResolveImportResult } from "@openreel/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GitCommitTransaction, GitProjectTransaction } from "../projects/git-store";
import type { ProjectMediaManifestSnapshot } from "../projects/media-manifest";
import { ResolveExportJobStore } from "./job-store";
import { ResolveExportService } from "./service";

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
}

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "openreel-resolve-service-"));
  roots.push(root);
  const projectDir = join(root, "vintage-tokyo");
  await mkdir(join(projectDir, "media"), { recursive: true });
  await writeFile(join(projectDir, "project.json"), JSON.stringify(projectFixture(), null, 2));
  await writeFile(join(projectDir, "media", "street.mov"), "canonical-media");
  const commits: Array<{ message: string; transaction: GitCommitTransaction }> = [];
  let commitCount = 0;
  const commit = vi.fn(async (message: string, transaction: GitCommitTransaction) => {
    commits.push({ message, transaction });
    commitCount += 1;
    if (options.commitFails || (options.commitFailsAfter !== undefined && commitCount > options.commitFailsAfter)) {
      throw new Error("git failed");
    }
    return { commitSha: "next", treeSha: "tree", projectBlobSha: "blob", mediaManifestDigest: "manifest-digest" };
  });
  const gitTransaction: GitProjectTransaction = {
    commit,
    stage: vi.fn(async () => undefined),
    unstage: vi.fn(async () => undefined),
  };
  const git = {
    readConfirmedReceipt: vi.fn(async () => ({
      commitSha: "confirmed-revision",
      treeSha: "tree",
      projectBlobSha: "blob",
      mediaManifestDigest: "manifest-digest",
    })),
    commit: vi.fn(async (_projectId: string, message: string, transaction: GitCommitTransaction) =>
      commit(message, transaction)),
    withProjectTransaction: async <T>(
      _projectId: string,
      operation: (transaction: GitProjectTransaction) => Promise<T>,
    ): Promise<T> => operation(gitTransaction),
  };
  const projects = {
    projectDir: (projectId: string) => join(root, projectId),
    loadProject: vi.fn(async (projectId: string) =>
      JSON.parse(await readFile(join(root, projectId, "project.json"), "utf8")) as Project),
    auditSnapshot: vi.fn(async () => audit(options.complete ?? true)),
    listProjects: vi.fn(async () => [{ id: "vintage-tokyo" }]),
  };
  const jobs = new ResolveExportJobStore({
    projectDir: projects.projectDir,
    listProjectIds: async () => ["vintage-tokyo"],
    beforeWrite: options.resultWriteFails
      ? (path) => {
        if (path.endsWith("result.json")) throw new Error("result write failed");
      }
      : undefined,
  });
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  let now = Date.parse("2026-07-22T00:00:00.000Z");
  const service = new ResolveExportService({
    projects,
    git,
    jobs,
    now: () => now,
    randomUUID: () => uuids.shift() ?? "44444444-4444-4444-8444-444444444444",
  });
  return { root, projectDir, projects, git, gitTransaction, commits, service, setNow: (value: number) => { now = value; } };
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

describe("ResolveExportService", () => {
  test("locks the requested confirmed revision and rejects a stale revision before artifact writes", async () => {
    const f = await fixture();
    await expect(f.service.start("vintage-tokyo", "stale", selection))
      .rejects.toMatchObject({ code: "STALE_PROJECT_REVISION", projectId: "vintage-tokyo" });
    await expect(stat(join(f.projectDir, "exports"))).rejects.toMatchObject({ code: "ENOENT" });
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

    const completed = await startReady();
    await completed.service.recordImportResult(completed.job.id, importResult({ artifactSha256: completed.artifactSha256 }));
    await expect(completed.service.cancel(completed.job.id)).rejects.toMatchObject({ code: "JOB_TERMINAL" });
  });

  test("accepts the same import result twice but rejects a conflicting result", async () => {
    const f = await startReady();
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
    const f = await startReady();
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
    const f = await startReady(await fixture({ commitFailsAfter: 1 }));
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
    const f = await startReady(await fixture({ resultWriteFails: true }));
    const before = await readFile(join(f.projectDir, "project.json"), "utf8");
    await expect(f.service.recordImportResult(
      f.job.id,
      importResult({ artifactSha256: f.artifactSha256 }),
    )).rejects.toMatchObject({ code: "IMPORT_RESULT_PERSIST_FAILED" });
    expect(await readFile(join(f.projectDir, "project.json"), "utf8")).toBe(before);
  });
});
