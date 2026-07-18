import type { GeneratedImageDefinition, GeneratedImageDraft } from "@openreel/core";
import { describe, expect, it, vi } from "vitest";
import type { GenerationModelCapability } from "../../../services/wavespeed/model-capabilities";
import { updateGeneratedImageDraft } from "./commands";
import {
  createGeneratedImageController,
  type GeneratedImageControllerJob,
  type GeneratedImageControllerModel,
  type GeneratedImageControllerProject,
} from "./controller";

const NOW = "2026-07-17T00:00:00.000Z";

function draft(overrides: Partial<GeneratedImageDraft> = {}): GeneratedImageDraft {
  return {
    provider: "wavespeed",
    modelId: "model-a",
    prompt: "A portrait",
    negativePrompt: "blur",
    roleByReferenceKey: {},
    inputs: { seed: 7, duration: 4, legacyOnly: "remove me" },
    ...overrides,
  };
}

function definition(
  id: string,
  overrides: Partial<GeneratedImageDefinition> = {},
): GeneratedImageDefinition {
  return {
    id,
    projectId: "project-1",
    assetGroupId: `${id}-group`,
    currentMediaVersionId: `${id}-media-v1`,
    title: `Image ${id}`,
    draft: draft(),
    attemptIds: [`${id}-attempt-1`],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

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
    inputFields: { prompt: "prompt", negativePrompt: "negative_prompt", seed: "seed" },
    ...overrides,
  };
}

function model(
  id: string,
  overrides: Partial<GeneratedImageControllerModel> = {},
): GeneratedImageControllerModel {
  return {
    id,
    label: id === "model-a" ? "Model A" : "Model B",
    provider: id === "model-a" ? "wavespeed" : "kieai",
    capability: capability(id),
    schemaVersion: "schema-1",
    inputFields: [
      { key: "seed", label: "Seed", type: "number" },
      { key: "duration", label: "Duration", type: "number", required: true },
    ],
    basePrice: 0.04,
    priceFormula: "$0.04 per image",
    limits: ["Maximum 2048 × 2048"],
    ...overrides,
  };
}

function activeJob(overrides: Partial<GeneratedImageControllerJob> = {}): GeneratedImageControllerJob {
  return {
    id: "job-1",
    definitionId: "definition-a",
    providerJobId: "provider-job-1",
    status: "running",
    createdAt: 100,
    updatedAt: 101,
    ...overrides,
  };
}

function harness(input?: {
  definitions?: GeneratedImageDefinition[];
  models?: GeneratedImageControllerModel[];
  jobs?: GeneratedImageControllerJob[];
}) {
  let project: GeneratedImageControllerProject = {
    id: "project-1",
    generatedImageDefinitions: input?.definitions ?? [definition("definition-a"), definition("definition-b")],
  };
  let jobs = input?.jobs ?? [];
  const submit = vi.fn(async ({ definition: submitted }: { definition: GeneratedImageDefinition }) => {
    const job = activeJob({ definitionId: submitted.id });
    jobs = [...jobs, job];
    return job;
  });
  const cancel = vi.fn(async (job: GeneratedImageControllerJob) => {
    const canceled = { ...job, status: "canceled" as const, updatedAt: 102 };
    jobs = jobs.map((candidate) => (candidate.id === job.id ? canceled : candidate));
    return canceled;
  });
  const retry = vi.fn(async (job: GeneratedImageControllerJob) => {
    const retried = {
      ...job,
      providerJobId: `${job.providerJobId}-retry`,
      status: "queued" as const,
      updatedAt: 103,
    };
    jobs = jobs.map((candidate) => (candidate.id === job.id ? retried : candidate));
    return retried;
  });
  const updateDraft = vi.fn(async (definitionId: string, patch: Partial<GeneratedImageDraft>) => {
    const commandProject = {
      id: project.id,
      mediaItems: [],
      mediaGroups: [],
      generatedImageDefinitions: [...project.generatedImageDefinitions],
    };
    const result = updateGeneratedImageDraft(commandProject, definitionId, patch, { now: () => NOW });
    if (!result.success) return result;
    project = {
      ...project,
      generatedImageDefinitions: result.nextProject.generatedImageDefinitions,
    };
    return result;
  });

  const controller = createGeneratedImageController({
    models: input?.models ?? [model("model-a"), model("model-b")],
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
      getJobs: (definitionId) => jobs.filter((job) => job.definitionId === definitionId),
      submit,
      cancel,
      retry,
    },
  });

  return {
    controller,
    submit,
    cancel,
    retry,
    updateDraft,
    getProject: () => project,
    getJobs: () => jobs,
  };
}

