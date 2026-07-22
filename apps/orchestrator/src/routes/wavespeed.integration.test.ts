import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";
import type {
  GenerationJob,
  GenerationProjectActionCommand,
  GenerationRouteIdentity,
} from "@openreel/music-video-domain/generation";
import { config } from "../env.js";
import { GenerationFinalizer } from "../services/generation/finalization.js";
import { FileGenerationJobRepository } from "../services/generation/repository.js";
import type { GenerationProviderPort, GenerationProviderStatus } from "../services/generation/index.js";
import {
  WaveSpeedFakeProvider,
  WaveSpeedFakeProviderError,
} from "../testing/wavespeed-fake-provider.js";
import {
  createWaveSpeedRouter,
  parseGenerationRouteManifest,
  type ValidatedGenerationRouteManifestEntry,
} from "./wavespeed.js";

const route: GenerationRouteIdentity = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "wavespeed/model-1",
  requestedMode: "text-to-image",
  providerSchemaId: "wavespeed-schema",
  providerEndpointId: "submit",
  providerSchemaVersion: "2026-07",
};

const manifest: readonly ValidatedGenerationRouteManifestEntry[] = [{
  identity: route,
  schemaFingerprint: "schema-fingerprint",
  clientSchemaFingerprint: "schema-fingerprint",
  serverSchemaFingerprint: "schema-fingerprint",
  clientAcceptance: true,
  serverAcceptance: true,
  configurationVersion: "generation-v2",
  inputSchema: {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: [],
    additionalProperties: false,
  },
  supportsAudio: false,
}];

function request(jobId: string, providerInputs: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    jobId,
    routing: route,
    target: { kind: "new-asset" as const, placeholderMediaId: `placeholder-${jobId}` },
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" as const },
      mode: "text-to-image" as const,
      placementPolicy: "none" as const,
      prompt: "a durable image",
      references: [],
    },
    providerInputs,
  };
}

function persistedJob(id: string, status: GenerationJob["status"]): GenerationJob {
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id,
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: route.providerInstanceId,
    modelId: route.providerModelId,
    modelSchemaVersion: route.providerSchemaVersion,
    routing: route,
    providerJobId: `provider-${id}`,
    status,
    attempt: 1,
    target: request(id).target,
    context: request(id).context,
    providerInputs: {},
    attempts: [{ attemptNumber: 1, routing: route, providerJobId: `provider-${id}`, startedAt: 1 }],
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function invoke(router: express.Router, method: string, url: string, body?: unknown, headerOverrides: Record<string, string | undefined> = {}) {
  const app = express();
  app.use("/api/generate/wavespeed", router);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(JSON.stringify(body ?? {}))),
      "x-project-id": "project-1",
      "x-user-id": "owner-1",
    };
    for (const [key, value] of Object.entries(headerOverrides)) {
      if (value === undefined) delete headers[key];
      else headers[key] = value;
    }
    const req = {
      method,
      url,
      originalUrl: url,
      headers,
      body,
      header(name: string) { return headers[name.toLowerCase()]; },
      get(name: string) { return headers[name.toLowerCase()]; },
    } as any;
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { resolve({ status: this.statusCode, body: payload }); return this; },
      end(payload?: unknown) { resolve({ status: this.statusCode, body: payload }); return this; },
      setHeader() {},
      getHeader() { return undefined; },
    } as any;
    (app as any).handle(req, res, (error?: unknown) => error ? reject(error) : resolve({ status: res.statusCode, body: undefined }));
  });
}

