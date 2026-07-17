import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import GenerateTab from "./GenerateTab";
import { useGenerationDraftStore } from "../../../../../features/generation/drafts";
import { readReferenceEditorRouteFromModalData } from "../../../../../features/references/navigation";
import type {
  GenerationError,
  GenerationJob,
} from "@openreel/music-video-domain/generation";
import GenerateTab from "./GenerateTab";
import { useGenerationDraftStore } from "../../../../../features/generation/drafts";
import type {
  GenerationReferenceCommand,
  GenerationReferenceRecoveryState,
} from "../../../../../features/generation/drafts/v2";
import type { GenerationEntryContextResult } from "../../../../../features/generation/context/scene-generation";
import type { GenerationAudioProvenance } from "../../../../../features/generation/audio";
import type { RecoveryAction } from "../../../../../features/generation/recovery/state-machine";
import { allowedRecoveryActionsForJob } from "../../../../../features/generation/recovery/state-machine";

const model = { id: "model-1", label: "WaveSpeed model", provider: "WaveSpeed" };
const isRecoveryAction = (value: string): value is RecoveryAction =>
  [
    "regenerate",
    "variation",
    "retry-provider",
    "retry-finalization",
    "retry-placement",
    "reconcile-placement",
    "cancel",
  ].includes(value);

const model = { id: "model-1", label: "WaveSpeed model", provider: "WaveSpeed" };
const isRecoveryAction = (value: string): value is RecoveryAction =>
  [
    "regenerate",
    "variation",
    "retry-provider",
    "retry-finalization",
    "retry-placement",
    "reconcile-placement",
    "cancel",
  ].includes(value);


const mockedProjectStore = vi.hoisted(() => ({
  state: {
    project: {
      timeline: { tracks: [] },
      generatedImageDefinitions: [],
    },
    getMediaItem: (_mediaId: string): MediaItem | undefined => undefined,
  },
}));

const mockedUIStore = vi.hoisted(() => {
  const state = {
    activeModal: null as string | null,
    modalData: null as Record<string, unknown> | null,
    inspectedAsset: null as unknown,
    inspectorSelection: null as unknown,
    referenceEditorInspectorRoute: null as unknown,
    sidebarTab: "inspector" as "inspector" | "edit",
  };

  return {
    state,
    openModal(modalId: string, data?: Record<string, unknown>) {
      state.activeModal = modalId;
      state.modalData = data ?? null;
    },
    closeModal() {
      state.activeModal = null;
      state.modalData = null;
    },
    clearSelection: vi.fn(),
    setInspectedAsset(asset: unknown) {
      state.inspectedAsset = asset;
      state.inspectorSelection = null;
      state.referenceEditorInspectorRoute = null;
      if (asset) state.sidebarTab = "inspector";
    },
    setInspectorSelection(selection: unknown) {
      state.inspectedAsset = null;
      state.inspectorSelection = selection;
      state.referenceEditorInspectorRoute = null;
      if (selection) state.sidebarTab = "inspector";
    },
    setReferenceEditorInspectorRoute(route: unknown) {
      state.inspectedAsset = null;
      state.inspectorSelection = null;
      state.referenceEditorInspectorRoute = route;
      if (route) state.sidebarTab = "edit";
    },
    setSidebarTab(tab: "inspector" | "edit") {
      state.sidebarTab = tab;
    },
  };
});

vi.mock("../../../../../stores/project-store", () => {
  const useProjectStore = Object.assign(
    (selector?: (state: typeof mockedProjectStore.state) => unknown) =>
      selector ? selector(mockedProjectStore.state) : mockedProjectStore.state,
    {
      getState: () => mockedProjectStore.state,
    },
  );

  return { useProjectStore };
});

vi.mock("../../../../../stores/ui-store", () => {
  const useUIStore = Object.assign(
    (selector?: (state: typeof mockedUIStore) => unknown) =>
      selector ? selector(mockedUIStore as never) : mockedUIStore,
    {
      getState: () => mockedUIStore,
    },
  );

  return { useUIStore };
});

function image(
  id: string,
  overrides: Partial<Omit<MediaItem, "thumbnailUrl">> & {
    thumbnailUrl?: string | null;
  } = {},
): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
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
    ...overrides,
    thumbnailUrl: overrides.thumbnailUrl ?? null,
  };
}
const linkedContext: GenerationEntryContextResult = {
  kind: "linked-projection",
  entryContext: {
    kind: "linked-projection",
    shotId: "shot-1",
    clipId: "clip-9",
    startTime: 3.25,
    endTime: 7.5,
  },
  timingAbsent: false,
  timing: {
    source: "timeline",
    startSeconds: 3.25,
    endSeconds: 7.5,
    durationSeconds: 4.25,
  },
  projection: {
    clipId: "clip-9",
    linkedShotId: "shot-1",
    startTime: 3.25,
    duration: 4.25,
    inPoint: 0.5,
    outPoint: 4.75,
  },
  audioEligible: true,
  defaultPlacementPolicy: "replace-selected-clip-media",
  placementPolicy: "replace-selected-clip-media",
  errors: [],
  warnings: [],
};

const newAssetContext: GenerationEntryContextResult = {
  kind: "new-asset",
  entryContext: { kind: "new-asset" },
  timingAbsent: true,
  audioEligible: false,
  defaultPlacementPolicy: "none",
  placementPolicy: "none",
  errors: [],
  warnings: [],
};

