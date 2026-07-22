import crypto from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  GitCommitReceipt,
  GitCommitTransaction,
  GitProjectTransaction,
} from "../projects/git-store";
import type { ProjectMediaManifestSnapshot } from "../projects/media-manifest";
import { buildResolvePreview, type PreviewMediaAvailability } from "./preview";
import {
  ResolveExportJobStore,
  type PersistedResolveExportJob,
  type ResolveExportArtifact,
} from "./job-store";

const TOKEN_TTL_MS = 5 * 60 * 1_000;

type BridgeErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_REVISION_UNAVAILABLE"
  | "STALE_PROJECT_REVISION"
  | "INVALID_HANDOFF_SELECTION"
  | "MEDIA_INCOMPLETE"
  | "EXPORT_BLOCKED"
  | "EXPORT_PERSIST_FAILED"
  | "RESOLVE_JOB_NOT_FOUND"
  | "LAUNCH_TOKEN_INVALID"
  | "LAUNCH_TOKEN_EXPIRED"
  | "LAUNCH_TOKEN_USED"
  | "JOB_TERMINAL"
  | "IMPORT_RESULT_CONFLICT"
  | "IMPORT_RESULT_INVALID"
  | "IMPORT_RESULT_PERSIST_FAILED";

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
}

export interface ResolveLaunchPayload {
  readonly jobId: string;
  readonly projectId: string;
  readonly revision: string;
  readonly artifacts: readonly ResolveExportArtifact[];
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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

async function atomicReplace(path: string, bytes: Buffer): Promise<void> {
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function sameResult(left: ResolveImportResult, right: ResolveImportResult): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ResolveExportService {
  readonly #now: () => number;
  readonly #randomUUID: () => string;

  constructor(private readonly options: ResolveExportServiceOptions) {
    this.#now = options.now ?? Date.now;
    this.#randomUUID = options.randomUUID ?? crypto.randomUUID;
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
    const receipt = await this.options.git.readConfirmedReceipt(projectId);
    if (!receipt?.commitSha) {
      throw new ResolveExportServiceError(
        "PROJECT_REVISION_UNAVAILABLE",
        "Project has no confirmed revision",
        { projectId },
      );
    }
    return receipt.commitSha;
  }

  async #commitJobTransition(
    found: PersistedResolveExportJob,
    message: string,
    updater: (current: PersistedResolveExportJob) => PersistedResolveExportJob | Promise<PersistedResolveExportJob>,
  ): Promise<PersistedResolveExportJob> {
    const projectId = found.job.projectId;
    const jobId = found.job.id;
    return this.options.git.withProjectTransaction(projectId, async (transaction) => {
      const jobPath = this.options.jobs.artifactPath(projectId, jobId, "job.json");
      const previousBytes = await readFile(jobPath);
      const before = await this.options.jobs.load(projectId, jobId);
      if (!before) {
        throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { projectId, jobId });
      }
      let updated: PersistedResolveExportJob;
      try {
        updated = await this.options.jobs.update(projectId, jobId, updater);
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
        await transaction.commit(message, {
          allowlist: [relativePath],
          expectedEntries: [{ status: "M", path: relativePath }],
        });
        return updated;
      } catch {
        await transaction.unstage([relativePath]).catch(() => undefined);
        await atomicReplace(jobPath, previousBytes).catch(() => undefined);
        throw new ResolveExportServiceError(
          "EXPORT_PERSIST_FAILED",
          "Resolve job transition could not be committed",
          { projectId, jobId },
        );
      }
    });
  }

  async preview(projectId: string): Promise<ResolvePreview> {
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
    await this.#loadProject(projectId);
    if (selection.projectId !== projectId || selection.target !== "resolve") {
      throw new ResolveExportServiceError(
        "INVALID_HANDOFF_SELECTION",
        "Resolve selection does not match the requested project",
        { projectId },
      );
    }

    return this.options.git.withProjectTransaction(projectId, async (transaction) => {
      const confirmed = await this.#confirmedRevision(projectId);
      if (revision !== confirmed) {
        throw new ResolveExportServiceError(
          "STALE_PROJECT_REVISION",
          "Requested project revision is not current",
          { projectId },
        );
      }
      const project = await this.#readAuthoritativeProject(projectId);
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

      let exportPaths: string[] = [];
      try {
        const fcpxml = await this.options.jobs.writeArtifact(
          projectId,
          jobId,
          `${projectName}.fcpxml`,
          serializeResolveFcpxml(plan),
        );
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
        const manifest = await this.options.jobs.writeArtifact(
          projectId,
          jobId,
          "manifest.json",
          `${JSON.stringify(manifestPayload, null, 2)}\n`,
        );
        const report = await this.options.jobs.writeArtifact(
          projectId,
          jobId,
          "compatibility-report.md",
          renderCompatibilityReport(reportFor(project, plan, [fcpxml, manifest], createdAt)),
        );
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
        await this.options.jobs.save(persisted);

        exportPaths = [fcpxml.path, manifest.path, report.path, `exports/resolve/${jobId}/job.json`].sort();
        await transaction.commit(
          `feat(resolve): persist export ${jobId}`,
          { allowlist: exportPaths, expectedEntries: exactEntries(exportPaths, "A") },
        );
        return job;
      } catch (error) {
        await transaction.unstage(exportPaths).catch(() => undefined);
        await this.options.jobs.removeJob(projectId, jobId).catch(() => undefined);
        if (error instanceof ResolveExportServiceError) throw error;
        throw new ResolveExportServiceError(
          "EXPORT_PERSIST_FAILED",
          "Resolve export artifacts could not be persisted",
          { projectId, jobId },
        );
      }
    });
  }

