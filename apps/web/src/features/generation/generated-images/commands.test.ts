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

const snapshotProject = (
  project: GeneratedImageCommandProject,
): GeneratedImageCommandProject => ({
  id: project.id,
  mediaItems: [...project.mediaItems],
  mediaGroups: [...project.mediaGroups],
  generatedImageDefinitions: [...project.generatedImageDefinitions],
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
  it("creates one group, one unrealized placeholder media item, and one definition without mutating input", () => {
    const project = createProject();
    const before = snapshotProject(project);

    const result = createGeneratedImage(project, {
      title: "Storm lighthouse",
      draft: createDraft(),
      createId: createIds("group-1", "media-1", "definition-1"),
      now: () => "2026-07-16T00:00:00.000Z",
    });

    expect(project).toEqual(before);
    expect(result).toMatchObject({
      success: true,
      definitionId: "definition-1",
      mediaId: "media-1",
    });
    expect(result.success && result.nextProject).toMatchObject({
      mediaGroups: [{ id: "group-1" }],
      mediaItems: [
        {
          id: "media-1",
          type: "image",
          title: "Storm lighthouse",
          assetGroupId: "group-1",
          isCurrent: true,
          generationMeta: {
            status: "unrealized",
            prompt: "A lighthouse in a storm",
          },
        },
      ],
      generatedImageDefinitions: [
        createDefinition("definition-1", [], {
          assetGroupId: "group-1",
          currentMediaVersionId: "media-1",
          title: "Storm lighthouse",
        }),
      ],
    });
  });

  it("converts an imported image idempotently without replacing blob identity or filename", () => {
    const blob = new Blob(["pixels"], { type: "image/png" });
    const project: GeneratedImageCommandProject = {
      id: "project-1",
      mediaItems: [
        {
          id: "imported-1",
          type: "image",
          name: "reference.png",
          fileName: "reference.png",
          blob,
        },
      ],
      mediaGroups: [],
      generatedImageDefinitions: [],
    };
    const before = snapshotProject(project);

    const first = convertImportedImageToGeneratedImage(project, "imported-1", {
      createId: createIds("definition-1"),
      now: () => "2026-07-16T00:00:00.000Z",
    });

    expect(project).toEqual(before);
    expect(first).toMatchObject({
      success: true,
      definitionId: "definition-1",
      mediaId: "imported-1",
    });
    if (!first.success) {
      throw new Error("Expected conversion to succeed");
    }

    const second = convertImportedImageToGeneratedImage(first.nextProject, "imported-1", {
      createId: () => {
        throw new Error("Idempotent conversion must not allocate another id");
      },
      now: () => "2026-07-16T01:00:00.000Z",
    });

    expect(second).toMatchObject({
      success: true,
      definitionId: "definition-1",
      mediaId: "imported-1",
    });
    expect(first.nextProject.mediaItems[0]).toMatchObject({
      id: "imported-1",
      fileName: "reference.png",
      blob,
    });
    expect(first.nextProject.mediaItems[0]?.generationMeta).toBeUndefined();
    expect(first.nextProject.generatedImageDefinitions).toEqual([
      createDefinition("definition-1", [], {
        assetGroupId: "imported-1",
        currentMediaVersionId: "imported-1",
        sourceMediaVersionId: "imported-1",
        title: "reference.png",
        draft: createDraft({ prompt: "reference.png" }),
      }),
    ]);
  });

  it("updates the draft through an undoable pure command", () => {
    const project: GeneratedImageCommandProject = {
      id: "project-1",
      mediaItems: [],
      mediaGroups: [],
      generatedImageDefinitions: [
        createDefinition("definition-1", [], {
          draft: createDraft({ prompt: "before" }),
        }),
      ],
    };
    const before = snapshotProject(project);

    const result = updateGeneratedImageDraft(
      project,
      "definition-1",
      { prompt: "after" },
      { now: () => "2026-07-16T01:00:00.000Z" },
    );

    expect(project).toEqual(before);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected draft update to succeed");
    }
    expect(result.nextProject.generatedImageDefinitions[0]?.draft.prompt).toBe("after");
    expect(result.undo?.()).toEqual(project);
  });

  it("requires confirmation before deleting a definition with affected uses", () => {
    const project: GeneratedImageCommandProject = {
      id: "project-1",
      mediaGroups: [{ id: "definition-1-group" }],
      mediaItems: [
        {
          id: "definition-1-media",
          type: "image",
          assetGroupId: "definition-1-group",
          generationMeta: {
            provider: "generated-image",
            model: "draft",
            status: "unrealized",
          },
        },
      ],
      generatedImageDefinitions: [
        createDefinition("definition-1"),
        createDefinition("definition-2", ["definition-1"]),
      ],
    };
    const before = snapshotProject(project);

    const pending = deleteGeneratedImage(project, "definition-1");
    expect(pending).toEqual({
      success: false,
      requiresConfirmation: true,
      affectedDefinitionIds: ["definition-2"],
      error: {
        code: "DEFINITION_IN_USE",
        message: "Generated image definition definition-1 is still referenced",
        details: {
          projectId: "project-1",
          definitionId: "definition-1",
          affectedDefinitionIds: ["definition-2"],
        },
      },
    });
    expect(project).toEqual(before);

    const confirmed = deleteGeneratedImage(project, "definition-1", { confirmed: true });
    expect(confirmed).toMatchObject({
      success: true,
      definitionId: "definition-1",
      mediaId: "definition-1-media",
    });
    if (!confirmed.success) {
      throw new Error("Expected confirmed delete to succeed");
    }
    expect(confirmed.nextProject.generatedImageDefinitions.map((definition) => definition.id)).toEqual([
      "definition-2",
    ]);
    expect(confirmed.nextProject.mediaItems).toHaveLength(0);
    expect(confirmed.nextProject.mediaGroups).toHaveLength(0);
  });

  it("returns structured validation errors without mutating input", () => {
    const project = createProject();
    const before = snapshotProject(project);

    const missingMedia = convertImportedImageToGeneratedImage(project, "missing-media", {
      createId: () => {
        throw new Error("Missing media must fail before allocating ids");
      },
      now: () => "2026-07-16T00:00:00.000Z",
    });
    const missingDefinition = updateGeneratedImageDraft(
      project,
      "missing-definition",
      { prompt: "after" },
      { now: () => "2026-07-16T00:00:00.000Z" },
    );

    expect(missingMedia).toEqual({
      success: false,
      error: {
        code: "MEDIA_NOT_FOUND",
        message: "Media item not found: missing-media",
        details: {
          projectId: "project-1",
          mediaId: "missing-media",
        },
      },
    });
    expect(missingDefinition).toEqual({
      success: false,
      error: {
        code: "DEFINITION_NOT_FOUND",
        message: "Generated image definition not found: missing-definition",
        details: {
          projectId: "project-1",
          definitionId: "missing-definition",
        },
      },
    });
    expect(project).toEqual(before);
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
