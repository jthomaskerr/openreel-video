import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, Project } from "@openreel/core";
import { canonicalMediaToken } from "../../features/generation/references/resolve";
import { useGenerationDraftStore } from "../../features/generation/drafts";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { InspectorPanel } from "./InspectorPanel";

const productionRuntime = vi.hoisted(() => ({
  readCapabilities: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../../stores/generation-job-store", async () => {
  const actual = await vi.importActual<typeof import("../../stores/generation-job-store")>(
    "../../stores/generation-job-store",
  );
  return {
    ...actual,
    getProductionGenerationRuntime: () => ({
      readCapabilities: productionRuntime.readCapabilities,
      controller: {
        submit: productionRuntime.submit,
        cancel: productionRuntime.cancel,
      },
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

describe("InspectorPanel generation reference integration", () => {
  beforeEach(() => {
    const source = image("media-source", "asset-source");
    const mentioned = image("media-mentioned", "asset-mentioned");
    const shotReference = image("media-shot", "asset-shot");
    const prompt = `Compose with ${canonicalMediaToken(mentioned.id)}.`;
    const base = createEmptyProject("Inspector generation reference test");
    const project: Project = {
      ...base,
      id: "project-inspector",
      mediaLibrary: { items: [source, mentioned, shotReference] },
      generatedImageDefinitions: [{
        id: "definition-source",
        projectId: "project-inspector",
        assetGroupId: "asset-source",
        currentMediaVersionId: source.id,
        title: "Source",
        draft: {
          prompt,
          roleByReferenceKey: { "reference:media-mentioned": "style" },
          inputs: {},
        },
        attemptIds: [],
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      }],
      timeline: {
        ...base.timeline,
        duration: 4,
        tracks: [{
          id: "track-image",
          type: "image",
          name: "Images",
          clips: [{
            id: "clip-image",
            type: "image",
            mediaId: source.id,
            trackId: "track-image",
            startTime: 0,
            duration: 4,
            inPoint: 0,
            outPoint: 4,
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
              shotId: "shot-1",
              source: "manual",
              prompt,
              referenceAssetIds: [shotReference.id],
            },
          }],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        }],
      },
    };
    useProjectStore.setState({ project });
    useGenerationDraftStore.setState({ drafts: {}, referenceRecoveries: {} });
    useUIStore.getState().closeModal();
    useUIStore.getState().clearSelection();
    useUIStore.getState().select({ type: "clip", id: "clip-image", trackId: "track-image" });
    useUIStore.getState().setSidebarTab("edit");
    productionRuntime.submit.mockReset();
    productionRuntime.cancel.mockReset();
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
          properties: { prompt: { type: "string" } },
          required: ["prompt"],
          additionalProperties: false,
        },
      }],
    });
    productionRuntime.submit.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => cleanup());

  it("submits the same ordered resolved identities rendered by the live inspector cards", async () => {
    render(<InspectorPanel />);

    fireEvent.click(await screen.findByRole("tab", { name: /Generate/ }));
    const card = await screen.findByTestId(
      "generate-reference-trigger-reference:media-mentioned",
    );

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
        key: "reference:media-shot",
        mediaId: "asset-shot",
        mediaVersionId: "media-shot",
        order: 2,
        origins: ["shot"],
      }),
    ]);

    fireEvent.click(card);
    expect(useUIStore.getState().activeModal).toBe("reference-editor");
    expect(useUIStore.getState().modalData).toMatchObject({
      referenceEditorRoute: {
        target: { kind: "imported-image", mediaId: "media-mentioned" },
      },
    });
  });
});