async function fixture(options?: {
  releaseEnabled?: boolean;
  status?: (providerJobId: string) => GenerationProviderStatus;
  authenticated?: boolean;
  authorized?: boolean;
  routes?: readonly import("./wavespeed.js").ValidatedGenerationRouteManifestEntry[];
  applyProjectAction?: (command: GenerationProjectActionCommand) => Promise<unknown>;
  finalizationFailure?: Error;
  provider?: GenerationProviderPort;
}) {
  const repository = new FileGenerationJobRepository(await mkdtemp(join(tmpdir(), "wavespeed-route-integration-")));
  let providerSubmits = 0;
  let providerStatusReads = 0;
  let placeholderFinalizations = 0;
  const provider: GenerationProviderPort = options?.provider ?? {
    submit: async ({ job }) => { providerSubmits += 1; return { providerJobId: `provider-${job.id}` }; },
    status: async ({ providerJobId }) => {
      providerStatusReads += 1;
      return options?.status?.(providerJobId) ?? { providerJobId, status: "running" };
    },
  };
  const router = createWaveSpeedRouter({
    repository,
    provider,
    createFinalizer: (finalizationRepository) => {
      assert.equal(finalizationRepository, repository, "the structural finalizer must be the sole claim owner");
      return new GenerationFinalizer(finalizationRepository, {
      download: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }) },
      verify: { verify: async () => {} },
      inspect: { inspect: async () => ({ width: 1, height: 1 }) },
      placeholder: {
        finalize: async ({ job }) => {
          placeholderFinalizations += 1;
          if (options?.finalizationFailure) throw options.finalizationFailure;
          return { mediaId: `media-${job.id}`, versionId: `version-${job.id}` };
        },
      },
      });
    },
    routes: options?.routes ?? manifest,
    releaseEnabled: options?.releaseEnabled ?? true,
    configured: true,
    authenticate: () => options?.authenticated === false ? undefined : { ownerId: "owner-1" },
    owner: () => options?.authorized !== false,
    applyProjectAction: options?.applyProjectAction,
  });
  return {
    repository,
    router,
    counts: () => ({ providerSubmits, providerStatusReads, placeholderFinalizations }),
  };
}

test("route persists the exact target and timing before provider reservation", async () => {
  const current = await fixture();
  const body = request("target-timing");
  body.context = {
    ...body.context,
    entryContext: { kind: "unlinked-range", rangeId: "range-1", startTime: 2, endTime: 5 },
    placementPolicy: "create-linked-clip",
    timing: { source: "timeline", startSeconds: 2, endSeconds: 5, durationSeconds: 3 },
  } as unknown as typeof body.context;

  const response = await invoke(current.router, "POST", "/api/generate/wavespeed/", body);

  assert.equal(response.status, 202);
  assert.deepEqual((await current.repository.get("target-timing"))?.target, body.target);
  assert.deepEqual((await current.repository.get("target-timing"))?.context.timing, {
    source: "timeline",
    startSeconds: 2,
    endSeconds: 5,
    durationSeconds: 3,
  });
  assert.equal(current.counts().providerSubmits, 1);
});

test("missing target is rejected before provider reservation", async () => {
  const current = await fixture();
  const body: Omit<ReturnType<typeof request>, "target"> & { target?: ReturnType<typeof request>["target"] } = request("missing-target");
  delete body.target;

  const response = await invoke(current.router, "POST", "/api/generate/wavespeed/", body);

  assert.equal(response.status, 400);
  assert.equal(current.counts().providerSubmits, 0);
  assert.equal(await current.repository.get("missing-target"), undefined);
});

test("missing authentication, project mismatch, and missing immutable manifest fail before repository/provider work", async () => {
  const unauthenticated = await fixture({ authenticated: false });
  const missingPrincipal = await invoke(unauthenticated.router, "POST", "/api/generate/wavespeed/", request("missing-principal"));
  assert.equal(missingPrincipal.status, 401);
  assert.equal(missingPrincipal.body.error, "generation-authentication-required");
  assert.equal(unauthenticated.counts().providerSubmits, 0);
  assert.equal(await unauthenticated.repository.get("missing-principal"), undefined);

  const mismatched = await fixture();
  const wrongProject = await invoke(mismatched.router, "POST", "/api/generate/wavespeed/", request("wrong-project"), { "x-project-id": "project-2" });
  assert.equal(wrongProject.status, 403);
  assert.equal(wrongProject.body.error, "generation-forbidden");
  assert.equal(mismatched.counts().providerSubmits, 0);
  assert.equal(await mismatched.repository.get("wrong-project"), undefined);

  const missingManifest = await fixture({ routes: [] });
  const unsupported = await invoke(missingManifest.router, "POST", "/api/generate/wavespeed/", request("missing-manifest"));
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error, "generation-route-unsupported");
  assert.equal(missingManifest.counts().providerSubmits, 0);
  assert.equal(await missingManifest.repository.get("missing-manifest"), undefined);

  const denied = await fixture({ authorized: false });
  const deniedModels = await invoke(denied.router, "GET", "/api/generate/wavespeed/models");
  assert.equal(deniedModels.status, 403);
  assert.equal(deniedModels.body.error, "generation-forbidden");
});

