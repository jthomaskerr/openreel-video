export interface ProjectUrlSyncInput {
  readonly route: string;
  readonly requestedProjectId?: string;
  readonly currentProjectId: string;
  readonly explicitlyCreated: boolean;
  readonly recoveryIsChecking: boolean;
  readonly currentProjectIsClientOnly: boolean;
}

/** Prevent the initial in-memory UUID from replacing an explicit backend slug
 * while recovery is still loading that canonical project. */
export function shouldSyncProjectIdToUrl(input: ProjectUrlSyncInput): boolean {
  if (input.route !== "editor" || !input.explicitlyCreated || !input.currentProjectId) return false;
  if (input.requestedProjectId) {
    if (input.recoveryIsChecking || input.currentProjectIsClientOnly) return false;
  }
  return input.requestedProjectId !== input.currentProjectId;
}
