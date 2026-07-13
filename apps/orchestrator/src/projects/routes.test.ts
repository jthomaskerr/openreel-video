import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Response } from "express";
import type { Project } from "@openreel/core";
import { createProjectRouter, handleMediaSendError } from "./routes";
import type { GitCommitReceipt, GitStore } from "./git-store";
import type { ProjectStore } from "./project-store";
import type { ProjectMediaManifestSnapshot } from "./media-manifest";

const verifiedLfsPayload = {
  mediaId: "media-1",
  semanticFilename: "Interview.mp4",
  relativePhysicalPath: "media/media-1.mp4",
  oid: `sha256:${"a".repeat(64)}` as const,
  pointerSize: 42,
  local: { state: "verified" as const, actualSize: 42 },
  remote: { state: "local-only" as const, remote: null },
};

function auditReceipt(): ProjectMediaManifestSnapshot {
  return {
    mediaManifestDigest: "sha256:manifest-digest",
    requiredMediaManifest: [],
    lfsPayloads: [verifiedLfsPayload],
    missingEntries: [],
    duplicateIssues: [],
    filenameMismatches: [],
    byteSizeMismatches: [],
    danglingClips: [],
  };
}

function projectFixture(id: string, name: string): Project {
  return {
    id,
    name,
    createdAt: 1,
    modifiedAt: 2,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  };
}

function commitReceipt(overrides: Partial<GitCommitReceipt> = {}): GitCommitReceipt {
  return {
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    treeSha: "89abcdef0123456789abcdef0123456789abcdef",
    projectBlobSha: "fedcba9876543210fedcba9876543210fedcba98",
    mediaManifestDigest: "sha256:manifest-digest",
    ...overrides,
  };
}

test("media send errors do not write a second response after headers are sent", () => {
  let statusCalls = 0;
  let jsonCalls = 0;
  const response = {
    headersSent: true,
    status: () => {
      statusCalls += 1;
      return response;
    },
    json: () => {
      jsonCalls += 1;
      return response;
    },
  } as unknown as Response;

  handleMediaSendError(response, new Error("request aborted"));

  assert.equal(statusCalls, 0);
  assert.equal(jsonCalls, 0);
});

test("media send errors return 404 before headers are sent", () => {
  let statusCode: number | undefined;
  let body: unknown;
  const response = {
    headersSent: false,
    status: (code: number) => {
      statusCode = code;
      return response;
    },
    json: (value: unknown) => {
      body = value;
      return response;
    },
  } as unknown as Response;

  handleMediaSendError(response, new Error("missing file"));

  assert.equal(statusCode, 404);
  assert.deepEqual(body, { error: "Media file not found" });
});

async function withProjectRouter(
  store: Partial<ProjectStore>,
  gitStore: Partial<GitStore>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/projects",
    createProjectRouter(store as unknown as ProjectStore, gitStore as unknown as GitStore),
  );

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("project import canonicalizes client UUID ids to slug worktree ids", async () => {
  const savedProjects: Project[] = [];
  const committedProjectIds: string[] = [];
  const store: Partial<ProjectStore> = {
    saveProject: async (project: Project) => {
      savedProjects.push(project);
      return { ...project, modifiedAt: 999 };
    },
  };
  const gitStore: Partial<GitStore> = {
    commit: async (projectId: string, _message: string, _transaction?: unknown) => {
      committedProjectIds.push(projectId);
      return commitReceipt();
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectFixture("14aec9eb-469f-4db6-9652-00dee0d243fc", "Vintage Tokyo")),
    });

    assert.equal(response.status, 201);
    const imported = (await response.json()) as Project;
    assert.equal(imported.id, "vintage-tokyo");
    assert.equal(savedProjects.at(-1)?.id, "vintage-tokyo");
    assert.equal(committedProjectIds.at(-1), "vintage-tokyo");
  });
});

