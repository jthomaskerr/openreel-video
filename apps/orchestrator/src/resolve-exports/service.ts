import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  HANDOFF_TARGET_PROFILES,
  ResolveImportResultSchema,
  assessHandoff,
  createHandoffPlan,
  renderCompatibilityReport,
  serializeResolveFcpxml,
  type CompatibilityReport,
  type HandoffSelection,
  type Project,
  type ResolveExportJob,
  type ResolveImportResult,
  type ResolvePreview,
} from "@openreel/core";
import type {
  GitCommitLifecycleHooks,
  GitCommitReceipt,
  GitCommitTransaction,
  GitProjectTransaction,
  GitReadResult,
} from "../projects/git-store";
import type { ProjectMediaManifestSnapshot } from "../projects/media-manifest";
import { buildResolvePreview, type PreviewMediaAvailability } from "./preview";
import {
  ResolveExportJobStore,
  ResolveJobStoreError,
  type PersistedResolveExportJob,
  type ResolveExportArtifact,
  type ResolveTransactionJournal,
  type ResolveTransactionKind,
} from "./job-store";

const TOKEN_TTL_MS = 5 * 60 * 1_000;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

type BridgeErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_REVISION_UNAVAILABLE"
  | "STALE_PROJECT_REVISION"
  | "WORKTREE_REVISION_MISMATCH"
  | "INVALID_HANDOFF_SELECTION"
  | "MEDIA_INCOMPLETE"
  | "EXPORT_BLOCKED"
  | "EXPORT_PERSIST_FAILED"
  | "RESOLVE_JOB_NOT_FOUND"
  | "LAUNCH_TOKEN_INVALID"
  | "LAUNCH_TOKEN_EXPIRED"
  | "LAUNCH_TOKEN_USED"
  | "ARTIFACT_CAPABILITY_EXPIRED"
  | "JOB_TERMINAL"
  | "INVALID_JOB_TRANSITION"
  | "IMPORT_RESULT_CONFLICT"
  | "IMPORT_RESULT_INVALID"
  | "IMPORT_RESULT_PERSIST_FAILED"
  | "RECOVERY_FAILED";

export class ResolveExportServiceError extends Error {
  readonly projectId?: string;
  readonly jobId?: string;
  readonly mediaIds?: readonly string[];

  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    identifiers: {
      readonly projectId?: string;
      readonly jobId?: string;
      readonly mediaIds?: readonly string[];
    } = {},
  ) {
    super(message);
    this.name = "ResolveExportServiceError";
    this.projectId = identifiers.projectId;
    this.jobId = identifiers.jobId;
    this.mediaIds = identifiers.mediaIds;
  }
}

interface ProjectStorePort {
  readonly projectDir: (projectId: string) => string;
  readonly loadProject: (projectId: string) => Promise<Project | null>;
  readonly auditSnapshot: (project: Project) => Promise<ProjectMediaManifestSnapshot>;
}

interface GitStorePort {
  readonly readConfirmedReceipt: (projectId: string) => Promise<GitCommitReceipt | null>;
  readonly readConfirmedReceiptStrict: (projectId: string) => Promise<GitReadResult<GitCommitReceipt>>;
  readonly getProjectAtCommit: (projectId: string, sha: string) => Promise<Project | null>;
  readonly readFileAtCommit: (
    projectId: string,
    sha: string,
    relativePath: string,
  ) => Promise<string | null>;
  readonly readFileAtCommitStrict: (
    projectId: string,
    sha: string,
    relativePath: string,
  ) => Promise<GitReadResult<string>>;
  readonly isCommitAncestor: (projectId: string, ancestor: string, descendant: string) => Promise<boolean>;
  readonly commit: (
    projectId: string,
    message: string,
    transaction: GitCommitTransaction,
  ) => Promise<GitCommitReceipt>;
  readonly withProjectTransaction: <T>(
    projectId: string,
    operation: (transaction: GitProjectTransaction) => Promise<T>,
  ) => Promise<T>;
}

export interface ResolveExportServiceOptions {
  readonly projects: ProjectStorePort;
  readonly git: GitStorePort;
  readonly jobs: ResolveExportJobStore;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
  readonly onTransactionPoint?: (point: ResolveTransactionPoint) => void | Promise<void>;
}

