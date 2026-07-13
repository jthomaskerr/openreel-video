import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface TestProjectRootGuardOptions {
  assignedTempRoot: string;
  userProjectsRoot: string;
}

async function canonicalizePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function overlapsOrContains(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(basePath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function ensureSafeTestProjectRoot(
  fixtureRoot: string,
  options: TestProjectRootGuardOptions,
): Promise<string> {
  const [fixturePath, tempRootPath, userProjectsPath] = await Promise.all([
    canonicalizePath(fixtureRoot),
    canonicalizePath(options.assignedTempRoot),
    canonicalizePath(options.userProjectsRoot),
  ]);

  if (fixturePath === tempRootPath || !overlapsOrContains(tempRootPath, fixturePath)) {
    throw new Error(
      `Unsafe test project root: ${fixturePath} must be inside the assigned temporary root ${tempRootPath}`,
    );
  }

  if (overlapsOrContains(userProjectsPath, fixturePath) || overlapsOrContains(fixturePath, userProjectsPath)) {
    throw new Error(
      `Unsafe test project root: ${fixturePath} overlaps the configured user projects root ${userProjectsPath}`,
    );
  }

  return fixturePath;
}
