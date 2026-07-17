import "../../../test/install-local-storage-mock";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, Project } from "@openreel/core";

import { mediaAvailabilityRuntime } from "../../../services/media-verification";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { AssetInspectorWithTabs } from "./AssetInspectorWithTabs";

const originalConvertImportedImage =
  useProjectStore.getState().convertImportedImage;

function image(
  overrides: Partial<MediaItem> & Pick<MediaItem, "id" | "name">,
): MediaItem {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    type: "image",
    fileHandle: null,
    blob: new Blob([name], { type: "image/png" }),
    metadata: {
      duration: 0,
      width: 1024,
      height: 1024,
      frameRate: 0,
      codec: "png",
      sampleRate: 0,
      channels: 0,
      fileSize: name.length,
    },
    thumbnailUrl: "data:image/png;base64,cHJldmlldw==",
    ...rest,
  };
}

function definition(
  overrides: Partial<Project["generatedImageDefinitions"][number]> = {},
): Project["generatedImageDefinitions"][number] {
  return {
    id: "definition-1",
    projectId: "project-1",
    assetGroupId: "group-1",
    currentMediaVersionId: "generated-current",
    title: "Generated still",
    draft: {
      prompt: "A generated still",
      roleByReferenceKey: {},
      inputs: {},
    },
    attemptIds: [],
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

function seedProject(
  items: MediaItem[],
  definitions: Project["generatedImageDefinitions"] = [],
): Project {
  const project: Project = {
    ...createEmptyProject("Asset Inspector Generation Test"),
    id: "project-1",
    mediaLibrary: { items },
    generatedImageDefinitions: definitions,
  };
  useProjectStore.setState({
    project,
    convertImportedImage: originalConvertImportedImage,
  });
  useUIStore.getState().clearSelection();
  useUIStore.getState().setInspectedAsset(null);
  useUIStore.getState().setReferenceEditorInspectorRoute(null);
  return project;
}

describe("AssetInspectorWithTabs generated-image entry", () => {
  beforeEach(() => {
    vi.spyOn(mediaAvailabilityRuntime, "get").mockImplementation(
      (_projectId, mediaId) => ({
        mediaId,
        status: "available",
        evidence: {
          authoritative: true,
          mapping: "present",
          object: "present",
        },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({
      project: createEmptyProject("Reset"),
      convertImportedImage: originalConvertImportedImage,
    });
    useUIStore.getState().clearSelection();
    useUIStore.getState().setInspectedAsset(null);
    useUIStore.getState().setReferenceEditorInspectorRoute(null);
    vi.restoreAllMocks();
  });

  it("renders Regenerate immediately next to Replace for an available image", () => {
    const item = image({
      id: "imported-1",
      name: "reference.png",
      assetGroupId: "group-1",
    });
    seedProject([item]);

    render(<AssetInspectorWithTabs item={item} />);

    const replace = screen.getByRole("button", { name: "Replace" });
    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    expect(replace.nextElementSibling).toBe(regenerate);
  });

  it("does not offer Regenerate for an unavailable image", () => {
    vi.mocked(mediaAvailabilityRuntime.get).mockReturnValue({
      mediaId: "missing-1",
      status: "confirmed_missing",
      evidence: {
        authoritative: true,
        mapping: "absent",
        object: "absent",
      },
    });
    const item = image({
      id: "missing-1",
      name: "missing.png",
      blob: null,
      thumbnailUrl: null,
      sourceFile: { name: "missing.png", size: 10, lastModified: 0 },
    });
    seedProject([item]);

    render(<AssetInspectorWithTabs item={item} />);

    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
  });

  it("converts an imported image without changing its media or provenance and opens the new definition", async () => {
    const originalBlob = new Blob(["original bytes"], { type: "image/png" });
    const imported = image({
      id: "imported-1",
      name: "original.png",
      assetGroupId: "group-1",
      blob: originalBlob,
      sourceFile: {
        name: "original.png",
        size: originalBlob.size,
        lastModified: 123,
      },
    });
    seedProject([imported]);

    render(<AssetInspectorWithTabs item={imported} />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(
        useProjectStore.getState().project.generatedImageDefinitions,
      ).toHaveLength(1);
    });

    const project = useProjectStore.getState().project;
    const preserved = project.mediaLibrary.items.find(
      (item) => item.id === imported.id,
    );
    const createdDefinition = project.generatedImageDefinitions[0];
    expect(preserved).toMatchObject(imported);
    expect(preserved?.blob).toBe(originalBlob);
    expect(preserved?.generationMeta).toBeUndefined();
    expect(createdDefinition).toMatchObject({
      assetGroupId: imported.assetGroupId,
      sourceMediaVersionId: imported.id,
      currentMediaVersionId: imported.id,
      attemptIds: [],
    });
    expect(useUIStore.getState().referenceEditorInspectorRoute).toMatchObject({
      editor: "generated-image",
      definitionId: createdDefinition?.id,
      mediaId: imported.id,
    });
  });

  it("opens the definition that owns the asset group without conversion or project mutation", async () => {
    const inspectedVersion = image({
      id: "generated-previous",
      name: "previous.png",
      assetGroupId: "group-1",
      generationMeta: {
        provider: "wavespeed",
        model: "flux",
        prompt: "Previous prompt",
        inputs: {},
        status: "realized",
      },
    });
    const currentVersion = image({
      id: "generated-current",
      name: "current.png",
      assetGroupId: "group-1",
      generationMeta: {
        provider: "wavespeed",
        model: "flux",
        prompt: "Current prompt",
        inputs: {},
        status: "realized",
      },
    });
    const existingDefinition = definition();
    const before = seedProject(
      [inspectedVersion, currentVersion],
      [existingDefinition],
    );
    const convertImportedImage = vi.fn();
    useProjectStore.setState({ convertImportedImage });

    render(<AssetInspectorWithTabs item={inspectedVersion} />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(useUIStore.getState().referenceEditorInspectorRoute).toMatchObject({
        editor: "generated-image",
        definitionId: existingDefinition.id,
        mediaId: currentVersion.id,
      });
    });
    expect(convertImportedImage).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toBe(before);
    expect(
      useProjectStore.getState().project.mediaLibrary.items[0]?.generationMeta,
    ).toEqual(inspectedVersion.generationMeta);
  });

  it("does not open the generated-image editor when imported conversion fails", async () => {
    const item = image({
      id: "imported-1",
      name: "reference.png",
      assetGroupId: "group-1",
    });
    const before = seedProject([item]);
    const failedConversion = vi.fn().mockResolvedValue({
      success: false,
      error: {
        code: "MEDIA_NOT_FOUND",
        message: "Imported image unavailable",
      },
    });
    useProjectStore.setState({ convertImportedImage: failedConversion });

    render(<AssetInspectorWithTabs item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(failedConversion).toHaveBeenCalledTimes(1));
    expect(useProjectStore.getState().project).toBe(before);
    expect(useUIStore.getState().referenceEditorInspectorRoute).toBeNull();
  });
});
