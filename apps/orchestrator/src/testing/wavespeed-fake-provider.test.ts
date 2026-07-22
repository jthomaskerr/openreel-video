import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGenerationProvider } from "../app.js";
import { WaveSpeedFakeProvider } from "./wavespeed-fake-provider.js";

test("application resolves an injected fake provider as configured without an HTTP provider", async () => {
  const fake = new WaveSpeedFakeProvider();

  const runtime = resolveGenerationProvider({ injectedProvider: fake });

  assert.equal(runtime.provider, fake);
  assert.equal(runtime.configured, true);
  assert.equal(runtime.productionProvider, undefined);
  const submitted = await runtime.provider.submit({
    job: { id: "browser-fake" } as never,
    attemptNumber: 1,
    idempotencyKey: "browser-fake-attempt-1",
  });
  assert.equal(submitted.providerJobId, "fake-wavespeed-job-0001");
});
