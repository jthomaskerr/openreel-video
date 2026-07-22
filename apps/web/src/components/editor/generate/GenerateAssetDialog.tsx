/**
 * GenerateAssetDialog — unified model list for all providers.
 *
 * No provider tabs. Every model appears in one searchable list.
 * Each model shows its provider, type (text-to-image, image-to-image, etc.),
 * and whether it requires a primary source image.
 *
 * Reference images can be picked from media library or uploaded inline.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createDurableId } from "@openreel/core";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "@openreel/ui";
import { ChevronLeft, Search } from "lucide-react";
import {
  normalizeSceneProjectionMetadata,
  type GeneratedAsset,
  type StoryboardShot,
} from "@openreel/music-video-domain";

// ── KieAI models ────────────────────────────────────────────────────────────
import type { ImageModelInput } from "../../../services/kieai/image-generation";
import { IMAGE_MODELS, type ImageModelId, createImageTask } from "../../../services/kieai/image-generation";
import { SeedreamForm } from "../kieai/forms/SeedreamForm";
import { ZImageForm } from "../kieai/forms/ZImageForm";
import { NanoBanana2Form } from "../kieai/forms/NanoBanana2Form";
import { Flux2Form } from "../kieai/forms/Flux2Form";
import { GrokForm } from "../kieai/forms/GrokForm";
import { QwenForm } from "../kieai/forms/QwenForm";

// ── WaveSpeed ────────────────────────────────────────────────────────────────
import type { WavespeedModel } from "../../../services/wavespeed/index";
import {
  resolveGenerationEntryContext,
  selectSceneGenerationContext,
} from "../../../features/generation/context/scene-generation";
import {
  prepareProjectWaveSpeedSubmission,
  type ProjectGenerationFormSubmission,
} from "../../../features/generation/prepare-project-submission";
import { resolveProjectGenerationReferences } from "../../../features/generation/references/project-resolution";
import { canonicalMediaToken } from "../../../features/generation/references/resolve";
import {
  useGenerationDraftStore,
  type GenerationDraftScope,
} from "../../../features/generation/drafts";
import { GenerateReferenceSection } from "../inspector/tabs/generation/GenerateTabSections";
import { GenerateTab } from "../inspector/tabs/generation/GenerateTab";
import { SchemaForm } from "./SchemaForm";

import { uploadFileStream } from "../../../services/kieai/file-upload";

// ── Reference images ─────────────────────────────────────────────────────────
import { ReferenceImagePicker } from "./ReferenceImagePicker";
import { injectImageInputs, getRefImageUrls } from "./schema-injector";

// ── Store ────────────────────────────────────────────────────────────────────
import { useProjectStore } from "../../../stores/project-store";
import {
  getProductionGenerationRuntime,
  prepareWaveSpeedGenerationDraft,
  prepareWaveSpeedProjectionAudio,
  waveSpeedRouteKey,
  type WaveSpeedRouteCapability,
} from "../../../stores/generation-job-store";

// ── Unified model type ───────────────────────────────────────────────────────

type ModelProvider = "kieai" | "wavespeed";

type GenType = "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video";

interface UnifiedModel {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  genType: GenType;
  requiresSourceImage: boolean;
  /** KieAI model constant, for routing to per-model KieAI forms */
  kieaiModel?: ImageModelId;
  /** WaveSpeed model object, for dynamic SchemaForm */
  wsModel?: WavespeedModel;
  /** Exact immutable route identity. */
  wsRoute?: WaveSpeedRouteCapability;
}

// ── Build KieAI unified models ───────────────────────────────────────────────

const KIEAI_MODEL_META: Array<{
  id: ImageModelId;
  name: string;
  description: string;
  genType: GenType;
  requiresSourceImage: boolean;
}> = [
  { id: IMAGE_MODELS.SEEDREAM, name: "Seedream 5 Lite", description: "High-quality image-to-image. 4K output.", genType: "image-to-image", requiresSourceImage: true },
  { id: IMAGE_MODELS.Z_IMAGE, name: "Z-Image", description: "Text-to-image. Source image used as inspiration.", genType: "text-to-image", requiresSourceImage: false },
  { id: IMAGE_MODELS.NANO_BANANA2, name: "Nano Banana 2", description: "Versatile generation, optional reference.", genType: "image-to-image", requiresSourceImage: false },
  { id: IMAGE_MODELS.FLUX2, name: "Flux 2 Pro", description: "Professional image-to-image, 2K.", genType: "image-to-image", requiresSourceImage: true },
  { id: IMAGE_MODELS.GROK, name: "Grok Imagine", description: "Style/composition transfer.", genType: "image-to-image", requiresSourceImage: true },
  { id: IMAGE_MODELS.QWEN, name: "Qwen", description: "Fine-grained image transformation control.", genType: "image-to-image", requiresSourceImage: true },
];

// ── KieAI input defaults ─────────────────────────────────────────────────────

interface KieAIDefaults {
  seedream: import("../../../services/kieai/image-generation").SeedreamInput;
  zimage: import("../../../services/kieai/image-generation").ZImageInput;
  nanoBanana2: import("../../../services/kieai/image-generation").NanoBanana2Input;
  flux2: import("../../../services/kieai/image-generation").Flux2Input;
  grok: import("../../../services/kieai/image-generation").GrokInput;
  qwen: import("../../../services/kieai/image-generation").QwenInput;
}

