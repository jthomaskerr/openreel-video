import "../../../test/install-local-storage-mock";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import type { StoryboardShot } from "@openreel/music-video-domain";
import { canonicalMediaToken } from "../../../features/generation/references/resolve";
import { useGenerationDraftStore } from "../../../features/generation/drafts";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { GenerateAssetDialog } from "./GenerateAssetDialog";

const productionRuntime = vi.hoisted(() => ({
  readCapabilities: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("../../../stores/generation-job-store", async () => {
  const actual = await vi.importActual<typeof import("../../../stores/generation-job-store")>(
    "../../../stores/generation-job-store",
  );
  return {
    ...actual,
    getProductionGenerationRuntime: () => ({
      readCapabilities: productionRuntime.readCapabilities,
      controller: { submit: productionRuntime.submit },
    }),
  };
});

function image(id: string, assetGroupId: string): MediaItem {
  return {
    id,
    assetGroupId,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: new Blob([id], { type: "image/png" }),
    metadata: {
      duration: 0,
      width: 1024,
      height: 1024,
      frameRate: 0,
      codec: "image/png",
      sampleRate: 0,
      channels: 0,
      fileSize: id.length,
    },
    thumbnailUrl: null,
  };
}

function shot(prompt: string, referenceAssetIds: string[]): StoryboardShot {
  return {
    id: "shot-1",
    index: 0,
    label: "Shot 1",
    prompt,
    model: "wavespeed/model",
    resolution: "1024x1024",
    aspectRatio: "1:1",
    includeMainAudio: false,
    referenceAssetIds,
    generatedAssetIds: [],
    validation: { valid: true, warnings: [], errors: [] },
    outputs: [],
    selected: true,
  };
}

describe("GenerateAssetDialog project reference integration", () => {
  beforeEach(() => {
    const source = image("media-source", "asset-source");
    const mentioned = image("media-mentioned", "asset-mentioned");
    const shotReference = image("media-shot", "asset-shot");
    const addedReference = image("media-added", "asset-added");
    const base = createEmptyProject("Dialog reference test");
    const project: Project = {
      ...base,
      id: "project-dialog",
      mediaLibrary: { items: [source, mentioned, shotReference, addedReference] },
      generatedImageDefinitions: [{
        id: "definition-source",
        projectId: "project-dialog",
        assetGroupId: "asset-source",
        currentMediaVersionId: source.id,
        title: "Source",
        draft: {
          prompt: "",
          roleByReferenceKey: { "reference:media-mentioned": "style" },
          inputs: {},
        },
        attemptIds: [],
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      }],
    };
    useProjectStore.setState((state) => ({ ...state, project }));
    useGenerationDraftStore.setState({ drafts: {}, referenceRecoveries: {} });
    useUIStore.getState().closeModal();
    useUIStore.getState().clearSelection();
    productionRuntime.submit.mockReset();
    productionRuntime.readCapabilities.mockReset();
    productionRuntime.readCapabilities.mockResolvedValue({
      configured: true,
      generationV2ReleaseEnabled: true,
      providerInstanceId: "wavespeed-production",
      routes: [{
        providerInstanceId: "wavespeed-production",
        providerModelId: "wavespeed/model",
        requestedMode: "text-to-image",
        providerSchemaId: "wavespeed-request",
        providerEndpointId: "wavespeed-submit",
        providerSchemaVersion: "2026-07",
        output: "image",
        supportsAudio: false,
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string" },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      }],
    });
    productionRuntime.submit.mockResolvedValue({ id: "job-1" });
  });

  it("resolves the live dialog prompt into navigable cards, one atomic draft, and canonical submission order", async () => {
    const prompt = `Compose with ${canonicalMediaToken("media-mentioned")}.`;

    render(
      <GenerateAssetDialog
        open
        onClose={vi.fn()}
        sourceMediaId="media-source"
        shot={shot(prompt, ["media-shot"])}
      />,
    );

    fireEvent.click(await screen.findByRole("option", { name: /wavespeed\/model/i }));

    await waitFor(() => {
      expect(useGenerationDraftStore.getState().getDraft({
        kind: "shot",
        shotId: "shot-1",
      })).toMatchObject({
        prompt,
        referenceIds: [
          "reference:media-source",
          "reference:media-mentioned",
          "reference:media-shot",
        ],
        referenceTargets: {
          "reference:media-source": { kind: "generated-image", definitionId: "definition-source" },
          "reference:media-mentioned": { kind: "imported-image", mediaId: "media-mentioned" },
          "reference:media-shot": { kind: "imported-image", mediaId: "media-shot" },
        },
      });
    });

    fireEvent.click(await screen.findByTestId(
      "generate-reference-trigger-reference:media-mentioned",
    ));
    expect(useUIStore.getState().activeModal).toBe("reference-editor");
    expect(useUIStore.getState().modalData).toMatchObject({
      referenceEditorRoute: {
        target: { kind: "imported-image", mediaId: "media-mentioned" },
      },
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: `${prompt} ${canonicalMediaToken("media-added")}` },
    });
    await waitFor(() => {
      expect(useGenerationDraftStore.getState().getDraft({
        kind: "shot",
        shotId: "shot-1",
      })).toMatchObject({
        prompt: `${prompt} ${canonicalMediaToken("media-added")}`,
        referenceIds: [
          "reference:media-source",
          "reference:media-mentioned",
          "reference:media-added",
          "reference:media-shot",
        ],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(productionRuntime.submit).toHaveBeenCalledTimes(1));
    expect(productionRuntime.submit.mock.calls[0]?.[0]?.references).toEqual([
      expect.objectContaining({
        key: "reference:media-source",
        mediaId: "asset-source",
        mediaVersionId: "media-source",
        order: 0,
        origins: ["source"],
      }),
      expect.objectContaining({
        key: "reference:media-mentioned",
        mediaId: "asset-mentioned",
        mediaVersionId: "media-mentioned",
        order: 1,
        role: "style",
        origins: ["user"],
      }),
      expect.objectContaining({
        key: "reference:media-added",
        mediaId: "asset-added",
        mediaVersionId: "media-added",
        order: 2,
        origins: ["user"],
      }),
      expect.objectContaining({
        key: "reference:media-shot",
        mediaId: "asset-shot",
        mediaVersionId: "media-shot",
        order: 3,
        origins: ["shot"],
      }),
    ]);
  });

  it("hydrates a clip-owned prompt and shot references without seeded draft state", async () => {
    const prompt = `Compose with ${canonicalMediaToken("media-mentioned")}.`;
    const current = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...current,
        timeline: {
          ...current.timeline,
          tracks: [{
            id: "track-1",
            type: "image",
            name: "Images",
            clips: [{
              id: "clip-1",
              type: "image",
              mediaId: "media-source",
              trackId: "track-1",
              startTime: 0,
              duration: 3,
              inPoint: 0,
              outPoint: 3,
              effects: [],
              audioEffects: [],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              volume: 1,
              keyframes: [],
              metadata: {
                kind: "storyboard-shot",
                shotId: "shot-from-clip",
                source: "manual",
                prompt,
                referenceAssetIds: ["media-shot"],
              },
            }],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          }],
        },
      },
    });

    render(<GenerateAssetDialog open onClose={vi.fn()} clipId="clip-1" />);

    await waitFor(() => {
      expect(useGenerationDraftStore.getState().getDraft({
        kind: "shot",
        shotId: "shot-from-clip",
      })).toMatchObject({
        prompt,
        referenceIds: [
          "reference:media-source",
          "reference:media-mentioned",
          "reference:media-shot",
        ],
        referenceTargets: {
          "reference:media-source": { kind: "generated-image", definitionId: "definition-source" },
          "reference:media-mentioned": { kind: "imported-image", mediaId: "media-mentioned" },
          "reference:media-shot": { kind: "imported-image", mediaId: "media-shot" },
        },
      });
    });
  });
});
