import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import {
  getRecordedWaveSpeedModelById,
  validateWaveSpeedProviderInputs,
} from "../../../../packages/core/src/generation/wavespeed";
import { Client } from "wavespeed";
import { config } from "../env.js";
import {
  FileGenerationJobRepository,
  UploadRepository,
} from "../services/generation/index.js";
import { WAVE_SPEED_REFERENCE_FIXTURES } from "../services/generation/references/fixtures/wavespeed.js";
import { mapProviderReferences } from "../services/generation/references/map.js";
import {
  rejectBrowserProviderKey,
  requireJsonContentType,
  validateModel,
} from "../services/wavespeed/index.js";

export const wavespeedRouter: ExpressRouter = Router();

const jobs = new FileGenerationJobRepository(config.generationDataDir);
const uploads = new UploadRepository(`${config.generationDataDir}/uploads`);

const owner = (req: any) => ({
  ownerId: String(req.header("x-user-id") || "anonymous"),
  projectId: String(req.header("x-project-id") || req.body?.context?.projectId || ""),
});

const safe = (res: any, status: number, code: string) =>
  res.status(status).json({ error: code });

function guard(req: any, res: any): boolean {
  try {
    rejectBrowserProviderKey(req.headers);
  } catch {
    safe(res, 400, "provider-key-header-forbidden");
    return false;
  }
  return true;
}

function findReferenceFixture(modelId: string) {
  return Object.values(WAVE_SPEED_REFERENCE_FIXTURES).find(
    (fixture) => fixture.modelId === modelId,
  );
}

function validateRecordedProviderInputs(
  modelId: string,
  providerInputs: Record<string, unknown>,
  mappedRoleFields?: Readonly<Record<string, "one" | "many">>,
): void {
  const recordedModel = getRecordedWaveSpeedModelById(modelId);
  if (!recordedModel) {
    return;
  }

  const schema = recordedModel.api_schema.api_schemas[0].request_schema;
  const errors = validateWaveSpeedProviderInputs({
    schema,
    inputs: providerInputs,
    mappedRoleFields,
  });
  if (errors.length === 0) {
    return;
  }

  const detail = errors.map(({ field, code }) => `${field}:${code}`).join(",");
  throw new Error(`invalid-provider-inputs:${detail}`);
}

wavespeedRouter.get("/config", (_req, res) => {
  res.json({ configured: Boolean(config.wavespeedApiKey) });
});

wavespeedRouter.get("/models", async (_req, res) => {
  if (!config.wavespeedApiKey) {
    return safe(res, 503, "provider-not-configured");
  }

  try {
    const result = await fetch("https://api.wavespeed.ai/api/v3/models", {
      headers: { Authorization: `Bearer ${config.wavespeedApiKey}` },
    });
    if (!result.ok) {
      return safe(res, 502, "model-discovery-failed");
    }

    return res.json({ models: ((await result.json()) as any).data ?? [] });
  } catch {
    return safe(res, 502, "model-discovery-failed");
  }
});

wavespeedRouter.post("/upload", async (req, res) => {
  if (!guard(req, res)) {
    return;
  }

  const { ownerId, projectId } = owner(req);
  if (!projectId) {
    return safe(res, 400, "project-required");
  }

  const mimeType = String(req.header("content-type") || "").split(";")[0];
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

  try {
    const record = await uploads.create({ ownerId, projectId, mimeType, bytes });
    return res.status(201).json({ uploadId: record.id, expiresAt: record.expiresAt });
  } catch (error) {
    return safe(res, 400, error instanceof Error ? error.message : "upload-invalid");
  }
});

