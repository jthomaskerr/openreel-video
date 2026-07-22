import { Router, type Request, type Response } from "express";
import {
  ResolveImportResultSchema,
  type HandoffSelection,
  type ResolveExportJob,
  type ResolveImportResult,
  type ResolvePreview,
} from "@openreel/core";
import { ResolveExportServiceError, type ResolveLaunchPayload } from "./service";

export interface ResolveExportRouteService {
  preview(projectId: string): Promise<ResolvePreview>;
  start(projectId: string, revision: string, selection: HandoffSelection): Promise<ResolveExportJob>;
  status(jobId: string): Promise<ResolveExportJob>;
  cancel(jobId: string): Promise<ResolveExportJob>;
  redeem(launchToken: string): Promise<ResolveLaunchPayload>;
  recordImportResult(jobId: string, input: ResolveImportResult): Promise<ResolveImportResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,126}[A-Za-z0-9])?$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;

type ResolveStartRequest = { readonly revision: string; readonly selection: HandoffSelection };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseStartRequest(value: unknown): ResolveStartRequest | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["revision", "selection"]) || typeof value.revision !== "string" || !COMMIT_SHA.test(value.revision)) return null;
  const selection = value.selection;
  if (!isPlainRecord(selection) || !hasOnlyKeys(selection, ["projectId", "projectModifiedAt", "target", "range"])
    || typeof selection.projectId !== "string" || !selection.projectId
    || typeof selection.projectModifiedAt !== "number" || !Number.isFinite(selection.projectModifiedAt)
    || selection.target !== "resolve" || !isPlainRecord(selection.range)) return null;
  const range = selection.range;
  if (!hasOnlyKeys(range, ["startTime", "endTime"])
    || typeof range.startTime !== "number" || !Number.isFinite(range.startTime)
    || typeof range.endTime !== "number" || !Number.isFinite(range.endTime)
    || range.startTime < 0 || range.endTime <= range.startTime) return null;
  return {
    revision: value.revision,
    selection: {
      projectId: selection.projectId,
      projectModifiedAt: selection.projectModifiedAt,
      target: "resolve",
      range: { startTime: range.startTime, endTime: range.endTime },
    },
  };
}

function safeError(status: number, code: string): { readonly error: { readonly code: string; readonly message: string } } {
  const messages: Record<number, string> = {
    400: "The Resolve export request is invalid.",
    404: "The requested Resolve resource was not found.",
    409: "The Resolve export conflicts with its current state.",
    410: "The Resolve launch request is no longer available.",
    500: "The Resolve export could not be processed.",
  };
  return { error: { code, message: messages[status] ?? messages[500] } };
}

function statusFor(error: unknown): { readonly status: number; readonly code: string } {
  if (!(error instanceof ResolveExportServiceError)) return { status: 500, code: "RESOLVE_EXPORT_FAILED" };
  switch (error.code) {
    case "INVALID_HANDOFF_SELECTION":
    case "IMPORT_RESULT_INVALID":
      return { status: 400, code: error.code };
    case "PROJECT_NOT_FOUND":
    case "PROJECT_REVISION_UNAVAILABLE":
    case "RESOLVE_JOB_NOT_FOUND":
    case "LAUNCH_TOKEN_INVALID":
      return { status: 404, code: error.code };
    case "LAUNCH_TOKEN_EXPIRED":
    case "LAUNCH_TOKEN_USED":
      return { status: 410, code: error.code };
    case "STALE_PROJECT_REVISION":
    case "WORKTREE_REVISION_MISMATCH":
    case "MEDIA_INCOMPLETE":
    case "EXPORT_BLOCKED":
    case "JOB_TERMINAL":
    case "INVALID_JOB_TRANSITION":
    case "IMPORT_RESULT_CONFLICT":
      return { status: 409, code: error.code };
    default:
      return { status: 500, code: error.code };
  }
}

function sendFailure(res: Response, error: unknown): void {
  const { status, code } = statusFor(error);
  // Request-scoped IDs and raw errors can contain paths, tokens, or provider details.
  console.warn("[Resolve export] route request failed", { code, status });
  res.status(status).json(safeError(status, code));
}

function validProjectId(projectId: string): boolean {
  return PROJECT_ID.test(projectId);
}

async function projectJob(
  service: ResolveExportRouteService,
  projectId: string,
  jobId: string,
): Promise<ResolveExportJob> {
  if (!UUID.test(jobId)) throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist");
  const job = await service.status(jobId);
  if (job.projectId !== projectId) throw new ResolveExportServiceError("RESOLVE_JOB_NOT_FOUND", "Resolve job does not exist");
  return job;
}

