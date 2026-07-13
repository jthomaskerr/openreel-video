import crypto, { createHash } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  Project,
  ProjectBaseRevision,
  ProjectSaveConflictResponse,
  ProjectSaveDestructiveChangeRequiresIntentResponse,
  ProjectSaveMediaIncompleteResponse,
  ProjectSaveReceipt,
  ProjectSaveRequest,
} from "@openreel/core";
import { serializeRequiredMediaManifest } from "../../../../packages/core/src/project-persistence";
import type { GitCommitReceipt, GitProjectTransaction, GitStore } from "./git-store";
import { ProjectMediaManifestAuditError } from "./media-manifest";
import type { ProjectStore } from "./project-store";
import { deterministicCommitMessage, semanticProjectChanges } from "./semantic-commit";
import {
  assessDestructiveChange,
  authorizeDestructiveChange,
  type ServerRemovalManifest,
} from "./destructive-change";

type SaveConflictBody = ProjectSaveConflictResponse
  | ProjectSaveDestructiveChangeRequiresIntentResponse
  | ProjectSaveMediaIncompleteResponse;

export class SaveTransactionError extends Error {
  constructor(readonly status: 409, readonly body: SaveConflictBody, cause?: unknown) {
    super(body.code, { cause });
    this.name = "SaveTransactionError";
  }
}

export interface SaveTransactionOptions {
  readonly commit?: (
    projectId: string,
    message: string,
    transaction: { allowlist: readonly string[]; expectedEntries: readonly { status: string; path: string }[] },
  ) => Promise<GitCommitReceipt>;
  readonly beforeCommit?: () => Promise<void>;
  readonly expectedEntries?: readonly { status: string; path: string }[];
  readonly simulateCrashAt?: "before-ref-update" | "after-ref-update";
  readonly serverRemovalManifest?: ServerRemovalManifest;
}

interface SaveJournal {
  readonly version: 1;
  readonly projectId: string;
  readonly baseCommitSha: string;
  readonly targetProjectBlobSha: string;
  readonly previousBytes: string;
  readonly proposedBytes: string;
  readonly stagedPath: string;
  readonly restorePath: string;
}

export class SimulatedSaveProcessCrash extends Error {}

function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

