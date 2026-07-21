import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import {
  GenerationOrchestrator,
  type GenerationProviderPort,
  type GenerationRouteManifestEntry,
} from "../generation/index.js";
import { FileGenerationJobRepository } from "../generation/repository.js";
import { UploadRepository } from "../generation/uploads.js";
import { WaveSpeedProvider } from "./client.js";
import { WaveSpeedInputMaterializer } from "./input-materializer.js";

const routing = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "fixture/reference-audio",
  requestedMode: "image-to-video" as const,
  providerSchemaId: "fixture-schema",
  providerEndpointId: "submit",
  providerSchemaVersion: "fixture-v1",
};

const manifest: GenerationRouteManifestEntry = {
  identity: routing,
  schemaFingerprint: "fixture",
  clientSchemaFingerprint: "fixture",
  serverSchemaFingerprint: "fixture",
  clientAcceptance: true,
  serverAcceptance: true,
  configurationVersion: "fixture",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      first_frame: { type: "string", "x-openreel-media-role": "source-image" },
      reference_images: {
        type: "array",
        items: { type: "string" },
        "x-openreel-media-role": "reference-images",
      },
      audio: { type: "string", "x-openreel-media-role": "audio" },
    },
    additionalProperties: false,
  },
  supportsAudio: true,
};

function job(id: string, providerInputs: Record<string, unknown>): GenerationJob {
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id,
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: routing.providerInstanceId,
    modelId: routing.providerModelId,
    modelSchemaVersion: routing.providerSchemaVersion,
    routing,
    status: "queued",
    attempt: 1,
    target: { kind: "new-asset", placeholderMediaId: `placeholder-${id}` },
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "image-to-video",
      placementPolicy: "none",
      prompt: "test",
      references: [],
    },
    providerInputs: providerInputs as GenerationJob["providerInputs"],
    attempts: [{ attemptNumber: 1, routing, startedAt: 1 }],
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

test("materializes every manifest-declared upload once, preserves reference order, and retains the attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavespeed-materializer-"));
  const uploads = new UploadRepository(directory, 1_000, () => 100);
  const source = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "image/png", bytes: new Uint8Array([1]) });
  const reference = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "image/jpeg", bytes: new Uint8Array([2]) });
  const audio = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "audio/mpeg", bytes: new Uint8Array([3]) });
  const uploaded: number[] = [];
  const materializer = new WaveSpeedInputMaterializer({
    uploads,
    routes: [manifest],
    mediaUpload: {
      uploadMedia: async ({ bytes }) => {
        const marker = bytes[0] ?? 0;
        uploaded.push(marker);
        return `https://cdn.example/${marker}`;
      },
    },
  });
  const input = job("valid", {
    prompt: "test",
    first_frame: source.id,
    reference_images: [reference.id, "https://cdn.example/existing", reference.id],
    audio: audio.id,
  });

  const result = await materializer.materialize({ ownerId: "owner-1", job: input, attemptNumber: 1 });

  assert.deepEqual(result, {
    prompt: "test",
    first_frame: "https://cdn.example/1",
    reference_images: ["https://cdn.example/2", "https://cdn.example/existing", "https://cdn.example/2"],
    audio: "https://cdn.example/3",
  });
  assert.deepEqual(uploaded, [1, 2, 3]);
  assert.equal((await uploads.get(source.id, "owner-1", "project-1"))?.references, 1);
  assert.equal((await uploads.get(reference.id, "owner-1", "project-1"))?.references, 1);
  assert.equal((await uploads.get(audio.id, "owner-1", "project-1"))?.references, 1);
  assert.equal(input.providerInputs.first_frame, source.id);
  assert.doesNotMatch(JSON.stringify(result), /upl_|blob:|local:|file:|localhost/);
});

