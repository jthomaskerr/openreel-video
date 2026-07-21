import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationRouteIdentity } from "@openreel/music-video-domain/generation";
import express from "express";
import { GenerationFinalizer } from "../services/generation/finalization.js";
import { FileGenerationJobRepository } from "../services/generation/repository.js";
import { UploadRepository } from "../services/generation/uploads.js";
import { createWaveSpeedRouter } from "./wavespeed.js";

const identity: GenerationRouteIdentity = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "fixture/tti",
  requestedMode: "text-to-image",
  providerSchemaId: "fixture-schema",
  providerEndpointId: "submit",
  providerSchemaVersion: "fixture",
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wavespeed-route-"));
  const repository = new FileGenerationJobRepository(join(root, "jobs"));
  const uploads = new UploadRepository(join(root, "uploads"));
  let providerSubmits = 0;
  const router = createWaveSpeedRouter({
    repository,
    uploads,
    provider: {
      submit: async ({ job }) => {
        providerSubmits += 1;
        return { providerJobId: `provider-${job.id}` };
      },
      status: async ({ providerJobId }) => ({ providerJobId, status: "running" }),
    },
    routes: [{
      identity,
      schemaFingerprint: "fixture",
      clientSchemaFingerprint: "fixture",
      serverSchemaFingerprint: "fixture",
      clientAcceptance: true,
      serverAcceptance: true,
      configurationVersion: "fixture",
      inputSchema: {
        type: "object",
        properties: { prompt: { type: "string" } },
        additionalProperties: false,
      },
      supportsAudio: false,
    }],
    releaseEnabled: true,
    configured: true,
    authenticate: () => ({ ownerId: "owner-1" }),
    owner: () => true,
    createFinalizer: (jobs) => new GenerationFinalizer(jobs, {
      download: { download: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" }) },
      verify: { verify: async () => {} },
      inspect: { inspect: async () => ({ width: 1, height: 1 }) },
      placeholder: { finalize: async ({ job }) => ({ mediaId: `media-${job.id}`, versionId: `version-${job.id}` }) },
    }),
  });
  return { router, providerSubmits: () => providerSubmits };
}

function invoke(
  router: express.Router,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const app = express();
  app.use("/api/generate/wavespeed", router);
  return new Promise((resolve, reject) => {
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

test("upload route rejects empty bodies", async () => {
  const current = await fixture();
  const response = await invoke(current.router, "POST", "/api/generate/wavespeed/upload", {
    "content-type": "image/png",
    "x-project-id": "project-1",
  }, Buffer.alloc(0));

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "upload-empty" });
  assert.equal(current.providerSubmits(), 0);
});

test("upload route rejects every browser provider-key alias before doing work", async () => {
  for (const header of ["x-wavespeed-api-key", "x-wavespeed-key", "wavespeed-api-key", "x-provider-api-key"]) {
    const current = await fixture();
    const response = await invoke(current.router, "POST", "/api/generate/wavespeed/upload", {
      "content-type": "image/png",
      "x-project-id": "project-1",
      [header]: "browser-key",
    }, Buffer.from([1]));

    assert.equal(response.status, 400, header);
    assert.deepEqual(response.body, { error: "provider-key-header-forbidden" });
    assert.equal(current.providerSubmits(), 0);
  }
});
