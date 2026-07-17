import { beforeEach, describe, expect, it } from "vitest";
import type {
  ReferenceRoleByKey,
  ResolvedGenerationReference,
} from "@openreel/core";
import type { GenerationModelCapability } from "../../../services/wavespeed/model-capabilities";
import {
  getExcludedReferences,
  getReferenceRoleOptions,
  reconcileReferenceRoles,
} from "./roles";
import {
  clearReferenceWarningPreferences,
  isReferenceWarningSuppressed,
  suppressReferenceWarning,
} from "../../../stores/reference-warning-preferences";

function capability(
  overrides: Partial<GenerationModelCapability["accepts"]> = {},
): GenerationModelCapability {
  return {
    provider: "wavespeed",
    modelId: "model-1",
    displayName: "Model 1",
    output: "image",
    mode: "image-to-image",
    accepts: {
      prompt: true,
      negativePrompt: true,
      sourceImage: true,
      referenceImages: { min: 0, max: 4 },
      audio: false,
      seed: true,
      ...overrides,
    },
    requestSchemaVersion: "schema-1",
    schemaVersion: "schema-1",
    supportsAudio: false,
    inputFields: {},
  };
}

function reference(
  id: string,
  overrides: Partial<ResolvedGenerationReference> = {},
): ResolvedGenerationReference {
  return {
    key: `reference:${id}`,
    mediaId: `media-${id}`,
    mediaVersionId: id,
    origins: ["prompt-media"],
    role: "prompt-media",
    canonicalTokens: [`media:${id}`],
    order: Number(id.replace(/\D+/g, "")) || 0,
    status: "active",
    ...overrides,
  };
}

describe("reconcileReferenceRoles", () => {
  beforeEach(() => {
    clearReferenceWarningPreferences();
  });

  it("exposes multiple role choices only when a source reference can fill both provider roles", () => {
    const sourceReference = reference("1", { origins: ["source", "shot"], role: "source-image" });
    const promptReference = reference("2");

    expect(getReferenceRoleOptions(sourceReference, capability())).toEqual([
      { value: "source-image", label: "Source image" },
      { value: "reference-images", label: "Reference image" },
    ]);
    expect(getReferenceRoleOptions(promptReference, capability())).toEqual([
      { value: "reference-images", label: "Reference image" },
    ]);
    expect(
      getReferenceRoleOptions(
        sourceReference,
        capability({ sourceImage: false, referenceImages: { min: 0, max: 4 } }),
      ),
    ).toEqual([{ value: "reference-images", label: "Reference image" }]);
  });

  it("keeps compatible chosen roles active when switching models", () => {
    const inputReference = reference("1", {
      origins: ["source"],
      role: "source-image",
    });
    const rolesByKey: ReferenceRoleByKey = {
      "reference:1": "reference-images",
    };

    const result = reconcileReferenceRoles({
      rolesByKey,
      references: [inputReference],
      capability: capability({ sourceImage: false, referenceImages: { min: 0, max: 2 } }),
    });

    expect(result.rolesByKey).toEqual({ "reference:1": "reference-images" });
    expect(result.references).toEqual([
      expect.objectContaining({
        key: "reference:1",
        role: "reference-images",
        status: "active",
      }),
    ]);
  });

  it("preserves incompatible user roles as inactive data and reactivates them when the model supports them again", () => {
    const inputReference = reference("1", {
      origins: ["source"],
      role: "source-image",
    });
    const rolesByKey: ReferenceRoleByKey = {
      "reference:1": "source-image",
    };

    const unsupported = reconcileReferenceRoles({
      rolesByKey,
      references: [inputReference],
      capability: capability({ sourceImage: false, referenceImages: { min: 0, max: 2 } }),
    });

    expect(unsupported.rolesByKey).toEqual({ "reference:1": "source-image" });
    expect(unsupported.references).toEqual([
      expect.objectContaining({
        key: "reference:1",
        role: "source-image",
        status: "unsupported",
        reason: "This model does not accept Source image for this reference.",
      }),
    ]);
    expect(getExcludedReferences(unsupported.references)).toEqual([
      expect.objectContaining({
        key: "reference:1",
        reason: "This model does not accept Source image for this reference.",
        warningClass: "reference-excluded",
      }),
    ]);

    const restored = reconcileReferenceRoles({
      rolesByKey: unsupported.rolesByKey,
      references: [inputReference],
      capability: capability(),
    });

    expect(restored.references).toEqual([
      expect.objectContaining({
        key: "reference:1",
        role: "source-image",
        status: "active",
        reason: undefined,
      }),
    ]);
  });

  it("marks overflow references inactive in stable order without mutating the inputs", () => {
    const rolesByKey: ReferenceRoleByKey = {
      "reference:1": "source-image",
      "reference:2": "reference-images",
      "reference:3": "reference-images",
      "reference:4": "reference-images",
    };
    const references = [
      reference("1", { origins: ["source"], role: "source-image", order: 0 }),
      reference("2", { order: 1 }),
      reference("3", { order: 2 }),
      reference("4", { order: 3 }),
    ] as const;
    const originalRoles = { ...rolesByKey };
    const originalReferences = references.map((item) => ({ ...item }));

    const result = reconcileReferenceRoles({
      rolesByKey,
      references,
      capability: capability({ referenceImages: { min: 0, max: 2 } }),
    });

    expect(result.references.map((item) => [item.key, item.status])).toEqual([
      ["reference:1", "active"],
      ["reference:2", "active"],
      ["reference:3", "active"],
      ["reference:4", "overflow"],
    ]);
    expect(result.references[3]).toEqual(
      expect.objectContaining({
        role: "reference-images",
        reason: "Only the first 2 reference images can be submitted to this model.",
      }),
    );
    expect(getExcludedReferences(result.references)).toEqual([
      expect.objectContaining({
        key: "reference:4",
        reason: "Only the first 2 reference images can be submitted to this model.",
        warningClass: "reference-overflow",
      }),
    ]);
    expect(rolesByKey).toEqual(originalRoles);
    expect(references).toEqual(originalReferences);
  });

  it("removes stale role entries only when the referenced card no longer exists", () => {
    const result = reconcileReferenceRoles({
      rolesByKey: {
        "reference:1": "reference-images",
        "reference:missing": "reference-images",
      },
      references: [reference("1")],
      capability: capability(),
    });

    expect(result.rolesByKey).toEqual({
      "reference:1": "reference-images",
    });
  });
});

describe("reference warning preferences", () => {
  beforeEach(() => {
    clearReferenceWarningPreferences();
  });

  it("suppresses only the requested warning class", () => {
    expect(isReferenceWarningSuppressed("reference-overflow")).toBe(false);
    expect(isReferenceWarningSuppressed("reference-excluded")).toBe(false);

    suppressReferenceWarning("reference-overflow");

    expect(isReferenceWarningSuppressed("reference-overflow")).toBe(true);
    expect(isReferenceWarningSuppressed("reference-excluded")).toBe(false);
  });
});