  async status(jobId: string): Promise<ResolveExportJob> {
    const record = await this.options.jobs.find(jobId);
    if (!record) {
      throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { jobId });
    }
    return record.job;
  }

  async cancel(jobId: string): Promise<ResolveExportJob> {
    const found = await this.options.jobs.find(jobId);
    if (!found) {
      throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist", { jobId });
    }
    const updated = await this.#commitJobTransition(found, `chore(resolve): cancel export ${jobId}`, async (current) => {
      if (current.job.phase === "cancelled") return current;
      if (["completed", "failed"].includes(current.job.phase)) {
        throw new ResolveExportServiceError("JOB_TERMINAL", "Terminal Resolve job cannot be cancelled", {
          projectId: current.job.projectId,
          jobId,
        });
      }
      return {
        ...current,
        job: { ...current.job, phase: "cancelled", updatedAt: iso(this.#now()) },
      };
    });
    return updated.job;
  }

  async redeem(launchToken: string): Promise<ResolveLaunchPayload> {
    const tokenHash = sha256(launchToken);
    const found = await this.options.jobs.findByTokenHash(tokenHash);
    if (!found) {
      throw new ResolveExportServiceError("LAUNCH_TOKEN_INVALID", "Resolve launch token is invalid");
    }
    const updated = await this.#commitJobTransition(
      found,
      `chore(resolve): redeem export ${found.job.id}`,
      async (current) => {
      if (current.launchToken.sha256 !== tokenHash) {
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
      const redeemedAt = iso(this.#now());
      return {
        ...current,
        launchToken: { ...current.launchToken, redeemedAt },
        job: { ...current.job, phase: "importing", updatedAt: redeemedAt },
      };
      },
    );
    return {
      jobId: updated.job.id,
      projectId: updated.job.projectId,
      revision: updated.job.revision,
      artifacts: updated.artifacts,
    };
  }

  async recordImportResult(jobId: string, input: ResolveImportResult): Promise<ResolveImportResult> {
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

      const projectPath = join(this.options.projects.projectDir(current.job.projectId), "project.json");
      const resultPath = this.options.jobs.artifactPath(current.job.projectId, jobId, "result.json");
      const jobPath = this.options.jobs.artifactPath(current.job.projectId, jobId, "job.json");
      const previousProject = await readFile(projectPath);
      const previousJob = await readFile(jobPath);
      const project = JSON.parse(previousProject.toString("utf8")) as Project;
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
          phase: result.status === "completed" ? "completed" : "failed",
          updatedAt: terminalAt,
        },
      };
      const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
      const paths = [
        `exports/resolve/${jobId}/job.json`,
        `exports/resolve/${jobId}/result.json`,
        ...(projectChanged ? ["project.json"] : []),
      ].sort();
      try {
        if (projectChanged) {
          await atomicReplace(projectPath, Buffer.from(JSON.stringify(updatedProject, null, 2), "utf8"));
        }
        await this.options.jobs.writeArtifact(current.job.projectId, jobId, "result.json", resultBytes);
        await this.options.jobs.save(updatedRecord);
        const expectedEntries = [
          { status: "M" as const, path: `exports/resolve/${jobId}/job.json` },
          { status: "A" as const, path: `exports/resolve/${jobId}/result.json` },
          ...(projectChanged ? [{ status: "M" as const, path: "project.json" }] : []),
        ].sort((left, right) => left.path.localeCompare(right.path));
        await transaction.commit(
          `feat(resolve): record import result ${jobId}`,
          { allowlist: paths, expectedEntries },
        );
        return result;
      } catch {
        await transaction.unstage(paths).catch(() => undefined);
        await atomicReplace(projectPath, previousProject).catch(() => undefined);
        await atomicReplace(jobPath, previousJob).catch(() => undefined);
        await rm(resultPath, { force: true }).catch(() => undefined);
        throw new ResolveExportServiceError(
          "IMPORT_RESULT_PERSIST_FAILED",
          "Resolve import result could not be persisted",
          { projectId: current.job.projectId, jobId },
        );
      }
    });
  }
}
