import type { MediaItem } from "@openreel/core";
import { describe, expect, it, vi } from "vitest";
import { IMAGE_MODELS } from "../../../services/kieai/image-generation";
import type { GenerationJob } from "../../../stores/generation-job-store";

import {
  misleadingType,
  textToImage,
  textToVideo,
} from "../../../services/wavespeed/__fixtures__/recorded-models";
import {
  controllerModelFromWaveSpeed,
  KIEAI_CONTROLLER_MODELS,
  kieAIProviderInputs,
  mentionOptionsFromMedia,
  recordSubmittedGenerationJob,
} from "./ProjectGeneratedImageEditor";

function media(
  id: string,
  type: MediaItem["type"],
  overrides: Partial<MediaItem> = {},
): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 100,
      height: 100,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    thumbnailUrl: null,
    ...overrides,
  };
}

describe("ProjectGeneratedImageEditor adapters", () => {
  it("exposes the supported KieAI image models through the shared controller", () => {
    expect(KIEAI_CONTROLLER_MODELS.map(({ id, label, provider }) => ({ id, label, provider }))).toEqual([
      { id: IMAGE_MODELS.Z_IMAGE, label: "Z-Image", provider: "kieai" },
      { id: IMAGE_MODELS.NANO_BANANA2, label: "Nano Banana 2", provider: "kieai" },
    ]);
  });

  it("maps Nano Banana references and schema inputs to the provider request", () => {
    expect(
      kieAIProviderInputs({
        modelId: IMAGE_MODELS.NANO_BANANA2,
        prompt: "A lighthouse in rain",
        inputs: { aspect_ratio: "auto", resolution: "4K", output_format: "jpg" },
        referenceUrls: ["https://example.test/reference.png"],
      }),
    ).toEqual({
      prompt: "A lighthouse in rain",
      image_input: ["https://example.test/reference.png"],
      aspect_ratio: "auto",
      resolution: "4K",
      output_format: "jpg",
    });
  });

  it("reuses the failed local job record when a provider retry is submitted", () => {
    const failedJob = {
      id: "local-failed",
      provider: "kieai" as const,
      providerJobId: "provider-old",
      model: IMAGE_MODELS.Z_IMAGE,
      prompt: "Retry me",
      inputs: {},
      projectId: "project-1",
      linkedMediaIds: ["media-1"],
      status: "failed" as const,
      createdAt: 1,
      updatedAt: 1,
      retryHistory: [],
    };
    const store = {
      jobs: [failedJob] as GenerationJob[],
      getJobs: () => store.jobs,
      enqueue: vi.fn(),
      retry: vi.fn((id: string, providerJobId: string) => {
        store.jobs = store.jobs.map((job) =>
          job.id === id ? { ...job, providerJobId, status: "queued" as const } : job,
        );
      }),
    };

    const result = recordSubmittedGenerationJob(
      {
        definitionId: "definition-1",
        retryJobId: failedJob.id,
        provider: "kieai",
        providerJobId: "provider-new",
        model: IMAGE_MODELS.Z_IMAGE,
        prompt: "Retry me",
        inputs: {},
        projectId: "project-1",
        linkedMediaIds: ["media-1"],
      },
      store,
    );

    expect(store.enqueue).not.toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalledWith("local-failed", "provider-new");
    expect(result).toMatchObject({ id: "local-failed", providerJobId: "provider-new" });
    expect(store.jobs).toHaveLength(1);
  });

  it("keeps only schema-supported image models and exposes non-media inputs", () => {
    const imageModel = controllerModelFromWaveSpeed(textToImage);

    expect(imageModel).toMatchObject({
      id: textToImage.model_id,
      provider: "wavespeed",
      capability: { output: "image", mode: "text-to-image" },
    });
    expect(imageModel?.inputFields.map((field) => field.key)).toEqual([
      "seed",
      "aspect_ratio",
      "enhance",
    ]);
    expect(controllerModelFromWaveSpeed(textToVideo)).toBeUndefined();
    expect(controllerModelFromWaveSpeed(misleadingType)).toBeUndefined();
  });

  it("offers only image media mentions and preserves explicit availability", () => {
    expect(
      mentionOptionsFromMedia([
        media("available", "image", {
          title: "Hero reference",
          description: "Front three-quarter portrait",
          thumbnailUrl: "blob:hero",
        }),
        media("missing", "image", { title: "Missing reference" }),
        media("video", "video"),
      ]),
    ).toEqual([
      {
        kind: "media",
        id: "available",
        label: "Hero reference",
        description: "Front three-quarter portrait",
        thumbnailUrl: "blob:hero",
        available: true,
      },
      {
        kind: "media",
        id: "missing",
        label: "Missing reference",
        description: "Image media",
        available: false,
      },
    ]);
  });
});
