import { Buffer } from "node:buffer";
import type {
  GenerationJob,
  GenerationProjectActionCommand,
  GenerationProjectActionResult,
  GenerationRouteIdentity,
  JsonValue,
} from "@openreel/music-video-domain/generation";
import {
  GenerationProjectActionCommandSchema,
  GenerationRouteIdentitySchema,
  GenerationStatusRequestSchema,
  GenerationSubmitRequestSchema,
} from "@openreel/music-video-domain/generation";
import { Router } from "express";
import type { Request, Response, Router as ExpressRouter } from "express";
import {
  parseWaveSpeedRequestSchema,
  validateWaveSpeedProviderInputs,
  type WaveSpeedRequestSchema,
} from "../../../../packages/core/src/generation/wavespeed";
import {
  GenerationOrchestrator,
  type GenerationFinalizerPort,
  type GenerationJobRepository,
  type GenerationProviderInputMaterializer,
  type GenerationProviderPort,
  type GenerationRouteManifestEntry,
  validateGenerationRequestBoundary,
} from "../services/generation/index.js";
import type { UploadRepository } from "../services/generation/uploads.js";
import { rejectBrowserProviderKey } from "../services/wavespeed/index.js";

const MAX_JSON_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export interface WaveSpeedRouterOptions {
  readonly repository: GenerationJobRepository;
  readonly uploads?: UploadRepository;
  readonly provider: GenerationProviderPort;
  readonly inputMaterializer?: GenerationProviderInputMaterializer;
  readonly routes: readonly ValidatedGenerationRouteManifestEntry[];
  readonly releaseEnabled: boolean;
  readonly configured: boolean;
  readonly authenticate: (request: Request) => { ownerId: string } | undefined;
  readonly owner: (input: { ownerId: string; projectId: string }) => boolean | Promise<boolean>;
  readonly discoverModels?: (input: { ownerId: string; projectId: string }) => Promise<unknown>;
  readonly createFinalizer: (repository: GenerationJobRepository) => {
    finalize(jobId: string, signal: {
      provider: string;
      providerJobId: string;
      outputIdentity?: string;
      transientOutputUrl?: string;
    }): Promise<GenerationJob>;
    reconcilePlacement(jobId: string): Promise<GenerationJob>;
    retryPlacement(jobId: string): Promise<GenerationJob>;
  };
  readonly applyProjectAction?: (command: GenerationProjectActionCommand) => Promise<GenerationProjectActionResult | unknown>;
  readonly clock?: () => number;
}

export type ValidatedGenerationRouteManifestEntry = GenerationRouteManifestEntry & {
  readonly inputSchema: Readonly<WaveSpeedRequestSchema>;
  readonly supportsAudio: boolean;
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validManifestEntry(value: unknown): value is ValidatedGenerationRouteManifestEntry {
  if (!record(value)) return false;
  const allowed = new Set([
    "identity",
    "schemaFingerprint",
    "clientSchemaFingerprint",
    "serverSchemaFingerprint",
    "clientAcceptance",
    "serverAcceptance",
    "configurationVersion",
    "inputSchema",
    "supportsAudio",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (!GenerationRouteIdentitySchema.safeParse(value.identity).success) return false;
  if (!record(value.inputSchema) || typeof value.supportsAudio !== "boolean") return false;
  try {
    parseWaveSpeedRequestSchema(value.inputSchema);
  } catch {
    return false;
  }
  for (const field of [
    "schemaFingerprint",
    "clientSchemaFingerprint",
    "serverSchemaFingerprint",
    "configurationVersion",
  ] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) return false;
  }
  return typeof value.clientAcceptance === "boolean" && typeof value.serverAcceptance === "boolean";
}

export function parseGenerationRouteManifest(json: string): readonly ValidatedGenerationRouteManifestEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("generation-route-manifest-invalid");
  }
  if (!Array.isArray(parsed) || !parsed.every(validManifestEntry)) {
    throw new Error("generation-route-manifest-invalid");
  }
  return deepFreeze(parsed.map((entry) => ({
    ...entry,
    identity: { ...entry.identity },
    inputSchema: parseWaveSpeedRequestSchema(entry.inputSchema),
  })));
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "generation-request-failed";
}

function statusFor(code: string): number {
  if (code === "generation-authentication-required") return 401;
  if (code === "generation-forbidden") return 403;
  if (code === "generation-not-found") return 404;
  if (code === "content-type-required") return 415;
  if (code === "provider-not-configured") return 503;
  if (
    code === "generation-v2-rollback-active"
    || code.includes("invalid-finalization-retry-state")
    || code.includes("invalid-placement-reconciliation-state")
    || code.includes("project-action-conflict")
  ) return 409;
  return 400;
}

function sendError(response: Response, error: unknown) {
  const code = errorCode(error);
  return response.status(statusFor(code)).json({ error: code });
}

