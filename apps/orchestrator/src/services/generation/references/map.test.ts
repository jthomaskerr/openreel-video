import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResolvedGenerationReference } from "@openreel/core";
import { WAVE_SPEED_REFERENCE_FIXTURES, WAVE_SPEED_UNSUPPORTED_REFERENCE_FIXTURES } from "./fixtures/wavespeed";
import { mapProviderReferences, validateProviderReferenceFixture } from "./map";
import type { ProviderReferenceFixture } from "./types";

function makeReference(
  key: string,
  role: string,
  order: number,
  status: ResolvedGenerationReference["status"] = "active",
  canonicalTokens: readonly string[] = [`@{${key}}`],
): ResolvedGenerationReference {
  return {
    key,
    mediaId: `${key}-media`,
    mediaVersionId: `${key}-version`,
    origins: ["source"],
    role,
    canonicalTokens,
    order,
    status,
  };
}

function hasLeak(value: unknown): boolean {
  if (typeof value === "string") {
    return /projectId|mediaId|mediaVersionId|blob:|file:|localhost|apiKey|secret|password|@\{/.test(value);
  }
  if (Array.isArray(value)) return value.some(hasLeak);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
      /projectId|mediaId|mediaVersionId|apiKey|secret|password/i.test(key) || hasLeak(item),
    );
  }
  return false;
}

test("accepts the recorded WaveSpeed fixtures and marks unsupported models explicitly", () => {
  assert.equal(validateProviderReferenceFixture(WAVE_SPEED_REFERENCE_FIXTURES.imageToImage).ok, true);
  assert.equal(validateProviderReferenceFixture(WAVE_SPEED_REFERENCE_FIXTURES.referenceAndAudio).ok, true);
  assert.equal(WAVE_SPEED_UNSUPPORTED_REFERENCE_FIXTURES.misleadingType.supported, false);
  assert.equal(WAVE_SPEED_UNSUPPORTED_REFERENCE_FIXTURES.untypedUri.supported, false);
});

test("rejects undocumented fields, duplicate role fields, inconsistent cardinality, missing concrete examples, and unresolved template placeholders", () => {
  const base: ProviderReferenceFixture = {
    provider: "wavespeed",
    modelId: "fixture/reference-audio",
    evidenceUrl: "file:///Volumes/Joseph/Projects1/ai-agents/openreel-video/apps/web/src/services/wavespeed/model-capabilities.test.ts",
    evidenceCapturedAt: "2026-07-16T00:00:00.000Z",
    acceptedFields: ["prompt", "image", "references"],
    roles: {
      source: { field: "image", cardinality: "one" },
      reference: { field: "references", cardinality: "many" },
    },
    minReferences: 1,
    maxReferences: 3,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "clean frame",
      image: 1,
      references: [1],
    },
  };

  assert.equal(
    validateProviderReferenceFixture({
      ...base,
      exampleRequest: { ...base.exampleRequest, leaked: "nope" },
    }).ok,
    false,
  );

  assert.equal(
    validateProviderReferenceFixture({
      ...base,
      roles: {
        ...base.roles,
        duplicate: { field: "image", cardinality: "one" },
      },
    }).ok,
    false,
  );

  assert.equal(
    validateProviderReferenceFixture({
      ...base,
      roles: {
        reference: { field: "references", cardinality: "one" },
      },
    }).ok,
    false,
  );

  assert.equal(
    validateProviderReferenceFixture({
      ...base,
      exampleRequest: { prompt: "@{prompt}", image: 1, references: [1] },
    }).ok,
    false,
  );

  assert.equal(
    validateProviderReferenceFixture({
      ...base,
      promptTokenRule: { template: "value {{missing}}" },
    }).ok,
    false,
  );
});

test("maps active references in final order, rewrites canonical tokens, and avoids leakage", () => {
  const fixture: ProviderReferenceFixture = {
    provider: "wavespeed",
    modelId: "fixture/reference-mapper",
    evidenceUrl: "file:///Volumes/Joseph/Projects1/ai-agents/openreel-video/apps/web/src/services/wavespeed/model-capabilities.test.ts",
    evidenceCapturedAt: "2026-07-16T00:00:00.000Z",
    acceptedFields: ["prompt", "image", "references"],
    roles: {
      source: { field: "image", cardinality: "one" },
      reference: { field: "references", cardinality: "many" },
    },
    minReferences: 1,
    maxReferences: 3,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "clean frame",
      image: 1,
      references: [1],
    },
  };

  const result = mapProviderReferences(
    fixture,
    "Lead with @{source} then @{reference-1} and keep @{inactive} out.",
    [
      makeReference("inactive", "reference", 99, "unresolved", ["@{inactive}"]),
      makeReference("source", "source", 2, "active", ["@{source}"]),
      makeReference("reference-1", "reference", 1, "active", ["@{reference-1}"]),
      makeReference("reference-2", "reference", 3, "active", ["@{reference-2}"]),
    ],
  );

  assert.equal(result.prompt, "Lead with then and keep out.");
  assert.deepEqual(result.inputs, { prompt: "clean frame", image: 2, references: [1, 3] });
  assert.equal(hasLeak(result), false);
});

test("fails closed when counts exceed the fixture bounds", async () => {
  const fixture = WAVE_SPEED_REFERENCE_FIXTURES.referenceAndAudio;

  await assert.rejects(
    async () =>
      mapProviderReferences(
        fixture,
        "prompt",
        [
          makeReference("reference-1", "reference", 1),
          makeReference("reference-2", "reference", 2),
          makeReference("reference-3", "reference", 3),
          makeReference("reference-4", "reference", 4),
        ],
      ),
  );
});
