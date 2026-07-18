import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("WaveSpeed settings expose only the same-origin non-secret capability boundary", async () => {
  const source = await readFile(new URL("./SingleServiceSettings.tsx", import.meta.url), "utf8");

  assert.match(source, /getProductionGenerationRuntime/);
  assert.match(source, /readCapabilities\(\{ refresh: true \}\)/);
  assert.doesNotMatch(source, /ORCHESTRATOR_URL/);
  assert.doesNotMatch(source, /fetch\(`?\$\{?ORCHESTRATOR/i);
  assert.doesNotMatch(source, /WAVESPEED_SECRET_ID/);
  assert.doesNotMatch(source, /X-WaveSpeed-Api-Key/i);
  assert.doesNotMatch(source, /Paste WaveSpeed API key/i);
  assert.doesNotMatch(source, /setWavespeedHasApiKey/);
  assert.match(source, /KIEAI_SECRET_ID/);
});
