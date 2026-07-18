import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  GeneratedImageDefinition,
  GeneratedImageDraft,
  MediaItem,
} from "@openreel/core";
import { describe, expect, it, vi } from "vitest";
import type { GenerationModelCapability } from "../../../services/wavespeed/model-capabilities";
import {
  createGeneratedImageController,
  type GeneratedImageControllerJob,
  type GeneratedImageControllerModel,
  type GeneratedImageControllerProject,
} from "../../../features/generation/generated-images/controller";
import GenerateTab from "../inspector/tabs/generation/GenerateTab";
import { GeneratedImageEditor } from "./GeneratedImageEditor";

const NOW = "2026-07-17T00:00:00.000Z";

function capability(
  modelId: string,
  overrides: Partial<GenerationModelCapability> = {},
): GenerationModelCapability {
  return {
    provider: "wavespeed",
    modelId,
    displayName: modelId,
    output: "image",
    mode: "text-to-image",
    accepts: {
      prompt: true,
      negativePrompt: true,
      sourceImage: true,
      referenceImages: { min: 0, max: 2 },
      audio: false,
      seed: true,
    },
    requestSchemaVersion: "schema-1",
    schemaVersion: "schema-1",
    supportsAudio: false,
    inputFields: {
      prompt: "prompt",
      negativePrompt: "negative_prompt",
      seed: "seed",
      duration: "duration",
    },
    ...overrides,
  };
}

function models(): GeneratedImageControllerModel[] {
  return [
    {
      id: "model-a",
      label: "Model A",
      provider: "wavespeed",
      capability: capability("model-a"),
      schemaVersion: "schema-1",
      inputFields: [
        { key: "seed", label: "Seed", type: "number" },
        {
          key: "duration",
          label: "Duration",
          type: "number",
          required: true,
          min: 1,
          max: 8,
        },
      ],
      basePrice: 0.04,
      priceFormula: "$0.04 per image",
      limits: ["Maximum 2048 × 2048"],
    },
    {
      id: "model-b",
      label: "Model B",
      provider: "kieai",
      capability: capability("model-b", {
        accepts: {
          prompt: true,
          negativePrompt: false,
          sourceImage: true,
          referenceImages: { min: 0, max: 1 },
          audio: false,
          seed: true,
        },
      }),
      schemaVersion: "schema-2",
      inputFields: [{ key: "seed", label: "Seed", type: "number" }],
      basePrice: 0.08,
    },
  ];
}

