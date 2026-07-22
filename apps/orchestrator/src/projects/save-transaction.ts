import crypto, { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
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
import { allocateMediaFilename } from "./media-filename";
import { listPendingMedia, type PendingMediaEntry } from "./pending-media";
import {
  assessDestructiveChange,
  authorizeDestructiveChange,
  type ServerRemovalManifest,
} from "./destructive-change";
import { assertExternallyReferencedMediaPreserved } from "./external-media";

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
  readonly pendingMoves?: readonly PendingMediaMove[];
}

interface PendingMediaMove {
  readonly mediaId: string;
  readonly pendingContentPath: string;
  readonly pendingEntryDirectory: string;
  readonly mediaPath: string;
  readonly relativeMediaPath: string;
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

function moveSourceIsAbsent(error: NodeJS.ErrnoException): boolean {
  return error.code === "ENOENT" || error.code === "ENAMETOOLONG";
}

async function filesMatch(leftPath: string, rightPath: string): Promise<boolean> {
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right);
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
  await transaction.unstage(["project.json", ...(journal.pendingMoves ?? []).map((move) => move.relativeMediaPath)]);
  if (currentCommit === journal.baseCommitSha) {
    await replaceBytes(projectPath, journal.restorePath, Buffer.from(journal.previousBytes, "base64"));
    for (const move of journal.pendingMoves ?? []) {
      await mkdir(move.pendingEntryDirectory, { recursive: true });
      await rename(move.mediaPath, move.pendingContentPath).catch((error: NodeJS.ErrnoException) => {
        if (!moveSourceIsAbsent(error)) throw error;
      });
    }
  } else if (committedTarget) {
    await replaceBytes(projectPath, journal.restorePath, Buffer.from(journal.proposedBytes, "base64"));
    for (const move of journal.pendingMoves ?? []) {
      await rm(move.pendingEntryDirectory, { recursive: true, force: true });
    }
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
): Promise<ProjectSaveReceipt & { readonly project: Project }> {
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

    assertExternallyReferencedMediaPreserved(currentProject, request.project as Project);

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

    const transactionId = crypto.randomUUID();
    const stagedPath = `${projectPath}.${transactionId}.save`;
    const restorePath = `${projectPath}.${transactionId}.restore`;
    const pendingEntries = await listPendingMedia(store.projectDir(request.projectId));
    const pendingById = new Map(pendingEntries.map((entry) => [entry.mediaId, entry]));
    const currentById = new Map(currentProject.mediaLibrary.items.map((item) => [item.id, item]));
    const referencedPending = (request.project as Project).mediaLibrary.items
      .filter((item) => pendingById.has(item.id));
    const occupied = new Set<string>();
    try {
      for (const filename of await readdir(store.mediaDir(request.projectId))) occupied.add(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const existingMediaFilenames = new Set(occupied);
    for (const item of (request.project as Project).mediaLibrary.items) {
      if (!pendingById.has(item.id)) occupied.add(item.name);
    }
    const allocatedById = new Map<string, string>();
    for (const item of referencedPending) {
      const pending = pendingById.get(item.id)!;
      if (item.metadata.fileSize !== pending.byteSize) {
        throw new Error(`Pending media byte size does not match snapshot metadata for ${item.id}`);
      }
      const currentItem = currentById.get(item.id);
      const allocated = currentItem?.name ?? allocateMediaFilename(
        item.name || pending.originalFilename,
        occupied,
        {
          caseSensitive: false,
          unicodeNormalization: "NFC",
        },
      ).persistedBasename;
      occupied.add(allocated);
      allocatedById.set(item.id, allocated);
    }
    const proposed: Project = {
      ...(request.project as Project),
      mediaLibrary: {
        ...(request.project as Project).mediaLibrary,
        items: (request.project as Project).mediaLibrary.items.map((item) => {
          const allocated = allocatedById.get(item.id);
          return allocated ? { ...item, name: allocated } : item;
        }),
      },
    };
    const redundantPending: typeof referencedPending = [];
    for (const item of referencedPending) {
      const currentItem = currentById.get(item.id);
      if (!currentItem || !existingMediaFilenames.has(currentItem.name)) continue;
      const pending = pendingById.get(item.id)!;
      const currentPath = join(store.mediaDir(request.projectId), currentItem.name);
      if (!await filesMatch(pending.contentPath, currentPath)) {
        throw new Error(`Pending upload changed bytes for existing media identity ${item.id}`);
      }
      redundantPending.push(item);
    }
    const redundantPendingIds = new Set(redundantPending.map((item) => item.id));
    const pendingMoves: PendingMediaMove[] = referencedPending.filter((item) => !redundantPendingIds.has(item.id)).map((item) => {
      const pending = pendingById.get(item.id) as PendingMediaEntry;
      const filename = allocatedById.get(item.id)!;
      return {
        mediaId: item.id,
        pendingContentPath: pending.contentPath,
        pendingEntryDirectory: pending.entryDirectory,
        mediaPath: join(store.mediaDir(request.projectId), filename),
        relativeMediaPath: `media/${filename}`,
      };
    });
    const proposedBytes = Buffer.from(JSON.stringify(proposed, null, 2), "utf8");
    const semanticChanges = semanticProjectChanges(currentProject, proposed);
    if (pendingMoves.length === 0 && semanticChanges.length === 0) {
      let audit;
      try {
        audit = await store.auditSnapshot(proposed);
      } catch (error) {
        if (error instanceof ProjectMediaManifestAuditError) throw mediaIncomplete(request.projectId, error);
        throw error;
      }
      assertReceipt(currentReceipt);
      if (!proposedBytes.equals(previousBytes)) {
        try {
          await durableWrite(stagedPath, proposedBytes);
          await rename(stagedPath, projectPath);
          await syncDirectory(dirname(projectPath));
        } finally {
          await rm(stagedPath, { force: true }).catch(() => undefined);
        }
      }
      for (const item of redundantPending) {
        await rm(pendingById.get(item.id)!.entryDirectory, { recursive: true, force: true });
      }
      return {
        saved: true,
        committed: true,
        commitDueAt: null,
        projectId: request.projectId,
        persistedAt: proposedBytes.equals(previousBytes)
          ? await gitStore.readCommitTimestamp(request.projectId, currentReceipt.commitSha)
          : Date.now(),
        sourceModifiedAt: proposed.modifiedAt,
        commitSha: currentReceipt.commitSha,
        treeSha: currentReceipt.treeSha,
        projectBlobSha: currentReceipt.projectBlobSha,
        mediaManifestDigest: audit.mediaManifestDigest,
        lfsPayloads: audit.lfsPayloads,
        project: proposed,
      };
    }
    const expectedEntries = options.expectedEntries ?? [
      ...pendingMoves.map((move) => ({ status: "A", path: move.relativeMediaPath })),
      { status: "M", path: "project.json" },
    ] as const;
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
      pendingMoves,
    };
    let simulatedCrash = false;
    let audit;

    try {
      await durableWrite(journalPath(store, request.projectId), JSON.stringify(journal));
      await mkdir(store.mediaDir(request.projectId), { recursive: true });
      for (const move of pendingMoves) await rename(move.pendingContentPath, move.mediaPath);
      try {
        // Pending bytes become auditable only inside this locked transaction.
        await store.auditSnapshot(proposed, { verifyLfs: false });
        await gitTransaction.stage(pendingMoves.map((move) => move.relativeMediaPath));
        audit = await store.auditSnapshot(proposed, { pointerSource: "index" });
      } catch (error) {
        if (error instanceof ProjectMediaManifestAuditError) throw mediaIncomplete(request.projectId, error);
        throw error;
      }
      const canonicalSubmittedManifest = request.requiredMediaManifest.map((entry) => {
        const filename = allocatedById.get(entry.mediaId);
        return filename ? { ...entry, semanticFilename: filename, relativePhysicalPath: `media/${filename}` } : entry;
      });
      if (serializeRequiredMediaManifest(canonicalSubmittedManifest)
        !== serializeRequiredMediaManifest(audit.requiredMediaManifest)) {
        throw new Error("Submitted required media manifest does not match the audited snapshot manifest");
      }
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
        deterministicCommitMessage(semanticChanges, expectedEntries),
        { allowlist: ["project.json", ...pendingMoves.map((move) => move.relativeMediaPath)], expectedEntries },
      );
      assertReceipt(receipt);
      if (options.simulateCrashAt === "after-ref-update") {
        simulatedCrash = true;
        throw new SimulatedSaveProcessCrash("simulated crash after ref update");
      }
      await rm(journalPath(store, request.projectId), { force: true });
      for (const move of pendingMoves) await rm(move.pendingEntryDirectory, { recursive: true, force: true });
      for (const item of redundantPending) {
        await rm(pendingById.get(item.id)!.entryDirectory, { recursive: true, force: true });
      }
      return {
      saved: true,
      committed: true,
      commitDueAt: null,
      projectId: request.projectId,
        persistedAt: Date.now(),
        sourceModifiedAt: proposed.modifiedAt,
        commitSha: receipt.commitSha,
        treeSha: receipt.treeSha,
        projectBlobSha: receipt.projectBlobSha,
        mediaManifestDigest: audit.mediaManifestDigest,
        lfsPayloads: audit.lfsPayloads,
        project: proposed,
      };
    } catch (error) {
      if (simulatedCrash) throw error;
      await gitTransaction.unstage(pendingMoves.map((move) => move.relativeMediaPath));
      await replaceBytes(projectPath, restorePath, previousBytes);
      for (const move of pendingMoves) {
        await mkdir(move.pendingEntryDirectory, { recursive: true });
        await rename(move.mediaPath, move.pendingContentPath).catch((moveError: NodeJS.ErrnoException) => {
          if (!moveSourceIsAbsent(moveError)) throw moveError;
        });
      }
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
