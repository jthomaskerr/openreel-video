import { describe, expect, it } from "vitest";
import { shouldSyncProjectIdToUrl } from "./project-url-identity";

describe("shouldSyncProjectIdToUrl", () => {
  const base = {
    route: "editor",
    requestedProjectId: "test-import",
    currentProjectId: "11111111-1111-4111-8111-111111111111",
    explicitlyCreated: true,
    recoveryIsChecking: true,
    currentProjectIsClientOnly: true,
  } as const;

  it("preserves an explicit backend slug while its project is loading", () => {
    expect(shouldSyncProjectIdToUrl(base)).toBe(false);
    expect(shouldSyncProjectIdToUrl({ ...base, recoveryIsChecking: false })).toBe(false);
  });

  it("replaces a pending UUID only after reconciliation produces a canonical slug", () => {
    expect(shouldSyncProjectIdToUrl({
      ...base,
      requestedProjectId: "11111111-1111-4111-8111-111111111111",
      currentProjectId: "my-project",
      recoveryIsChecking: false,
      currentProjectIsClientOnly: false,
    })).toBe(true);
  });

  it("adds a new client project id when no project id is already in the URL", () => {
    expect(shouldSyncProjectIdToUrl({ ...base, requestedProjectId: undefined })).toBe(true);
  });
});