test("unknown, expired, cross-owner, and cross-project uploads fail before generation persistence, reservation, or provider work", async () => {
  for (const failure of ["unknown", "expired", "cross-owner", "cross-project"] as const) {
    let now = 100;
    const root = await mkdtemp(join(tmpdir(), `wavespeed-materializer-${failure}-`));
    const uploads = new UploadRepository(join(root, "uploads"), 10, () => now);
    const created = failure === "unknown" ? undefined : await uploads.create({
      ownerId: failure === "cross-owner" ? "owner-2" : "owner-1",
      projectId: failure === "cross-project" ? "project-2" : "project-1",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    });
    if (failure === "expired") now = created!.expiresAt;
    const events: string[] = [];
    const repository = new FileGenerationJobRepository(join(root, "jobs"));
    for (const method of ["get", "create", "beginSubmission"] as const) {
      const original = repository[method].bind(repository) as (...args: any[]) => Promise<any>;
      (repository as any)[method] = async (...args: any[]) => { events.push(`repository:${method}`); return original(...args); };
    }
    const materializer = new WaveSpeedInputMaterializer({
      uploads,
      routes: [manifest],
      mediaUpload: { uploadMedia: async () => { events.push("media-upload"); return "https://cdn.example/media"; } },
    });
    const provider: GenerationProviderPort = {
      submit: async () => { events.push("provider-submit"); return { providerJobId: "provider-1" }; },
      status: async ({ providerJobId }) => ({ providerJobId, status: "running" }),
    };
    const service = new GenerationOrchestrator({
      repository,
      provider,
      inputMaterializer: materializer,
      routes: [manifest],
      releaseEnabled: true,
      owner: () => true,
      finalizer: {
        finalize: async () => {},
        reconcilePlacement: async () => { throw new Error("unused"); },
      },
      requestBoundary: { validate: () => {} },
      clock: () => now,
    });
    const uploadId = created?.id ?? "upl_missing";

    await assert.rejects(
      service.submit({ ownerId: "owner-1", job: job(`invalid-${failure}`, { first_frame: uploadId }), request: { contentType: "application/json", byteLength: 1, maxBytes: 2, timeoutMs: 1, maxTimeoutMs: 2 } }),
      failure === "unknown" ? /generation-upload-not-found/ : failure === "expired" ? /upload-expired/ : /upload-forbidden/,
    );
    assert.deepEqual(events, [], failure);
  }
});

test("retry materialization fails before mutating the durable attempt or acquiring a new reservation", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavespeed-materializer-retry-"));
  const repository = new FileGenerationJobRepository(join(root, "jobs"));
  const failed = {
    ...job("retry-invalid", { first_frame: "upl_missing" }),
    status: "failed" as const,
    providerJobId: "provider-old",
    attempts: [{ attemptNumber: 1, routing, providerJobId: "provider-old", startedAt: 1, endedAt: 2 }],
  };
  await repository.create(failed);
  const events: string[] = [];
  for (const method of ["update", "beginSubmission"] as const) {
    const original = repository[method].bind(repository) as (...args: any[]) => Promise<any>;
    (repository as any)[method] = async (...args: any[]) => { events.push(`repository:${method}`); return original(...args); };
  }
  const uploads = new UploadRepository(join(root, "uploads"));
  const service = new GenerationOrchestrator({
    repository,
    provider: {
      submit: async () => { events.push("provider-submit"); return { providerJobId: "must-not-submit" }; },
      status: async ({ providerJobId }) => ({ providerJobId, status: "running" }),
    },
    inputMaterializer: new WaveSpeedInputMaterializer({
      uploads,
      routes: [manifest],
      mediaUpload: { uploadMedia: async () => { events.push("media-upload"); return "https://cdn.example/media"; } },
    }),
    routes: [manifest],
    releaseEnabled: true,
    owner: () => true,
    finalizer: { finalize: async () => {}, reconcilePlacement: async () => { throw new Error("unused"); } },
    requestBoundary: { validate: () => {} },
  });

  await assert.rejects(
    service.retryProvider({ ownerId: "owner-1", projectId: "project-1", jobId: failed.id }),
    /generation-upload-not-found/,
  );
  assert.deepEqual(events, []);
  const unchanged = await repository.get(failed.id);
  assert.equal(unchanged?.status, "failed");
  assert.equal(unchanged?.attempt, 1);
  assert.equal(unchanged?.providerJobId, "provider-old");
});

test("rejects local and undeclared upload-shaped values before media upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavespeed-materializer-forbidden-"));
  const uploads = new UploadRepository(directory);
  let mediaUploads = 0;
  const materializer = new WaveSpeedInputMaterializer({
    uploads,
    routes: [manifest],
    mediaUpload: { uploadMedia: async () => { mediaUploads += 1; return "https://cdn.example/media"; } },
  });

  for (const value of ["blob:media", "local:media", "file:///tmp/media", "/tmp/media", "./media", "http://localhost/media"]) {
    await assert.rejects(
      materializer.materialize({ ownerId: "owner-1", job: job(`forbidden-${mediaUploads}`, { first_frame: value }), attemptNumber: 1 }),
      /wavespeed-input-media-unreachable/,
    );
  }
  await assert.rejects(
    materializer.materialize({ ownerId: "owner-1", job: job("undeclared", { prompt: "upl_hidden" }), attemptNumber: 1 }),
    /wavespeed-input-media-unresolved/,
  );
  assert.equal(mediaUploads, 0);
});

