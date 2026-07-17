import type { GeneratedImageDefinition, GeneratedImageDraft } from "@openreel/core";
import { describe, expect, it } from "vitest";

import {
  convertImportedImageToGeneratedImage,
  createGeneratedImage,
  deleteGeneratedImage,
  type GeneratedImageCommandProject,
  updateGeneratedImageDraft,
} from "./commands";
import { findGeneratedImageDependencyCycle } from "./selectors";

const createProject = (): GeneratedImageCommandProject => ({
  id: "project-1",
  mediaItems: [],
  mediaGroups: [],
  generatedImageDefinitions: [],
});

const createIds = (...values: string[]): (() => string) => {
  let index = 0;
  return () => {
    const value = values[index];
    if (!value) {
      throw new Error("No more IDs available");
    }
    index += 1;
    return value;
  };
};

const createDraft = (
  overrides: Partial<GeneratedImageDraft> = {},
): GeneratedImageDraft => ({
  prompt: "A lighthouse in a storm",
  roleByReferenceKey: {},
  inputs: {},
  ...overrides,
});

const createDefinition = (
  id: string,
  dependencyIds: readonly string[] = [],
  overrides: Partial<GeneratedImageDefinition> = {},
): GeneratedImageDefinition => ({
  id,
  projectId: "project-1",
  assetGroupId: `${id}-group`,
  currentMediaVersionId: `${id}-media`,
  title: id,
  draft: createDraft(
    dependencyIds.length > 0
      ? {
          inputs: { generatedImageDefinitionIds: dependencyIds },
        }
      : {},
  ),
  attemptIds: [],
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  ...overrides,
});

describe("generated image commands", () => {
  it("creates one group, one unrealized placeholder media item, and one definition", () => {
    const project = createProject();

    const result = createGeneratedImage(project, {
      title: "Storm lighthouse",
      draft: createDraft(),
      createId: createIds("group-1", "media-1", "definition-1"),
      now: () => "2026-07-16T00:00:00.000Z",
    });

    expect(result).toEqual({
      success: true,
      definitionId: "definition-1",
      mediaId: "media-1",
    });
    expect(project.mediaGroups).toEqual([{ id: "group-1" }]);
    expect(project.mediaItems).toHaveLength(1);
    expect(project.mediaItems[0]).toMatchObject({
      id: "media-1",
      type: "image",
      title: "Storm lighthouse",
      assetGroupId: "group-1",
      isCurrent: true,
      generationMeta: {
        status: "unrealized",
        prompt: "A lighthouse in a storm",
      },
    });
    expect(project.generatedImageDefinitions).toEqual([
      createDefinition("definition-1", [], {
        assetGroupId: "group-1",
        currentMediaVersionId: "media-1",
        title: "Storm lighthouse",
      }),
    ]);
  });

  it("converts an imported image idempotently without replacing blob identity or filename", () => {
    const project = createProject();
    const blob = new Blob(["pixels"], { type: "image/png" });
    project.mediaItems.push({
      id: "imported-1",
      type: "image",
      name: "reference.png",
      fileName: "reference.png",
      blob,
    });

    const first = convertImportedImageToGeneratedImage(project, "imported-1", {
      createId: createIds("definition-1"),
      now: () => "2026-07-16T00:00:00.000Z",
    });
    const second = convertImportedImageToGeneratedImage(project, "imported-1", {
      createId: () => {
        throw new Error("Idempotent conversion must not allocate another id");
      },
      now: () => "2026-07-16T01:00:00.000Z",
    });

    expect(first).toEqual({
      success: true,
      definitionId: "definition-1",
      mediaId: "imported-1",
    });
    expect(second).toEqual(first);
    expect(project.mediaItems[0]).toMatchObject({
      id: "imported-1",
      fileName: "reference.png",
      blob,
    });
    expect(project.mediaItems[0]?.generationMeta).toBeUndefined();
    expect(project.generatedImageDefinitions).toEqual([
      createDefinition("definition-1", [], {
        assetGroupId: "imported-1",
        currentMediaVersionId: "imported-1",
        sourceMediaVersionId: "imported-1",
        title: "reference.png",
        draft: createDraft({ prompt: "reference.png" }),
      }),
    ]);
  });

  it("updates the draft through an undoable command", () => {
    const project = createProject();
    project.generatedImageDefinitions.push(
      createDefinition("definition-1", [], {
        draft: createDraft({ prompt: "before" }),
      }),
    );

    const result = updateGeneratedImageDraft(
      project,
      "definition-1",
      { prompt: "after" },
      { now: () => "2026-07-16T01:00:00.000Z" },
    );

    expect(result.success).toBe(true);
    expect(project.generatedImageDefinitions[0]?.draft.prompt).toBe("after");
    result.undo?.();
    expect(project.generatedImageDefinitions[0]?.draft.prompt).toBe("before");
  });

  it("requires confirmation before deleting a definition with affected uses", () => {
    const project = createProject();
    project.mediaGroups.push({ id: "definition-1-group" });
    project.mediaItems.push({
      id: "definition-1-media",
      type: "image",
      assetGroupId: "definition-1-group",
      generationMeta: {
        provider: "generated-image",
        model: "draft",
        status: "unrealized",
      },
    });
    project.generatedImageDefinitions.push(createDefinition("definition-1"));
    project.generatedImageDefinitions.push(createDefinition("definition-2", ["definition-1"]));

    const pending = deleteGeneratedImage(project, "definition-1");
    expect(pending).toEqual({
      success: false,
      requiresConfirmation: true,
      affectedDefinitionIds: ["definition-2"],
    });
    expect(project.generatedImageDefinitions).toHaveLength(2);

    const confirmed = deleteGeneratedImage(project, "definition-1", { confirmed: true });
    expect(confirmed).toEqual({
      success: true,
      definitionId: "definition-1",
      mediaId: "definition-1-media",
    });
    expect(project.generatedImageDefinitions.map((definition) => definition.id)).toEqual([
      "definition-2",
    ]);
    expect(project.mediaItems).toHaveLength(0);
    expect(project.mediaGroups).toHaveLength(0);
  });
});

describe("findGeneratedImageDependencyCycle", () => {
  const dependencyMap = (
    entries: ReadonlyArray<readonly [string, readonly string[]]>,
  ): ReadonlyMap<string, readonly string[]> => new Map(entries);

  it("finds direct self-reference", () => {
    const definitions = [createDefinition("a")];

    expect(
      findGeneratedImageDependencyCycle(
        definitions,
        dependencyMap([["a", ["a"]]]),
        "a",
      ),
    ).toEqual(["a", "a"]);
  });

  it("finds transitive cycles", () => {
    const definitions = [createDefinition("a"), createDefinition("b"), createDefinition("c")];

    expect(
      findGeneratedImageDependencyCycle(
        definitions,
        dependencyMap([
          ["a", ["b"]],
          ["b", ["c"]],
          ["c", ["a"]],
        ]),
        "a",
      ),
    ).toEqual(["a", "b", "c", "a"]);
  });

  it("returns null for an acyclic diamond", () => {
    const definitions = [
      createDefinition("a"),
      createDefinition("b"),
      createDefinition("c"),
      createDefinition("d"),
    ];

    expect(
      findGeneratedImageDependencyCycle(
        definitions,
        dependencyMap([
          ["a", ["b", "c"]],
          ["b", ["d"]],
          ["c", ["d"]],
          ["d", []],
        ]),
        "a",
      ),
    ).toBeNull();
  });
});
