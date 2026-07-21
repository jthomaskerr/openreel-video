import "../../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { useGenerationDraftStore } from "./ui-store";

const scope = { kind: "new-asset" as const, projectId: "project-1", draftId: "clip-1" };

describe("generation draft recovery persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useGenerationDraftStore.setState({ drafts: {}, referenceRecoveries: {} });
  });

  it("persists recovery disposition but strips upload leases and source transport values", () => {
    useGenerationDraftStore.getState().saveReferenceRecovery(scope, {
      projectId: "project-1",
      jobId: "job-1",
      references: [{
        id: "reference-1",
        order: 1,
        mediaId: "media-1",
        origins: ["user"],
        active: true,
        state: "active",
        preparationStatus: "ready",
        errorHistory: [],
        uploadLeaseId: "upload-secret-1",
      }],
      drafts: [{
        id: "reference-1",
        mediaId: "media-1",
        origins: ["user"],
        value: { url: "https://signed.example/file?token=secret", path: "/Users/operator/file.png" },
      }],
      providerReferences: [{
        id: "reference-1",
        order: 1,
        mediaId: "media-1",
        origins: ["user"],
        active: true,
        state: "active",
        preparationStatus: "ready",
        errorHistory: [],
        uploadLeaseId: "upload-secret-1",
      }],
    });

    const persisted = localStorage.getItem("openreel-generation-drafts-v2") ?? "";
    expect(persisted).toContain("reference-1");
    expect(persisted).not.toMatch(/upload-secret|signed\.example|token=secret|operator/);
  });
});