async function durableWrite(path: string, bytes: string | Buffer): Promise<void> {
  const handle = await open(path, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function journalPath(store: ProjectStore, projectId: string): string {
  return join(store.projectDir(projectId), ".openreel-save-transaction.json");
}

async function replaceBytes(target: string, temp: string, bytes: Buffer): Promise<void> {
  await durableWrite(temp, bytes);
  await rename(temp, target);
  await syncDirectory(dirname(target));
}

async function recoverUnderLock(
  store: ProjectStore,
  gitStore: GitStore,
  projectId: string,
  transaction: GitProjectTransaction,
): Promise<void> {
  const path = journalPath(store, projectId);
  let journal: SaveJournal;
  try {
    journal = JSON.parse(await readFile(path, "utf8")) as SaveJournal;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`Cannot recover interrupted save journal for ${projectId}`, { cause: error });
  }
  if (journal.version !== 1 || journal.projectId !== projectId) {
    throw new Error(`Invalid interrupted save journal for ${projectId}`);
  }

  const receipt = await gitStore.readConfirmedReceipt(projectId);
  const currentCommit = receipt?.commitSha;
  const committedTarget = receipt?.projectBlobSha === journal.targetProjectBlobSha;
  const projectPath = join(store.projectDir(projectId), "project.json");
  await transaction.unstage(["project.json"]);
  if (currentCommit === journal.baseCommitSha) {
    await replaceBytes(projectPath, journal.restorePath, Buffer.from(journal.previousBytes, "base64"));
  } else if (committedTarget) {
    await replaceBytes(projectPath, journal.restorePath, Buffer.from(journal.proposedBytes, "base64"));
  } else {
    throw new Error(`Interrupted save for ${projectId} cannot be recovered against current HEAD ${currentCommit ?? "none"}`);
  }
  await rm(journal.stagedPath, { force: true });
  await rm(journal.restorePath, { force: true });
  await rm(path, { force: true });
}

export async function recoverInterruptedSave(
  store: ProjectStore,
  gitStore: GitStore,
  projectId: string,
): Promise<void> {
  await gitStore.withProjectTransaction(projectId, (transaction) =>
    recoverUnderLock(store, gitStore, projectId, transaction));
}

function revisionMatches(submitted: ProjectBaseRevision, current: ProjectBaseRevision): boolean {
  return submitted.commitSha === current.commitSha
    && submitted.treeSha === current.treeSha
    && submitted.projectBlobSha === current.projectBlobSha
    && submitted.sourceModifiedAt === current.sourceModifiedAt;
}

function asRevision(receipt: GitCommitReceipt, project: Project): ProjectBaseRevision | null {
  if (!receipt.commitSha || !receipt.treeSha || !receipt.projectBlobSha) return null;
  return {
    commitSha: receipt.commitSha,
    treeSha: receipt.treeSha,
    projectBlobSha: receipt.projectBlobSha,
    sourceModifiedAt: project.modifiedAt,
  };
}

function assertReceipt(receipt: GitCommitReceipt): asserts receipt is GitCommitReceipt & {
  commitSha: string;
  treeSha: string;
  projectBlobSha: string;
} {
  if (!receipt.commitSha || !receipt.treeSha || !receipt.projectBlobSha || !receipt.mediaManifestDigest) {
    throw new Error("Save commit did not return a complete verifiable receipt");
  }
}

function mediaIncomplete(projectId: string, error: ProjectMediaManifestAuditError): SaveTransactionError {
  return new SaveTransactionError(409, {
    saved: false,
    code: "MEDIA_INCOMPLETE",
    projectId,
    missingItems: error.snapshot.missingEntries.map(({ actualFilename: _actualFilename, ...entry }) => entry),
  }, error);
}

/**
 * Saves one project snapshot under a project-scoped lock. The worktree file is
 * used only as Git's staging input and is restored byte-for-byte unless commit
 * confirmation succeeds.
 */
export async function executeSaveTransaction(
  store: ProjectStore,
  gitStore: GitStore,
  request: ProjectSaveRequest,
  options: SaveTransactionOptions = {},
): Promise<ProjectSaveReceipt> {
  if (!request?.project || request.projectId !== request.project.id) {
    throw new TypeError("Project save request id does not match its snapshot");
  }

  return gitStore.withProjectTransaction(request.projectId, async (gitTransaction) => {
    await recoverUnderLock(store, gitStore, request.projectId, gitTransaction);
    const projectPath = join(store.projectDir(request.projectId), "project.json");
    const previousBytes = await readFile(projectPath);
    const currentProject = JSON.parse(previousBytes.toString("utf8")) as Project;
    const currentReceipt = await gitStore.readConfirmedReceipt(request.projectId);
    if (!currentProject || !currentReceipt) throw new Error(`Project ${request.projectId} has no confirmed base revision`);
    const currentBaseRevision = asRevision(currentReceipt, currentProject);
    if (!currentBaseRevision) throw new Error(`Project ${request.projectId} has an incomplete confirmed base revision`);
    if (!revisionMatches(request.baseRevision, currentBaseRevision)) {
      throw new SaveTransactionError(409, {
        saved: false,
        code: "PROJECT_CONFLICT",
        projectId: request.projectId,
        submittedBaseRevision: request.baseRevision,
        currentBaseRevision,
      });
    }

    const destructiveChange = assessDestructiveChange(currentProject, request.project as Project);
    if (!authorizeDestructiveChange(destructiveChange, {
      saveIntent: request.saveIntent,
      destructiveIntent: request.destructiveIntent,
      serverRemovalManifest: options.serverRemovalManifest,
    })) {
      throw new SaveTransactionError(409, {
        saved: false,
        code: "DESTRUCTIVE_CHANGE_REQUIRES_INTENT",
        projectId: request.projectId,
        submittedBaseRevision: request.baseRevision,
        currentBaseRevision,
        ...destructiveChange.deltas,
      });
    }

    let audit;
    try {
      // Fail missing/invalid originals with the structured snapshot error before
      // invoking LFS plumbing, which cannot inspect an absent worktree path.
      await store.auditSnapshot(request.project as Project, { verifyLfs: false });
      audit = await store.auditSnapshot(request.project as Project);
    } catch (error) {
      if (error instanceof ProjectMediaManifestAuditError) throw mediaIncomplete(request.projectId, error);
      throw error;
    }
    if (serializeRequiredMediaManifest(request.requiredMediaManifest)
      !== serializeRequiredMediaManifest(audit.requiredMediaManifest)) {
      throw new Error("Submitted required media manifest does not match the audited snapshot manifest");
    }

    const transactionId = crypto.randomUUID();
    const stagedPath = `${projectPath}.${transactionId}.save`;
    const restorePath = `${projectPath}.${transactionId}.restore`;
    const proposed = request.project as Project;
    const proposedBytes = Buffer.from(JSON.stringify(proposed, null, 2), "utf8");
    const expectedEntries = options.expectedEntries ?? [{ status: "M", path: "project.json" }] as const;
    const commit = options.commit
      ?? ((_projectId: string, message: string, transaction: Parameters<GitProjectTransaction["commit"]>[1]) =>
        gitTransaction.commit(message, transaction));
    const journal: SaveJournal = {
      version: 1,
      projectId: request.projectId,
      baseCommitSha: currentBaseRevision.commitSha,
      targetProjectBlobSha: gitBlobSha(proposedBytes),
      previousBytes: previousBytes.toString("base64"),
      proposedBytes: proposedBytes.toString("base64"),
      stagedPath,
      restorePath,
    };
    let simulatedCrash = false;

    try {
      await durableWrite(journalPath(store, request.projectId), JSON.stringify(journal));
      await durableWrite(stagedPath, proposedBytes);
      await rename(stagedPath, projectPath);
      await syncDirectory(dirname(projectPath));
      if (options.simulateCrashAt === "before-ref-update") {
        simulatedCrash = true;
        throw new SimulatedSaveProcessCrash("simulated crash before ref update");
      }
      await options.beforeCommit?.();
      const receipt = await commit(
        request.projectId,
        deterministicCommitMessage(semanticProjectChanges(currentProject, proposed), expectedEntries),
        { allowlist: ["project.json"], expectedEntries },
      );
      assertReceipt(receipt);
      if (options.simulateCrashAt === "after-ref-update") {
        simulatedCrash = true;
        throw new SimulatedSaveProcessCrash("simulated crash after ref update");
      }
      await rm(journalPath(store, request.projectId), { force: true });
      return {
        saved: true,
        committed: true,
        projectId: request.projectId,
        persistedAt: Date.now(),
        sourceModifiedAt: proposed.modifiedAt,
        commitSha: receipt.commitSha,
        treeSha: receipt.treeSha,
        projectBlobSha: receipt.projectBlobSha,
        mediaManifestDigest: audit.mediaManifestDigest,
        lfsPayloads: audit.lfsPayloads,
      };
    } catch (error) {
      if (simulatedCrash) throw error;
      await replaceBytes(projectPath, restorePath, previousBytes);
      await rm(journalPath(store, request.projectId), { force: true });
      throw error;
    } finally {
      if (!simulatedCrash) {
        await rm(stagedPath, { force: true }).catch(() => undefined);
        await rm(restorePath, { force: true }).catch(() => undefined);
      }
    }
  });
}