test("rolls back every attempt lease when provider materialization fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavespeed-materializer-rollback-"));
  const uploads = new UploadRepository(directory);
  const source = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "image/png", bytes: new Uint8Array([1]) });
  const reference = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "image/png", bytes: new Uint8Array([2]) });
  let calls = 0;
  const materializer = new WaveSpeedInputMaterializer({
    uploads,
    routes: [manifest],
    mediaUpload: {
      uploadMedia: async () => {
        calls += 1;
        if (calls === 2) throw new Error("provider-upload-failed");
        return "https://cdn.example/source";
      },
    },
  });

  await assert.rejects(
    materializer.materialize({
      ownerId: "owner-1",
      job: job("rollback", { first_frame: source.id, reference_images: [reference.id] }),
      attemptNumber: 1,
    }),
    /provider-upload-failed/,
  );
  assert.equal((await uploads.get(source.id, "owner-1", "project-1"))?.references, 0);
  assert.equal((await uploads.get(reference.id, "owner-1", "project-1"))?.references, 0);
});

test("sends only transient provider HTTPS values in the final WaveSpeed JSON while preserving durable local IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavespeed-materializer-orchestrator-"));
  const repository = new FileGenerationJobRepository(join(root, "jobs"));
  const uploads = new UploadRepository(join(root, "uploads"));
  const source = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  const reference = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "image/jpeg", bytes: new Uint8Array([4, 5, 6]) });
  const audio = await uploads.create({ ownerId: "owner-1", projectId: "project-1", mimeType: "audio/mpeg", bytes: new Uint8Array([7, 8, 9]) });
  const input = job("transient", {
    first_frame: source.id,
    reference_images: [reference.id, "https://cdn.example/existing"],
    audio: audio.id,
  });
  const calls: Array<{ url: string; body?: string | FormData }> = [];
  const provider = new WaveSpeedProvider({
    baseUrl: "https://api.example",
    apiKey: "secret",
    fetch: async (url, init) => {
      calls.push({ url, body: init.body });
      return url.endsWith("/api/v3/media/upload/binary")
        ? { ok: true, status: 200, json: async () => ({ data: { download_url: `https://cdn.example/materialized-${calls.length}` } }) }
        : { ok: true, status: 200, json: async () => ({ data: { id: "provider-1" } }) };
    },
  });
  const service = new GenerationOrchestrator({
    repository,
    provider,
    inputMaterializer: new WaveSpeedInputMaterializer({ uploads, routes: [manifest], mediaUpload: provider }),
    routes: [manifest],
    releaseEnabled: true,
    owner: () => true,
    finalizer: { finalize: async () => {}, reconcilePlacement: async () => { throw new Error("unused"); } },
    requestBoundary: { validate: () => {} },
    clock: () => 100,
  });

  await service.submit({ ownerId: "owner-1", job: input, request: { contentType: "application/json", byteLength: 1, maxBytes: 2, timeoutMs: 1, maxTimeoutMs: 2 } });

  assert.deepEqual(calls.map(({ url }) => url), [
    "https://api.example/api/v3/media/upload/binary",
    "https://api.example/api/v3/media/upload/binary",
    "https://api.example/api/v3/media/upload/binary",
    `https://api.example/api/v3/${routing.providerModelId}`,
  ]);
  assert.deepEqual(JSON.parse(String(calls[3]?.body)), {
    first_frame: "https://cdn.example/materialized-1",
    reference_images: ["https://cdn.example/materialized-2", "https://cdn.example/existing"],
    audio: "https://cdn.example/materialized-3",
  });
  assert.doesNotMatch(String(calls[3]?.body), /upl_|blob:|local:|file:|localhost/);
  assert.deepEqual((await repository.get(input.id))?.providerInputs, {
    first_frame: source.id,
    reference_images: [reference.id, "https://cdn.example/existing"],
    audio: audio.id,
  });
});
