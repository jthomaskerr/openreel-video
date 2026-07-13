import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { Project } from "@openreel/core";
import { createProjectRouter } from "./routes";
import type { GitStore } from "./git-store";
import type { ProjectStore } from "./project-store";

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

  const server = app.listen(0);
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
    commit: async (projectId: string) => {
      committedProjectIds.push(projectId);
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
    commit: async () => {
      commitCalls += 1;
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
  const project = projectFixture("vintage-tokyo", "Vintage Tokyo");
  let commitFinished = false;
  const store: Partial<ProjectStore> = {
    loadProject: async () => project,
    saveProject: async (incoming: Project) => incoming,
  };
  const gitStore: Partial<GitStore> = {
    commit: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      commitFinished = true;
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/vintage-tokyo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
    const receipt = await response.json();

    assert.equal(response.status, 200);
    assert.equal(commitFinished, true);
    assert.deepEqual(
      { saved: receipt.saved, projectId: receipt.projectId },
      { saved: true, projectId: "vintage-tokyo" },
    );
    assert.equal(typeof receipt.persistedAt, "number");
  });
});

test("PUT exposes Git commit failures instead of returning a false success", async () => {
  const project = projectFixture("vintage-tokyo", "Vintage Tokyo");
  const store: Partial<ProjectStore> = {
    loadProject: async () => project,
    saveProject: async (incoming: Project) => incoming,
  };
  const gitStore: Partial<GitStore> = {
    commit: async () => {
      throw new Error("git index is locked");
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/vintage-tokyo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.match(body.detail, /git index is locked/);
  });
});
