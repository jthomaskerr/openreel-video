import assert from "node:assert/strict";
import { test } from "node:test";
import { generation } from "./index.js";

test("root exposes the authoritative V2 generation namespace without legacy name collisions", () => {
  assert.equal(generation.GENERATION_JOB_CONTRACT_VERSION, 2);
  assert.ok(generation.GenerationSubmitRequestSchema);
  assert.equal(generation.isGenerationPollingActive("needs-attention"), false);
});