test("duplicate submission re-authorizes ownership before disclosing an existing job", async () => {
  const current = await fixture({ authorized: false });
  await current.repository.create(persistedJob("owned-elsewhere", "running"));

  const response = await invoke(
    current.router,
    "POST",
    "/api/generate/wavespeed/",
    request("owned-elsewhere"),
  );

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "generation-forbidden");
  assert.equal(response.body.job, undefined);
  assert.equal(current.counts().providerSubmits, 0);
});

test("manifest input schema and supportsAudio fail closed before reservation", async () => {
  const strictManifest = [{
    ...manifest[0],
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" } },
      additionalProperties: false,
    },
  }] as const;
  const invalidInput = await fixture({ routes: strictManifest });
  const invalidInputResponse = await invoke(
    invalidInput.router,
    "POST",
    "/api/generate/wavespeed/",
    request("invalid-provider-input", { prompt: "ok", unsupported: true }),
  );
  assert.equal(invalidInputResponse.status, 400);
  assert.equal(invalidInputResponse.body.error, "generation-provider-input-invalid");
  assert.equal(await invalidInput.repository.get("invalid-provider-input"), undefined);
  assert.equal(invalidInput.counts().providerSubmits, 0);

  const unsupportedAudio = await fixture({ routes: strictManifest });
  const audioRequest = request("unsupported-audio", { prompt: "ok" });
  audioRequest.context = {
    ...audioRequest.context,
    entryContext: {
      kind: "linked-projection",
      shotId: "shot-1",
      clipId: "clip-1",
      startTime: 0,
      endTime: 1,
    },
    audioAssetId: "audio-1",
    audioRange: { startTime: 0, endTime: 1 },
  } as unknown as typeof audioRequest.context;
  const audioResponse = await invoke(
    unsupportedAudio.router,
    "POST",
    "/api/generate/wavespeed/",
    audioRequest,
  );
  assert.equal(audioResponse.status, 400);
  assert.equal(audioResponse.body.error, "generation-audio-unsupported");
  assert.equal(await unsupportedAudio.repository.get("unsupported-audio"), undefined);
  assert.equal(unsupportedAudio.counts().providerSubmits, 0);
});

test("submission rejects conflicting durable identities and path-shaped job IDs before reservation", async () => {
  const projectMismatch = await fixture();
  const mismatchedProjectRequest = request("context-project-mismatch");
  mismatchedProjectRequest.context = {
    ...mismatchedProjectRequest.context,
    projectId: "project-2",
  };
  const mismatchedProject = await invoke(
    projectMismatch.router,
    "POST",
    "/api/generate/wavespeed/",
    mismatchedProjectRequest,
  );
  assert.equal(mismatchedProject.status, 400);
  assert.equal(mismatchedProject.body.error, "generation-project-identity-mismatch");
  assert.equal(projectMismatch.counts().providerSubmits, 0);
  assert.equal(await projectMismatch.repository.get("context-project-mismatch"), undefined);

  const modeMismatch = await fixture();
  const mismatchedModeRequest = request("context-mode-mismatch");
  mismatchedModeRequest.context = {
    ...mismatchedModeRequest.context,
    mode: "image-to-video",
  } as unknown as typeof mismatchedModeRequest.context;
  const mismatchedMode = await invoke(
    modeMismatch.router,
    "POST",
    "/api/generate/wavespeed/",
    mismatchedModeRequest,
  );
  assert.equal(mismatchedMode.status, 400);
  assert.equal(mismatchedMode.body.error, "generation-mode-identity-mismatch");
  assert.equal(modeMismatch.counts().providerSubmits, 0);
  assert.equal(await modeMismatch.repository.get("context-mode-mismatch"), undefined);

  const pathShaped = await fixture();
  const pathRequest = request("nested/job");
  const pathResult = await invoke(
    pathShaped.router,
    "POST",
    "/api/generate/wavespeed/",
    pathRequest,
  );
  assert.equal(pathResult.status, 400);
  assert.equal(pathResult.body.error, "generation-identifier-invalid");
  assert.equal(pathShaped.counts().providerSubmits, 0);

  const pathProject = await fixture();
  const projectResult = await invoke(
    pathProject.router,
    "GET",
    "/api/generate/wavespeed/models",
    undefined,
    { "x-project-id": "../project" },
  );
  assert.equal(projectResult.status, 400);
  assert.equal(projectResult.body.error, "generation-identifier-invalid");

  const encodedJob = await fixture();
  const encodedResult = await invoke(
    encodedJob.router,
    "GET",
    "/api/generate/wavespeed/nested%2Fjob",
  );
  assert.equal(encodedResult.status, 400);
  assert.equal(encodedResult.body.error, "generation-identifier-invalid");
});