wavespeedRouter.post("/", async (req, res) => {
  if (!guard(req, res)) {
    return;
  }

  try {
    requireJsonContentType(req.header("content-type"));
  } catch {
    return safe(res, 415, "content-type-required");
  }

  if (!config.wavespeedApiKey) {
    return safe(res, 503, "provider-not-configured");
  }

  const body = req.body as any;

  try {
    const model = String(body?.modelId ?? body?.model ?? "");
    validateModel(model, new Set([model]));

    if (!body?.context?.projectId || !body?.context?.target) {
      throw new Error("context-required");
    }

    const providerInputs = {
      ...(body?.providerInputs ?? body?.inputs ?? {}),
    } as Record<string, unknown>;

    const normalizedContext = {
      ...(body?.context ?? {}),
    } as Record<string, unknown>;
    const references = Array.isArray(body?.references) ? body.references : [];

    let finalProviderInputs = providerInputs;
    let mappedRoleFields: Readonly<Record<string, "one" | "many">> | undefined;
    if (references.length > 0) {
      const fixture = findReferenceFixture(model);
      if (!fixture) {
        throw new Error("reference-mapping-unsupported-model");
      }

      const mapped = mapProviderReferences(
        fixture,
        String(providerInputs.prompt ?? body?.prompt ?? ""),
        references,
      );
      finalProviderInputs = {
        ...providerInputs,
        ...mapped.inputs,
        prompt: mapped.prompt,
      };
      mappedRoleFields = Object.fromEntries(
        Object.values(fixture.roles).map((role) => [role.field, role.cardinality]),
      );
    }

    validateRecordedProviderInputs(model, finalProviderInputs, mappedRoleFields);

    const client = new Client(config.wavespeedApiKey) as any;
    const [providerJobId] = await client._submit(model, finalProviderInputs);
    const now = Date.now();
    const { references: _legacyReferences, ...jobBody } = body ?? {};
    const job = await jobs.create({
      ...jobBody,
      schemaVersion: 2,
      id: body.id || randomUUID(),
      provider: "wavespeed",
      modelId: model,
      modelSchemaVersion: String(body.modelSchemaVersion || "unknown"),
      context: normalizedContext,
      providerInputs: finalProviderInputs,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      attempts: [{ attemptNumber: 1, providerJobId, startedAt: now }],
      checkpoints: {},
    });

    return res.status(202).json({ jobId: job.id, providerJobId });
  } catch (error) {
    return safe(
      res,
      400,
      error instanceof Error ? error.message : "generation-submit-failed",
    );
  }
});

wavespeedRouter.get("/:jobId", async (req, res) => {
  if (!guard(req, res)) {
    return;
  }

  const job = await jobs.get(req.params.jobId);
  if (!job) {
    return safe(res, 404, "generation-not-found");
  }
  if (!config.wavespeedApiKey) {
    return safe(res, 503, "provider-not-configured");
  }

  try {
    const providerJobId = job.attempts.at(-1)?.providerJobId;
    const result = await (new Client(config.wavespeedApiKey) as any)._getResult(
      providerJobId,
    );
    const status = result.data?.status;
    const next =
      status === "completed"
        ? "completed"
        : status === "failed"
          ? "failed"
          : "running";

    await jobs.update(job.id, (current) => ({
      ...current,
      status: next,
      updatedAt: Date.now(),
    }));

    return res.json({ status: next, jobId: job.id });
  } catch {
    return safe(res, 502, "generation-status-failed");
  }
});

for (const action of [
  "cancel",
  "retry",
  "finalization-status",
  "placement-retry",
] as const) {
  wavespeedRouter.post(`/:jobId/${action}`, async (req, res) => {
    if (!guard(req, res)) {
      return;
    }

    const job = await jobs.get(req.params.jobId);
    if (!job) {
      return safe(res, 404, "generation-not-found");
    }

    const status = action === "cancel" ? "canceling" : job.status;
    const updated = await jobs.update(job.id, (current) => ({
      ...current,
      status: status as any,
      updatedAt: Date.now(),
    }));

    return res.json({ jobId: updated.id, status: updated.status });
  });
}

wavespeedRouter.post("/cleanup", async (_req, res) => {
  res.json({ removed: await uploads.cleanup() });
});