describe("generated image controller", () => {
  it("persists drafts by canonical definition ID and restores each selection independently", async () => {
    const { controller, getProject, updateDraft } = harness();

    await controller.patchDraft("definition-a", { prompt: "Definition A prompt" });
    await controller.patchDraft("definition-b", { prompt: "Definition B prompt" });

    expect(updateDraft).toHaveBeenNthCalledWith(1, "definition-a", { prompt: "Definition A prompt" });
    expect(updateDraft).toHaveBeenNthCalledWith(2, "definition-b", { prompt: "Definition B prompt" });
    expect(controller.read("definition-a").definition?.draft.prompt).toBe("Definition A prompt");
    expect(controller.read("definition-b").definition?.draft.prompt).toBe("Definition B prompt");
    expect(getProject().generatedImageDefinitions).toHaveLength(2);
  });

  it("changes provider and model while preserving compatible values and reconciling reference roles", async () => {
    const modelB = model("model-b", {
      capability: capability("model-b", {
        accepts: {
          prompt: true,
          negativePrompt: false,
          sourceImage: false,
          referenceImages: { min: 0, max: 1 },
          audio: false,
          seed: true,
        },
      }),
      inputFields: [{ key: "seed", label: "Seed", type: "number" }],
    });
    const { controller } = harness({ models: [model("model-a"), modelB] });
    const sourceKey = controller.read("definition-a").references[0]?.key;
    expect(sourceKey).toBeTruthy();
    await controller.patchDraft("definition-a", {
      roleByReferenceKey: { [sourceKey!]: "source-image" },
    });

    const changed = await controller.changeModel("definition-a", "model-b");
    const state = controller.read("definition-a");

    expect(changed).toEqual({ ok: true, resetFields: ["duration", "legacyOnly"] });
    expect(state.definition?.draft.provider).toBe("kieai");
    expect(state.definition?.draft.modelId).toBe("model-b");
    expect(state.definition?.draft.inputs).toEqual({ seed: 7 });
    expect(state.definition?.draft.roleByReferenceKey[sourceKey!]).toBe("source-image");
    expect(state.references[0]).toMatchObject({ status: "unsupported", role: "source-image" });
  });

  it("derives validation, cost, and limits and blocks invalid submission", async () => {
    const invalid = definition("definition-a", {
      title: "",
      draft: draft({ prompt: "", inputs: { seed: 7 } }),
    });
    const { controller, submit } = harness({ definitions: [invalid] });

    const state = controller.read("definition-a");
    const result = await controller.submit("definition-a");

    expect(state.validation.issues.map((issue) => issue.field)).toEqual([
      "title",
      "prompt",
      "inputs.duration",
    ]);
    expect(state.cost).toEqual({ amount: 0.04, currency: "USD", formula: "$0.04 per image" });
    expect(state.limits).toEqual([
      "Up to 2 reference images",
      "Maximum 2048 × 2048",
    ]);
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits the canonical snapshot with resolved active references", async () => {
    const { controller, submit } = harness();

    const result = await controller.submit("definition-a");

    expect(result).toMatchObject({ ok: true, job: { id: "job-1", status: "running" } });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      definition: { id: "definition-a", draft: { prompt: "A portrait" } },
      model: { id: "model-a", provider: "wavespeed" },
      references: [{ mediaVersionId: "source-version", status: "active" }],
    });
  });

  it("blocks duplicate submission while a request is pending and after restoring an active job", async () => {
    let release: ((job: GeneratedImageControllerJob) => void) | undefined;
    const pendingSubmit = vi.fn(
      () =>
        new Promise<GeneratedImageControllerJob>((resolve) => {
          release = resolve;
        }),
    );
    let jobs: GeneratedImageControllerJob[] = [];
    const base = harness();
    const controller = createGeneratedImageController({
      models: [model("model-a")],
      referenceContext: {
        characters: [],
        mediaVersions: [],
        shotReferences: [],
      },
      ports: {
        getProject: base.getProject,
        updateDraft: async () => ({ success: true as const, nextProject: base.getProject() as never }),
        getJobs: () => jobs,
        submit: pendingSubmit,
        cancel: vi.fn(),
        retry: vi.fn(),
      },
    });

    const first = controller.submit("definition-a");
    const duplicate = await controller.submit("definition-a");
    expect(duplicate).toEqual({ ok: false, code: "DUPLICATE_SUBMISSION", message: "Generation is already active." });
    expect(pendingSubmit).toHaveBeenCalledTimes(1);

    const restored = activeJob();
    jobs = [restored];
    release?.(restored);
    await first;
    expect(controller.read("definition-a").activeJob).toEqual(restored);
    expect(await controller.submit("definition-a")).toMatchObject({ ok: false, code: "DUPLICATE_SUBMISSION" });
  });

  it("cancels and retries through job ports without clearing the canonical draft", async () => {
    const failed = activeJob({ status: "failed", error: "provider failed" });
    const { controller, cancel, getProject } = harness({ jobs: [activeJob()] });

    const canceled = await controller.cancel("definition-a");
    expect(canceled).toMatchObject({ ok: true, job: { status: "canceled" } });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }));
    expect(getProject().generatedImageDefinitions[0]?.draft.prompt).toBe("A portrait");

    const retryHarness = harness({ jobs: [failed] });
    const retried = await retryHarness.controller.retry("definition-a");
    expect(retried).toMatchObject({
      ok: true,
      job: { status: "queued", providerJobId: "provider-job-1-retry" },
    });
    expect(retryHarness.retry).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
      expect.objectContaining({
        definition: expect.objectContaining({ id: "definition-a" }),
      }),
    );
    expect(retryHarness.getProject().generatedImageDefinitions[0]?.draft.prompt).toBe("A portrait");
  });

  it("restores the latest active job and exposes immutable version history", () => {
    const jobs = [
      activeJob({ id: "old", status: "completed", updatedAt: 90 }),
      activeJob({ id: "active", status: "queued", updatedAt: 110 }),
    ];
    const { controller } = harness({ jobs });

    const state = controller.read("definition-a");

    expect(state.activeJob?.id).toBe("active");
    expect(state.latestJob?.id).toBe("active");
    expect(state.versionHistory).toEqual([
      { attemptId: "definition-a-attempt-1", index: 1 },
    ]);
  });
});
