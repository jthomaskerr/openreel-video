import { describe, expect, it } from "vitest";
import { shouldSyncProjectIdToUrl } from "./project-url-identity";

describe("shouldSyncProjectIdToUrl", () => {
  const base = {
    route: "editor",
    requestedProjectId: "test-import",
    currentProjectId: "11111111-1111-4111-8111-111111111111",
    explicitlyCreated: true,
    recoveryIsChecking: true,
  } as const;

  it("preserves the requested backend id only while recovery is loading", () => {
    expect(shouldSyncProjectIdToUrl(base)).toBe(false);
    expect(shouldSyncProjectIdToUrl({ ...base, recoveryIsChecking: false })).toBe(true);
  });

  it("syncs the authoritative project id after reconciliation", () => {
    expect(shouldSyncProjectIdToUrl({
      ...base,
      requestedProjectId: "11111111-1111-4111-8111-111111111111",
      currentProjectId: "my-project",
      recoveryIsChecking: false,
    })).toBe(true);
  });

  it("adds a new client project id when no project id is already in the URL", () => {
    expect(shouldSyncProjectIdToUrl({ ...base, requestedProjectId: undefined })).toBe(true);
  });
});