export function isLoopbackRemoteAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  if (ipv4 === "::1") return true;
  const octets = ipv4.split(".");
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) && Number(octets[0]) === 127;
}

type ResolveRouterOptions = { readonly peerIsLoopback?: (address: string | undefined) => boolean };

function publicJob(job: ResolveExportJob) {
  const { bridgeLaunchUrl: _bridgeLaunchUrl, ...safe } = job;
  return safe;
}

export function createResolveExportRouter(service: ResolveExportRouteService, options: ResolveRouterOptions = {}): Router {
  const router = Router();
  const peerIsLoopback = options.peerIsLoopback ?? isLoopbackRemoteAddress;

  router.get("/:projectId/resolve-preview", async (req, res) => {
    if (!validProjectId(req.params.projectId)) return res.status(400).json(safeError(400, "INVALID_PROJECT_ID"));
    try {
      return res.json(await service.preview(req.params.projectId));
    } catch (error) {
      sendFailure(res, error);
      return undefined;
    }
  });

  router.post("/:projectId/exports/resolve", async (req, res) => {
    if (!validProjectId(req.params.projectId)) return res.status(400).json(safeError(400, "INVALID_PROJECT_ID"));
    const input = parseStartRequest(req.body);
    if (!input) return res.status(400).json(safeError(400, "INVALID_RESOLVE_EXPORT_REQUEST"));
    try {
      const job = await service.start(req.params.projectId, input.revision, input.selection);
      const statusUrl = `/api/projects/${req.params.projectId}/exports/resolve/${job.id}`;
      return res.status(202).json({ job: publicJob(job), jobId: job.id, revision: job.revision, phase: job.phase, statusUrl, cancelUrl: statusUrl, bridgeLaunchUrl: job.bridgeLaunchUrl });
    } catch (error) {
      sendFailure(res, error);
      return undefined;
    }
  });

  router.get("/:projectId/exports/resolve/:jobId", async (req, res) => {
    if (!validProjectId(req.params.projectId)) return res.status(400).json(safeError(400, "INVALID_PROJECT_ID"));
    try {
      return res.json(publicJob(await projectJob(service, req.params.projectId, req.params.jobId)));
    } catch (error) {
      sendFailure(res, error);
      return undefined;
    }
  });

  router.delete("/:projectId/exports/resolve/:jobId", async (req, res) => {
    if (!validProjectId(req.params.projectId)) return res.status(400).json(safeError(400, "INVALID_PROJECT_ID"));
    try {
      await projectJob(service, req.params.projectId, req.params.jobId);
      return res.json(publicJob(await service.cancel(req.params.jobId)));
    } catch (error) {
      sendFailure(res, error);
      return undefined;
    }
  });

  router.post("/:projectId/exports/resolve/:jobId/import-result", async (req, res) => {
    if (!peerIsLoopback(req.socket.remoteAddress)) return res.status(404).json(safeError(404, "IMPORT_RESULT_NOT_FOUND"));
    if (!validProjectId(req.params.projectId)) return res.status(400).json(safeError(400, "INVALID_PROJECT_ID"));
    const parsed = ResolveImportResultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(safeError(400, "IMPORT_RESULT_INVALID"));
    try {
      await projectJob(service, req.params.projectId, req.params.jobId);
      await service.recordImportResult(req.params.jobId, parsed.data);
      return res.status(202).json({ jobId: req.params.jobId, status: "accepted" });
    } catch (error) {
      sendFailure(res, error);
      return undefined;
    }
  });

  router.post("/resolve-launches/:launchToken/redeem", async (req: Request, res: Response) => {
    if (!peerIsLoopback(req.socket.remoteAddress)) return res.status(404).json(safeError(404, "LAUNCH_REDEMPTION_NOT_FOUND"));
    if (!UUID.test(req.params.launchToken)) return res.status(404).json(safeError(404, "LAUNCH_TOKEN_INVALID"));
    try {
      const payload = await service.redeem(req.params.launchToken);
      return res.json({
        jobId: payload.jobId,
        projectId: payload.projectId,
        revision: payload.revision,
        artifacts: payload.artifacts.map(({ path, mediaType, byteLength, sha256 }) => ({
          name: path.slice(path.lastIndexOf("/") + 1),
          url: `/api/projects/${payload.projectId}/exports/resolve/${payload.jobId}/artifacts/${encodeURIComponent(path.slice(path.lastIndexOf("/") + 1))}`,
          mediaType,
          byteLength,
          sha256,
        })),
      });
    } catch (error) {
      sendFailure(res, error);
      return undefined;
    }
  });

  return router;
}