function image(): MediaItem {
  return {
    id: "source-media",
    name: "source.png",
    title: "Source image",
    type: "image",
    fileHandle: null,
    blob: null,
    thumbnailUrl: null,
    metadata: {
      duration: 0,
      width: 1024,
      height: 1024,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
  };
}

function definition(
  overrides: Partial<GeneratedImageDefinition> = {},
): GeneratedImageDefinition {
  return {
    id: "definition-1",
    projectId: "project-1",
    assetGroupId: "group-1",
    currentMediaVersionId: "version-current",
    title: "Hero image",
    draft: {
      provider: "wavespeed",
      modelId: "model-a",
      prompt: "A portrait",
      negativePrompt: "blur",
      roleByReferenceKey: {},
      inputs: { seed: 7, duration: 4 },
    },
    attemptIds: ["attempt-1", "attempt-2"],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function activeJob(
  overrides: Partial<GeneratedImageControllerJob> = {},
): GeneratedImageControllerJob {
  return {
    id: "job-1",
    definitionId: "definition-1",
    providerJobId: "provider-job-1",
    status: "running",
    progress: 25,
    createdAt: 100,
    updatedAt: 101,
    ...overrides,
  };
}

function harness(input?: {
  definition?: GeneratedImageDefinition;
  jobs?: GeneratedImageControllerJob[];
}) {
  let project: GeneratedImageControllerProject = {
    id: "project-1",
    generatedImageDefinitions: [input?.definition ?? definition()],
  };
  let jobs = input?.jobs ?? [];
  const submit = vi.fn(async () => {
    const job = activeJob();
    jobs = [job];
    return job;
  });
  const cancel = vi.fn(async (job: GeneratedImageControllerJob) => {
    const canceled = { ...job, status: "canceled" as const, updatedAt: 102 };
    jobs = [canceled];
    return canceled;
  });
  const retry = vi.fn(async (job: GeneratedImageControllerJob) => {
    const retried = {
      ...job,
      providerJobId: "provider-job-2",
      status: "queued" as const,
      updatedAt: 103,
    };
    jobs = [retried];
    return retried;
  });
  const updateDraft = vi.fn(
    async (definitionId: string, patch: Partial<GeneratedImageDraft>) => {
      project = {
        ...project,
        generatedImageDefinitions: project.generatedImageDefinitions.map((candidate) =>
          candidate.id === definitionId
            ? {
                ...candidate,
                draft: {
                  ...candidate.draft,
                  ...patch,
                  inputs: patch.inputs ?? candidate.draft.inputs,
                  roleByReferenceKey:
                    patch.roleByReferenceKey ?? candidate.draft.roleByReferenceKey,
                },
              }
            : candidate,
        ),
      };
      return { success: true as const };
    },
  );
  const controller = createGeneratedImageController({
    models: models(),
    referenceContext: {
      source: {
        mediaId: "source-media",
        mediaVersionId: "source-version",
        canonicalTokens: [],
        defaultRole: "source-image",
      },
      characters: [],
      mediaVersions: [],
      shotReferences: [],
    },
    ports: {
      getProject: () => project,
      updateDraft,
      getJobs: () => jobs,
      submit,
      cancel,
      retry,
    },
  });

  return { controller, submit, cancel, retry, updateDraft };
}

async function renderEditor(
  props: React.ComponentProps<typeof GeneratedImageEditor>,
) {
  let rendered: ReturnType<typeof render> | undefined;
  await act(async () => {
    rendered = render(<GeneratedImageEditor {...props} />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return rendered!;
}

describe("GeneratedImageEditor", () => {
  it.each(["modal", "inspector"] as const)(
    "renders the shared %s surface from controller capability and job state",
    async (placement) => {
      const { controller } = harness({ jobs: [activeJob()] });

      await renderEditor({
        controller,
        definitionId: "definition-1",
        placement,
        mediaItems: [image()],
        mentionOptions: [],
        onOpenReference: vi.fn(),
      });

      expect(screen.getByTestId("generated-image-editor")).toHaveAttribute(
        "data-placement",
        placement,
      );
      expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue(
        "wavespeed",
      );
      expect(
        screen.getByRole("combobox", { name: "Generation model" }),
      ).toHaveValue("model-a");
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
        "Hero image",
      );
      expect(
        screen.getByRole("combobox", { name: "Prompt references" }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "References" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Negative prompt" })).toHaveValue(
        "blur",
      );
      expect(screen.getByRole("spinbutton", { name: "Duration" })).toHaveValue(4);
      expect(screen.getByText(/\$0\.04 estimated/)).toBeTruthy();
      expect(screen.getByText("Up to 2 reference images")).toBeTruthy();
      expect(screen.getByRole("status")).toHaveTextContent("running");
      expect(screen.getByRole("button", { name: "Cancel generation" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry generation" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Version history" })).toBeTruthy();
      expect(screen.getByText(/attempt-2/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Generate image" })).toBeDisabled();
    },
  );

  it("changes provider/model through the controller and reports reset fields", async () => {
    const { controller, updateDraft } = harness();
    await renderEditor({
      controller,
      definitionId: "definition-1",
      placement: "inspector",
      mediaItems: [image()],
      mentionOptions: [],
      onOpenReference: vi.fn(),
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "kieai" },
    });

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Generation model" }),
      ).toHaveValue("model-b"),
    );
    expect(screen.queryByRole("textbox", { name: "Negative prompt" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Duration" })).toBeNull();
    expect(screen.getByRole("status", { name: "Model change" })).toHaveTextContent(
      "Reset fields: duration",
    );
    expect(updateDraft).toHaveBeenCalledWith(
      "definition-1",
      expect.objectContaining({ provider: "kieai", modelId: "model-b" }),
    );
  });

  it("announces validation, focuses the first invalid control, and exposes retry", async () => {
    const invalid = definition({
      draft: {
        ...definition().draft,
        prompt: "",
        inputs: { seed: 7 },
      },
    });
    const { controller, retry } = harness({
      definition: invalid,
      jobs: [activeJob({ status: "failed", error: "provider failed" })],
    });
    await renderEditor({
      controller,
      definitionId: "definition-1",
      placement: "modal",
      mediaItems: [image()],
      mentionOptions: [],
      onOpenReference: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Prompt is required");
    expect(
      screen.getByRole("combobox", { name: "Prompt references" }),
    ).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Duration is required");

    fireEvent.click(screen.getByRole("button", { name: "Retry generation" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("queued");
  });

  it("persists prompt and schema inputs and submits only once while active", async () => {
    const { controller, submit, updateDraft } = harness();
    await renderEditor({
      controller,
      definitionId: "definition-1",
      placement: "inspector",
      mediaItems: [image()],
      mentionOptions: [],
      onOpenReference: vi.fn(),
    });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), {
      target: { value: "42" },
    });
    await waitFor(() =>
      expect(updateDraft).toHaveBeenCalledWith(
        "definition-1",
        expect.objectContaining({ inputs: { seed: 42, duration: 4 } }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Generate image" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("renders GenerateTab through the shared editor/controller surface", async () => {
    await act(async () => {
      render(
        <GenerateTab
          projectId="project-1"
          draftId="draft-1"
          context="asset"
          models={[{ id: "model-a", label: "Model A", provider: "wavespeed" }]}
          prompt="A shared inspector prompt"
        />,
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId("generate-tab")).toContainElement(
      screen.getByTestId("generated-image-editor"),
    );
    expect(screen.getByTestId("generated-image-editor")).toHaveAttribute(
      "data-placement",
      "inspector",
    );
  });

});
