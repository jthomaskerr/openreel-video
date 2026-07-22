import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { HandoffSelection, ResolveExportJob } from "@openreel/core";
import {
  ResolveExportJobStore,
  type PersistedResolveExportJob,
} from "./job-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function job(): ResolveExportJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "vintage-tokyo",
    revision: "confirmed-revision",
    phase: "ready",
    processed: 1,
    total: 1,
    percent: 100,
    warnings: [],
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    bridgeLaunchUrl:
      "openreel-resolve://import/22222222-2222-4222-8222-222222222222",
  };
}

const selection: HandoffSelection = {
  projectId: "vintage-tokyo",
  projectModifiedAt: 2,
  target: "resolve",
  range: { startTime: 0, endTime: 2 },
};

function record(): PersistedResolveExportJob {
  return {
    version: 1,
    job: job(),
    selection,
    launchToken: {
      sha256: "a".repeat(64),
      expiresAt: "2026-07-22T00:05:00.000Z",
      redeemedAt: null,
    },
    artifacts: [
      {
        path: "exports/resolve/11111111-1111-4111-8111-111111111111/Vintage-Tokyo.fcpxml",
        mediaType: "application/xml",
        byteLength: 42,
        sha256: "b".repeat(64),
      },
    ],
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openreel-resolve-job-store-"));
  roots.push(root);
  const store = new ResolveExportJobStore({
    projectDir: (projectId) => join(root, projectId),
    listProjectIds: async () => ["vintage-tokyo"],
  });
  return { root, store };
}

describe("ResolveExportJobStore", () => {
  test("recovers a persisted job in a fresh store and leaves no temporary file", async () => {
    const { root, store } = await fixture();
    await store.save(record());

    const fresh = new ResolveExportJobStore({
      projectDir: (projectId) => join(root, projectId),
      listProjectIds: async () => ["vintage-tokyo"],
    });
    await expect(fresh.find(job().id)).resolves.toEqual({
      ...record(),
      job: { ...job(), bridgeLaunchUrl: undefined },
    });

    const directory = join(root, "vintage-tokyo", "exports", "resolve", job().id);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("persists only the launch token hash, never the bearer token or launch URL", async () => {
    const { root, store } = await fixture();
    const bearer = "22222222-2222-4222-8222-222222222222";
    await store.save(record());

    const bytes = await readFile(
      join(root, "vintage-tokyo", "exports", "resolve", job().id, "job.json"),
      "utf8",
    );
    expect(bytes).not.toContain(bearer);
    expect(bytes).not.toContain("openreel-resolve://");
    expect(bytes).toContain("a".repeat(64));
  });

  test("serializes concurrent updates without losing either transition", async () => {
    const { store } = await fixture();
    await store.save(record());

    const first = store.update("vintage-tokyo", job().id, async (current) => ({
      ...current,
      launchToken: { ...current.launchToken, redeemedAt: "2026-07-22T00:01:00.000Z" },
    }));
    const second = store.update("vintage-tokyo", job().id, async (current) => ({
      ...current,
      result: {
        requestId: "33333333-3333-4333-8333-333333333333",
        status: "failed",
        resolveVersion: "21.0.3",
        resolveBuild: "21.0.30007",
        projectName: "Vintage Tokyo",
        trackCounts: {},
        clipCounts: {},
        offlineMediaIds: [],
        referencedMediaIds: [],
        saved: false,
        artifactSha256: "b".repeat(64),
        failure: { code: "EXPORT_FAILED", message: "failed" },
      },
    }));

    await Promise.all([first, second]);
    const persisted = await store.load("vintage-tokyo", job().id);
    expect(persisted?.launchToken.redeemedAt).toBe("2026-07-22T00:01:00.000Z");
    expect(persisted?.result?.requestId).toBe("33333333-3333-4333-8333-333333333333");
  });

  test.each([
    ["project traversal", "../outside", job().id],
    ["job traversal", "vintage-tokyo", "../outside"],
    ["non-UUID job", "vintage-tokyo", "not-a-job"],
  ])("rejects %s before resolving a path", async (_label, projectId, jobId) => {
    const { store } = await fixture();
    await expect(store.load(projectId, jobId)).rejects.toMatchObject({ code: "INVALID_RESOLVE_JOB_PATH" });
  });

  test("rejects a persisted artifact path rebound to a different job", async () => {
    const { root, store } = await fixture();
    await store.save(record());
    const path = join(root, "vintage-tokyo", "exports", "resolve", job().id, "job.json");
    const persisted = JSON.parse(await readFile(path, "utf8")) as PersistedResolveExportJob;
    await writeFile(path, JSON.stringify({
      ...persisted,
      artifacts: persisted.artifacts.map((artifact) => ({
        ...artifact,
        path: `exports/resolve/99999999-9999-4999-8999-999999999999/${artifact.path.split("/").at(-1)}`,
      })),
    }));

    await expect(store.load("vintage-tokyo", job().id))
      .rejects.toMatchObject({ code: "RESOLVE_JOB_CORRUPT" });
  });

  test("rejects unknown persisted fields that could smuggle token material", async () => {
    const { root, store } = await fixture();
    await store.save(record());
    const path = join(root, "vintage-tokyo", "exports", "resolve", job().id, "job.json");
    const persisted = JSON.parse(await readFile(path, "utf8")) as PersistedResolveExportJob;
    await writeFile(path, JSON.stringify({ ...persisted, plaintextLaunchToken: "secret" }));

    await expect(store.load("vintage-tokyo", job().id))
      .rejects.toMatchObject({ code: "RESOLVE_JOB_CORRUPT" });
  });
});
