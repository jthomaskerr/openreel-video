import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { GenerationProviderPort } from "./index.js";
import { createReplaySafeGenerationOutputDownloader } from "./output-downloader.js";

const routing = {
  providerInstanceId: "wavespeed-primary",
  providerModelId: "wavespeed/model",
  requestedMode: "text-to-image" as const,
  providerSchemaId: "schema",
  providerEndpointId: "endpoint",
  providerSchemaVersion: "v1",
};

test("downloader keys replay cache by provider instance, job, and opaque output identity", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "generation-output-cache-"));
  let providerReads = 0;
  let fetches = 0;
  const provider: GenerationProviderPort = {
    submit: async () => ({ providerJobId: "unused" }),
    status: async (input) => {
      providerReads += 1;
      assert.deepEqual(input.routing, routing);
      return {
        providerJobId: input.providerJobId,
        status: "completed",
        outputMediaIds: ["opaque-output-2"],
        outputUrls: ["https://cdn.example.test/output-2.png"],
      };
    },
  };
  const downloader = createReplaySafeGenerationOutputDownloader({
    cacheDir,
    provider,
    fetch: async (input) => {
      fetches += 1;
      return new Response(String(input).includes("output-2") ? new Uint8Array([4, 5, 6]) : new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    },
  });
  const firstInput = {
    provider: "wavespeed",
    providerInstanceId: routing.providerInstanceId,
    providerJobId: "provider-job-1",
    outputIdentity: "opaque-output-1",
    routing,
    transientOutputUrl: "https://cdn.example.test/output-1.png",
  };
  const first = await downloader.download(firstInput);
  const replay = createReplaySafeGenerationOutputDownloader({
    cacheDir,
    provider: {
      submit: provider.submit,
      status: async () => { throw new Error("provider-must-not-be-read-on-cache-replay"); },
    },
    fetch: async () => { throw new Error("network-must-not-be-read-on-cache-replay"); },
  });
  const second = await replay.download({ ...firstInput, transientOutputUrl: undefined });
  const differentOutput = await downloader.download({
    ...firstInput,
    outputIdentity: "opaque-output-2",
    transientOutputUrl: undefined,
  });

  assert.deepEqual([...first.bytes], [1, 2, 3]);
  assert.deepEqual([...second.bytes], [1, 2, 3]);
  assert.deepEqual([...differentOutput.bytes], [4, 5, 6]);
  assert.equal(providerReads, 1);
  assert.equal(fetches, 2);
});
