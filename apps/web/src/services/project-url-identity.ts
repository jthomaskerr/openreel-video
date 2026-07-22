export interface ProjectUrlSyncInput {
  readonly route: string;
  readonly requestedProjectId?: string;
  readonly currentProjectId: string;
  readonly explicitlyCreated: boolean;
  readonly recoveryIsChecking: boolean;
}

/** Prevent local editor state from replacing an explicit backend slug while
 * recovery is still loading that canonical project. */
export function shouldSyncProjectIdToUrl(input: ProjectUrlSyncInput): boolean {
  if (input.route !== "editor" || !input.explicitlyCreated || !input.currentProjectId) return false;
  if (input.requestedProjectId && input.recoveryIsChecking) return false;
  return input.requestedProjectId !== input.currentProjectId;
}