const unplacedShotContext: GenerationEntryContextResult = {
  kind: "unplaced-shot",
  entryContext: { kind: "unplaced-shot", shotId: "shot-unplaced" },
  timingAbsent: true,
  audioEligible: false,
  defaultPlacementPolicy: "none",
  placementPolicy: "none",
  errors: [],
  warnings: [],
};

const unlinkedRangeContext: GenerationEntryContextResult = {
  kind: "unlinked-range",
  entryContext: {
    kind: "unlinked-range",
    rangeId: "range-1",
    startTime: 8,
    endTime: 12,
    destinationTrackId: "track-1",
  },
  timingAbsent: false,
  timing: {
    source: "manual",
    startSeconds: 8,
    endSeconds: 12,
    durationSeconds: 4,
  },
  audioEligible: false,
  defaultPlacementPolicy: "create-linked-clip",
  placementPolicy: "create-linked-clip",
  errors: [],
  warnings: [],
};

const audioProvenance: GenerationAudioProvenance = {
  sourceMediaId: "audio-media-1",
  sourceVersionId: "audio-version-2",
  sourceClipId: "audio-clip-3",
  requestedProjectRange: { startSeconds: 3.25, endSeconds: 7.5 },
  requestedSourceRange: { startSeconds: 12, endSeconds: 16.25 },
  actualSourceRange: { startSeconds: 12.01, endSeconds: 16.24 },
  format: "pcm-s16le-wav",
  byteLength: 16384,
  sha256: "audio-sha256",
};

function generationError(code: string, field?: string): GenerationError {
  return { code, field, message: `${code} message`, retryable: true };
}

function generationJob(
  error?: GenerationError,
  options: {
    status?: GenerationJob["status"];
    placementFailure?: boolean;
  } = {},
): GenerationJob {
  const placementFailure = options.placementFailure ?? false;
  const placementPolicy = placementFailure ? "create-linked-clip" : "none";
  const routing = {
    providerInstanceId: "wavespeed-primary",
    providerModelId: "wavespeed/model-1",
    requestedMode: "text-to-image" as const,
    providerSchemaId: "wavespeed-schema",
    providerEndpointId: "wavespeed-endpoint",
    providerSchemaVersion: "2026-07",
  };
  const status = options.status ?? "failed";
  const needsFinalizationIdentity =
    status === "needs-attention" || status === "completed";
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: "job-1",
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: "wavespeed-primary",
    modelId: routing.providerModelId,
    modelSchemaVersion: "2026-07",
    routing,
    providerJobId: "provider-job-1",
    status,
    attempt: 1,
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      placementPolicy,
      prompt: "Generate this",
      references: [],
    },
    providerInputs: {},
    attempts: [
      {
        attemptNumber: 1,
        providerJobId: "provider-job-1",
        routing,
        startedAt: 1,
        endedAt: 2,
        terminalError: error,
      },
    ],
    checkpoints: placementFailure
      ? {
          "placement-applied": {
            status: "failed",
            timestamp: 10,
            error: error ?? generationError("placement-retry-failed"),
          },
        }
      : {},
    error,
    output: needsFinalizationIdentity
      ? {
          mediaId: "output-media-1",
          versionId: "output-version-1",
          mimeType: "image/png",
          byteLength: 1024,
          sha256: "output-sha256",
        }
      : undefined,
    createdAt: 1,
    updatedAt: 2,
    placement: placementFailure
      ? {
          policy: "create-linked-clip",
          status: "failed",
          error: error ?? generationError("placement-retry-failed"),
          replaySafe: true,
        }
      : undefined,
  };
}

const referenceFailure = generationError("reference-upload-failed", "references.ref-1");
const referenceRecovery: GenerationReferenceRecoveryState = {
  projectId: "project-1",
  jobId: "job-1",
  references: [
    {
      id: "ref-1",
      order: 1,
      mediaId: "maya-media",
      versionId: "maya-version",
      origins: ["character", "user"],
      state: "failed",
      preparationStatus: "failed",
      errorHistory: [referenceFailure],
      uploadLeaseId: "lease-1",
      active: true,
    },
    {
      id: "ref-2",
      order: 2,
      mediaId: "source-media",
      origins: ["source"],
      state: "failed",
      preparationStatus: "failed",
      errorHistory: [generationError("reference-source-unavailable")],
      active: false,
    },
    {
      id: "ref-3",
      order: 3,
      mediaId: "shot-media",
      versionId: "shot-version",
      origins: ["shot"],
      state: "active",
      preparationStatus: "ready",
      errorHistory: [],
      active: true,
    },
  ],
  drafts: [
    { id: "ref-1", mediaId: "maya-media", versionId: "maya-version", origins: ["character", "user"] },
    { id: "ref-2", mediaId: "source-media", origins: ["source"] },
  ],
  providerReferences: [
    {
      id: "ref-3",
      order: 1,
      mediaId: "shot-media",
      versionId: "shot-version",
      origins: ["shot"],
      state: "active",
      preparationStatus: "ready",
      errorHistory: [],
    },
  ],
};

