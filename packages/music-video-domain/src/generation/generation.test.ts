import { describe, expect, it } from "vitest";
import { convertNeuralFramesCharacters, migratePersistedGenerationJob, parseGenerationJob } from "./index.js";

const base = {
  schemaVersion: 2, id: "job-1", provider: "wavespeed", modelId: "model-1", modelSchemaVersion: "schema-1",
  status: "queued", createdAt: 1000, updatedAt: 1001, providerInputs: { seed: 0, enhance: false, references: [] },
  attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1000 }], checkpoints: {},
};
const context = (target: unknown) => ({ projectId: "project-1", target, references: [], placementPolicy: "none" });

describe("GenerationJobSchema", () => {
  it.each([
    { kind: "new-asset", placeholderMediaId: "placeholder-1" },
    { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
  ])("parses an explicit $kind target and preserves JSON falsy values", (target) => {
    const parsed = parseGenerationJob({ ...base, context: context(target) });
    expect(parsed.providerInputs).toEqual({ seed: 0, enhance: false, references: [] });
  });

  it.each([
    ["missing placeholder", { ...base, context: context({ kind: "new-asset" }) }],
    ["replacement without clip", { ...base, context: { ...context({ kind: "new-asset", placeholderMediaId: "p" }), placementPolicy: "replace-selected-clip-media" } }],
    ["negative timing", { ...base, context: { ...context({ kind: "new-asset", placeholderMediaId: "p" }), timing: { source: "shot", startSeconds: -1, endSeconds: 2, durationSeconds: 3 } } }],
    ["reversed timing", { ...base, context: { ...context({ kind: "new-asset", placeholderMediaId: "p" }), timing: { source: "shot", startSeconds: 2, endSeconds: 1, durationSeconds: 1 } } }],
    ["duplicate attempts", { ...base, attempts: [{ attemptNumber: 1, startedAt: 1 }, { attemptNumber: 1, startedAt: 2 }], context: context({ kind: "new-asset", placeholderMediaId: "p" }) }],
    ["unknown boundary key", { ...base, secret: "must-not-pass", context: context({ kind: "new-asset", placeholderMediaId: "p" }) }],
  ])("rejects %s", (_label, value) => expect(() => parseGenerationJob(value)).toThrow());

  it("round-trips a secret-safe persisted job", () => {
    const parsed = parseGenerationJob({ ...base, context: context({ kind: "new-asset", placeholderMediaId: "p" }) });
    const json = JSON.stringify(parsed);
    expect(json).not.toMatch(/https?:|blob:|signed/i);
    expect(parseGenerationJob(JSON.parse(json))).toEqual(parsed);
  });
});

describe("legacy migration", () => {
  it("reconstructs only from explicit target fields", () => {
    const migrated = migratePersistedGenerationJob({ id: "legacy-1", provider: "wavespeed", model: "m", projectId: "p", placeholderMediaId: "placeholder-1", sourceMediaId: "source-1", linkedMediaIds: ["reference-not-source"], status: "complete", createdAt: 10 });
    expect(migrated.context.target).toEqual({ kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" });
    expect(migrated.status).toBe("completed");
  });
  it("makes ambiguous linkedMediaIds terminal without inferring a source", () => {
    const migrated = migratePersistedGenerationJob({ id: "legacy-2", projectId: "p", linkedMediaIds: ["reference-1"], createdAt: 10 });
    expect(migrated.status).toBe("needs-attention");
    expect(migrated.error?.code).toBe("generation-legacy-target-ambiguous");
    expect("sourceMediaId" in migrated.context.target).toBe(false);
  });
});

describe("NeuralFrames character conversion", () => {
  it("normalizes slugs and resolves collisions deterministically", () => {
    const input = [
      { id: "b", name: "The Hero!", primaryImageMediaId: "media-b" },
      { id: "a", name: "Thé Héro", primaryImageMediaId: "media-a", primaryImageVersionId: "v1" },
      { name: "!!!", primaryImageMediaId: "media-c" },
    ];
    const first = convertNeuralFramesCharacters(input);
    const second = convertNeuralFramesCharacters([...input].reverse());
    expect(first).toEqual(second);
    expect(first.map((character) => character.slug)).toEqual(["character", "the-hero", "the-hero-2"]);
    expect(first.map((character) => character.id)).toEqual(["neuralframes:character:1", "a", "b"]);
  });
});