test("generation-job-dispositions.fixture.ts: production commands use the exact authenticated suffixes", async () => {
  const f = await fixture();
  await f.repository.create({
    ...persistedJob("provider-retry", "failed"),
    error: { code: "provider-failed", message: "Provider failed", retryable: true },
  });

  const providerRetry = await invoke(f.router, "POST", "/api/generate/wavespeed/provider-retry/retry-provider");
  assert.equal(providerRetry.status, 200);
  assert.equal(providerRetry.body.job.attempt, 2);
  assert.equal(f.counts().providerSubmits, 1);

  await f.repository.create(persistedJob("finalization-command", "running"));
  const finalizationRetry = await invoke(f.router, "POST", "/api/generate/wavespeed/finalization-command/retry-finalization");
  assert.equal(finalizationRetry.status, 409);
  assert.equal(finalizationRetry.body.error, "generation-invalid-finalization-retry-state");

  await f.repository.create(persistedJob("placement-command", "needs-attention"));
  const placementRetry = await invoke(f.router, "POST", "/api/generate/wavespeed/placement-command/retry-placement");
  assert.equal(placementRetry.status, 200);
  assert.equal(placementRetry.body.job.id, "placement-command");

  const reconciliation = await invoke(f.router, "POST", "/api/generate/wavespeed/placement-command/reconcile-placement");
  assert.equal(reconciliation.status, 409);
  assert.equal(reconciliation.body.error, "generation-invalid-placement-reconciliation-state");
});

test("generation-v2-rollback.fixture.ts: production route rejects rollback submissions before repository reservation while existing jobs keep polling", async () => {
  const f = await fixture({ releaseEnabled: false });
  const rejected = await invoke(f.router, "POST", "/api/generate/wavespeed/", request("rollback-new"));
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, "generation-v2-rollback-active");
  assert.equal(await f.repository.get("rollback-new"), undefined);
  assert.equal(f.counts().providerSubmits, 0);

  await f.repository.create(persistedJob("rollback-existing", "running"));
  const continued = await invoke(f.router, "GET", "/api/generate/wavespeed/rollback-existing");
  assert.equal(continued.status, 200);
  assert.equal(continued.body.job.status, "running");
  assert.equal(f.counts().providerStatusReads, 1);
});

