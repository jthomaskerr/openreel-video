import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { Client } from "wavespeed";
import { config } from "../env.js";
import { FileGenerationJobRepository } from "../services/generation/index.js";
import { UploadRepository } from "../services/generation/index.js";
import { rejectBrowserProviderKey, requireJsonContentType, validateModel } from "../services/wavespeed/index.js";

export const wavespeedRouter: ExpressRouter = Router();
const jobs = new FileGenerationJobRepository(config.generationDataDir);
const uploads = new UploadRepository(`${config.generationDataDir}/uploads`);
const owner = (req: any) => ({ ownerId: String(req.header("x-user-id") || "anonymous"), projectId: String(req.header("x-project-id") || req.body?.context?.projectId || "") });
const safe = (res: any, status: number, code: string) => res.status(status).json({ error: code });
function guard(req: any, res: any) { try { rejectBrowserProviderKey(req.headers); } catch { safe(res, 400, "provider-key-header-forbidden"); return false; } return true; }

wavespeedRouter.get("/config", (_req, res) => res.json({ configured: Boolean(config.wavespeedApiKey) }));
wavespeedRouter.get("/models", async (_req, res) => {
  if (!config.wavespeedApiKey) return safe(res, 503, "provider-not-configured");
  try { const result = await fetch("https://api.wavespeed.ai/api/v3/models", { headers: { Authorization: `Bearer ${config.wavespeedApiKey}` } }); if (!result.ok) return safe(res, 502, "model-discovery-failed"); return res.json({ models: (await result.json() as any).data ?? [] }); } catch { return safe(res, 502, "model-discovery-failed"); }
});

wavespeedRouter.post("/upload", async (req, res) => {
  if (!guard(req, res)) return; const { ownerId, projectId } = owner(req); if (!projectId) return safe(res, 400, "project-required");
  const mime = String(req.header("content-type") || "").split(";")[0]; const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  try { const record = await uploads.create({ ownerId, projectId, mimeType: mime, bytes }); return res.status(201).json({ uploadId: record.id, expiresAt: record.expiresAt }); } catch (e) { return safe(res, 400, e instanceof Error ? e.message : "upload-invalid"); }
});

wavespeedRouter.post("/", async (req, res) => {
  if (!guard(req, res)) return; try { requireJsonContentType(req.header("content-type")); } catch { return safe(res, 415, "content-type-required"); }
  if (!config.wavespeedApiKey) return safe(res, 503, "provider-not-configured"); const body = req.body as any;
  try { validateModel(String(body?.model), new Set([String(body?.model)])); if (!body?.context?.projectId || !body?.target) throw new Error("context-required"); const client = new Client(config.wavespeedApiKey) as any; const [providerJobId] = await client._submit(body.model, body.inputs ?? {}); const now = Date.now(); const job = await jobs.create({ ...body, schemaVersion: 2, id: body.id || crypto.randomUUID(), provider: "wavespeed", modelId: body.model, modelSchemaVersion: String(body.modelSchemaVersion || "unknown"), status: "queued", createdAt: now, updatedAt: now, attempts: [{ attemptNumber: 1, providerJobId, startedAt: now }], checkpoints: {} }); return res.status(202).json({ jobId: job.id, providerJobId }); } catch (e) { return safe(res, 400, e instanceof Error ? e.message : "generation-submit-failed"); }
});

wavespeedRouter.get("/:jobId", async (req, res) => { if (!guard(req, res)) return; const job = await jobs.get(req.params.jobId); if (!job) return safe(res, 404, "generation-not-found"); if (!config.wavespeedApiKey) return safe(res, 503, "provider-not-configured"); try { const providerJobId = job.attempts.at(-1)?.providerJobId; const result = await (new Client(config.wavespeedApiKey) as any)._getResult(providerJobId); const status = result.data?.status; const next = status === "completed" ? "completed" : status === "failed" ? "failed" : "running"; await jobs.update(job.id, (j) => ({ ...j, status: next, updatedAt: Date.now() })); return res.json({ status: next, jobId: job.id }); } catch { return safe(res, 502, "generation-status-failed"); } });
for (const action of ["cancel", "retry", "finalization-status", "placement-retry"] as const) wavespeedRouter.post(`/:jobId/${action}`, async (req, res) => { if (!guard(req, res)) return; const job = await jobs.get(req.params.jobId); if (!job) return safe(res, 404, "generation-not-found"); const status = action === "cancel" ? "canceling" : job.status; const updated = await jobs.update(job.id, (j) => ({ ...j, status: status as any, updatedAt: Date.now() })); return res.json({ jobId: updated.id, status: updated.status }); });
wavespeedRouter.post("/cleanup", async (_req, res) => res.json({ removed: await uploads.cleanup() }));
