import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

const TRANSACTION_ID = "55555555-5555-4555-8555-555555555555";
const BASE_COMMIT_SHA = "c".repeat(40);

interface RawJournal extends Record<string, unknown> {
  writes: Array<Record<string, unknown>>;
  publishedPaths: string[];
}

function journalFile(root: string): string {
  return join(
    root,
    "vintage-tokyo",
    "exports",
    "resolve",
    job().id,
    ".transactions",
    `${TRANSACTION_ID}.json`,
  );
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jobPath(name: string): string {
  return `exports/resolve/${job().id}/${name}`;
}

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
  await mkdir(join(root, "vintage-tokyo"));
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

  test.each(["project", "job"] as const)("rejects a record rebound to another physical %s location", async (kind) => {
    const { root, store } = await fixture();
    await store.save(record());
    const path = join(root, "vintage-tokyo", "exports", "resolve", job().id, "job.json");
    const persisted = JSON.parse(await readFile(path, "utf8")) as PersistedResolveExportJob;
    const otherJobId = "99999999-9999-4999-8999-999999999999";
    const rebound = kind === "project"
      ? {
        ...persisted,
        job: { ...persisted.job, projectId: "other-project" },
        selection: { ...persisted.selection, projectId: "other-project" },
      }
      : {
        ...persisted,
        job: { ...persisted.job, id: otherJobId },
        artifacts: persisted.artifacts.map((artifact) => ({
          ...artifact,
          path: artifact.path.replace(job().id, otherJobId),
        })),
      };
    await writeFile(path, JSON.stringify(rebound));

    await expect(store.load("vintage-tokyo", job().id))
      .rejects.toMatchObject({ code: "RESOLVE_JOB_CORRUPT" });
  });

  test.each(["exports", "resolve", "job"] as const)("rejects a symlinked %s path component", async (component) => {
    const { root, store } = await fixture();
    const projectRoot = join(root, "vintage-tokyo");
    const outside = await mkdtemp(join(tmpdir(), "openreel-resolve-escape-"));
    roots.push(outside);
    await mkdir(projectRoot, { recursive: true });
    if (component === "exports") {
      await symlink(outside, join(projectRoot, "exports"));
    } else {
      await mkdir(join(projectRoot, "exports"), { recursive: true });
      if (component === "resolve") {
        await symlink(outside, join(projectRoot, "exports", "resolve"));
      } else {
        await mkdir(join(projectRoot, "exports", "resolve"), { recursive: true });
        await symlink(outside, join(projectRoot, "exports", "resolve", job().id));
      }
    }

    await expect(store.writeArtifact("vintage-tokyo", job().id, "escape.json", "secret"))
      .rejects.toMatchObject({ code: "INVALID_RESOLVE_JOB_PATH" });
    expect(await readdir(outside)).toEqual([]);
  });

  test("durably journals before-images and recovers an interrupted multi-file publish", async () => {
    const { root, store } = await fixture();
    const first = `exports/resolve/${job().id}/manifest.json`;
    const second = `exports/resolve/${job().id}/job.json`;
    const journal = await store.prepareTransaction({
      transactionId: TRANSACTION_ID,
      kind: "start",
      projectId: "vintage-tokyo",
      jobId: job().id,
      baseCommitSha: BASE_COMMIT_SHA,
      writes: [
        { path: first, bytes: Buffer.from("manifest") },
        { path: second, bytes: Buffer.from("job") },
      ],
    });

    await expect(store.publishTransaction(journal, (path) => {
      if (path === first) throw new Error("simulated process loss");
    })).rejects.toThrow("simulated process loss");

    const fresh = new ResolveExportJobStore({
      projectDir: (projectId) => join(root, projectId),
      listProjectIds: async () => ["vintage-tokyo"],
    });
    const [recovered] = await fresh.listTransactions();
    expect(recovered.publishedPaths).toEqual([first]);
    await fresh.restoreTransaction(recovered, "before");
    await fresh.completeTransaction(recovered);
    await expect(readFile(join(root, "vintage-tokyo", first))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "vintage-tokyo", second))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fresh.listTransactions()).toEqual([]);
  });

  test.each([
    ["tampered before image", (raw: RawJournal) => {
      raw.writes[0]!.beforeBase64 = Buffer.from("tampered-before").toString("base64");
    }],
    ["tampered after image", (raw: RawJournal) => {
      raw.writes[0]!.afterBase64 = Buffer.from("tampered-after").toString("base64");
    }],
    ["malformed write", (raw: RawJournal) => {
      delete raw.writes[0]!.afterSha256;
    }],
    ["duplicate write path", (raw: RawJournal) => {
      raw.writes.push({ ...raw.writes[0]! });
    }],
    ["published path outside writes", (raw: RawJournal) => {
      raw.publishedPaths = [jobPath("other.json")];
    }],
    ["noncanonical base64", (raw: RawJournal) => {
      raw.writes[0]!.afterBase64 = "YQ";
      raw.writes[0]!.afterSha256 = sha256("a");
    }],
    ["unknown exact-schema key", (raw: RawJournal) => {
      raw.untrusted = true;
    }],
    ["invalid transaction kind", (raw: RawJournal) => {
      raw.kind = "other";
    }],
    ["invalid prepared timestamp", (raw: RawJournal) => {
      raw.preparedAt = "not-a-timestamp";
    }],
    ["non-full base commit SHA", (raw: RawJournal) => {
      raw.baseCommitSha = "short";
    }],
    ["empty write set", (raw: RawJournal) => {
      raw.writes = [];
      raw.publishedPaths = [];
    }],
    ["physical job identity mismatch", (raw: RawJournal) => {
      raw.jobId = "99999999-9999-4999-8999-999999999999";
    }],
    ["physical transaction identity mismatch", (raw: RawJournal) => {
      raw.transactionId = "99999999-9999-4999-8999-999999999999";
    }],
  ] as const)("rejects a %s without replaying or deleting the journal", async (_label, mutate) => {
    const { root, store } = await fixture();
    const target = jobPath("job.json");
    await store.writeArtifact("vintage-tokyo", job().id, "job.json", "before");
    await store.prepareTransaction({
      transactionId: TRANSACTION_ID,
      kind: "redeem",
      projectId: "vintage-tokyo",
      jobId: job().id,
      baseCommitSha: BASE_COMMIT_SHA,
      writes: [{ path: target, bytes: Buffer.from("after") }],
    });
    const path = journalFile(root);
    const raw = JSON.parse(await readFile(path, "utf8")) as RawJournal;
    mutate(raw);
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const fresh = new ResolveExportJobStore({
      projectDir: (projectId) => join(root, projectId),
      listProjectIds: async () => ["vintage-tokyo"],
    });
    await expect(fresh.listTransactions()).rejects.toMatchObject({
      code: "RESOLVE_JOB_CORRUPT",
      identifiers: { projectId: "vintage-tokyo", jobId: job().id },
    });
    expect(await readFile(join(root, "vintage-tokyo", target), "utf8")).toBe("before");
    await expect(readFile(path, "utf8")).resolves.toContain("transactionId");
  });
});
