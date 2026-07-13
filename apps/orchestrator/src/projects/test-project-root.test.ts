import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../env";
import { ensureSafeTestProjectRoot } from "./test-project-root";

async function validateThenRun(
  fixtureRoot: string,
  assignedTempRoot: string,
  repositoryCommand: () => Promise<void>,
): Promise<void> {
  await ensureSafeTestProjectRoot(fixtureRoot, {
    assignedTempRoot,
    userProjectsRoot: config.projectsRepo,
  });
  await repositoryCommand();
}

test("rejects paths outside the assigned temp root before repository commands run", async () => {
  const assignedTempRoot = await mkdtemp(join(tmpdir(), "openreel-test-project-root-"));
  try {
    const repositoryCommandCalls: string[] = [];
    const repositoryCommand = async (path: string): Promise<void> => {
      repositoryCommandCalls.push(path);
    };

    for (const fixtureRoot of [
      join(homedir(), "openreel-projects"),
      config.projectsRepo,
      join(homedir(), "openreel-projects-outside-temp"),
    ]) {
      await assert.rejects(
        validateThenRun(fixtureRoot, assignedTempRoot, async () => repositoryCommand(fixtureRoot)),
        /temporary root|user projects root/,
      );
      assert.equal(repositoryCommandCalls.length, 0);
    }
  } finally {
    await rm(assignedTempRoot, { recursive: true, force: true });
  }
});

test("accepts a fixture root nested inside a fresh temporary directory", async () => {
  const assignedTempRoot = await mkdtemp(join(tmpdir(), "openreel-test-project-root-"));
  const fixtureRoot = await mkdtemp(join(assignedTempRoot, "repo-"));
  try {
    let repositoryCommandCalls = 0;

    await validateThenRun(fixtureRoot, assignedTempRoot, async () => {
      repositoryCommandCalls += 1;
    });

    assert.equal(repositoryCommandCalls, 1);
  } finally {
    await rm(assignedTempRoot, { recursive: true, force: true });
  }
});