test("UUID PUT autosaves are rejected before any project worktree is touched", async () => {
  let saveCalls = 0;
  let commitCalls = 0;
  const store: Partial<ProjectStore> = {
    loadProject: async () => {
      throw new Error("loadProject should not be called for UUID project ids");
    },
    saveProject: async (project: Project) => {
      saveCalls += 1;
      return project;
    },
  };
  const gitStore: Partial<GitStore> = {
    commit: async (_projectId: string, _message: string, _transaction?: unknown) => {
      commitCalls += 1;
      return commitReceipt();
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const uuid = "14aec9eb-469f-4db6-9652-00dee0d243fc";
    const response = await fetch(`${baseUrl}/api/projects/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectFixture(uuid, "Vintage Tokyo")),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /UUID project ids are not allowed/);
    assert.equal(saveCalls, 0);
    assert.equal(commitCalls, 0);
  });
});

test("PUT confirms persistence only after the Git commit succeeds", async () => {
  const previous = projectFixture("vintage-tokyo", "Vintage Tokyo");
  const project = { ...previous, name: "Vintage Tokyo Revised", modifiedAt: previous.modifiedAt + 1 };
  let commitFinished = false;
  let commitMessage = "";
  const expectedReceipt = commitReceipt({
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    treeSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    projectBlobSha: "cccccccccccccccccccccccccccccccccccccccc",
    mediaManifestDigest: "sha256:semantic-diff",
  });
  const store: Partial<ProjectStore> = {
    loadProject: async () => previous,
    saveProject: async (incoming: Project) => incoming,
    auditSnapshot: async () => auditReceipt(),
  };
  const gitStore: Partial<GitStore> = {
    commit: async (_projectId: string, message: string, _transaction?: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      commitMessage = message;
      commitFinished = true;
      return expectedReceipt;
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/vintage-tokyo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
    const responseReceipt = await response.json();

    assert.equal(response.status, 200);
    assert.equal(commitFinished, true);
    assert.equal(responseReceipt.committed, true);
    assert.equal(responseReceipt.commitSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(responseReceipt.treeSha, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert.equal(responseReceipt.projectBlobSha, "cccccccccccccccccccccccccccccccccccccccc");
    assert.equal(responseReceipt.mediaManifestDigest, "sha256:semantic-diff");
    assert.deepEqual(responseReceipt.lfsPayloads, [verifiedLfsPayload]);
    assert.match(
      commitMessage,
      /^update name\n\n- Update name\n\nFiles staged:\n- Update project\.json\n\nFiles changed: 1$/,
    );
    assert.equal(typeof responseReceipt.persistedAt, "number");
  });
});


test("PUT writes modifiedAt-only changes without creating a Git commit", async () => {
  const previous = projectFixture("vintage-tokyo", "Vintage Tokyo");
  const incoming = { ...previous, modifiedAt: previous.modifiedAt + 1 };
  let commits = 0;
  const deferredReceipt = commitReceipt({
    commitSha: "dddddddddddddddddddddddddddddddddddddddd",
    treeSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    projectBlobSha: "ffffffffffffffffffffffffffffffffffffffff",
    mediaManifestDigest: "sha256:confirmed-diff",
  });
  const store: Partial<ProjectStore> = {
    loadProject: async () => previous,
    saveProject: async (project: Project) => project,
    auditSnapshot: async () => auditReceipt(),
  };
  const gitStore: Partial<GitStore> = {
    commit: async (_projectId: string, _message: string, _transaction?: unknown) => {
      commits += 1;
      return deferredReceipt;
    },
    readConfirmedReceipt: async () => deferredReceipt,
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/vintage-tokyo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(incoming),
    });
    const receipt = await response.json();

    assert.equal(response.status, 200);
    assert.equal(commits, 0);
    assert.equal(receipt.saved, true);
    assert.equal(receipt.committed, false);
    assert.equal(receipt.commitSha, "dddddddddddddddddddddddddddddddddddddddd");
    assert.equal(receipt.treeSha, "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    assert.equal(receipt.projectBlobSha, "ffffffffffffffffffffffffffffffffffffffff");
    assert.equal(receipt.mediaManifestDigest, "sha256:confirmed-diff");
    assert.deepEqual(receipt.lfsPayloads, [verifiedLfsPayload]);
    assert.equal(receipt.persistedAt, null);
    assert.equal(receipt.sourceModifiedAt, incoming.modifiedAt);
  });
});

test("PUT exposes Git commit failures instead of returning a false success", async () => {
  const previous = projectFixture("vintage-tokyo", "Vintage Tokyo");
  const project = { ...previous, name: "Vintage Tokyo Revised", modifiedAt: previous.modifiedAt + 1 };
  const store: Partial<ProjectStore> = {
    loadProject: async () => previous,
    saveProject: async (incoming: Project) => incoming,
  };
  const gitStore: Partial<GitStore> = {
    commit: async (_projectId: string, _message: string, _transaction?: unknown) => {
      throw new Error("git index is locked");
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/vintage-tokyo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
    const responseBody = await response.json();

    assert.equal(response.status, 500);
    assert.match(responseBody.detail, /git index is locked/);
  });
});