function schemaError(result: { error: { issues: readonly { message: string }[] } }): Error {
  const issue = result.error.issues.find(({ message }) =>
    message.startsWith("generation-") || message === "content-type-required",
  );
  return new Error(issue?.message ?? "generation-request-invalid");
}

function projectHeader(request: Request): string {
  return String(request.header("x-project-id") ?? "");
}

function requestBoundary(request: Request) {
  const contentLength = Number(request.header("content-length") ?? Buffer.byteLength(JSON.stringify(request.body ?? {})));
  return {
    contentType: String(request.header("content-type") ?? ""),
    byteLength: contentLength,
    maxBytes: MAX_JSON_BYTES,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxTimeoutMs: REQUEST_TIMEOUT_MS,
  };
}

function outputKind(identity: GenerationRouteIdentity): "image" | "video" {
  return identity.requestedMode.endsWith("video") ? "video" : "image";
}

function routeKey(identity: GenerationRouteIdentity): string {
  return [
    identity.providerInstanceId,
    identity.providerModelId,
    identity.requestedMode,
    identity.providerSchemaId,
    identity.providerEndpointId,
    identity.providerSchemaVersion,
  ].join("\u0000");
}

function validateProviderInputs(
  route: ValidatedGenerationRouteManifestEntry,
  inputs: Record<string, JsonValue>,
): void {
  const errors = validateWaveSpeedProviderInputs({ schema: route.inputSchema, inputs });
  if (errors.length > 0) throw new Error("generation-provider-input-invalid");
}

