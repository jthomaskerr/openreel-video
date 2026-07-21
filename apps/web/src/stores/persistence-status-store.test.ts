import { beforeEach, describe, expect, it } from "vitest";
import type { Project, ProjectSaveReceipt } from "@openreel/core";
import {
  isProjectDirty,
  usePersistenceStatusStore,
} from "./persistence-status-store";

const project = (id: string, modifiedAt: number) => ({ id, modifiedAt }) as Project;

const receipt = (projectId: string, sourceModifiedAt: number): ProjectSaveReceipt => ({
  projectId,
  sourceModifiedAt,
  persistedAt: sourceModifiedAt + 1,
  committed: true,
  commitSha: "commit",
  treeSha: "tree",
  projectBlobSha: "blob",
  mediaManifest: [],
  lfsPayloads: [],
});

describe("isProjectDirty", () => {
  beforeEach(() => usePersistenceStatusStore.getState().reset());

  it("treats a freshly loaded project with a matching confirmed receipt as clean", () => {
    const active = project("project-a", 100);
    usePersistenceStatusStore.getState().confirmReceipt(active.id, receipt(active.id, 100));

    expect(isProjectDirty(active, usePersistenceStatusStore.getState())).toBe(false);
  });

  it.each([
    ["no confirmed receipt", project("project-a", 100)],
    ["a receipt for another project", project("project-b", 100)],
    ["a newer local timestamp", project("project-a", 101)],
  ])("treats %s as dirty", (_case, active) => {
    if (_case !== "no confirmed receipt") {
      usePersistenceStatusStore.getState().confirmReceipt("project-a", receipt("project-a", 100));
    }

    expect(isProjectDirty(active, usePersistenceStatusStore.getState())).toBe(true);
  });
});