export type ResolveTransactionPoint =
  | `after-publish:${string}`
  | "after-git-stage"
  | "after-git-tree"
  | "before-ref-update"
  | "after-ref-update";

export class ResolveSimulatedProcessCrash extends Error {
  constructor(readonly point: ResolveTransactionPoint) {
    super(`Simulated process crash at ${point}`);
    this.name = "ResolveSimulatedProcessCrash";
  }
}

export interface ResolveRecoveryDiagnostic {
  readonly transactionId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly action: "rolled-back" | "rolled-forward";
  readonly recoveredAt: string;
}

export interface ResolveLaunchPayload {
  readonly jobId: string;
  readonly projectId: string;
  readonly revision: string;
  readonly artifacts: readonly ResolveExportArtifact[];
  readonly artifactAccessToken: string;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sameSha256(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function gitBlobSha(bytes: Buffer): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(bytes).digest("hex");
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function missingMediaIds(audit: ProjectMediaManifestSnapshot): string[] {
  const ids = new Set<string>();
  for (const issue of [
    ...audit.missingEntries,
    ...audit.filenameMismatches,
    ...audit.byteSizeMismatches,
    ...audit.danglingClips,
  ]) {
    const mediaId = (issue as { mediaId?: unknown }).mediaId;
    if (typeof mediaId === "string") ids.add(mediaId);
  }
  for (const entry of audit.requiredMediaManifest) {
    const payload = audit.lfsPayloads.find((candidate) => candidate.mediaId === entry.mediaId);
    if (!payload || payload.local.state !== "verified") ids.add(entry.mediaId);
  }
  return [...ids].sort();
}

function auditComplete(audit: ProjectMediaManifestSnapshot): boolean {
  return missingMediaIds(audit).length === 0
    && audit.duplicateIssues.length === 0
    && audit.filenameMismatches.length === 0
    && audit.byteSizeMismatches.length === 0
    && audit.danglingClips.length === 0;
}

function mediaAvailability(
  project: Project,
  audit: ProjectMediaManifestSnapshot,
): Map<string, { available: boolean }> {
  const unavailable = new Set(missingMediaIds(audit));
  return new Map(project.mediaLibrary.items.map((item) => [
    item.id,
    { available: !unavailable.has(item.id) },
  ]));
}

function previewAvailability(
  project: Project,
  audit: ProjectMediaManifestSnapshot,
): ReadonlyMap<string, PreviewMediaAvailability> {
  const unavailable = new Set(missingMediaIds(audit));
  return new Map(project.mediaLibrary.items.map((item) => [
    item.id,
    unavailable.has(item.id)
      ? { status: "missing" as const, reason: "Canonical media is unavailable" }
      : { status: "ready" as const },
  ]));
}

function exactEntries(paths: readonly string[], status: "A" | "M") {
  return paths.map((path) => ({ status, path } as const));
}

function reportFor(
  project: Project,
  plan: ReturnType<typeof createHandoffPlan>,
  artifacts: readonly ResolveExportArtifact[],
  generatedAt: string,
): CompatibilityReport {
  const profile = plan.targetProfile;
  return {
    schemaVersion: "1.0",
    project: { id: project.id, name: project.name },
    target: {
      id: profile.id,
      label: profile.label,
      mode: profile.mode,
      contractVersion: profile.contractVersion,
      applicationVersions: profile.applicationVersions,
    },
    range: {
      startFrame: 0,
      endFrame: plan.durationFrames,
      durationFrames: plan.durationFrames,
      frameRate: String(plan.timebase.sourceFrameRate),
      startDisplay: "0",
      endDisplay: String(plan.durationFrames),
      durationDisplay: String(plan.durationFrames),
    },
    artifacts: artifacts.map((artifact) => ({
      kind: artifact.path.endsWith(".fcpxml") ? "fcpxml" : "report",
      relativePath: artifact.path,
      mediaType: artifact.mediaType,
      required: true,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      status: "written",
    })),
    issues: plan.issues,
    unsupportedItems: plan.issues.filter((issue) => issue.severity === "flattening"),
    result: { status: "completed", summary: "Resolve handoff artifacts are ready." },
    generatedAt,
  };
}

function sameResult(left: ResolveImportResult, right: ResolveImportResult): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type ResolveLifecycleEvent = "redeem" | "cancel" | "result-completed" | "result-failed";

const RESOLVE_LIFECYCLE: Readonly<Record<ResolveLifecycleEvent, Readonly<Record<string, string>>>> = {
  redeem: { ready: "importing" },
  cancel: { ready: "cancelled" },
  "result-completed": { importing: "completed" },
  "result-failed": { importing: "failed" },
};

function lifecyclePhase(
  record: PersistedResolveExportJob,
  event: ResolveLifecycleEvent,
): ResolveExportJob["phase"] {
  const next = RESOLVE_LIFECYCLE[event][record.job.phase] as ResolveExportJob["phase"] | undefined;
  if (!next) {
    throw new ResolveExportServiceError(
      "INVALID_JOB_TRANSITION",
      "Resolve job lifecycle transition is not permitted",
      { projectId: record.job.projectId, jobId: record.job.id },
    );
  }
  return next;
}

export class ResolveExportService {
  readonly #now: () => number;
  readonly #randomUUID: () => string;
  readonly #onTransactionPoint?: ResolveExportServiceOptions["onTransactionPoint"];
  #recoveryPromise: Promise<void> | null = null;
  readonly #recoveryDiagnostics: ResolveRecoveryDiagnostic[] = [];
  #artifactCapabilities = new Map<string, { readonly jobId: string; readonly projectId: string; readonly expiresAt: number }>();

  constructor(private readonly options: ResolveExportServiceOptions) {
    this.#now = options.now ?? Date.now;
    this.#randomUUID = options.randomUUID ?? crypto.randomUUID;
    this.#onTransactionPoint = options.onTransactionPoint;
  }

  async #ensureRecovered(): Promise<void> {
    this.#recoveryPromise ??= this.#recoverTransactions();
    return this.#recoveryPromise;
  }

  async #transactionPoint(point: ResolveTransactionPoint): Promise<void> {
    await this.#onTransactionPoint?.(point);
  }