test("generation-finalization-new-asset-no-source.fixture.ts: production route carries output identity and runs the structural finalizer exactly once", async () => {
  const f = await fixture({ status: (providerJobId) => ({
    providerJobId,
    status: "completed",
    outputUrls: ["https://cdn.example.test/generated.png"],
  }) });
  const submitted = await invoke(f.router, "POST", "/api/generate/wavespeed/", request("completed-job"));
  assert.equal(submitted.status, 202);
  assert.equal(submitted.body.job.contractVersion, 2);

  const completed = await invoke(f.router, "GET", "/api/generate/wavespeed/completed-job");
  assert.equal(completed.status, 200);
  assert.equal(completed.body.job.status, "succeeded", JSON.stringify(completed.body.job));
  assert.equal(completed.body.job.output.mediaId, "media-completed-job");
  assert.equal(completed.body.job.output.versionId, "version-completed-job");
  assert.deepEqual(completed.body.job.outputMediaIds, ["provider-output:provider-completed-job:0"]);

  const replay = await invoke(f.router, "GET", "/api/generate/wavespeed/completed-job");
  assert.equal(replay.body.job.status, "succeeded");
  assert.equal(f.counts().placeholderFinalizations, 1);
});

test("production route preserves a durable needs-attention finalization failure", async () => {
  const f = await fixture({
    status: (providerJobId) => ({
      providerJobId,
      status: "completed",
      outputUrls: ["https://cdn.example.test/generated.png"],
    }),
    finalizationFailure: new Error("project-mutation-failed"),
  });
  const submitted = await invoke(f.router, "POST", "/api/generate/wavespeed/", request("failed-finalization-job"));
  assert.equal(submitted.status, 202);

  const completed = await invoke(f.router, "GET", "/api/generate/wavespeed/failed-finalization-job");
  assert.equal(completed.status, 200);
  assert.equal(completed.body.job.status, "needs-attention", JSON.stringify(completed.body.job));
  assert.equal(f.counts().placeholderFinalizations, 1);
});

test("generation-local-url-boundaries.fixture.ts: production route never polls needs-attention and rejects local identities before persistence", async () => {
  const f = await fixture();
  await f.repository.create({
    ...persistedJob("attention-job", "needs-attention"),
    error: { code: "legacy-source-ambiguous", message: "Source cannot be inferred", retryable: false },
  });
  const attention = await invoke(f.router, "GET", "/api/generate/wavespeed/attention-job");
  assert.equal(attention.status, 200);
  assert.equal(attention.body.job.status, "needs-attention");
  assert.equal(f.counts().providerStatusReads, 0);

  for (const prefix of ["blob:", "local:", "file:"]) {
    const id = `local-${prefix.slice(0, -1)}`;
    const rejected = await invoke(f.router, "POST", "/api/generate/wavespeed/", request(id, { image: `${prefix}unsafe` }));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "generation-local-url-forbidden");
    assert.equal(await f.repository.get(id), undefined);
  }
});

test("config exposes non-secret capabilities only", async () => {
  const f = await fixture({ releaseEnabled: false });
  const response = await invoke(f.router, "GET", "/api/generate/wavespeed/config");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    configured: true,
    generationV2ReleaseEnabled: false,
    providerInstanceId: "wavespeed-production",
    routes: [{
      providerInstanceId: "wavespeed-production",
      providerModelId: "wavespeed/model-1",
      requestedMode: "text-to-image",
      providerSchemaId: "wavespeed-schema",
      providerEndpointId: "submit",
      providerSchemaVersion: "2026-07",
      output: "image",
      inputSchema: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: [],
        additionalProperties: false,
      },
      supportsAudio: false,
    }],
  });
  assert.equal(JSON.stringify(response.body).toLowerCase().includes("key"), false);
});

test("browser-supplied provider credential aliases are rejected while application authorization is allowed", async () => {
  const f = await fixture();
  for (const header of ["x-wavespeed-api-key", "x-wavespeed-key", "wavespeed-api-key", "x-provider-api-key"]) {
    const response = await invoke(f.router, "GET", "/api/generate/wavespeed/config", undefined, { [header]: "browser-secret" });
    assert.equal(response.status, 400, header);
    assert.equal(response.body.error, "provider-key-header-forbidden");
  }
  const authorized = await invoke(f.router, "GET", "/api/generate/wavespeed/config", undefined, { authorization: "Bearer application-session" });
  assert.equal(authorized.status, 200);
});

test("generation V2 release configuration fails closed when the environment flag is absent", () => {
  assert.equal(config.generationV2ReleaseEnabled, false);
});