export function createWaveSpeedRouter(options: WaveSpeedRouterOptions): ExpressRouter {
  const routes = parseGenerationRouteManifest(JSON.stringify(options.routes));
  const router = Router();
  const structuralFinalizer = options.createFinalizer(options.repository);
  const finalizer: GenerationFinalizerPort = {
    async finalize({ job, output }) {
      return structuralFinalizer.finalize(job.id, {
        provider: job.provider,
        providerJobId: output.providerJobId,
        ...(job.outputMediaIds?.[0] ? { outputIdentity: job.outputMediaIds[0] } : {}),
        ...(output.outputUrls?.[0] ? { transientOutputUrl: output.outputUrls[0] } : {}),
      });
    },
    reconcilePlacement: (jobId) => structuralFinalizer.reconcilePlacement(jobId),
    retryPlacement: (jobId) => structuralFinalizer.retryPlacement(jobId),
  };
  const orchestrator = new GenerationOrchestrator({
    repository: options.repository,
    provider: options.provider,
    inputMaterializer: options.inputMaterializer,
    routes,
    releaseEnabled: options.releaseEnabled,
    owner: options.owner,
    finalizer,
    clock: options.clock,
    requestBoundary: { validate: validateGenerationRequestBoundary },
  });

  function guard(request: Request, response: Response): { ownerId: string } | undefined {
    try {
      rejectBrowserProviderKey(request.headers);
    } catch {
      response.status(400).json({ error: "provider-key-header-forbidden" });
      return undefined;
    }
    const principal = options.authenticate(request);
    if (!principal) response.status(401).json({ error: "generation-authentication-required" });
    return principal;
  }

  async function authorizeProject(
    request: Request,
    response: Response,
    projectId: string,
  ): Promise<{ ownerId: string } | undefined> {
    const principal = guard(request, response);
    if (!principal) return undefined;
    const status = GenerationStatusRequestSchema.safeParse({ projectId, jobId: "authorization-check" });
    if (!status.success) {
      sendError(response, schemaError(status));
      return undefined;
    }
    if (!await options.owner({ ownerId: principal.ownerId, projectId })) {
      response.status(403).json({ error: "generation-forbidden" });
      return undefined;
    }
    return principal;
  }

  router.get("/config", (request, response) => {
    if (!guard(request, response)) return;
    const first = routes[0];
    return response.json({
      configured: options.configured,
      generationV2ReleaseEnabled: options.releaseEnabled,
      providerInstanceId: first?.identity.providerInstanceId,
      routes: routes.map(({ identity, supportsAudio, inputSchema }) => ({
        ...identity,
        output: outputKind(identity),
        supportsAudio,
        inputSchema,
      })),
    });
  });

  router.get("/models", async (request, response) => {
    try {
      const projectId = projectHeader(request);
      const principal = await authorizeProject(request, response, projectId);
      if (!principal) return;
      if (!options.configured) throw new Error("provider-not-configured");
      const models = options.discoverModels
        ? await options.discoverModels({ ownerId: principal.ownerId, projectId })
        : routes.map(({ identity, supportsAudio, inputSchema }) => ({ ...identity, supportsAudio, inputSchema }));
      return response.json({ models });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.post("/upload", async (request, response) => {
    try {
      const projectId = projectHeader(request);
      const principal = await authorizeProject(request, response, projectId);
      if (!principal) return;
      if (!options.uploads) throw new Error("generation-upload-unavailable");
      const mimeType = String(request.header("content-type") ?? "").split(";", 1)[0] ?? "";
      const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.from([]);
      const created = await options.uploads.create({ ownerId: principal.ownerId, projectId, mimeType, bytes });
      return response.status(201).json({ uploadId: created.id, expiresAt: created.expiresAt });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.post("/", async (request, response) => {
    try {
      const principal = guard(request, response);
      if (!principal) return;
      if (!options.configured) throw new Error("provider-not-configured");
      const parsed = GenerationSubmitRequestSchema.safeParse(request.body);
      if (!parsed.success) throw schemaError(parsed);
      if (projectHeader(request) && projectHeader(request) !== parsed.data.projectId) throw new Error("generation-forbidden");
      const selected = routes.find(({ identity }) => routeKey(identity) === routeKey(parsed.data.routing));
      if (!selected) throw new Error("generation-route-unsupported");
      if (!selected.supportsAudio && (parsed.data.context.audioAssetId || parsed.data.context.audioRange)) {
        throw new Error("generation-audio-unsupported");
      }
      const providerInputs = parsed.data.providerInputs as Record<string, JsonValue>;
      validateProviderInputs(selected, providerInputs);
      const now = options.clock?.() ?? Date.now();
      const job: GenerationJob = {
        schemaVersion: 2,
        contractVersion: 2,
        id: parsed.data.jobId,
        projectId: parsed.data.projectId,
        provider: "wavespeed",
        providerInstanceId: parsed.data.routing.providerInstanceId,
        modelId: parsed.data.routing.providerModelId,
        modelSchemaVersion: parsed.data.routing.providerSchemaVersion,
        routing: parsed.data.routing,
        status: "queued",
        attempt: 1,
        target: parsed.data.target,
        context: parsed.data.context,
        providerInputs,
        attempts: [{ attemptNumber: 1, routing: parsed.data.routing, startedAt: now }],
        checkpoints: {},
        createdAt: now,
        updatedAt: now,
      };
      const submitted = await orchestrator.submit({
        ownerId: principal.ownerId,
        job,
        request: requestBoundary(request),
      });
      return response.status(202).json({ job: submitted, jobId: submitted.id, providerJobId: submitted.providerJobId });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.post("/actions/:actionId", async (request, response) => {
    try {
      const parsed = GenerationProjectActionCommandSchema.safeParse(request.body);
      if (!parsed.success) throw schemaError(parsed);
      const principal = await authorizeProject(request, response, parsed.data.projectId);
      if (!principal) return;
      if (request.params.actionId !== parsed.data.actionId) throw new Error("generation-project-action-identity-mismatch");
      if (!options.applyProjectAction) throw new Error("generation-project-action-unavailable");
      const result = await options.applyProjectAction(parsed.data);
      return response.json({ result });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.get("/:jobId", async (request, response) => {
    try {
      const projectId = projectHeader(request);
      const parsed = GenerationStatusRequestSchema.safeParse({ projectId, jobId: request.params.jobId });
      if (!parsed.success) throw schemaError(parsed);
      const principal = guard(request, response);
      if (!principal) return;
      const job = await orchestrator.status({ ownerId: principal.ownerId, ...parsed.data });
      return response.json({ job, jobId: job.id, status: job.status });
    } catch (error) {
      return sendError(response, error);
    }
  });

  const actions = {
    cancel: (command: { ownerId: string; projectId: string; jobId: string }) => orchestrator.cancel(command),
    "retry-provider": (command: { ownerId: string; projectId: string; jobId: string }) => orchestrator.retryProvider(command),
    "retry-finalization": (command: { ownerId: string; projectId: string; jobId: string }) => orchestrator.retryFinalization(command),
    "retry-placement": (command: { ownerId: string; projectId: string; jobId: string }) => orchestrator.retryPlacement(command),
    "reconcile-placement": (command: { ownerId: string; projectId: string; jobId: string }) => orchestrator.reconcilePlacement(command),
  } as const;

  for (const [suffix, execute] of Object.entries(actions)) {
    router.post(`/:jobId/${suffix}`, async (request, response) => {
      try {
        const projectId = projectHeader(request);
        const parsed = GenerationStatusRequestSchema.safeParse({ projectId, jobId: request.params.jobId });
        if (!parsed.success) throw schemaError(parsed);
        const principal = guard(request, response);
        if (!principal) return;
        const job = await execute({ ownerId: principal.ownerId, ...parsed.data });
        return response.json({ job, jobId: job.id, status: job.status });
      } catch (error) {
        return sendError(response, error);
      }
    });
  }

  router.post("/cleanup", async (request, response) => {
    try {
      if (!guard(request, response)) return;
      if (!options.uploads) throw new Error("generation-upload-unavailable");
      return response.json({ removed: await options.uploads.cleanup() });
    } catch (error) {
      return sendError(response, error);
    }
  });

  return router;
}