function makeKieAIDefaults(asset?: GeneratedAsset, shot?: StoryboardShot): KieAIDefaults {
  const prompt = asset?.prompt ?? shot?.videoPrompt ?? shot?.prompt ?? "";
  const negPrompt = asset?.negativePrompt ?? shot?.negativePrompt ?? "";
  const asp = (shot?.aspectRatio ?? "16:9") as "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
  return {
    seedream: { prompt, image_urls: [], aspect_ratio: asp, quality: "basic" },
    zimage: { prompt, aspect_ratio: "16:9" },
    nanoBanana2: { prompt, aspect_ratio: asp, resolution: "2K", output_format: "png" },
    flux2: { prompt, input_urls: [], aspect_ratio: asp, resolution: "1K" },
    grok: { image_urls: [], ...(prompt ? { prompt } : {}) },
    qwen: { prompt, image_url: "", strength: 0.8, output_format: "png", acceleration: "regular", ...(negPrompt ? { negative_prompt: negPrompt } : {}), ...(shot?.seed != null ? { seed: shot.seed } : {}) },
  };
}

function makeWsDefaults(model: WavespeedModel, asset?: GeneratedAsset, shot?: StoryboardShot): Record<string, unknown> {
  const schema = model.api_schema?.api_schemas?.[0]?.request_schema;
  if (!schema?.properties) return {};
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop && typeof prop === "object" && "default" in prop) defaults[key] = prop.default;
  }
  if ("prompt" in schema.properties) defaults.prompt = asset?.prompt ?? shot?.videoPrompt ?? shot?.prompt ?? defaults.prompt ?? "";
  if ("negative_prompt" in schema.properties) defaults.negative_prompt = asset?.negativePrompt ?? shot?.negativePrompt ?? defaults.negative_prompt ?? "";
  if ("seed" in schema.properties && shot?.seed != null) defaults.seed = shot.seed;
  const arKey = "aspect_ratio" in schema.properties ? "aspect_ratio" : "size" in schema.properties ? "size" : null;
  if (arKey && shot?.aspectRatio) defaults[arKey] = shot.aspectRatio;
  return defaults;
}