describe("GenerateTab", () => {
  beforeEach(() => {
    useGenerationDraftStore.setState({ drafts: {} });
    mockedProjectStore.state = {
      project: {
        timeline: { tracks: [] },
        generatedImageDefinitions: [],
      },
      getMediaItem(mediaId: string) {
        return [image("media-imported-1", { title: "Mood board" })].find(
          (item) => item.id === mediaId,
        );
      },
    };
    mockedUIStore.state.activeModal = null;
    mockedUIStore.state.modalData = null;
    mockedUIStore.state.inspectedAsset = null;
    mockedUIStore.state.inspectorSelection = null;
    mockedUIStore.state.referenceEditorInspectorRoute = null;
    mockedUIStore.state.sidebarTab = "inspector";
    mockedUIStore.clearSelection.mockReset();
  });

  it("renders failed references individually and keeps a deactivated card with exact commands", () => {
    const commands: GenerationReferenceCommand[] = [];

    function Harness() {
      const [recovery, setRecovery] = useState(referenceRecovery);
      const onReferenceCommand = (command: GenerationReferenceCommand) => {
        commands.push(command);
        setRecovery((current) => ({
          ...current,
          references:
            command.action === "remove"
              ? current.references.filter((reference) => reference.id !== command.referenceId)
              : current.references.map((reference) =>
                  reference.id === command.referenceId && command.action === "deactivate"
                    ? { ...reference, active: false }
                    : reference,
                ),
        }));
      };
      return (
        <GenerateTab
          projectId="project-1"
          models={[model]}
          prompt="Generate Maya"
          referenceRecovery={recovery}
          referenceLabels={{ "ref-1": "Maya", "ref-2": "Source frame", "ref-3": "Shot frame" }}
          onReferenceCommand={onReferenceCommand}
        />
      );
    }

    render(<Harness />);
    const mayaCard = screen.getByTestId("generation-reference-card-ref-1");
    expect(mayaCard).toHaveTextContent("Maya");
    expect(mayaCard).toHaveTextContent("Origins: character, user");
    expect(mayaCard).toHaveTextContent("reference-upload-failed message");
    expect(within(mayaCard).getByRole("button", { name: "Retry Maya" })).toBeEnabled();
    expect(within(mayaCard).getByRole("button", { name: "Remove Maya" })).toBeEnabled();
    expect(within(mayaCard).getByRole("button", { name: "Deactivate Maya" })).toBeEnabled();

    fireEvent.click(within(mayaCard).getByRole("button", { name: "Retry Maya" }));
    fireEvent.click(within(mayaCard).getByRole("button", { name: "Deactivate Maya" }));
    const retainedCard = screen.getByTestId("generation-reference-card-ref-1");
    expect(retainedCard).toHaveTextContent("Deactivated");
    expect(retainedCard).toHaveTextContent("reference-upload-failed message");
    expect(screen.getAllByTestId("generation-reference-card-ref-1")).toHaveLength(1);
    expect(within(retainedCard).getByRole("button", { name: "Deactivate Maya" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Generation status" })).toHaveTextContent(
      "Deactivate requested for Maya",
    );

    expect(commands.slice(0, 2)).toEqual([
      { action: "retry", projectId: "project-1", jobId: "job-1", referenceId: "ref-1" },
      { action: "deactivate", projectId: "project-1", jobId: "job-1", referenceId: "ref-1" },
    ]);

    fireEvent.click(within(retainedCard).getByRole("button", { name: "Remove Maya" }));
    expect(screen.queryByTestId("generation-reference-card-ref-1")).toBeNull();
    expect(commands.at(-1)).toEqual({
      action: "remove",
      projectId: "project-1",
      jobId: "job-1",
      referenceId: "ref-1",
    });
    expect(screen.getByTestId("generation-reference-card-ref-2")).toHaveTextContent("Deactivated");
    const shotCard = screen.getByTestId("generation-reference-card-ref-3");
    expect(shotCard).toHaveTextContent("Origins: shot");
    expect(within(shotCard).queryByRole("button")).toBeNull();
  });

  it("surfaces rejected reference commands without removing the failed card", async () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate Maya"
        referenceRecovery={referenceRecovery}
        referenceLabels={{ "ref-1": "Maya" }}
        onReferenceCommand={() => Promise.reject(new Error("reference service unavailable"))}
      />,
    );

    const mayaCard = screen.getByTestId("generation-reference-card-ref-1");
    fireEvent.click(within(mayaCard).getByRole("button", { name: "Retry Maya" }));

    const alert = await screen.findByRole("alert", { name: "Generation action error" });
    expect(alert).toHaveTextContent("Retry reference failed: reference service unavailable");
    expect(screen.getByTestId("generation-reference-card-ref-1")).toBe(mayaCard);
  });

  it("re-announces repeated commands for the same reference", () => {
    const onReferenceCommand = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate Maya"
        referenceRecovery={referenceRecovery}
        referenceLabels={{ "ref-1": "Maya" }}
        onReferenceCommand={onReferenceCommand}
      />,
    );

    const retry = within(
      screen.getByTestId("generation-reference-card-ref-1"),
    ).getByRole("button", { name: "Retry Maya" });
    const status = screen.getByRole("status", { name: "Generation status" });
    fireEvent.click(retry);
    const firstAnnouncement = within(status).getByText("Retry requested for Maya");
    fireEvent.click(retry);
    const secondAnnouncement = within(status).getByText("Retry requested for Maya");

    expect(secondAnnouncement).not.toBe(firstAnnouncement);
    expect(onReferenceCommand).toHaveBeenCalledTimes(2);
  });

  it("shows the exact placement default and submits a changed pre-submit value", () => {
    const onSubmit = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        destination="create-linked-clip"
        placementDefault="create-linked-clip"
        onSubmit={onSubmit}
      />,
    );

    const placement = screen.getByRole("combobox", { name: "Placement" });
    expect(screen.getByText("Default: Create linked clip")).toBeInTheDocument();
    expect(placement).toHaveValue("create-linked-clip");
    fireEvent.change(placement, { target: { value: "none" } });
    expect(placement).toHaveValue("none");
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ placementPolicy: "none" }));
  });

  it("surfaces a rejected submission and restores the submit action", async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error("provider queue unavailable")));
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.submit(screen.getByTestId("generate-tab"));

    const alert = await screen.findByRole("alert", { name: "Generation action error" });
    expect(alert).toHaveTextContent("Generation submission failed: provider queue unavailable");
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["new asset", newAssetContext, "none", "create-linked-clip"],
    ["unplaced shot", unplacedShotContext, "none", "create-linked-clip"],
    ["unlinked range", unlinkedRangeContext, "create-linked-clip", "none"],
    ["linked projection", linkedContext, "replace-selected-clip-media", "none"],
  ] as const)(
    "renders the %s default and submits the user's canonical placement override",
    (_label, contextResult, expectedDefault, override) => {
      const onSubmit = vi.fn();
      render(
        <GenerateTab
          projectId="project-1"
          models={[model]}
          prompt="Generate this"
          entryContextResult={contextResult}
          onSubmit={onSubmit}
        />,
      );
      const placement = screen.getByRole("combobox", { name: "Placement" });
      expect(placement).toHaveValue(expectedDefault);
      fireEvent.change(placement, { target: { value: override } });
      expect(placement).toHaveValue(override);
      fireEvent.submit(screen.getByTestId("generate-tab"));
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ placementPolicy: override }));
    },
  );

  it("renders exact projection timing and resolved audio provenance", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        entryContextResult={linkedContext}
        audioPresentation={{ kind: "ready", provenance: audioProvenance }}
      />,
    );

    expect(screen.getByText("Linked projection")).toBeInTheDocument();
    expect(screen.getByText(/clip-9.*shot-1/i)).toBeInTheDocument();
    expect(screen.getByText("3.25s to 7.50s from timeline")).toBeInTheDocument();
    expect(screen.getByText(/Projection trim 0.50s to 4.75s/)).toBeInTheDocument();
    expect(screen.getByText(/audio-media-1.*audio-version-2.*audio-clip-3/i)).toBeInTheDocument();
    expect(screen.getByText(/Requested project range 3.25s to 7.50s/i)).toBeInTheDocument();
    expect(screen.getByText(/requested source range 12.00s to 16.25s.*actual source range 12.01s to 16.24s/i)).toBeInTheDocument();
    expect(screen.getByText(/pcm-s16le-wav.*16,384 bytes.*audio-sha256/i)).toBeInTheDocument();
  });

  it("keeps an explicit unsupported-audio zero-work explanation even without timing", () => {
    const unsupported: GenerationEntryContextResult = {
      ...linkedContext,
      timingAbsent: true,
      timing: undefined,
      projection: undefined,
      audioEligible: false,
    };
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        entryContextResult={unsupported}
        audioPresentation={{ kind: "unsupported" }}
      />,
    );

    expect(screen.getByText(/model does not support audio/i)).toBeInTheDocument();
    expect(screen.getByText(/No audio resolution, extraction, cache, upload, or provider audio work will run/i)).toBeInTheDocument();
  });

  it.each([
    ["validation", "validation-prompt-required", "Edit request", "edit"],
    ["configuration", "configuration-provider-missing", "Revalidate configuration", "revalidate"],
    ["routing/schema", "routing-schema-drift", "Refresh routing and revalidate", "revalidate"],
    ["reference", "reference-upload-failed", "Retry failed item", "retry-item"],
    ["audio", "audio-extraction-failed", "Retry failed item", "retry-item"],
    ["provider", "provider-request-failed", "Retry provider", "retry-provider"],
    ["transport", "generation-submit-failed", "Revalidate submission", "revalidate"],
    ["cancellation", "cancellation-request-failed", "Cancel generation", "cancel"],
    ["download", "download-output-failed", "Retry finalization", "retry-finalization"],
    ["finalization", "finalization-checkpoint-failed", "Retry finalization", "retry-finalization"],
    ["placement", "placement-apply-failed", "Retry placement", "retry-placement"],
    ["persistence", "persistence-save-failed", "Retry finalization", "retry-finalization"],
  ] as const)(
    "maps %s errors to the one safe recovery action",
    (category, code, label, expectedAction) => {
      const onEdit = vi.fn();
      const onRevalidate = vi.fn();
      const onRetryItem = vi.fn();
      const onRecoveryAction = vi.fn<[RecoveryAction], void>();
      const error = generationError(code);
      const status =
        category === "cancellation"
          ? "running"
          : category === "download" || category === "finalization" || category === "placement" || category === "persistence"
            ? "completed"
            : "failed";
      const placementFailure = category === "placement";
      const job = generationJob(error, { status, placementFailure });

      render(
        <GenerateTab
          projectId="project-1"
          models={[model]}
          prompt="Generate this"
          job={job}
          onEdit={onEdit}
          onRevalidate={onRevalidate}
          onRetryItem={onRetryItem}
          onRecoveryAction={onRecoveryAction}
        />,
      );

      const alert = screen.getByRole("alert", { name: "Generation error" });
      expect(alert).toHaveTextContent(code);
      const action = within(alert).getByRole("button", { name: label });
      expect(within(alert).getAllByRole("button")).toEqual([action]);
      if (isRecoveryAction(expectedAction)) {
        expect(allowedRecoveryActionsForJob(job)).toContain(expectedAction);
      }
      fireEvent.click(action);

      if (expectedAction === "edit") expect(onEdit).toHaveBeenCalledTimes(1);
      else if (expectedAction === "revalidate") expect(onRevalidate).toHaveBeenCalledTimes(1);
      else if (expectedAction === "retry-item") expect(onRetryItem).toHaveBeenCalledWith(category);
      else expect(onRecoveryAction).toHaveBeenCalledWith(expectedAction);
      if (expectedAction === "cancel") {
        expect(screen.getAllByRole("button", { name: label })).toHaveLength(1);
      }
    },
  );

  it.each(["provider", "references.ref-1", "audio.source"])(
    "classifies invalid-draft as validation even when the field is %s",
    (field) => {
      render(
        <GenerateTab
          projectId="project-1"
          models={[model]}
          prompt="Generate this"
          job={generationJob(generationError("invalid-draft", field))}
          onRecoveryAction={vi.fn()}
        />,
      );

      const alert = screen.getByRole("alert", { name: "Generation error" });
      expect(within(alert).getByRole("button", { name: "Edit request" })).toBeEnabled();
      expect(within(alert).queryByRole("button", { name: /Retry provider|Retry failed item/ })).toBeNull();
    },
  );

  it.each([
    ["generation-route-unsupported", "Edit model or mode"],
    ["generation-reference-recovery-scope-mismatch", "Reload reference identity"],
  ] as const)("maps %s to its code-specific safe action", (code, label) => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(generationError(code))}
        onRevalidate={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(within(alert).getByRole("button", { name: label })).toBeEnabled();
    expect(within(alert).getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the safe recovery action visible but disabled without its dispatcher", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(generationError("provider-request-failed"))}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    const action = within(alert).getByRole("button", { name: "Retry provider" });
    expect(action).toBeDisabled();
    expect(within(alert).getAllByRole("button")).toEqual([action]);
  });

  it.each([
    ["queued", true, true],
    ["running", true, true],
    ["submitting", true, false],
    ["needs-attention", true, false],
    ["queued", false, false],
  ] as const)(
    "renders footer cancel for %s with dispatcher=%s only when canonically eligible",
    (status, hasDispatcher, expectedVisible) => {
      const job = generationJob(undefined, { status });
      const onRecoveryAction = hasDispatcher ? vi.fn() : undefined;
      expect(allowedRecoveryActionsForJob(job).includes("cancel")).toBe(
        status === "queued" || status === "running",
      );

      render(
        <GenerateTab
          projectId="project-1"
          models={[model]}
          prompt="Generate this"
          job={job}
          onRecoveryAction={onRecoveryAction}
        />,
      );

      const cancel = screen.queryByRole("button", { name: "Cancel generation" });
      if (expectedVisible) expect(cancel).toBeEnabled();
      else expect(cancel).toBeNull();
    },
  );

  it("classifies an unknown error as terminal and explains why no retry is safe", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob({
          code: "unrecognized-failure",
          message: "The persisted output identity is inconsistent.",
          retryable: false,
        })}
        terminalErrorExplanation="No retry is safe because the persisted output identity cannot be verified."
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent("No retry is safe because the persisted output identity cannot be verified.");
    expect(within(alert).queryByRole("button")).toBeNull();
  });

  it("revalidates an unknown audio capability without offering item or provider retry", () => {
    const onRevalidate = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(generationError("audio-capability-required", "modelId"))}
        onRevalidate={onRevalidate}
        onRetryItem={vi.fn()}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    fireEvent.click(within(alert).getByRole("button", { name: "Revalidate audio capability" }));
    expect(onRevalidate).toHaveBeenCalledTimes(1);
    expect(within(alert).queryByRole("button", { name: /Retry failed item/i })).toBeNull();
    expect(within(alert).queryByRole("button", { name: /Retry provider/i })).toBeNull();
  });

  it("routes an ambiguous placement outcome to reconciliation, never direct retry", () => {
    const error = generationError("generation-placement-outcome-unknown");
    const job = {
      ...generationJob(error, { status: "needs-attention", placementFailure: true }),
      placement: {
        policy: "create-linked-clip" as const,
        status: "pending" as const,
        error,
        replaySafe: false,
      },
    } satisfies GenerationJob;
    const onRecoveryAction = vi.fn<[RecoveryAction], void>();
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={job}
        onRecoveryAction={onRecoveryAction}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(allowedRecoveryActionsForJob(job)).toContain("reconcile-placement");
    fireEvent.click(within(alert).getByRole("button", { name: "Check placement" }));
    expect(onRecoveryAction).toHaveBeenCalledWith("reconcile-placement");
    expect(within(alert).queryByRole("button", { name: "Retry placement" })).toBeNull();
  });

  it("withholds placement reconciliation without a failed placement checkpoint", () => {
    const error = generationError("generation-placement-outcome-unknown");
    const unsafeJob = {
      ...generationJob(error, { status: "needs-attention", placementFailure: true }),
      checkpoints: {},
    } satisfies GenerationJob;
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={unsafeJob}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(within(alert).queryByRole("button", { name: "Check placement" })).toBeNull();
    expect(alert).toHaveTextContent(/failed placement checkpoint.*required/i);
  });

  it("explains the V2 rollback policy without exposing a new-submission retry", () => {
    const onSubmit = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(generationError("generation-v2-rollback-active"))}
        onSubmit={onSubmit}
        onRevalidate={vi.fn()}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent(/New V2 submissions are disabled by release policy/i);
    expect(alert).toHaveTextContent(/Existing submitted V2 jobs may continue recovery/i);
    expect(within(alert).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not expose provider retry without the durable prior provider identity", () => {
    const error = generationError("provider-request-failed");
    const unsafeJob = {
      ...generationJob(error),
      providerJobId: undefined,
      attempts: [],
    } satisfies GenerationJob;
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={unsafeJob}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(within(alert).queryByRole("button", { name: "Retry provider" })).toBeNull();
    expect(alert).toHaveTextContent(/durable prior provider identity is missing, so provider retry is unsafe/i);
  });

  it("does not expose provider retry when the current attempt records a different terminal error", () => {
    const error = generationError("provider-request-failed");
    const unsafeJob = {
      ...generationJob(error),
      attempts: generationJob(error).attempts.map((attempt) => ({
        ...attempt,
        terminalError: generationError("provider-different-failure"),
      })),
    } satisfies GenerationJob;
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={unsafeJob}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(within(alert).queryByRole("button", { name: "Retry provider" })).toBeNull();
    expect(alert).toHaveTextContent(/does not record this provider terminal error/i);
  });

  it("does not treat provider output URLs as durable finalization identity", () => {
    const error = generationError("finalization-checkpoint-failed");
    const unsafeJob = {
      ...generationJob(error, { status: "completed" }),
      output: undefined,
      outputUrls: ["provider-output-1"],
    } satisfies GenerationJob;
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={unsafeJob}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(within(alert).queryByRole("button", { name: "Retry finalization" })).toBeNull();
    expect(alert).toHaveTextContent(/provider and output identity is incomplete/i);
  });

  it("withholds finalization retry when the durable error is terminal", () => {
    const error = {
      ...generationError("finalization-checkpoint-failed"),
      retryable: false,
    };
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(error, { status: "needs-attention" })}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent(/marked terminal.*retry is unsafe/i);
    expect(within(alert).queryByRole("button", { name: "Retry finalization" })).toBeNull();
  });

  it.each([
    "generation-placement-claim-corrupt",
    "generation-provider-id-conflict",
    "generation-output-identity-conflict",
    "generation-local-url-forbidden",
  ])("treats invariant failure %s as terminal operator work", (code) => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(generationError(code), { status: "needs-attention" })}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent(/automated recovery is unsafe.*operator/i);
    expect(within(alert).queryByRole("button")).toBeNull();
  });

  it.each([
    "generation-placement-claim-corrupt",
    "generation-output-identity-conflict",
  ])("blocks replay-safe placement retry for integrity error %s", (code) => {
    const onRecoveryAction = vi.fn<[RecoveryAction], void>();
    const job = generationJob(generationError(code), {
      status: "succeeded",
      placementFailure: true,
    });

    expect(allowedRecoveryActionsForJob(job)).toContain("retry-placement");

    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={job}
        onRecoveryAction={onRecoveryAction}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent(code);
    expect(alert).toHaveTextContent(/integrity failed.*operator/i);
    expect(within(alert).queryByRole("button", { name: "Retry placement" })).toBeNull();
    expect(onRecoveryAction).not.toHaveBeenCalled();
  });

  it("exposes replay-safe placement retry for a succeeded job without a top-level error", () => {
    const onRecoveryAction = vi.fn<[RecoveryAction], void>();
    const job = generationJob(undefined, {
      status: "succeeded",
      placementFailure: true,
    });

    expect(allowedRecoveryActionsForJob(job)).toContain("retry-placement");

    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={job}
        onRecoveryAction={onRecoveryAction}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent("placement-retry-failed");
    const action = within(alert).getByRole("button", { name: "Retry placement" });
    fireEvent.click(action);
    expect(onRecoveryAction).toHaveBeenCalledWith("retry-placement");
  });

  it.each(["succeeded", "canceled"] as const)(
    "withholds stale recovery actions from a %s job",
    (status) => {
      render(
        <GenerateTab
          projectId="project-1"
          models={[model]}
          prompt="Generate this"
          job={generationJob(generationError("validation-prompt-required"), { status })}
          onEdit={vi.fn()}
        />,
      );

      const alert = screen.getByRole("alert", { name: "Generation error" });
      expect(alert).toHaveTextContent(`already ${status}`);
      expect(within(alert).queryByRole("button")).toBeNull();
    },
  );

  it("withholds cancel when the persisted cancellation state is invalid", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(generationError("generation-invalid-cancel-state"), {
          status: "running",
        })}
        onRecoveryAction={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Generation error" });
    expect(alert).toHaveTextContent(/another cancellation request is unsafe/i);
    expect(screen.queryByRole("button", { name: "Cancel generation" })).toBeNull();
  });

  it("keeps an incompatible controlled model ID out of aria-activedescendant", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        modelId="removed-model"
        prompt="Generate this"
      />,
    );

    const modelList = screen.getByRole("listbox", { name: "Generation models" });
    expect(modelList).not.toHaveAttribute("aria-activedescendant");
    expect(modelList).toHaveAttribute("tabindex", "0");
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(modelList).toHaveFocus();
    fireEvent.keyDown(modelList, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /WaveSpeed model/ })).toHaveFocus();
  });

  it("focuses the first invalid control in DOM order and exposes a named summary", () => {
    const { rerender } = render(
      <GenerateTab
        projectId="project-1"
        models={[]}
        prompt=""
        promptErrors={{ prompt: "Prompt needs more detail" }}
      />,
    );
    fireEvent.submit(screen.getByTestId("generate-tab"));

    const summary = screen.getByRole("alert", { name: "Generation form errors" });
    const messages = within(summary).getAllByRole("listitem").map((item) => item.textContent);
    expect(messages).toEqual([
      "Choose a compatible generation model.",
      "Prompt is required.",
      "Prompt needs more detail",
    ]);
    const modelList = screen.getByRole("listbox", { name: "Generation models" });
    expect(modelList).toHaveFocus();
    expect(modelList).toHaveAttribute("aria-invalid", "true");

    rerender(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="A prompt"
        promptErrors={{ prompt: "Prompt conflicts with the selected model" }}
      />,
    );
    fireEvent.submit(screen.getByTestId("generate-tab"));
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    expect(prompt).toHaveFocus();
    expect(prompt).toHaveAttribute("aria-invalid", "true");
    expect(prompt.getAttribute("aria-describedby")).toContain("generate-error-prompt");
  });

  it("moves model selection and focus with Arrow, Home, and End keys", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[
          { id: "m1", label: "First" },
          { id: "m2", label: "Second" },
          { id: "m3", label: "Third" },
        ]}
        modelId="m2"
        prompt="Generate this"
      />,
    );

    const second = screen.getByRole("option", { name: /Second/ });
    second.focus();
    fireEvent.keyDown(second, { key: "End" });
    expect(screen.getByRole("option", { name: /Third/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("option", { name: /Third/ }), { key: "Home" });
    expect(screen.getByRole("option", { name: /First/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("option", { name: /First/ }), { key: "ArrowLeft" });
    expect(screen.getByRole("option", { name: /Third/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("option", { name: /Third/ }), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /First/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("option", { name: /First/ }), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /Third/ })).toHaveFocus();
    expect(screen.getAllByRole("option").filter((option) => option.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("listbox", { name: "Generation models" })).toHaveAttribute("tabindex", "-1");
  });

  it("keeps a named live status node mounted across idle, running, and completed states", () => {
    const { rerender } = render(
      <GenerateTab projectId="project-1" models={[model]} prompt="Generate this" />,
    );
    const status = screen.getByRole("status", { name: "Generation status" });
    expect(status).toHaveAttribute("aria-live", "polite");

    rerender(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(undefined, { status: "running" })}
        jobProgress={20}
        jobMessage="Provider is rendering"
      />,
    );
    expect(screen.getByRole("status", { name: "Generation status" })).toBe(status);
    expect(status).toHaveTextContent("running");
    expect(status).toHaveTextContent("20%");
    expect(status).toHaveTextContent("Provider is rendering");
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();

    rerender(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(undefined, { status: "succeeded" })}
      />,
    );
    expect(screen.getByRole("status", { name: "Generation status" })).toBe(status);
    expect(status).toHaveTextContent("succeeded");
  });

  it("applies visible-focus, reduced-motion, and 44px action contracts", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[model]}
        prompt="Generate this"
        job={generationJob(undefined, { status: "running" })}
        onRecoveryAction={vi.fn()}
      />,
    );

    const spinner = screen.getByTestId("generation-status-spinner");
    expect(spinner).toHaveClass("animate-spin", "motion-reduce:animate-none");
    screen.getAllByRole("button").forEach((button) => {
      expect(button).toHaveClass("min-h-11", "focus-visible:outline-none", "focus-visible:ring-2");
    });
    const cancel = screen.getByRole("button", { name: "Cancel generation" });
    expect(cancel).toHaveClass("min-w-11");
    expect(screen.getByRole("option", { name: /WaveSpeed model/ })).toHaveClass(
      "motion-reduce:transition-none",
    );
  });

  it.each([280, 320, 420, 160])(
    "keeps long inspector content reflowable at %ipx without clipping the root",
    (width) => {
      const longLabel = "MayaReferenceWithoutAnyNaturalBreakPoint".repeat(5);
      const longRecovery: GenerationReferenceRecoveryState = {
        ...referenceRecovery,
        references: [
          {
            ...referenceRecovery.references[0],
            errorHistory: [generationError(`reference-${"x".repeat(180)}`)],
          },
        ],
      };
      render(
        <div style={{ width }} data-testid={`viewport-${width}`}>
          <GenerateTab
            projectId="project-1"
            models={[model]}
            prompt="Generate this"
            referenceRecovery={longRecovery}
            referenceLabels={{ "ref-1": longLabel }}
            onReferenceCommand={vi.fn()}
          />
        </div>,
      );

      const form = screen.getByTestId("generate-tab");
      expect(form).toHaveClass("min-w-0", "max-w-full", "w-full");
      expect(form).not.toHaveClass("overflow-x-hidden");
      const card = screen.getByTestId("generation-reference-card-ref-1");
      expect(card).toHaveClass("min-w-0", "max-w-full");
      expect(within(card).getByText(longLabel)).toHaveClass("break-words", "[overflow-wrap:anywhere]");
      expect(screen.getByTestId("generation-reference-actions-ref-1")).toHaveClass("flex-wrap", "max-w-full");
      expect(screen.getByTestId("generation-actions")).toHaveClass("flex-wrap", "max-w-full");
      expect(within(card).getByRole("button", { name: `Retry ${longLabel}` })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: `Remove ${longLabel}` })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: `Deactivate ${longLabel}` })).toBeInTheDocument();
    },
  );

  it("restores per-shot and new-asset drafts after selection changes", () => {
    useGenerationDraftStore.getState().saveDraft(
      { kind: "shot", shotId: "shot-2" },
      { prompt: "restored prompt", modelId: "m" },
      10,
    );
    useGenerationDraftStore.getState().saveDraft(
      { kind: "new-asset", draftId: "draft-1" },
      { prompt: "asset prompt", modelId: "a" },
      11,
    );

    const { rerender } = render(
      <GenerateTab shotId="shot-2" projectId="project-1" models={[{ id: "m", label: "Model" }]} />,
    );
    expect(screen.getByDisplayValue("restored prompt")).toBeTruthy();
    rerender(
      <GenerateTab draftId="draft-1" projectId="project-1" models={[{ id: "a", label: "Asset" }]} />,
    );
    expect(screen.getByDisplayValue("asset prompt")).toBeTruthy();
  });

  it("preserves compatible values on model switch", () => {
    const onModelChange = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[
          { id: "m1", label: "Model 1" },
          { id: "m2", label: "Model 2" },
        ]}
        modelId="m1"
        prompt="Hello"
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByRole("option", { name: /Model 2/ }));
    expect(onModelChange).toHaveBeenCalledWith("m2");
    expect(screen.getByDisplayValue("Hello")).toBeTruthy();
  });

  it("focuses the first invalid field and announces the error summary", () => {
    render(<GenerateTab projectId="project-1" models={[{ id: "m", label: "Model" }]} promptErrors={{ prompt: "Prompt is required" }} />);
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(screen.getByRole("alert")).toHaveTextContent("Fix the highlighted fields");
    expect(screen.getByLabelText("Prompt")).toHaveFocus();
  });

  it("prevents duplicate submit and exposes recovery actions in the job card", () => {
    const onSubmit = vi.fn();
    const onRetry = vi.fn();
    render(
      <GenerateTab
        projectId="project-1"
        models={[{ id: "m", label: "Model" }]}
        prompt="Generate this"
        onSubmit={onSubmit}
        job={{ id: "job-1", status: "failed", error: "save failed", message: "needs attention", progress: 20 }}
        onRetry={onRetry}
        onSaveRetry={vi.fn()}
        onPlacementRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.submit(screen.getByTestId("generate-tab"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByRole("button", { name: /Retry placement/i })).toBeTruthy();
  });

  it("supports roving focus with Home and End on the model list", () => {
    render(
      <GenerateTab
        projectId="project-1"
        models={[
          { id: "m1", label: "First" },
          { id: "m2", label: "Second" },
          { id: "m3", label: "Third" },
        ]}
        modelId="m2"
      />,
    );

    const listbox = screen.getByRole("listbox", { name: /Generation models/i });
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "End" });
    expect(screen.getByTestId("model-option-m3")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "Home" });
    expect(screen.getByTestId("model-option-m1")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the narrow panel layout defensive", () => {
    render(<GenerateTab projectId="project-1" models={[{ id: "m", label: "Model" }]} />);
    expect(screen.getByTestId("generate-tab").className).toContain("min-w-0");
    expect(screen.getByTestId("generate-tab").className).toContain("overflow-x-hidden");
  });

  it("routes a reference card click to the modal and Shift-click to the inspector", () => {
    render(
      <GenerateTab
        context="shot"
        shotId="shot-1"
        projectId="project-1"
        models={[{ id: "img", label: "Image" }]}
        references={[
          {
            id: "r1",
            label: "Mood board",
            origins: ["user"],
            target: { kind: "imported-image", mediaId: "media-imported-1" },
          } as any,
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Mood board/i });

    fireEvent.click(trigger);

    expect(mockedUIStore.state.activeModal).toBe("reference-editor");
    expect(mockedUIStore.state.referenceEditorInspectorRoute).toBeNull();
    expect(
      readReferenceEditorRouteFromModalData(mockedUIStore.state.modalData),
    ).toMatchObject({
      editor: "imported-image",
      mediaId: "media-imported-1",
    });

    mockedUIStore.closeModal();
    mockedUIStore.setReferenceEditorInspectorRoute(null);

    fireEvent.click(trigger, { shiftKey: true });

    expect(mockedUIStore.state.activeModal).toBeNull();
    expect(mockedUIStore.state.modalData).toBeNull();
    expect(mockedUIStore.state.referenceEditorInspectorRoute).toMatchObject({
      editor: "imported-image",
      mediaId: "media-imported-1",
    });
  });
});