test("production manifest configuration is validated and deeply immutable", () => {
  const routes = parseGenerationRouteManifest(JSON.stringify(manifest));
  assert.deepEqual(routes, manifest);
  assert.equal(Object.isFrozen(routes), true);
  assert.equal(Object.isFrozen(routes[0]), true);
  assert.equal(Object.isFrozen(routes[0].identity), true);
  assert.equal(Object.isFrozen(routes[0].inputSchema), true);
  assert.throws(
    () => parseGenerationRouteManifest(JSON.stringify([{ ...manifest[0], serverAcceptance: "yes" }])),
    /generation-route-manifest-invalid/,
  );
  for (const inputSchema of [
    {},
    { type: "object", properties: {} },
    { type: "object", properties: { prompt: { type: "unsupported" } }, additionalProperties: false },
    { type: "object", properties: { prompt: { type: "string" } }, required: ["missing"], additionalProperties: false },
  ]) {
    assert.throws(
      () => parseGenerationRouteManifest(JSON.stringify([{ ...manifest[0], inputSchema }])),
      /generation-route-manifest-invalid/,
    );
  }
});

test("authenticated project actions use the durable domain command unchanged", async () => {
  let received: GenerationProjectActionCommand | undefined;
  const current = await fixture({
    applyProjectAction: async (command) => {
      received = command;
      return {
        projectId: command.projectId,
        actionId: command.actionId,
        operation: command.operation,
        status: "applied",
        revision: command.expectedRevision,
        envelope: command.envelope,
      };
    },
  });
  const revision = {
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    projectBlobSha: "c".repeat(40),
    sourceModifiedAt: 1,
  };
  const command: GenerationProjectActionCommand = {
    projectId: "project-1",
    actionId: "action-1",
    operation: "undo",
    expectedRevision: revision,
    envelope: {
      schemaVersion: 1,
      projectId: "project-1",
      receipt: {
        schemaVersion: 1,
        actionId: "action-1",
        jobId: "job-1",
        idempotencyKey: `generation-stage-${"d".repeat(64)}`,
        kind: "finalize-placeholder",
        semanticPayload: "{}",
        baseRevision: revision,
        appliedAt: 2,
      },
      appliedRevision: revision,
    },
  };

  const response = await invoke(
    current.router,
    "POST",
    "/api/generate/wavespeed/actions/action-1",
    command,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, command);
  assert.equal(response.body.result.status, "applied");
});

test("deterministic fake provider fixes IDs, sequences, output bytes, cancellation, retry, and idempotent counters", async () => {
  const provider = new WaveSpeedFakeProvider({
    statusSequences: [
      [
        { status: "submitting" },
        { status: "running" },
        { status: "completed", outputMediaIds: ["fake-output-0001"] },
      ],
      [{ status: "running" }],
    ],
    outputBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    outputMimeType: "image/png",
  });
  const job = persistedJob("fake-provider-job", "queued");

  const first = await provider.submit({
    job,
    attemptNumber: 1,
    idempotencyKey: "fake-provider-job:1",
  });
  assert.equal(first.providerJobId, "fake-wavespeed-job-0001");
  assert.deepEqual(await provider.status({ providerJobId: first.providerJobId, routing: route }), {
    providerJobId: first.providerJobId,
    status: "submitting",
  });
  assert.equal((await provider.status({ providerJobId: first.providerJobId, routing: route })).status, "running");
  assert.deepEqual(await provider.status({ providerJobId: first.providerJobId, routing: route }), {
    providerJobId: first.providerJobId,
    status: "completed",
    outputMediaIds: ["fake-output-0001"],
  });
  assert.deepEqual(await provider.downloadOutput({ providerJobId: first.providerJobId }), {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: "image/png",
  });

  const replay = await provider.submit({
    job,
    attemptNumber: 1,
    idempotencyKey: "fake-provider-job:1",
  });
  assert.equal(replay.providerJobId, first.providerJobId);

  const retry = await provider.submit({
    job: { ...job, attempt: 2 },
    attemptNumber: 2,
    idempotencyKey: "fake-provider-job:2",
  });
  assert.equal(retry.providerJobId, "fake-wavespeed-job-0002");
  await provider.cancel({ providerJobId: retry.providerJobId, routing: route });
  assert.equal((await provider.status({ providerJobId: retry.providerJobId, routing: route })).status, "canceled");

  assert.deepEqual(provider.snapshot(), {
    submitCalls: 3,
    providerReservations: 2,
    duplicateSubmitCalls: 1,
    statusReads: 4,
    cancelCalls: 1,
    downloadCalls: 1,
    submissionsByIdempotencyKey: {
      "fake-provider-job:1": 2,
      "fake-provider-job:2": 1,
    },
  });
});