function wavespeedModelFromCapability(route: WaveSpeedRouteCapability): WavespeedModel {
  return {
    model_id: route.providerModelId,
    name: route.providerModelId,
    type: route.requestedMode,
    description: `Server-configured ${route.requestedMode} route`,
    base_price: 0,
    formula: "server-configured",
    sort_order: 0,
    api_schema: {
      api_schemas: [{
        type: route.requestedMode,
        method: "POST",
        server: "same-origin",
        api_path: route.providerEndpointId,
        request_schema: route.inputSchema,
      }],
    },
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface GenerateAssetDialogProps {
  open: boolean;
  onClose: () => void;
  sourceFile?: File;
  previewUrl?: string | null;
  sourceMediaId?: string;
  asset?: GeneratedAsset;
  shot?: StoryboardShot;
  /** Clip ID passed from ReferenceImages "Generate" button — used to seed prompt from clip metadata */
  clipId?: string;
}

export function GenerateAssetDialog({
  open,
  onClose,
  sourceMediaId,
  asset,
  shot,
  clipId,
}: GenerateAssetDialogProps) {
  const project = useProjectStore((state) => state.project);
  const [generationRuntime] = useState(getProductionGenerationRuntime);
  const [routes, setRoutes] = useState<WaveSpeedRouteCapability[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string>();
  const [releaseEnabled, setReleaseEnabled] = useState(true);

  const selectedClip = useMemo(
    () => clipId
      ? project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
      : undefined,
    [clipId, project.timeline.tracks],
  );
  const effectiveShot = useMemo<StoryboardShot | undefined>(() => {
    if (!selectedClip) return shot;
    const payload = selectedClip.metadata
      && typeof selectedClip.metadata.payload === "object"
      && selectedClip.metadata.payload !== null
      ? (selectedClip.metadata.payload as Record<string, unknown>)
      : (selectedClip.metadata as Record<string, unknown>) ?? {};
    const prompt = typeof payload.prompt === "string"
      ? payload.prompt
      : typeof payload.text === "string"
        ? payload.text
        : typeof payload.videoPrompt === "string"
          ? payload.videoPrompt
          : shot?.prompt ?? "";
    if (!prompt && !shot) return undefined;
    if (shot) return { ...shot, prompt };
    const metadata = normalizeSceneProjectionMetadata(selectedClip.metadata)
      ?? normalizeSceneProjectionMetadata(
        selectedClip.metadata && typeof selectedClip.metadata.payload === "object"
          ? selectedClip.metadata.payload
          : undefined,
      );
    const referenceAssetIds = Array.isArray(payload.referenceAssetIds)
      ? payload.referenceAssetIds.filter(
        (referenceId): referenceId is string => typeof referenceId === "string",
      )
      : [];
    return {
      id: metadata?.shotId ?? selectedClip.id,
      index: 0,
      label: "",
      prompt,
      model: "",
      resolution: "",
      aspectRatio: "16:9",
      includeMainAudio: false,
      referenceAssetIds,
      generatedAssetIds: [],
      validation: { valid: true, warnings: [], errors: [] },
      outputs: [],
      selected: false,
    };
  }, [selectedClip, shot]);
  const effectiveSceneId = useMemo(() => {
    if (shot?.id) return shot.id;
    if (!selectedClip) return undefined;
    return (
      normalizeSceneProjectionMetadata(selectedClip.metadata)
      ?? normalizeSceneProjectionMetadata(
        selectedClip.metadata && typeof selectedClip.metadata.payload === "object"
          ? selectedClip.metadata.payload
          : undefined,
      )
    )?.shotId;
  }, [selectedClip, shot?.id]);
  const sceneGenerationSelection = useMemo(() => {
    if (!effectiveSceneId || !effectiveShot) return undefined;
    const projections = project.timeline.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => {
        const metadata = normalizeSceneProjectionMetadata(clip.metadata)
          ?? normalizeSceneProjectionMetadata(
            clip.metadata && typeof clip.metadata.payload === "object"
              ? clip.metadata.payload
              : undefined,
          );
        return metadata
          ? [{
              clipId: clip.id,
              linkedShotId: metadata.shotId,
              startTime: clip.startTime,
              duration: clip.duration,
              inPoint: clip.inPoint,
              outPoint: clip.outPoint,
            }]
          : [];
      }),
    );
    return selectSceneGenerationContext({
      shotId: effectiveSceneId,
      includeAudio: effectiveShot.includeMainAudio,
      projectionClipId: clipId,
      projections,
    });
  }, [clipId, effectiveSceneId, effectiveShot, project.timeline.tracks]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setCapabilityError(undefined);
    void generationRuntime.readCapabilities()
      .then((capabilities) => {
        if (!active) return;
        if (!capabilities.configured) throw new Error("provider-not-configured");
        setReleaseEnabled(capabilities.generationV2ReleaseEnabled);
        setRoutes(capabilities.routes);
        setSelectedModelId((current) =>
          capabilities.routes.some((route) => waveSpeedRouteKey(route) === current)
            ? current
            : (capabilities.routes[0] ? waveSpeedRouteKey(capabilities.routes[0]) : ""),
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("generation-capabilities-load-failed", { projectId: project.id, error });
        setRoutes([]);
        setCapabilityError(
          error instanceof Error ? error.message : "Generation capabilities could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [generationRuntime, open, project.id]);

  const selectedRoute = routes.find((route) => waveSpeedRouteKey(route) === selectedModelId);
  const entryContext = sceneGenerationSelection?.status === "ready"
    && sceneGenerationSelection.projection
    && effectiveSceneId
    ? {
        kind: "linked-projection" as const,
        shotId: effectiveSceneId,
        clipId: sceneGenerationSelection.projection.clipId,
        startTime: sceneGenerationSelection.projection.startTime,
        endTime:
          sceneGenerationSelection.projection.startTime
          + sceneGenerationSelection.projection.duration,
      }
    : effectiveSceneId
      ? { kind: "unplaced-shot" as const, shotId: effectiveSceneId }
      : selectedClip
        ? {
            kind: "unlinked-range" as const,
            rangeId: selectedClip.id,
            destinationTrackId: selectedClip.trackId,
            startTime: selectedClip.startTime,
            endTime: selectedClip.startTime + selectedClip.duration,
          }
        : { kind: "new-asset" as const };
  const entryContextResult = entryContext.kind === "linked-projection"
    ? resolveGenerationEntryContext({
        ...entryContext,
        supportsAudio: selectedRoute?.supportsAudio ?? false,
      })
    : resolveGenerationEntryContext(entryContext);
  const selectedClipMedia = selectedClip?.mediaId
    ? project.mediaLibrary.items.find((item) => item.id === selectedClip.mediaId)
    : undefined;
  const effectiveSourceMediaId = sourceMediaId
    ?? (selectedClipMedia?.type === "image" ? selectedClipMedia.id : undefined);
  const referenceResolutionInput = useMemo(() => {
    const sourceItem = effectiveSourceMediaId
      ? project.mediaLibrary.items.find((item) => item.id === effectiveSourceMediaId)
      : undefined;
    const sourceDefinition = sourceItem
      ? project.generatedImageDefinitions.find((definition) =>
          definition.currentMediaVersionId === sourceItem.id
          || definition.assetGroupId === (sourceItem.assetGroupId ?? sourceItem.id))
      : undefined;
    return {
      mediaItems: project.mediaLibrary.items,
      generatedImageDefinitions: project.generatedImageDefinitions,
      tracks: project.timeline.tracks,
      ...(effectiveSourceMediaId
        ? { source: { mediaVersionId: effectiveSourceMediaId, defaultRole: "source" as const } }
        : {}),
      shotReferences: (effectiveShot?.referenceAssetIds ?? []).map((mediaVersionId) => ({
        mediaVersionId,
        defaultRole: "reference-image" as const,
      })),
      roleByReferenceKey: sourceDefinition?.draft.roleByReferenceKey ?? {},
    };
  }, [
    effectiveShot?.referenceAssetIds,
    project.generatedImageDefinitions,
    project.mediaLibrary.items,
    project.timeline.tracks,
    effectiveSourceMediaId,
  ]);
  const models = releaseEnabled
    ? routes.map((route) => ({
        id: waveSpeedRouteKey(route),
        label: `${route.providerModelId} · ${route.requestedMode}`,
        provider: "wavespeed",
        modes: [route.output],
      }))
    : [];
  const audioPresentation = !selectedRoute
    ? ({ kind: "pending" } as const)
    : !selectedRoute.supportsAudio
      ? ({ kind: "unsupported" } as const)
      : !entryContextResult.audioEligible
        ? ({
            kind: "zero-work",
            reason: "Audio preparation only runs for a selected linked projection.",
          } as const)
        : ({ kind: "pending" } as const);
  const promptErrors = {
    ...(sceneGenerationSelection?.status === "disabled"
      ? { context: sceneGenerationSelection.reason }
      : {}),
    ...(!releaseEnabled
      ? { release: "generation-v2-rollback-active" }
      : capabilityError
        ? { capabilities: capabilityError }
        : {}),
  };
  const initialPrompt = asset?.prompt
    ?? effectiveShot?.videoPrompt
    ?? effectiveShot?.prompt
    ?? "";

  const handleSubmit = useCallback(async (
    form: ProjectGenerationFormSubmission & { modelId?: string },
  ) => {
    const route = routes.find((candidate) => waveSpeedRouteKey(candidate) === form.modelId);
    if (!route) throw new Error("generation-route-unavailable");
    if (!releaseEnabled) throw new Error("generation-v2-rollback-active");
    if (sceneGenerationSelection?.status === "disabled") {
      throw new Error(sceneGenerationSelection.reason);
    }
    if (entryContextResult.errors.length > 0) {
      throw new Error(entryContextResult.errors[0]?.code ?? "generation-entry-context-invalid");
    }
    setSubmitting(true);
    try {
      const prepared = await prepareProjectWaveSpeedSubmission({
        project,
        route,
        entryContext: entryContextResult.entryContext,
        form,
      });
      await generationRuntime.controller.submit(prepared);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [
    entryContextResult,
    generationRuntime,
    onClose,
    project,
    releaseEnabled,
    routes,
    sceneGenerationSelection,
  ]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen: boolean) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-lg h-[85vh] flex min-w-0 flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Generate Image/Video</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p role="status" className="px-3 py-2 text-sm text-text-secondary">
            Loading generation models…
          </p>
        ) : null}
        {capabilityError ? (
          <p role="alert" className="px-3 py-2 text-sm text-red-300">
            {capabilityError}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GenerateTab
            projectId={project.id}
            shotId={effectiveSceneId}
            draftId={effectiveSceneId ? undefined : selectedClip?.id ?? "new-asset"}
            context={effectiveSceneId ? "shot" : selectedClip ? "clip" : "asset"}
            mode={selectedRoute?.output ?? "image"}
            models={models}
            modelId={selectedModelId}
            onModelChange={setSelectedModelId}
            prompt={initialPrompt}
            promptErrors={promptErrors}
            entryContextResult={entryContextResult}
            destination={entryContextResult.placementPolicy}
            placementDefault={entryContextResult.defaultPlacementPolicy}
            audioPresentation={audioPresentation}
            referenceResolutionInput={referenceResolutionInput}
            submitting={submitting}
            onSubmit={handleSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

type Step = "pick" | "form" | "submitting" | "error";

export function LegacyGenerateAssetDialog({ open, onClose, sourceFile, previewUrl, sourceMediaId, asset, shot, clipId }: GenerateAssetDialogProps) {
  const [step, setStep] = useState<Step>("pick");
  const [search, setSearch] = useState("");
  const [model, setModel] = useState<UnifiedModel | null>(null);
  const [errorMsg, setError] = useState("");
  const [wsModels, setWsModels] = useState<WavespeedModel[]>([]);
  const [wsRoutes, setWsRoutes] = useState<WaveSpeedRouteCapability[]>([]);
  const [wsModelsLoading, setWsModelsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const [generationRuntime] = useState(getProductionGenerationRuntime);
  const { project, addPlaceholderMedia } = useProjectStore();

  // If opened from a clip's ReferenceImages "Generate" button, pull the prompt
  // from that clip's metadata payload so the dialog pre-fills correctly.
  const effectiveShot: StoryboardShot | undefined = useMemo(() => {
    if (!clipId) return shot;
    const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) return shot;
    const payload = clip.metadata && typeof clip.metadata.payload === "object" && clip.metadata.payload !== null
      ? (clip.metadata.payload as Record<string, unknown>)
      : (clip.metadata as Record<string, unknown>) ?? {};
    const prompt = typeof payload.prompt === "string" ? payload.prompt
      : typeof payload.text === "string" ? payload.text
      : typeof payload.videoPrompt === "string" ? payload.videoPrompt
      : shot?.prompt ?? "";
    if (!prompt && !shot) return undefined;
    if (shot) return { ...shot, prompt };
    const metadata = normalizeSceneProjectionMetadata(clip.metadata)
      ?? normalizeSceneProjectionMetadata(
        clip.metadata && typeof clip.metadata.payload === "object"
          ? clip.metadata.payload
          : undefined,
      );
    const referenceAssetIds = Array.isArray(payload.referenceAssetIds)
      ? payload.referenceAssetIds.filter(
          (referenceId): referenceId is string => typeof referenceId === "string",
        )
      : [];
    return {
      id: metadata?.shotId ?? clipId, index: 0, label: "",
      prompt, model: "", resolution: "", aspectRatio: "16:9",
      includeMainAudio: false, referenceAssetIds, generatedAssetIds: [],
      validation: { valid: true, warnings: [], errors: [] }, outputs: [], selected: false,
    };
  }, [clipId, project.timeline.tracks, shot]);

  const effectiveSceneId = useMemo(() => {
    if (shot?.id) return shot.id;
    if (!clipId) return undefined;
    const clip = project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === clipId);
    if (!clip) return undefined;
    return (
      normalizeSceneProjectionMetadata(clip.metadata)
      ?? normalizeSceneProjectionMetadata(
        clip.metadata && typeof clip.metadata.payload === "object"
          ? clip.metadata.payload
          : undefined,
      )
    )?.shotId;
  }, [clipId, project.timeline.tracks, shot?.id]);

  const sceneGenerationSelection = useMemo(() => {
    if (!effectiveSceneId || !effectiveShot) return undefined;
    const projections = project.timeline.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => {
        const metadata = normalizeSceneProjectionMetadata(clip.metadata)
          ?? normalizeSceneProjectionMetadata(
            clip.metadata && typeof clip.metadata.payload === "object"
              ? clip.metadata.payload
              : undefined,
          );
        return metadata
          ? [{
              clipId: clip.id,
              linkedShotId: metadata.shotId,
              startTime: clip.startTime,
              duration: clip.duration,
              inPoint: clip.inPoint,
              outPoint: clip.outPoint,
            }]
          : [];
      }),
    );
    return selectSceneGenerationContext({
      shotId: effectiveSceneId,
      includeAudio: effectiveShot.includeMainAudio,
      projectionClipId: clipId,
      projections,
    });
  }, [clipId, effectiveSceneId, effectiveShot, project.timeline.tracks]);

  // ── KieAI input state ────────────────────────────────────────────────────
  const defaults = makeKieAIDefaults(asset, effectiveShot);
  const [seedream, setSeedream] = useState(defaults.seedream);
  const [zimage, setZimage] = useState(defaults.zimage);
  const [nanoBanana2, setNanoBanana2] = useState(defaults.nanoBanana2);
  const [flux2, setFlux2] = useState(defaults.flux2);
  const [grok, setGrok] = useState(defaults.grok);
  const [qwen, setQwen] = useState(defaults.qwen);

  // ── WaveSpeed input state ─────────────────────────────────────────────────
  const [wsInputs, setWsInputs] = useState<Record<string, unknown>>({});

// ── Reference images ──────────────────────────────────────────────────────
  const [refIds, setRefIds] = useState<string[]>([]);
  const [generateRefOpen, setGenerateRefOpen] = useState(false);
  const [dialogDraftId] = useState(() => sourceMediaId ?? asset?.id ?? clipId ?? createDurableId("draft"));
  const saveDraft = useGenerationDraftStore((state) => state.saveDraft);
  const draftScope = useMemo<GenerationDraftScope>(() => effectiveShot
    ? { kind: "shot", shotId: effectiveShot.id, projectId: project.id }
    : { kind: "new-asset", draftId: dialogDraftId, projectId: project.id }, [
    dialogDraftId,
    effectiveShot,
    project.id,
  ]);
  const resolutionPrompt = typeof wsInputs.prompt === "string"
    ? wsInputs.prompt
    : asset?.prompt ?? effectiveShot?.videoPrompt ?? effectiveShot?.prompt ?? "";
  const referenceResolutionInput = useMemo(() => {
    const sourceItem = sourceMediaId
      ? project.mediaLibrary.items.find((item) => item.id === sourceMediaId)
      : undefined;
    const sourceDefinition = sourceItem
      ? project.generatedImageDefinitions.find((definition) =>
          definition.currentMediaVersionId === sourceItem.id
          || definition.assetGroupId === (sourceItem.assetGroupId ?? sourceItem.id))
      : undefined;
    return {
      mediaItems: project.mediaLibrary.items,
      generatedImageDefinitions: project.generatedImageDefinitions,
      tracks: project.timeline.tracks,
      ...(sourceMediaId
        ? { source: { mediaVersionId: sourceMediaId, defaultRole: "source" } }
        : {}),
      shotReferences: (effectiveShot?.referenceAssetIds ?? []).map((mediaVersionId) => ({
        mediaVersionId,
        defaultRole: "reference-image",
      })),
      roleByReferenceKey: sourceDefinition?.draft.roleByReferenceKey ?? {},
    };
  }, [
    effectiveShot?.referenceAssetIds,
    project.generatedImageDefinitions,
    project.mediaLibrary.items,
    project.timeline.tracks,
    sourceMediaId,
  ]);
  const referenceResolution = useMemo(
    () => resolveProjectGenerationReferences({
      ...referenceResolutionInput,
      prompt: resolutionPrompt,
    }),
    [referenceResolutionInput, resolutionPrompt],
  );
  const promptReferenceIds = useMemo(
    () => referenceResolution.submissionReferences
      .filter((reference) => reference.origins?.includes("user"))
      .map((reference) => reference.mediaVersionId)
      .filter((mediaVersionId): mediaVersionId is string => Boolean(mediaVersionId)),
    [referenceResolution.submissionReferences],
  );
  const referenceCards = useMemo(
    () => referenceResolution.referenceIds.map((referenceId) => {
      const reference = referenceResolution.submissionReferences.find(
        (candidate) => candidate.key === referenceId,
      );
      const item = project.mediaLibrary.items.find(
        (candidate) => candidate.id === reference?.mediaVersionId,
      );
      const target = referenceResolution.referenceTargets[referenceId];
      return {
        id: referenceId,
        label: item?.name ?? (target?.kind === "missing" ? target.token : referenceId),
        origins: [...(reference?.origins ?? ["prompt"])],
        target,
      };
    }),
    [project.mediaLibrary.items, referenceResolution],
  );

  useEffect(() => {
    if (!open) return;
    const current = useGenerationDraftStore.getState().getDraft(draftScope);
    const sameIds = current.referenceIds.length === referenceResolution.referenceIds.length
      && current.referenceIds.every((id, index) => id === referenceResolution.referenceIds[index]);
    const sameTargets = JSON.stringify(current.referenceTargets)
      === JSON.stringify(referenceResolution.referenceTargets);
    if (current.prompt === resolutionPrompt && sameIds && sameTargets) return;
    saveDraft(draftScope, {
      prompt: resolutionPrompt,
      referenceIds: [...referenceResolution.referenceIds],
      referenceTargets: { ...referenceResolution.referenceTargets },
    });
  }, [draftScope, open, referenceResolution, resolutionPrompt, saveDraft]);

  useEffect(() => {
    if (model?.provider !== "wavespeed") return;
    if (refIds.length === promptReferenceIds.length
      && refIds.every((id, index) => id === promptReferenceIds[index])) return;
    setRefIds(promptReferenceIds);
  }, [model?.provider, promptReferenceIds, refIds]);

  const wsFetchRef = useRef(false);

  // WaveSpeed model availability comes only from the non-secret server capability boundary.
  useEffect(() => {
    if (!open) {
      wsFetchRef.current = false;
      return;
    }
    if (wsFetchRef.current) return;
    wsFetchRef.current = true;

    setWsModelsLoading(true);
    void generationRuntime.readCapabilities()
      .then((capabilities) => {
        if (!capabilities.configured) throw new Error("provider-not-configured");
        setWsRoutes(capabilities.routes);
        setWsModels(capabilities.routes.map(wavespeedModelFromCapability));
      })
      .catch((error: unknown) => {
        console.error("wavespeed-capabilities-load-failed", { projectId: project.id, error });
        setWsRoutes([]);
        setWsModels([]);
        setError(error instanceof Error ? error.message : "WaveSpeed capabilities could not be loaded.");
      })
      .finally(() => setWsModelsLoading(false));
  }, [generationRuntime, open, project.id]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    const d = makeKieAIDefaults(asset, effectiveShot);
    setStep("pick");
    setModel(null);
    setError("");
    setSearch("");
    setSeedream(d.seedream);
    setZimage(d.zimage);
    setNanoBanana2(d.nanoBanana2);
    setFlux2(d.flux2);
    setGrok(d.grok);
    setQwen(d.qwen);
    setWsInputs({});
    setRefIds([]);
  }, [open]);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  // ── Unified model list ────────────────────────────────────────────────────
  const unifiedModels = useMemo<UnifiedModel[]>(() => {
    const kieai: UnifiedModel[] = KIEAI_MODEL_META.map((m) => ({
      id: `kieai:${m.id}`,
      provider: "kieai",
      name: m.name,
      description: m.description,
      genType: m.genType,
      requiresSourceImage: m.requiresSourceImage,
      kieaiModel: m.id,
    }));
    const ws: UnifiedModel[] = wsModels.map((m, index) => {
      const route = wsRoutes[index];
      const genType = (route?.requestedMode ?? m.type) as GenType;
      const isEdit = genType.startsWith("image-to-");
      return {
        id: route
          ? `wavespeed:${waveSpeedRouteKey(route)}`
          : `wavespeed:${m.model_id}:${genType}`,
        provider: "wavespeed",
        name: m.name,
        description: m.description?.slice(0, 120) ?? "",
        genType,
        requiresSourceImage: isEdit,
        wsModel: m,
        wsRoute: route,
      };
    });
    return [...kieai, ...ws].sort((a, b) => a.name.localeCompare(b.name));
  }, [wsModels, wsRoutes]);

  const filteredModels = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return unifiedModels;
    return unifiedModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.provider.includes(q),
    );
  }, [unifiedModels, search]);

  // ── Model select ──────────────────────────────────────────────────────────
  const handleSelectModel = useCallback((m: UnifiedModel) => {
    setModel(m);
    if (m.provider === "wavespeed" && m.wsModel) {
      const schema = m.wsModel.api_schema?.api_schemas?.[0]?.request_schema;
      const base = makeWsDefaults(m.wsModel, asset, effectiveShot);
      if (schema) {
        setWsInputs(injectImageInputs(schema, base, getRefImageUrls(project?.mediaLibrary.items ?? [], refIds)));
      } else {
        setWsInputs(base);
      }
    }
    setStep("form");
  }, [asset, effectiveShot, project, refIds]);

  // Re-inject reference images into WaveSpeed inputs when refIds change
  useEffect(() => {
    if (!model || model.provider !== "wavespeed" || !model.wsModel) return;
    const schema = model.wsModel.api_schema?.api_schemas?.[0]?.request_schema;
    if (!schema) return;
    setWsInputs((prev) => injectImageInputs(schema, prev, getRefImageUrls(project?.mediaLibrary.items ?? [], refIds)));
  }, [refIds, model, project]);

  // ── Reference image upload ────────────────────────────────────────────────
  const handleRefUpload = useCallback(async (file: File) => {
    if (!project) return;
    // Import the uploaded file as media, then add its ID to selection
    const { importMedia } = useProjectStore.getState();
    const result = await importMedia(file);
    if (result.success && result.actionId) {
      setRefIds((prev) => [...prev, result.actionId!]);
    }
  }, [project]);

  const handleReferenceSelection = useCallback((nextIds: string[]) => {
    if (model?.provider !== "wavespeed") {
      setRefIds(nextIds);
      return;
    }
    let nextPrompt = resolutionPrompt;
    for (const mediaVersionId of promptReferenceIds) {
      if (nextIds.includes(mediaVersionId)) continue;
      nextPrompt = nextPrompt.split(canonicalMediaToken(mediaVersionId)).join("");
    }
    for (const mediaVersionId of nextIds) {
      if (promptReferenceIds.includes(mediaVersionId)) continue;
      const token = canonicalMediaToken(mediaVersionId);
      nextPrompt = nextPrompt.trim() ? `${nextPrompt.trim()} ${token}` : token;
    }
    setWsInputs((current) => ({
      ...current,
      prompt: nextPrompt.replace(/\s{2,}/g, " ").trim(),
    }));
  }, [model?.provider, promptReferenceIds, resolutionPrompt]);

  const handleRequestGenerateRef = useCallback(() => {
    setGenerateRefOpen(true);
  }, []);


  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!model || !project) return;
    if (sceneGenerationSelection?.status === "disabled") {
      setError(sceneGenerationSelection.reason);
      setStep("error");
      return;
    }
    setStep("submitting");
    setError("");
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      if (model.provider === "kieai" && model.kieaiModel) {
        // Upload reference images first
        const refUrls: string[] = [];
        for (const refId of refIds) {
          const refItem = project.mediaLibrary.items.find((item) => item.id === refId);
          if (refItem?.blob) {
            try {
              const uploaded = await uploadFileStream(refItem.blob);
              const url = uploaded.fileUrl || uploaded.downloadUrl || "";
              if (url) refUrls.push(url);
            } catch (uploadError) {
              console.warn("kieai-reference-upload-failed", { refId, uploadError });
            }
          }
        }

        // Upload source if needed
        let uploadedUrl = "";
        if (model.requiresSourceImage && sourceFile) {
          const uploaded = await uploadFileStream(sourceFile);
          if (ac.signal.aborted) return;
          uploadedUrl = uploaded.fileUrl || uploaded.downloadUrl || "";
          if (!uploadedUrl) throw new Error("Upload returned no URL");
        }
        // Merge source and reference image URLs
        const allImageUrls = [...(uploadedUrl ? [uploadedUrl] : []), ...refUrls];
        const kinputs: Record<string, unknown> = (() => {
          switch (model.kieaiModel) {
            case IMAGE_MODELS.SEEDREAM:    return { prompt: seedream.prompt, image_urls: allImageUrls, aspect_ratio: seedream.aspect_ratio, quality: seedream.quality };
            case IMAGE_MODELS.Z_IMAGE:     return { prompt: zimage.prompt, aspect_ratio: zimage.aspect_ratio };
            case IMAGE_MODELS.NANO_BANANA2: return { prompt: nanoBanana2.prompt, image_input: allImageUrls, aspect_ratio: nanoBanana2.aspect_ratio, resolution: nanoBanana2.resolution, output_format: nanoBanana2.output_format };
            case IMAGE_MODELS.FLUX2:       return { prompt: flux2.prompt, input_urls: allImageUrls, aspect_ratio: flux2.aspect_ratio, resolution: flux2.resolution };
            case IMAGE_MODELS.GROK:        return { ...(grok.prompt ? { prompt: grok.prompt } : {}), image_urls: allImageUrls };
            case IMAGE_MODELS.QWEN:        return { prompt: qwen.prompt, image_url: uploadedUrl, strength: qwen.strength, output_format: qwen.output_format, acceleration: qwen.acceleration, ...(qwen.negative_prompt ? { negative_prompt: qwen.negative_prompt } : {}), ...(qwen.seed != null ? { seed: qwen.seed } : {}) };
            default: throw new Error("Unknown KieAI model");
          }
        })();

        const taskId = await createImageTask(model.kieaiModel, kinputs as unknown as ImageModelInput);
        if (ac.signal.aborted) return;

        const mediaId = createDurableId("media");
        const name = `${(sourceFile?.name ?? "generated").replace(/\.[^.]+$/, "")}_kieai.png`;
        addPlaceholderMedia({
          id: mediaId, name, type: "image", fileHandle: null, blob: null,
          metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
          thumbnailUrl: previewUrl ?? null, kieaiTaskId: taskId,
          generationMeta: { provider: "kieai", model: model.kieaiModel, prompt: String(kinputs.prompt ?? ""), inputs: kinputs, jobId: taskId, status: "pending" },
        });
      } else if (model.provider === "wavespeed" && model.wsModel) {
        const schema = model.wsModel.api_schema?.api_schemas?.[0]?.request_schema;
        if (Object.values(referenceResolution.referenceTargets).some(
          (target) => target.kind === "missing",
        )) {
          throw new Error("generation-reference-target-missing");
        }
        const resolvedReferenceIds = referenceResolution.submissionReferences.map((reference) => {
          if (!reference.mediaVersionId) {
            throw new Error(`Generation reference ${reference.key ?? reference.mediaId} has no version identity.`);
          }
          return reference.mediaVersionId;
        });
        const resolvedReferenceItems = getRefImageUrls(
          project.mediaLibrary.items,
          resolvedReferenceIds,
        );
        const injected = schema ? injectImageInputs(schema, wsInputs, resolvedReferenceItems) : wsInputs;
        const route = model.wsRoute;
        if (!route) {
          throw new Error(`No immutable WaveSpeed route is configured for ${model.wsModel.model_id} (${model.genType}).`);
        }
        const projection = sceneGenerationSelection?.status === "ready"
          ? sceneGenerationSelection.projection
          : undefined;
        const entryContext = projection && effectiveSceneId
          ? {
              kind: "linked-projection" as const,
              shotId: effectiveSceneId,
              clipId: projection.clipId,
              startTime: projection.startTime,
              endTime: projection.startTime + projection.duration,
            }
          : effectiveSceneId
            ? { kind: "unplaced-shot" as const, shotId: effectiveSceneId }
            : { kind: "new-asset" as const };
      const references = referenceResolution.submissionReferences.map((reference) => {
          const item = project.mediaLibrary.items.find(
            (candidate) => candidate.id === reference.mediaVersionId,
          );
          if (!item) {
            throw new Error(`Generation reference ${reference.mediaVersionId} is missing from the project.`);
          }
          const remoteUrl = item.remoteUrl ?? item.originalUrl ?? undefined;
          if (!item.blob && !remoteUrl) {
            throw new Error(`Generation reference ${reference.mediaVersionId} has no uploadable content.`);
          }
          return {
            ...reference,
            value: {
              projectId: project.id,
              ...(item.blob
                ? {
                    body: item.blob,
                    mimeType: item.blob.type || item.metadata.codec || "application/octet-stream",
                  }
                : {
                    url: remoteUrl,
                    mimeType: item.metadata.codec || undefined,
                  }),
            },
        };
      });
      const preparedAudio = await prepareWaveSpeedProjectionAudio({
        projectId: project.id,
        supportsAudio: route.supportsAudio ?? false,
        entryContext,
        tracks: project.timeline.tracks,
        media: project.mediaLibrary.items,
      });
      if (preparedAudio.kind === "error") {
        throw new Error(preparedAudio.code);
      }
      const generationAudio = preparedAudio.kind === "ready"
        ? preparedAudio.audio
        : undefined;
      const prepared = prepareWaveSpeedGenerationDraft({
        projectId: project.id,
        route,
          entryContext,
          prompt: resolutionPrompt,
          negativePrompt: typeof wsInputs.negative_prompt === "string" ? wsInputs.negative_prompt : undefined,
          placementPolicy: entryContext.kind === "linked-projection" ? "replace-selected-clip-media" : undefined,
          target: { kind: "new-asset" },
        providerInputs: injected,
        references,
        audio: generationAudio,
      });
        await generationRuntime.controller.submit(prepared.draft);
        if (ac.signal.aborted) return;
        handleClose();
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setStep("error");
    }
  }, [model, project, sceneGenerationSelection, effectiveSceneId, sourceFile, previewUrl, seedream, zimage, nanoBanana2, flux2, grok, qwen, wsInputs, refIds, addPlaceholderMedia, generationRuntime, handleClose, referenceResolution, resolutionPrompt]);

  // ── Gen type label ────────────────────────────────────────────────────────
  const genTypeLabel: Record<GenType, string> = {
    "text-to-image": "Text → Image",
    "image-to-image": "Image → Image",
    "text-to-video": "Text → Video",
    "image-to-video": "Image → Video",
  };

  const providerColors: Record<ModelProvider, string> = {
    kieai: "bg-violet-500/20 text-violet-300",
    wavespeed: "bg-emerald-500/20 text-emerald-300",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const imageMedia = project?.mediaLibrary.items ?? [];
  const title = step === "pick" ? "Generate Asset"
    : step === "submitting" ? "Submitting…"
    : step === "error" ? "Generation Failed"
    : model?.name ?? "";

  return (
    <>
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Source image preview */}
        {(sourceFile || previewUrl) && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background-elevated p-2 shrink-0">
            {previewUrl ? (
              <img src={previewUrl} alt="Source" className="h-10 w-10 rounded object-cover flex-shrink-0" />
            ) : (
              <div className="h-10 w-10 rounded bg-background-tertiary flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-text-primary">{sourceFile?.name ?? "Reference"}</p>
              <p className="text-[10px] text-text-muted">Source image</p>
            </div>
          </div>
        )}

        {/* Content — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          {step === "pick" && (
            <div className="space-y-3">
              {/* Search */}
              <div className="sticky top-0 bg-background z-10 pb-2">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2">
                  <Search size={14} className="text-text-muted flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${unifiedModels.length} models…`}
                    className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                  />
                </div>
              </div>

              {wsModelsLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
                  <span className="ml-2 text-xs text-text-muted">Loading WaveSpeed models…</span>
                </div>
              )}

              {/* Model cards */}
              <div className="grid grid-cols-1 gap-2">
                {filteredModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleSelectModel(m)}
                    className="flex items-start gap-3 rounded-lg border border-border bg-background-elevated p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{m.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerColors[m.provider]}`}>
                          {m.provider === "kieai" ? "KieAI" : "WaveSpeed"}
                        </span>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-background-tertiary text-text-muted">
                          {genTypeLabel[m.genType]}
                        </span>
                        {m.requiresSourceImage && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">Needs source</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-text-muted leading-relaxed line-clamp-2">{m.description}</p>
                    </div>
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ))}
              </div>

              {filteredModels.length === 0 && !wsModelsLoading && (
                <p className="text-xs text-text-muted text-center py-8">No models match "{search}"</p>
              )}
            </div>
          )}

          {step === "form" && model && (
            <div className="space-y-3">
              <button onClick={() => setStep("pick")} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                <ChevronLeft size={12} /> Back to models
              </button>

              {/* Selected model header */}
              <div className="rounded-lg border border-border bg-background-elevated p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-text-primary">{model.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerColors[model.provider]}`}>
                    {model.provider === "kieai" ? "KieAI" : "WaveSpeed"}
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-background-tertiary text-text-muted">
                    {genTypeLabel[model.genType]}
                  </span>
                  {model.requiresSourceImage && !sourceFile && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">
                      Source image recommended
                    </span>
                  )}
                </div>
              </div>

              {/* Reference images — always visible */}
              <ReferenceImagePicker
                mediaItems={imageMedia}
                selectedIds={refIds}
                onChange={handleReferenceSelection}
                onUpload={handleRefUpload}
                onRequestGenerate={handleRequestGenerateRef}
              />
              <GenerateReferenceSection references={referenceCards} />

              {/* KieAI per-model form */}
              {model.provider === "kieai" && model.kieaiModel && (
                <>
                  {model.kieaiModel === IMAGE_MODELS.SEEDREAM    && <SeedreamForm value={seedream} onChange={setSeedream} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.Z_IMAGE     && <ZImageForm value={zimage} onChange={setZimage} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.NANO_BANANA2 && <NanoBanana2Form value={nanoBanana2} onChange={setNanoBanana2} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.FLUX2       && <Flux2Form value={flux2} onChange={setFlux2} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.GROK        && <GrokForm value={grok} onChange={setGrok} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.QWEN        && <QwenForm value={qwen} onChange={setQwen} onSubmit={handleGenerate} isLoading={false} />}
                </>
              )}

              {/* WaveSpeed dynamic form */}
              {model.provider === "wavespeed" && model.wsModel && (
                <>
                  <SchemaForm
                    schema={model.wsModel.api_schema.api_schemas[0].request_schema}
                    values={wsInputs}
                    onChange={setWsInputs}
                  />
                  {sceneGenerationSelection?.status === "disabled" && (
                    <p className="text-xs text-amber-400" role="status">
                      {sceneGenerationSelection.reason}
                    </p>
                  )}
                  <Button
                    onClick={handleGenerate}
                    className="w-full"
                    size="sm"
                    disabled={sceneGenerationSelection?.status === "disabled"}
                  >
                    Generate
                  </Button>
                </>
              )}
            </div>
          )}

          {step === "submitting" && (
            <div className="space-y-4 py-8 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
              <p className="text-sm text-text-secondary">Submitting to {model?.provider === "kieai" ? "KieAI" : "WaveSpeed"}…</p>
              <Button variant="outline" size="sm" onClick={() => { abortRef.current?.abort(); handleClose(); }}>Cancel</Button>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{errorMsg}</div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleClose}>Close</Button>
                <Button className="flex-1" onClick={() => setStep("form")}>Try Again</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {generateRefOpen && (
      <GenerateAssetDialog
        open={generateRefOpen}
        onClose={() => setGenerateRefOpen(false)}
      />
    )}
    </>
  );
}
