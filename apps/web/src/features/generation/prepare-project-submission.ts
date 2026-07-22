import type { Project } from "@openreel/core";
import type {
  GenerationEntryContext,
  GenerationPlacementPolicy,
} from "@openreel/music-video-domain/generation";
import {
  prepareWaveSpeedGenerationDraft,
  prepareWaveSpeedProjectionAudio,
  type WaveSpeedRouteCapability,
} from "../../stores/generation-job-store";
import type { ProjectGenerationReferenceResolution } from "./references/project-resolution";
import type { GenerationDraft } from "./submit-generation";

export interface ProjectGenerationFormSubmission {
  key: string;
  prompt: string;
  providerInputs: Record<string, unknown>;
  placementPolicy: GenerationPlacementPolicy;
  referenceResolution?: ProjectGenerationReferenceResolution;
}

export async function prepareProjectWaveSpeedSubmission(input: {
  project: Project;
  route: WaveSpeedRouteCapability;
  entryContext: GenerationEntryContext;
  form: ProjectGenerationFormSubmission;
}): Promise<GenerationDraft> {
  const resolution = input.form.referenceResolution;
  if (!resolution) throw new Error("generation-reference-resolution-missing");
  if (Object.values(resolution.referenceTargets).some((target) => target.kind === "missing")) {
    throw new Error("generation-reference-target-missing");
  }

  const preparedAudio = await prepareWaveSpeedProjectionAudio({
    projectId: input.project.id,
    supportsAudio: input.route.supportsAudio ?? false,
    entryContext: input.entryContext,
    tracks: input.project.timeline.tracks,
    media: input.project.mediaLibrary.items,
  });
  if (preparedAudio.kind === "error") throw new Error(preparedAudio.code);

  const references = resolution.submissionReferences.map((reference) => {
    const source = input.project.mediaLibrary.items.find(
      (candidate) => candidate.id === reference.mediaVersionId,
    );
    if (!source) {
      throw new Error(`Generation reference ${reference.mediaVersionId} is missing from the project.`);
    }
    const remoteUrl = source.remoteUrl ?? source.originalUrl ?? undefined;
    if (!source.blob && !remoteUrl) {
      throw new Error(`Generation reference ${reference.mediaVersionId} has no uploadable content.`);
    }
    return {
      ...reference,
      value: source.blob
        ? {
            projectId: input.project.id,
            body: source.blob,
            mimeType: source.blob.type || source.metadata.codec || "application/octet-stream",
          }
        : {
            projectId: input.project.id,
            url: remoteUrl,
            mimeType: source.metadata.codec || undefined,
          },
    };
  });

  return prepareWaveSpeedGenerationDraft({
    projectId: input.project.id,
    route: input.route,
    entryContext: input.entryContext,
    prompt: input.form.prompt,
    placementPolicy: input.form.placementPolicy,
    target: { kind: "new-asset" },
    providerInputs: {
      ...input.form.providerInputs,
      prompt: input.form.prompt,
    },
    references,
    audio: preparedAudio.kind === "ready" ? preparedAudio.audio : undefined,
    idempotencyKey: input.form.key,
  }).draft;
}