test("deterministic fake provider injects each boundary failure by call number without sleeps", async () => {
  const provider = new WaveSpeedFakeProvider({
    failures: {
      submit: { 1: { code: "fake-submit-failed", message: "submit failed", retryable: true } },
      status: { 1: { code: "fake-poll-failed", message: "poll failed", retryable: true } },
      cancel: { 1: { code: "fake-cancel-failed", message: "cancel failed", retryable: true } },
      download: { 1: { code: "fake-download-failed", message: "download failed", retryable: true } },
    },
  });
  const job = persistedJob("failure-injection", "queued");

  await assert.rejects(
    provider.submit({ job, attemptNumber: 1, idempotencyKey: "failure-injection:1" }),
    (error: unknown) => error instanceof WaveSpeedFakeProviderError && error.code === "fake-submit-failed",
  );
  const submitted = await provider.submit({ job, attemptNumber: 1, idempotencyKey: "failure-injection:1" });
  await assert.rejects(
    provider.status({ providerJobId: submitted.providerJobId, routing: route }),
    (error: unknown) => error instanceof WaveSpeedFakeProviderError && error.code === "fake-poll-failed",
  );
  await assert.rejects(
    provider.cancel({ providerJobId: submitted.providerJobId, routing: route }),
    (error: unknown) => error instanceof WaveSpeedFakeProviderError && error.code === "fake-cancel-failed",
  );
  await assert.rejects(
    provider.downloadOutput({ providerJobId: submitted.providerJobId }),
    (error: unknown) => error instanceof WaveSpeedFakeProviderError && error.code === "fake-download-failed",
  );
  assert.equal(provider.snapshot().providerReservations, 1);
});

test("production route with fake provider keeps submit, output, and finalization counts exactly once across request replay and poll replay", async () => {
  const provider = new WaveSpeedFakeProvider({
    statusSequences: [[{
      status: "completed",
      outputUrls: ["https://fixtures.openreel.invalid/fake-output.png"],
      outputMediaIds: ["fake-output-0001"],
    }]],
  });
  const f = await fixture({ provider });

  const submitted = await invoke(f.router, "POST", "/api/generate/wavespeed/", request("fake-production-route"));
  assert.equal(submitted.status, 202);
  const replayedSubmit = await invoke(f.router, "POST", "/api/generate/wavespeed/", request("fake-production-route"));
  assert.equal(replayedSubmit.status, 202);
  assert.equal(replayedSubmit.body.job.id, submitted.body.job.id);

  const firstPoller = await invoke(f.router, "GET", "/api/generate/wavespeed/fake-production-route");
  const secondPoller = await invoke(f.router, "GET", "/api/generate/wavespeed/fake-production-route");
  assert.equal(firstPoller.body.job.status, "succeeded");
  assert.equal(secondPoller.body.job.status, "succeeded");
  assert.equal(firstPoller.body.job.output.mediaId, "media-fake-production-route");
  assert.deepEqual(firstPoller.body.job.outputMediaIds, ["fake-output-0001"]);
  assert.equal(f.counts().placeholderFinalizations, 1);
  assert.deepEqual(provider.snapshot(), {
    submitCalls: 1,
    providerReservations: 1,
    duplicateSubmitCalls: 0,
    statusReads: 1,
    cancelCalls: 0,
    downloadCalls: 0,
    submissionsByIdempotencyKey: { "generation:fake-production-route:attempt:1": 1 },
  });
});