  #commitHooks(): GitCommitLifecycleHooks {
    return {
      afterStage: () => this.#transactionPoint("after-git-stage"),
      afterTree: () => this.#transactionPoint("after-git-tree"),
      beforeRefUpdate: () => this.#transactionPoint("before-ref-update"),
      afterRefUpdate: () => this.#transactionPoint("after-ref-update"),
    };
  }

  async #latestJournal(journal: ResolveTransactionJournal): Promise<ResolveTransactionJournal> {
    const current = (await this.options.jobs.listTransactions())
      .find((candidate) => candidate.transactionId === journal.transactionId);
    if (!current) {
      throw new ResolveJobStoreError(
        "RESOLVE_JOB_CORRUPT",
        "Resolve transaction journal is missing",
        { projectId: journal.projectId, jobId: journal.jobId },
      );
    }
    return current;
  }

  async #reconcileJournal(
    journalInput: ResolveTransactionJournal,
    transaction: GitProjectTransaction,
  ): Promise<ResolveRecoveryDiagnostic> {
    const journal = await this.#latestJournal(journalInput);
    const receipt = await this.options.git.readConfirmedReceiptStrict(journal.projectId);
    if (receipt.status !== "present" || !receipt.value.commitSha || !FULL_COMMIT_SHA.test(receipt.value.commitSha)) {
      throw new Error("Authoritative Resolve recovery ref is unavailable");
    }
    const currentCommitSha = receipt.value.commitSha;
    const committed = currentCommitSha !== journal.baseCommitSha;
    if (committed) {
      if (!await this.options.git.isCommitAncestor(journal.projectId, journal.baseCommitSha, currentCommitSha)) {
        throw new Error("Resolve recovery ref does not descend from the transaction base");
      }
      for (const write of journal.writes) {
        const committedFile = await this.options.git.readFileAtCommitStrict(
          journal.projectId,
          currentCommitSha,
          write.path,
        );
        if (
          committedFile.status !== "present"
          || crypto.createHash("sha256").update(Buffer.from(committedFile.value, "utf8")).digest("hex")
            !== write.afterSha256
        ) {
          throw new Error("Resolve recovery commit does not contain the transaction image");
        }
      }
    }
    const paths = journal.writes.map((write) => write.path);
    await transaction.unstage(paths);
    await this.options.jobs.restoreTransaction(journal, committed ? "after" : "before");
    await this.options.jobs.completeTransaction(journal);
    const diagnostic: ResolveRecoveryDiagnostic = {
      transactionId: journal.transactionId,
      projectId: journal.projectId,
      jobId: journal.jobId,
      action: committed ? "rolled-forward" : "rolled-back",
      recoveredAt: iso(this.#now()),
    };
    this.#recoveryDiagnostics.push(diagnostic);
    return diagnostic;
  }

  async #recoverTransactions(): Promise<void> {
    let recovering: ResolveTransactionJournal | undefined;
    try {
      for (const journal of await this.options.jobs.listTransactions()) {
        recovering = journal;
        await this.options.git.withProjectTransaction(journal.projectId, (transaction) =>
          this.#reconcileJournal(journal, transaction));
      }
    } catch (error) {
      const identifiers = error instanceof ResolveJobStoreError
        ? error.identifiers
        : recovering
          ? { projectId: recovering.projectId, jobId: recovering.jobId }
          : {};
      throw new ResolveExportServiceError(
        "RECOVERY_FAILED",
        "Resolve transaction recovery failed",
        identifiers,
      );
    }
  }

  async recoveryDiagnostics(): Promise<readonly ResolveRecoveryDiagnostic[]> {
    await this.#ensureRecovered();
    return [...this.#recoveryDiagnostics];
  }

  async #runJournaledTransaction(input: {
    readonly kind: ResolveTransactionKind;
    readonly projectId: string;
    readonly jobId: string;
    readonly baseCommitSha: string;
    readonly writes: readonly { readonly path: string; readonly bytes: Uint8Array }[];
    readonly message: string;
    readonly expectedEntries: readonly { readonly status: "A" | "M"; readonly path: string }[];
    readonly transaction: GitProjectTransaction;
  }): Promise<void> {
    let journal = await this.options.jobs.prepareTransaction({
      transactionId: crypto.randomUUID(),
      kind: input.kind,
      projectId: input.projectId,
      jobId: input.jobId,
      baseCommitSha: input.baseCommitSha,
      writes: input.writes,
    });
    try {
      journal = await this.options.jobs.publishTransaction(
        journal,
        (path) => this.#transactionPoint(`after-publish:${path}`),
      );
      await input.transaction.commit(input.message, {
        allowlist: input.expectedEntries.map((entry) => entry.path).sort(),
        expectedEntries: [...input.expectedEntries].sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
        hooks: this.#commitHooks(),
      });
      await this.options.jobs.completeTransaction(journal);
    } catch (error) {
      if (error instanceof ResolveSimulatedProcessCrash) throw error;
      let diagnostic: ResolveRecoveryDiagnostic;
      try {
        diagnostic = await this.#reconcileJournal(journal, input.transaction);
      } catch {
        throw new ResolveExportServiceError(
          "RECOVERY_FAILED",
          "Resolve transaction recovery failed",
          { projectId: input.projectId, jobId: input.jobId },
        );
      }
      if (diagnostic.action === "rolled-forward") return;
      throw error;
    }
  }

  async #loadProject(projectId: string): Promise<Project> {
    const project = await this.options.projects.loadProject(projectId);
    if (!project) {
      throw new ResolveExportServiceError("PROJECT_NOT_FOUND", "Project does not exist", { projectId });
    }
    return project;
  }

  async #readAuthoritativeProject(projectId: string): Promise<Project> {
    try {
      return JSON.parse(
        await readFile(join(this.options.projects.projectDir(projectId), "project.json"), "utf8"),
      ) as Project;
    } catch {
      throw new ResolveExportServiceError("PROJECT_NOT_FOUND", "Project cannot be read", { projectId });
    }
  }

  async #confirmedRevision(projectId: string): Promise<string> {
    return (await this.#confirmedReceipt(projectId)).commitSha!;
  }

  async #confirmedReceipt(projectId: string): Promise<GitCommitReceipt> {
    const receipt = await this.options.git.readConfirmedReceipt(projectId);
    if (!receipt?.commitSha) {
      throw new ResolveExportServiceError(
        "PROJECT_REVISION_UNAVAILABLE",
        "Project has no confirmed revision",
        { projectId },
      );
    }
    return receipt;
  }

  async #commitJobTransition(
    found: PersistedResolveExportJob,
    kind: Extract<ResolveTransactionKind, "cancel" | "redeem">,
    message: string,
    updater: (current: PersistedResolveExportJob) => PersistedResolveExportJob | Promise<PersistedResolveExportJob>,
  ): Promise<PersistedResolveExportJob> {
    const projectId = found.job.projectId;
    const jobId = found.job.id;
    return this.options.git.withProjectTransaction(projectId, async (transaction) => {
      const before = await this.options.jobs.load(projectId, jobId);
      if (!before) {
        throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { projectId, jobId });
      }
      let updated: PersistedResolveExportJob;
      try {
        updated = await updater(before);
      } catch (error) {
        if (error instanceof ResolveExportServiceError) throw error;
        throw new ResolveExportServiceError(
          "EXPORT_PERSIST_FAILED",
          "Resolve job transition could not be persisted",
          { projectId, jobId },
        );
      }
      if (JSON.stringify(before) === JSON.stringify(updated)) return updated;

      const relativePath = `exports/resolve/${jobId}/job.json`;
      try {
        await this.#runJournaledTransaction({
          kind,
          projectId,
          jobId,
          baseCommitSha: await this.#confirmedRevision(projectId),
          writes: [{ path: relativePath, bytes: this.options.jobs.recordBytes(updated) }],
          message,
          expectedEntries: [{ status: "M", path: relativePath }],
          transaction,
        });
        return updated;
      } catch (error) {
        if (error instanceof ResolveSimulatedProcessCrash || error instanceof ResolveExportServiceError) throw error;
        throw new ResolveExportServiceError(
          "EXPORT_PERSIST_FAILED",
          "Resolve job transition could not be committed",
          { projectId, jobId },
        );
      }
    });
  }

  async preview(projectId: string): Promise<ResolvePreview> {
    await this.#ensureRecovered();
    const project = await this.#loadProject(projectId);
    const revision = await this.#confirmedRevision(projectId);
    const audit = await this.options.projects.auditSnapshot(project);
    return buildResolvePreview(project, revision, previewAvailability(project, audit));
  }

  async start(
    projectId: string,
    revision: string,
    selection: HandoffSelection,
  ): Promise<ResolveExportJob> {
    await this.#ensureRecovered();
    await this.#loadProject(projectId);
    if (selection.projectId !== projectId || selection.target !== "resolve") {
      throw new ResolveExportServiceError(
        "INVALID_HANDOFF_SELECTION",
        "Resolve selection does not match the requested project",
        { projectId },
      );
    }

    return this.options.git.withProjectTransaction(projectId, async (transaction) => {
      const confirmed = await this.#confirmedReceipt(projectId);
      if (revision !== confirmed.commitSha) {
        throw new ResolveExportServiceError(
          "STALE_PROJECT_REVISION",
          "Requested project revision is not current",
          { projectId },
        );
      }
      const worktreeBytes = await readFile(
        join(this.options.projects.projectDir(projectId), "project.json"),
      );
      if (!confirmed.projectBlobSha || gitBlobSha(worktreeBytes) !== confirmed.projectBlobSha) {
        throw new ResolveExportServiceError(
          "WORKTREE_REVISION_MISMATCH",
          "Project worktree does not match the confirmed revision",
          { projectId },
        );
      }
      const project = await this.options.git.getProjectAtCommit(projectId, revision);
      if (!project) {
        throw new ResolveExportServiceError(
          "PROJECT_REVISION_UNAVAILABLE",
          "Confirmed project snapshot cannot be read",
          { projectId },
        );
      }
      if (selection.projectModifiedAt !== project.modifiedAt) {
        throw new ResolveExportServiceError(
          "STALE_PROJECT_REVISION",
          "Resolve selection was made from a stale project snapshot",
          { projectId },
        );
      }
      const audit = await this.options.projects.auditSnapshot(project);
      if (!auditComplete(audit)) {
        throw new ResolveExportServiceError(
          "MEDIA_INCOMPLETE",
          "Required media is unavailable",
          { projectId, mediaIds: missingMediaIds(audit) },
        );
      }

      const assessment = assessHandoff(project, selection, {
        targetProfiles: HANDOFF_TARGET_PROFILES,
        mediaAvailability: mediaAvailability(project, audit),
        now: this.#now,
      });
      if (assessment.status !== "ready") {
        throw new ResolveExportServiceError(
          "EXPORT_BLOCKED",
          "Compatibility assessment blocked the Resolve export",
          { projectId },
        );
      }
      const profile = HANDOFF_TARGET_PROFILES.get("resolve");
      if (!profile) {
        throw new ResolveExportServiceError("EXPORT_BLOCKED", "Resolve target profile is unavailable", { projectId });
      }
      const plan = createHandoffPlan(project, assessment, profile);
      const timestamp = this.#now();
      const createdAt = iso(timestamp);
      const jobId = this.#randomUUID();
      const launchToken = this.#randomUUID();
      const projectName = plan.project.name;
      const job: ResolveExportJob = {
        id: jobId,
        projectId,
        revision,
        phase: "ready",
        processed: plan.clips.length,
        total: plan.clips.length,
        percent: 100,
        warnings: assessment.issues.filter((issue) => issue.severity === "flattening").map((issue) => issue.message),
        createdAt,
        updatedAt: createdAt,
        bridgeLaunchUrl: `openreel-resolve://import/${launchToken}`,
      };

      try {
        const fcpxmlName = `${projectName}.fcpxml`;
        const fcpxmlBytes = Buffer.from(serializeResolveFcpxml(plan), "utf8");
        const fcpxml = this.options.jobs.describeArtifact(jobId, fcpxmlName, fcpxmlBytes);
        const manifestPayload = {
          schemaVersion: "1.0",
          jobId,
          projectId,
          revision,
          planId: plan.planId,
          target: { id: profile.id, contractVersion: profile.contractVersion },
          selection,
          requiredMedia: audit.requiredMediaManifest.map((entry) => ({
            mediaId: entry.mediaId,
            semanticFilename: entry.semanticFilename,
            canonicalRelativePath: entry.relativePhysicalPath,
            expectedByteSize: entry.expectedByteSize,
            lfsOid: entry.lfsOid,
          })),
          artifacts: [{ path: fcpxml.path, byteLength: fcpxml.byteLength, sha256: fcpxml.sha256 }],
        };
        const manifestBytes = Buffer.from(`${JSON.stringify(manifestPayload, null, 2)}\n`, "utf8");
        const manifest = this.options.jobs.describeArtifact(jobId, "manifest.json", manifestBytes);
        const reportBytes = Buffer.from(
          renderCompatibilityReport(reportFor(project, plan, [fcpxml, manifest], createdAt)),
          "utf8",
        );
        const report = this.options.jobs.describeArtifact(jobId, "compatibility-report.md", reportBytes);
        const persisted: PersistedResolveExportJob = {
          version: 1,
          job,
          selection,
          launchToken: {
            sha256: sha256(launchToken),
            expiresAt: iso(timestamp + TOKEN_TTL_MS),
            redeemedAt: null,
          },
          artifacts: [fcpxml, manifest, report],
        };
        const jobPath = `exports/resolve/${jobId}/job.json`;
        const writes = [
          { path: fcpxml.path, bytes: fcpxmlBytes },
          { path: manifest.path, bytes: manifestBytes },
          { path: report.path, bytes: reportBytes },
          { path: jobPath, bytes: this.options.jobs.recordBytes(persisted) },
        ];
        const exportPaths = writes.map((write) => write.path).sort();
        await this.#runJournaledTransaction({
          kind: "start",
          projectId,
          jobId,
          baseCommitSha: revision,
          writes,
          message: `feat(resolve): persist export ${jobId}`,
          expectedEntries: exactEntries(exportPaths, "A"),
          transaction,
        });
        return job;
      } catch (error) {
        if (error instanceof ResolveSimulatedProcessCrash || error instanceof ResolveExportServiceError) throw error;
        throw new ResolveExportServiceError(
          "EXPORT_PERSIST_FAILED",
          "Resolve export artifacts could not be persisted",
          { projectId, jobId },
        );
      }
    });
  }

  async status(jobId: string): Promise<ResolveExportJob> {
    await this.#ensureRecovered();
    const record = await this.options.jobs.find(jobId);
    if (!record) {
      throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { jobId });
    }
    return record.job;
  }

  async cancel(jobId: string): Promise<ResolveExportJob> {
    await this.#ensureRecovered();
    const found = await this.options.jobs.find(jobId);
    if (!found) {
      throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { jobId });
    }
    const updated = await this.#commitJobTransition(found, "cancel", `chore(resolve): cancel export ${jobId}`, async (current) => {
      if (current.job.phase === "cancelled") return current;
      const phase = lifecyclePhase(current, "cancel");
      return {
        ...current,
        job: { ...current.job, phase, updatedAt: iso(this.#now()) },
      };
    });
    return updated.job;
  }

  async redeem(launchToken: string): Promise<ResolveLaunchPayload> {
    await this.#ensureRecovered();
    const tokenHash = sha256(launchToken);
    const found = await this.options.jobs.findByTokenHash(tokenHash);
    if (!found) {
      throw new ResolveExportServiceError("LAUNCH_TOKEN_INVALID", "Resolve launch token is invalid");
    }
    const updated = await this.#commitJobTransition(
      found,
      "redeem",
      `chore(resolve): redeem export ${found.job.id}`,
      async (current) => {
      if (!sameSha256(current.launchToken.sha256, tokenHash)) {
        throw new ResolveExportServiceError("LAUNCH_TOKEN_INVALID", "Resolve launch token is invalid");
      }
      if (current.launchToken.redeemedAt) {
        throw new ResolveExportServiceError("LAUNCH_TOKEN_USED", "Resolve launch token was already used", {
          projectId: current.job.projectId,
          jobId: current.job.id,
        });
      }
      if (this.#now() >= Date.parse(current.launchToken.expiresAt)) {
        throw new ResolveExportServiceError("LAUNCH_TOKEN_EXPIRED", "Resolve launch token has expired", {
          projectId: current.job.projectId,
          jobId: current.job.id,
        });
      }
      const phase = lifecyclePhase(current, "redeem");
      const redeemedAt = iso(this.#now());
      return {
        ...current,
        launchToken: { ...current.launchToken, redeemedAt },
        job: { ...current.job, phase, updatedAt: redeemedAt },
      };
      },
    );
    const artifactAccessToken = this.#randomUUID();
    this.#artifactCapabilities.set(sha256(artifactAccessToken), {
      jobId: updated.job.id,
      projectId: updated.job.projectId,
      expiresAt: this.#now() + TOKEN_TTL_MS,
    });
    return {
      jobId: updated.job.id,
      projectId: updated.job.projectId,
      revision: updated.job.revision,
      artifacts: updated.artifacts,
      artifactAccessToken,
    };
  }

  async readArtifact(projectId: string, jobId: string, name: string, artifactAccessToken: string): Promise<{ readonly mediaType: string; readonly bytes: Buffer }> {
    await this.#ensureRecovered();
    const requestedHash = sha256(artifactAccessToken);
    const capability = [...this.#artifactCapabilities.entries()].find(([storedHash]) => crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(requestedHash)))?.[1];
    if (!capability || capability.projectId !== projectId || capability.jobId !== jobId || this.#now() >= capability.expiresAt) {
      throw new ResolveExportServiceError("ARTIFACT_CAPABILITY_EXPIRED", "Resolve artifact capability expired; start a new export job", { projectId, jobId });
    }
    const record = await this.options.jobs.find(jobId);
    if (!record || record.job.projectId !== projectId) throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { projectId, jobId });
    const artifact = record.artifacts.find((candidate) => basename(candidate.path) === name);
    if (!artifact || basename(name) !== name) throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve artifact does not exist", { projectId, jobId });
    return { mediaType: artifact.mediaType, bytes: await readFile(join(this.options.projects.projectDir(projectId), artifact.path)) };
  }

  async recordImportResult(jobId: string, input: ResolveImportResult): Promise<ResolveImportResult> {
    await this.#ensureRecovered();
    let result: ResolveImportResult;
    try {
      result = ResolveImportResultSchema.parse(input);
    } catch {
      throw new ResolveExportServiceError("IMPORT_RESULT_INVALID", "Resolve import result is invalid", { jobId });
    }
    const found = await this.options.jobs.find(jobId);
    if (!found) {
      throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { jobId });
    }
    if (found.result) {
      if (sameResult(found.result, result)) return found.result;
      throw new ResolveExportServiceError("IMPORT_RESULT_CONFLICT", "Resolve import result conflicts with the persisted result", {
        projectId: found.job.projectId,
        jobId,
      });
    }

    const fcpxml = found.artifacts.find((artifact) => artifact.path.endsWith(".fcpxml"));
    if (!fcpxml || fcpxml.sha256 !== result.artifactSha256) {
      throw new ResolveExportServiceError("IMPORT_RESULT_INVALID", "Resolve import artifact hash does not match", {
        projectId: found.job.projectId,
        jobId,
      });
    }

    return this.options.git.withProjectTransaction(found.job.projectId, async (transaction) => {
      const current = await this.options.jobs.load(found.job.projectId, jobId);
      if (!current) {
        throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { jobId });
      }
      if (current.result) {
        if (sameResult(current.result, result)) return current.result;
        throw new ResolveExportServiceError("IMPORT_RESULT_CONFLICT", "Resolve import result conflicts with the persisted result", {
          projectId: current.job.projectId,
          jobId,
        });
      }
      const terminalPhase = lifecyclePhase(
        current,
        result.status === "completed" ? "result-completed" : "result-failed",
      );

      const baseCommitSha = await this.#confirmedRevision(current.job.projectId);
      const project = await this.#readAuthoritativeProject(current.job.projectId);
      const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
      const referencedIds = [...new Set(result.referencedMediaIds)].sort();
      const unknown = referencedIds.filter((mediaId) => !mediaById.has(mediaId));
      if (unknown.length > 0) {
        throw new ResolveExportServiceError(
          "IMPORT_RESULT_INVALID",
          "Resolve import result references unknown media",
          { projectId: project.id, jobId, mediaIds: unknown },
        );
      }
      const referenced = new Set(referencedIds);
      const projectChanged = referencedIds.some((mediaId) => !mediaById.get(mediaId)?.externallyReferenced);
      const updatedProject: Project = projectChanged ? {
        ...project,
        modifiedAt: this.#now(),
        mediaLibrary: {
          ...project.mediaLibrary,
          items: project.mediaLibrary.items.map((item) =>
            referenced.has(item.id) ? { ...item, externallyReferenced: true } : item),
        },
      } : project;
      const terminalAt = iso(this.#now());
      const updatedRecord: PersistedResolveExportJob = {
        ...current,
        result,
        job: {
          ...current.job,
          phase: terminalPhase,
          updatedAt: terminalAt,
        },
      };
      const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
      const jobPath = `exports/resolve/${jobId}/job.json`;
      const resultPath = `exports/resolve/${jobId}/result.json`;
      const writes = [
        { path: jobPath, bytes: this.options.jobs.recordBytes(updatedRecord) },
        { path: resultPath, bytes: resultBytes },
        ...(projectChanged
          ? [{ path: "project.json", bytes: Buffer.from(JSON.stringify(updatedProject, null, 2), "utf8") }]
          : []),
      ];
      const expectedEntries = [
        { status: "M" as const, path: jobPath },
        { status: "A" as const, path: resultPath },
        ...(projectChanged ? [{ status: "M" as const, path: "project.json" }] : []),
      ].sort((left, right) => left.path.localeCompare(right.path));
      try {
        await this.#runJournaledTransaction({
          kind: "import-result",
          projectId: current.job.projectId,
          jobId,
          baseCommitSha,
          writes,
          message: `feat(resolve): record import result ${jobId}`,
          expectedEntries,
          transaction,
        });
        return result;
      } catch (error) {
        if (error instanceof ResolveSimulatedProcessCrash || error instanceof ResolveExportServiceError) throw error;
        throw new ResolveExportServiceError(
          "IMPORT_RESULT_PERSIST_FAILED",
          "Resolve import result could not be persisted",
          { projectId: current.job.projectId, jobId },
        );
      }
    });
  }
}
