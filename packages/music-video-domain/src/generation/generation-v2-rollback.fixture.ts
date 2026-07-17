import { describe, expect, it } from "vitest";
import { acceptGenerationProviderResponse, assertGenerationV2ExistingOperationAllowed, assertGenerationV2SubmissionAllowed, beginGenerationFinalizationRetry, beginGenerationProviderRetry, transitionGenerationDisposition } from "./contracts.js";
import { makeJob } from "./generation-job-dispositions.fixture.js";

describe("generation-v2-rollback.fixture", () => {
  it("rejects new V2 submissions before reservation/provider submit", () => { let reservationCount = 0; let submitCount = 0; const submitNew = () => { assertGenerationV2SubmissionAllowed(2, false); reservationCount += 1; submitCount += 1; }; expect(submitNew).toThrow("generation-v2-rollback-active"); expect(reservationCount).toBe(0); expect(submitCount).toBe(0); });
  it("allows release-enabled and legacy submissions", () => { expect(() => assertGenerationV2SubmissionAllowed(2, true)).not.toThrow(); expect(() => assertGenerationV2SubmissionAllowed(1, false)).not.toThrow(); });
  it("requires a typed persisted provider submission before rollback operations", () => { expect(() => assertGenerationV2ExistingOperationAllowed({ ...makeJob("running"), providerJobId: undefined }, "poll", false)).toThrow("generation-v2-submission-not-persisted"); });
  it.each([
    ["poll", "running"], ["cancel", "running"], ["provider-retry", "failed"], ["recover", "needs-attention"], ["finalize", "finalizing"], ["finalization-retry", "needs-attention"],
  ] as const)("allows explicitly requested %s for an already-submitted %s job without implicit submission", (operation, status) => {
    let submitCount = 0;
    const base = makeJob(status);
    const job = status === "needs-attention" || status === "finalizing" ? { ...base, output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 0, sha256: "sha-1" } } : base;
    const precondition = assertGenerationV2ExistingOperationAllowed(job, operation, false);
    if (operation === "poll") expect(acceptGenerationProviderResponse(job, "project-1", precondition.attempt, precondition.providerJobId)).toBe(true);
    if (operation === "cancel") expect(transitionGenerationDisposition(job, "canceled").status).toBe("canceled");
    if (operation === "recover") expect(beginGenerationFinalizationRetry(job).status).toBe("finalizing");
    if (operation === "finalize") expect(transitionGenerationDisposition(job, "succeeded").status).toBe("succeeded");
    if (operation === "finalization-retry") expect(beginGenerationFinalizationRetry(job).status).toBe("finalizing");
    if (operation === "provider-retry") { submitCount += 1; const retried = beginGenerationProviderRetry(job, "provider-2", 2000); expect(retried.attempt).toBe(2); expect(retried.providerJobId).toBe("provider-2"); }
    expect(submitCount).toBe(operation === "provider-retry" ? 1 : 0);
  });
  it("does not persist the release flag", () => expect(JSON.stringify({ contractVersion: 2, status: "running" })).not.toContain("generationV2ReleaseEnabled"));
});
