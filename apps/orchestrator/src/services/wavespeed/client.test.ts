import assert from "node:assert/strict";
import { test } from "node:test";
import { WaveSpeedProvider, type WaveSpeedFetchResponse } from "./client.js";
import type { GenerationJob } from "@openreel/music-video-domain/generation";

const route = { providerInstanceId: "instance", providerModelId: "wavespeed-ai/wan", requestedMode: "text-to-video" as const, providerSchemaId: "schema", providerEndpointId: "endpoint", providerSchemaVersion: "v1" };
const job = { routing: route, providerInputs: { prompt: "test" } } as unknown as GenerationJob;
function response(value: unknown, status = 200): WaveSpeedFetchResponse { return { ok: status >= 200 && status < 300, status, json: async () => value }; }

test("uses the installed SDK's v3 submit and result endpoints", async () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const provider = new WaveSpeedProvider({ baseUrl: "https://api.example", apiKey: "secret", fetch: async (url, init) => { calls.push({ url, ...init }); return calls.length === 1 ? response({ data: { id: "task-1" } }) : response({ data: { status: "completed", outputs: ["https://cdn.example/output.mp4"] } }); } });
  assert.deepEqual(await provider.submit({ job, attemptNumber: 1, idempotencyKey: "generation:job:attempt:1" }), { providerJobId: "task-1" });
  assert.deepEqual(await provider.status({ providerJobId: "task-1", routing: route }), { providerJobId: "task-1", status: "completed", outputUrls: ["https://cdn.example/output.mp4"] });
  assert.equal(calls[0].url, "https://api.example/api/v3/wavespeed-ai/wan");
  assert.equal(calls[1].url, "https://api.example/api/v3/predictions/task-1/result");
  assert.equal(calls[0].headers["idempotency-key"], undefined);
});

test("normalizes processing and failure, rejects unknown state, and reports unsupported cancellation", async () => {
  const provider = (value: unknown) => new WaveSpeedProvider({ baseUrl: "https://api.example", apiKey: "secret", fetch: async () => response(value) });
  assert.equal((await provider({ data: { status: "processing" } }).status({ providerJobId: "task", routing: route })).status, "running");
  assert.equal((await provider({ data: { status: "failed", error: "private provider detail" } }).status({ providerJobId: "task", routing: route })).status, "failed");
  await assert.rejects(provider({ data: { status: "mystery" } }).status({ providerJobId: "task", routing: route }), /wavespeed-status-unknown/);
  await assert.rejects(provider({ data: { status: "processing" } }).cancel({ providerJobId: "task", routing: route }), /wavespeed-cancel-unsupported/);
});

test("classifies timeout as ambiguous and HTTP 400 as non-ambiguous", async () => {
  const timeout = new WaveSpeedProvider({ baseUrl: "https://api.example", apiKey: "secret", timeoutMs: 1, fetch: async (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); }) });
  await assert.rejects(timeout.submit({ job, attemptNumber: 1, idempotencyKey: "key" }), (error: { ambiguous?: boolean }) => error.ambiguous === true);
  const bad = new WaveSpeedProvider({ baseUrl: "https://api.example", apiKey: "secret", fetch: async () => response({}, 400) });
  await assert.rejects(bad.submit({ job, attemptNumber: 1, idempotencyKey: "key" }), (error: { ambiguous?: boolean }) => error.ambiguous === false);
});

test("rejects a completion response containing any malformed output", async () => {
  const provider = new WaveSpeedProvider({ baseUrl: "https://api.example", apiKey: "secret", fetch: async () => response({ data: { status: "completed", outputs: ["https://cdn.example/output.mp4", ""] } }) });
  await assert.rejects(provider.status({ providerJobId: "task", routing: route }), /wavespeed-output-identity-invalid/);
});
