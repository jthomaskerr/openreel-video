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
    commitAsync: (projectId: string) => {
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

test("UUID PUT autosaves are accepted and written to the canonical slug project", async () => {
  const savedProjects: Project[] = [];
  const committedProjectIds: string[] = [];
  const store: Partial<ProjectStore> = {
    loadProject: async () => null,
    saveProject: async (project: Project) => {
      savedProjects.push(project);
      return { ...project, modifiedAt: 999 };
    },
  };
  const gitStore: Partial<GitStore> = {
    commitAsync: (projectId: string) => {
      committedProjectIds.push(projectId);
    },
  };

  await withProjectRouter(store, gitStore, async (baseUrl) => {
    const uuid = "14aec9eb-469f-4db6-9652-00dee0d243fc";
    const response = await fetch(`${baseUrl}/api/projects/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectFixture(uuid, "Vintage Tokyo")),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: true, projectId: "vintage-tokyo" });
    assert.equal(savedProjects.at(-1)?.id, "vintage-tokyo");
    assert.equal(committedProjectIds.at(-1), "vintage-tokyo");
  });
});
