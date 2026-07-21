import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Captions, Upload, Info, Pencil, AlertTriangle, List } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import { useProblemCount } from "../../stores/problem-store";
import type { Transform, EditingTemplatePrimitive } from "@openreel/core";
import { getSceneIdFromClip, isSceneProjection } from "@openreel/music-video-domain";
import {
  ChromaKeyEngine,
  initializeTranscriptionService,
  type WhisperTranscriptionProgress,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
} from "@openreel/core";
import { OPENREEL_TRANSCRIBE_URL } from "../../config/api-endpoints";
import { mergeEditingTemplateControlValues } from "./panels/EditingTemplateControls";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  DEFAULT_NOISE_REDUCTION,
} from "../../bridges/audio-bridge-effects";
import { toast } from "../../stores/notification-store";
import {
  FONT_CATEGORIES,
  FONT_FILE_ACCEPT,
  registerCustomFont,
  useCustomFonts,
} from "./inspector/font-options";
import { getNoiseReductionPreset } from "./inspector/noise-reduction-presets";
import {
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@openreel/ui";
import {
  getTabsForClipType,
  getTabIdsForClipType,
  type InspectorClipType,
  type InspectorTabId,
} from "./inspector/clip-tabs.config";
import { InspectorTabs } from "./inspector/shell/InspectorTabs";
import { InspectorClipHeader } from "./inspector/shell/InspectorClipHeader";
import { InspectorTabPanel } from "./inspector/shell/InspectorTabPanel";
import { InspectorTabErrorBoundary } from "./inspector/shell/InspectorTabErrorBoundary";
import { InspectorSection } from "./inspector/shell/InspectorSection";
import { ColorTab } from "./inspector/tabs/ColorTab";
import { AudioTab } from "./inspector/tabs/AudioTab";
import { TransformTab } from "./inspector/tabs/TransformTab";
import { SpeedTab } from "./inspector/tabs/SpeedTab";
import { AnimateTab } from "./inspector/tabs/AnimateTab";
import { StyleTab } from "./inspector/tabs/StyleTab";
import { EffectsTab } from "./inspector/tabs/EffectsTab";
import { AiTab } from "./inspector/tabs/AiTab";
import { GenerateTab } from "./inspector/tabs/generation/GenerateTab";
import type { GenerateAudioPresentation } from "./inspector/tabs/generation/GenerateTabSections";
import { resolveGenerationEntryContext } from "../../features/generation/context/scene-generation";
import {
  applyGenerationReferenceCommand,
  createGenerationReferenceRecoveryState,
  type GenerationReferenceCommand,
} from "../../features/generation/drafts/v2";
import {
  generationDraftKey,
  useGenerationDraftStore,
  type GenerationDraftScope,
} from "../../features/generation/drafts/ui-store";
import {
  isPlacementReconciliationCandidate,
  type RecoveryAction,
} from "../../features/generation/recovery/state-machine";
import {
  getProductionGenerationRuntime,
  prepareWaveSpeedGenerationDraft,
  prepareWaveSpeedProjectionAudio,
  useGenerationJobStore,
  waveSpeedRouteKey,
  type WaveSpeedGenerationCapabilities,
} from "../../stores/generation-job-store";
import { MetadataClipInspector } from "./inspector/MetadataClipInspector";
import { SceneMetadataInspector } from "./inspector/SceneMetadataInspector";
import { SceneEditor } from "./inspector/SceneEditor";
import { ProblemsPanel } from "./inspector/ProblemsPanel";
import { ImportErrorsPanel } from "./inspector/ImportErrorsPanel";
import { LogPanel } from "./inspector/LogPanel";
import { AssetInspectorWithTabs } from "./inspector/AssetInspectorWithTabs";
import { ClipTimingSection } from "./inspector/ClipTimingSection";
import { readReferenceEditorRouteFromModalData } from "../../features/references/navigation";
import { ReferenceEditorContent, ReferenceEditorModal } from "./references/ReferenceEditorModal";

// Initialize engines as singletons
const chromaKeyEngine = new ChromaKeyEngine({ width: 1920, height: 1080 });

const Section = InspectorSection;

const EmptyState: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-50">
    <p className="text-sm text-text-secondary mb-2">No selection</p>
    <p className="text-xs text-text-muted">
      Select a clip to view its properties
    </p>
  </div>
);


export const InspectorPanel: React.FC = () => {
  // Stores
  const {
    getClip,
    getMediaItem,
    addSubtitle,
    importSRT,
    updateSubtitle,
    getSubtitle,
    getEditingTemplate,
    updateEditingTemplateApplication,
    removeEditingTemplateApplication,
  } = useProjectStore();
  const project = useProjectStore((state) => state.project);
  const { getSelectedClipIds } = useUIStore();
  const selectedItems = useUIStore((state) => state.selectedItems);
  const effectApplicationClipId = useUIStore(
    (state) => state.effectApplicationClipId,
  );
  const startEffectApplication = useUIStore(
    (state) => state.startEffectApplication,
  );
  const finishEffectApplication = useUIStore(
    (state) => state.finishEffectApplication,
  );
  const inspectedAsset = useUIStore((state) => state.inspectedAsset);
  const inspectorSelection = useUIStore((state) => state.inspectorSelection);
  const referenceEditorInspectorRoute = useUIStore(
    (state) => state.referenceEditorInspectorRoute,
  );
  const activeModal = useUIStore((state) => state.activeModal);
  const modalData = useUIStore((state) => state.modalData);
  const closeModal = useUIStore((state) => state.closeModal);
  const selectedClipIds = getSelectedClipIds();
  // When a clip is selected and no explicit asset is pinned, show the clip's media item.
  const selectedClipMediaItem = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clip = getClip(selectedClipIds[0]);
    if (!clip) return null;
    return getMediaItem(clip.mediaId) ?? null;
  }, [getClip, getMediaItem, selectedClipIds, project.modifiedAt]);
  // Always derive a fresh reference from the project store so that
  // replaceMediaAsset (link file) updates are reflected immediately.
  const effectiveInspectedAsset = useMemo(() => {
    const base = inspectedAsset ?? selectedClipMediaItem;
    if (!base) return null;
    return getMediaItem(base.id) ?? base;
  }, [inspectedAsset, selectedClipMediaItem, getMediaItem, project.modifiedAt]);
  const importErrors = useUIStore((state) => state.importErrors);
  const pausePlayback = useTimelineStore((state) => state.pause);
  const lockPlayback = useTimelineStore((state) => state.lockPlayback);
  const unlockPlayback = useTimelineStore((state) => state.unlockPlayback);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  // Transcription state
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<WhisperTranscriptionProgress | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("none");
  const [defaultAnimationStyle, setDefaultAnimationStyle] =
    useState<CaptionAnimationStyle>("word-highlight");
  const [expandedRecipeApplicationId, setExpandedRecipeApplicationId] =
    useState<string | null>(null);
  const [recipeControlValues, setRecipeControlValues] = useState<
    Record<string, Record<string, EditingTemplatePrimitive>>
  >({});
  const srtInputRef = useRef<HTMLInputElement>(null);
  const subtitleFontInputRef = useRef<HTMLInputElement>(null);
  const customFonts = useCustomFonts();
  const [generationModels, setGenerationModels] = useState<Array<{ id: string; label: string; provider: string; modes: Array<"image" | "video"> }>>([]);
  const [generationRuntime] = useState(getProductionGenerationRuntime);
  const [generationCapabilities, setGenerationCapabilities] =
    useState<WaveSpeedGenerationCapabilities>();
  const [generationModelId, setGenerationModelId] = useState("");
  const [generationSubmitting, setGenerationSubmitting] = useState(false);

  useEffect(() => {
    setExpandedRecipeApplicationId(null);
  }, [selectedClipIds.join("|")]);

  // Check if a subtitle is selected
  const selectedSubtitleId = useMemo(() => {
    const subtitleSelection = selectedItems.find(
      (item) => item.type === "subtitle",
    );
    return subtitleSelection?.id || null;
  }, [selectedItems]);

  const selectedSubtitle = useMemo(() => {
    if (!selectedSubtitleId) return null;
    return getSubtitle(selectedSubtitleId) || null;
  }, [selectedSubtitleId, getSubtitle, project.timeline.subtitles]);

  const selectedTimelineClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    return getClip(selectedClipIds[0]) || null;
  }, [getClip, project.modifiedAt, selectedClipIds]);

  const generationJob = useGenerationJobStore((state) => {
    const selectedClipId = selectedTimelineClip?.id;
    if (!selectedClipId) return undefined;
    for (let index = state.records.length - 1; index >= 0; index -= 1) {
      const record = state.records[index];
      if (record.kind !== "v2" || record.job.projectId !== project.id) continue;
      const entryContext = record.job.context.entryContext;
      if (
        (entryContext.kind === "linked-projection" && entryContext.clipId === selectedClipId)
        || (entryContext.kind === "unlinked-range" && entryContext.rangeId === selectedClipId)
      ) {
        return record.job;
      }
    }
    return undefined;
  });

  useEffect(() => {
    let active = true;
    void generationRuntime.readCapabilities()
      .then((capabilities) => {
        if (!active) return;
        setGenerationCapabilities(capabilities);
        setGenerationModels(capabilities.routes.map((route) => ({
            id: waveSpeedRouteKey(route),
            label: `${route.providerModelId} · ${route.requestedMode}`,
            provider: "wavespeed",
            modes: [route.output],
          })));
        setGenerationModelId((current) =>
          capabilities.routes.some((route) => waveSpeedRouteKey(route) === current)
            ? current
            : (capabilities.routes[0] ? waveSpeedRouteKey(capabilities.routes[0]) : ""),
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("generation-capabilities-load-failed", {
          projectId: project.id,
          error,
        });
        toast.error(
          "Generation models unavailable",
          error instanceof Error ? error.message : "Generation capabilities could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [generationRuntime, project.id]);

  const generationRoute = useMemo(
    () => generationCapabilities?.routes.find((route) =>
      waveSpeedRouteKey(route) === generationModelId),
    [generationCapabilities, generationModelId],
  );

  const generationEntryContext = useMemo(() => {
    const shotId = selectedTimelineClip ? getSceneIdFromClip(selectedTimelineClip) : undefined;
    if (selectedTimelineClip && shotId) {
      return {
        kind: "linked-projection" as const,
        shotId,
        clipId: selectedTimelineClip.id,
        startTime: selectedTimelineClip.startTime,
        endTime: selectedTimelineClip.startTime + selectedTimelineClip.duration,
      };
    }
    if (selectedTimelineClip) {
      return {
        kind: "unlinked-range" as const,
        rangeId: selectedTimelineClip.id,
        startTime: selectedTimelineClip.startTime,
        endTime: selectedTimelineClip.startTime + selectedTimelineClip.duration,
        destinationTrackId: selectedTimelineClip.trackId,
      };
    }
    return { kind: "new-asset" as const };
  }, [selectedTimelineClip]);

  const generationEntryContextResult = useMemo(
    () => generationEntryContext.kind === "linked-projection"
      ? resolveGenerationEntryContext({
        ...generationEntryContext,
        supportsAudio: generationRoute?.supportsAudio ?? false,
      })
      : resolveGenerationEntryContext(generationEntryContext),
    [generationEntryContext, generationRoute?.supportsAudio],
  );

  const generationAudioPresentation = useMemo<GenerateAudioPresentation>(() => {
    if (!generationRoute) return { kind: "pending" };
    if (!generationRoute.supportsAudio) return { kind: "unsupported" };
    if (!generationEntryContextResult.audioEligible) {
      return {
        kind: "zero-work",
        reason: "Audio preparation only runs for a selected linked projection.",
      };
    }
    return { kind: "pending" };
  }, [generationEntryContextResult.audioEligible, generationRoute]);

  const generationReferenceSeed = useMemo(
    () => createGenerationReferenceRecoveryState({
      projectId: project.id,
      jobId: generationJob?.id ?? "draft",
      references: (generationJob?.context.references ?? []).map((reference) => ({
        ...reference,
        active: true,
      })),
      drafts: (generationJob?.context.references ?? []).map((reference) => {
        const referenceMedia = getMediaItem(reference.mediaId);
        return {
          id: reference.id,
          mediaId: reference.mediaId,
          versionId: reference.versionId,
          origins: reference.origins,
          value: referenceMedia?.blob
            ? {
              projectId: project.id,
              body: referenceMedia.blob,
              mimeType: referenceMedia.blob.type || referenceMedia.metadata.codec,
            }
            : referenceMedia?.remoteUrl
              ? {
                projectId: project.id,
                url: referenceMedia.remoteUrl,
                mimeType: referenceMedia.metadata.codec,
              }
              : undefined,
        };
      }),
    }),
    [generationJob, getMediaItem, project.id],
  );
  const selectedGenerationDraftId = selectedClipIds.length === 1 ? selectedClipIds[0] : project.id;
  const generationReferenceScope = useMemo<GenerationDraftScope>(() => ({
    kind: "new-asset",
    projectId: project.id,
    draftId: selectedGenerationDraftId,
  }), [project.id, selectedGenerationDraftId]);
  const generationReferenceKey = generationDraftKey(generationReferenceScope);
  const persistedGenerationReferenceRecovery = useGenerationDraftStore(
    (state) => state.referenceRecoveries[generationReferenceKey],
  );
  const saveGenerationReferenceRecovery = useGenerationDraftStore(
    (state) => state.saveReferenceRecovery,
  );
  const generationReferenceRecovery = useMemo(() => {
    if (persistedGenerationReferenceRecovery?.projectId !== generationReferenceSeed.projectId
      || persistedGenerationReferenceRecovery.jobId !== generationReferenceSeed.jobId) {
      return generationReferenceSeed;
    }
    return {
      ...persistedGenerationReferenceRecovery,
      drafts: persistedGenerationReferenceRecovery.drafts.map((draft) => ({
        ...draft,
        value: generationReferenceSeed.drafts.find((candidate) => candidate.id === draft.id)?.value,
      })),
    };
  }, [generationReferenceSeed, persistedGenerationReferenceRecovery]);
  const generationReferenceLabels = useMemo(
    () => Object.fromEntries(generationReferenceRecovery.references.map((reference) => [
      reference.id,
      getMediaItem(reference.mediaId)?.name ?? reference.mediaId,
    ])),
    [generationReferenceRecovery.references, getMediaItem],
  );

  const handleGenerationReferenceCommand = useCallback(async (
    command: GenerationReferenceCommand,
  ) => {
    try {
      const next = await applyGenerationReferenceCommand(
        generationReferenceRecovery,
        command,
        generationRuntime.referenceRecovery,
      );
      saveGenerationReferenceRecovery(generationReferenceScope, next);
    } catch (error) {
      console.error("generation-reference-command-failed", {
        projectId: project.id,
        jobId: generationReferenceRecovery.jobId,
        referenceId: command.referenceId,
        action: command.action,
        error,
      });
      toast.error(
        "Reference action failed",
        error instanceof Error ? error.message : "The reference could not be updated.",
      );
    }
  }, [
    generationReferenceRecovery,
    generationReferenceScope,
    generationRuntime,
    project.id,
    saveGenerationReferenceRecovery,
  ]);

  const handleGenerationSubmit = useCallback(async (draft: {
    key: string;
    modelId?: string;
    prompt: string;
    providerInputs: Record<string, unknown>;
    referenceIds: string[];
    placementPolicy: "none" | "create-linked-clip" | "replace-selected-clip-media";
    updatedAt: number;
  }) => {
    const route = generationCapabilities?.routes.find((candidate) =>
      waveSpeedRouteKey(candidate) === draft.modelId);
    if (!route) {
      toast.error("Generation route unavailable", "Choose an available WaveSpeed image model.");
      return;
    }
    if (generationEntryContextResult.errors.length > 0) {
      toast.error(
        "Generation context unavailable",
        generationEntryContextResult.errors[0]?.code ?? "The selected timeline context is invalid.",
      );
      return;
    }

    setGenerationSubmitting(true);
    try {
      const preparedAudio = await prepareWaveSpeedProjectionAudio({
        projectId: project.id,
        supportsAudio: route.supportsAudio ?? false,
        entryContext: generationEntryContextResult.entryContext,
        tracks: project.timeline.tracks,
        media: project.mediaLibrary.items,
      });
      if (preparedAudio.kind === "error") {
        throw new Error(preparedAudio.code);
      }
      const generationAudio = preparedAudio.kind === "ready"
        ? preparedAudio.audio
        : undefined;
      const references = generationReferenceRecovery.providerReferences.map((reference) => {
        const source = generationReferenceRecovery.drafts.find(
          (candidate) => candidate.id === reference.id,
        );
        return {
          mediaId: reference.mediaId,
          versionId: reference.versionId,
          origins: reference.origins,
          value: source?.value,
        };
      });
      const prepared = prepareWaveSpeedGenerationDraft({
        projectId: project.id,
        route,
        entryContext: generationEntryContextResult.entryContext,
        prompt: draft.prompt,
        placementPolicy: draft.placementPolicy,
        target: { kind: "new-asset" },
        providerInputs: {
          ...draft.providerInputs,
          prompt: draft.prompt,
        },
        references,
        audio: generationAudio,
        idempotencyKey: draft.key,
      });
      await generationRuntime.controller.submit(prepared.draft);
    } catch (error) {
      console.error("inspector-generation-submit-failed", {
        projectId: project.id,
        clipId: selectedTimelineClip?.id,
        error,
      });
      toast.error(
        "Generation could not start",
        error instanceof Error ? error.message : "The generation request could not be submitted.",
      );
    } finally {
      setGenerationSubmitting(false);
    }
  }, [
    generationCapabilities,
    generationEntryContextResult,
    generationReferenceRecovery,
    generationRuntime,
    project.id,
    project.mediaLibrary.items,
    project.timeline.tracks,
    selectedTimelineClip?.id,
  ]);

  const handleGenerationRecoveryAction = useCallback(async (action: RecoveryAction) => {
    if (!generationJob) {
      toast.error("Generation job unavailable", "Refresh the project before retrying this action.");
      return;
    }
    if (action === "regenerate" || action === "variation") {
      toast.error(
        "Start a new generation",
        "Edit the generation settings, then submit a new draft.",
      );
      return;
    }
    if (
      action === "reconcile-placement"
      && !isPlacementReconciliationCandidate(generationJob)
    ) {
      toast.error(
        "Placement reconciliation unavailable",
        "This job is not eligible for placement reconciliation.",
      );
      return;
    }
    try {
      await generationRuntime.command(action, generationJob);
    } catch (error) {
      console.error("inspector-generation-recovery-failed", {
        projectId: project.id,
        jobId: generationJob.id,
        action,
        error,
      });
      toast.error(
        "Generation recovery failed",
        error instanceof Error ? error.message : "The recovery action could not be completed.",
      );
    }
  }, [generationJob, generationRuntime, project.id]);

  const handleGenerationCancel = useCallback(() => {
    void handleGenerationRecoveryAction("cancel");
  }, [handleGenerationRecoveryAction]);

  const sceneEditorSelection = useMemo(() => {
    if (selectedTimelineClip) {
      const sceneId = getSceneIdFromClip(selectedTimelineClip);
      if (!sceneId) return null;
      return {
        sceneId,
        projectionClipId: selectedTimelineClip.id,
        focusTitleRequestId:
          inspectorSelection?.type === "scene" && inspectorSelection.sceneId === sceneId
            ? inspectorSelection.focusTitleRequestId
            : undefined,
      };
    }
    return inspectorSelection?.type === "scene" ? inspectorSelection : null;
  }, [inspectorSelection, selectedTimelineClip]);

  const isSelectedMetadataClip = selectedTimelineClip?.type === "metadata";

  const metadataKind = useMemo(
    () => {
      if (isSceneProjection(selectedTimelineClip)) return "scene";
      return typeof selectedTimelineClip?.metadata?.kind === "string"
        ? (selectedTimelineClip.metadata.kind as string)
        : undefined;
    },
    [selectedTimelineClip],
  );

  // Get selected clip (check regular clips, text clips, and shape clips)
  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
    const regularClip = getClip(clipId);
    if (regularClip) return regularClip;
    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) {
      return {
        id: textClip.id,
        mediaId: `text-${textClip.id}`,
        startTime: textClip.startTime,
        duration: textClip.duration,
        inPoint: 0,
        outPoint: textClip.duration,
        transform: textClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        text: textClip.text,
        trackId: textClip.trackId,
      };
    }
    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) {
      return {
        id: shapeClip.id,
        mediaId: `shape-${shapeClip.id}`,
        startTime: shapeClip.startTime,
        duration: shapeClip.duration,
        inPoint: 0,
        outPoint: shapeClip.duration,
        transform: shapeClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        shapeType: shapeClip.shapeType,
        trackId: shapeClip.trackId,
      };
    }
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) {
      return {
        id: svgClip.id,
        mediaId: `svg-${svgClip.id}`,
        startTime: svgClip.startTime,
        duration: svgClip.duration,
        inPoint: 0,
        outPoint: svgClip.duration,
        transform: svgClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        svgContent: svgClip.svgContent,
        trackId: svgClip.trackId,
      };
    }
    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) {
      return {
        id: stickerClip.id,
        mediaId: `sticker-${stickerClip.id}`,
        startTime: stickerClip.startTime,
        duration: stickerClip.duration,
        inPoint: 0,
        outPoint: stickerClip.duration,
        transform: stickerClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        imageUrl: stickerClip.imageUrl,
        trackId: stickerClip.trackId,
      };
    }
    return null;
  }, [
    selectedClipIds,
    getClip,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  // Force re-render trigger - increment to force recalculation of engine values
  const [updateCounter, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // Get current values from engines - recalculate when updateCounter changes
  const clipId = selectedClip?.id || "";

  const chromaKeySettings = useMemo(() => {
    return clipId ? chromaKeyEngine.getSettings(clipId) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, updateCounter]);

  // Get updateClipTransform from store
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );

  // Transform handlers
  const handleTransformChange = useCallback(
    (changes: Partial<Transform>) => {
      if (!selectedClip) return;
      updateClipTransform(selectedClip.id, changes);
    },
    [selectedClip, updateClipTransform],
  );

  // Chroma Key handlers using ChromaKeyEngine
  const handleChromaKeyToggle = useCallback(
    (enabled: boolean) => {
      if (!selectedClip) return;
      if (enabled) {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
      } else {
        chromaKeyEngine.disableChromaKey(selectedClip.id);
      }
      forceUpdate();
    },
    [selectedClip],
  );

  const handleKeyColorChange = useCallback(
    (hexColor: string) => {
      if (!selectedClip) return;
      const hex = hexColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      chromaKeyEngine.setKeyColor(selectedClip.id, { r, g, b });
      forceUpdate();
    },
    [selectedClip],
  );

  const handleToleranceChange = useCallback(
    (tolerance: number) => {
      if (!selectedClip) return;
      chromaKeyEngine.setTolerance(selectedClip.id, tolerance / 100);
      forceUpdate();
    },
    [selectedClip],
  );

  const {
    addVideoEffect,
    updateVideoEffect,
    getAudioEffects,
    updateAudioEffect,
    toggleAudioEffect,
  } = useProjectStore();

  const [isEnhancingAudio, setIsEnhancingAudio] = useState(false);
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  const isApplyingSelectedClipEffect =
    effectApplicationClipId !== null && effectApplicationClipId === selectedClip?.id;

  const waitForEffectApplicationPaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
    [],
  );

  const applyClipEffectWithPlaybackLock = useCallback(
    async (
      clipId: string,
      label: string,
      apply: () => void | Promise<void>,
    ) => {
      pausePlayback();
      lockPlayback(label);
      startEffectApplication(clipId, label);

      try {
        await waitForEffectApplicationPaint();
        await apply();
        window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
        await waitForEffectApplicationPaint();
      } finally {
        finishEffectApplication();
        unlockPlayback();
      }
    },
    [
      finishEffectApplication,
      lockPlayback,
      pausePlayback,
      startEffectApplication,
      unlockPlayback,
      waitForEffectApplicationPaint,
    ],
  );

  const handleRemoveBackground = useCallback(() => {
    if (!selectedClip) return;
    void applyClipEffectWithPlaybackLock(
      selectedClip.id,
      "Applying background removal",
      () => {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
        chromaKeyEngine.setKeyColor(selectedClip.id, { r: 0, g: 1, b: 0 });
        chromaKeyEngine.setTolerance(selectedClip.id, 0.35);
        forceUpdate();
      },
    );
  }, [applyClipEffectWithPlaybackLock, forceUpdate, selectedClip]);

  const handleEnhanceAudio = useCallback(async () => {
    if (!selectedClip) return;
    setIsEnhancingAudio(true);
    try {
      await applyClipEffectWithPlaybackLock(
        selectedClip.id,
        "Applying audio cleanup",
        async () => {
          await initializeAudioBridgeEffects();
          const bridge = getAudioBridgeEffects();
          const noiseCleanupConfig = {
            ...DEFAULT_NOISE_REDUCTION,
            ...getNoiseReductionPreset("speech").config,
          };

          const existingNoiseReduction = getAudioEffects(selectedClip.id).find(
            (effect) => effect.type === "noiseReduction",
          );

          if (existingNoiseReduction) {
            updateAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              noiseCleanupConfig as unknown as Record<string, unknown>,
            );
            toggleAudioEffect(selectedClip.id, existingNoiseReduction.id, true);
          } else {
            const result = bridge.applyNoiseReduction(
              selectedClip.id,
              noiseCleanupConfig,
            );

            if (!result.success) {
              throw new Error(result.error ?? "Failed to apply noise cleanup");
            }
          }

          setAudioEnhanced(true);
          setTimeout(() => setAudioEnhanced(false), 2000);
          toast.success(
            "Noise cleanup applied",
            "Fine-tune or switch presets in Background Noise Removal.",
          );

          forceUpdate();
        },
      );
    } catch (error) {
      console.error("Failed to enhance audio:", error);
      toast.error(
        "Could not clean up audio",
        error instanceof Error
          ? error.message
          : "Noise cleanup could not be applied to this clip.",
      );
    } finally {
      setIsEnhancingAudio(false);
    }
  }, [
    applyClipEffectWithPlaybackLock,
    selectedClip,
    forceUpdate,
    getAudioEffects,
    toggleAudioEffect,
    updateAudioEffect,
  ]);

  const handleAutoColor = useCallback(async () => {
    if (!selectedClip) return;
    await applyClipEffectWithPlaybackLock(
      selectedClip.id,
      "Applying auto color",
      () => {
        addVideoEffect(selectedClip.id, "saturation");
        addVideoEffect(selectedClip.id, "contrast");
        addVideoEffect(selectedClip.id, "brightness");
        const effects = useProjectStore.getState().getVideoEffects(selectedClip.id);
        const satEffect = effects.find((e) => e.type === "saturation");
        const contEffect = effects.find((e) => e.type === "contrast");
        const brightEffect = effects.find((e) => e.type === "brightness");
        if (satEffect) {
          updateVideoEffect(selectedClip.id, satEffect.id, { value: 1.15 });
        }
        if (contEffect) {
          updateVideoEffect(selectedClip.id, contEffect.id, { value: 1.1 });
        }
        if (brightEffect) {
          updateVideoEffect(selectedClip.id, brightEffect.id, { value: 5 });
        }
      },
    );
  }, [
    addVideoEffect,
    applyClipEffectWithPlaybackLock,
    selectedClip,
    updateVideoEffect,
  ]);

  const handleGenerateSubtitles = useCallback(async () => {
    if (!selectedClip || isTranscribing) return;

    const mediaItem = getMediaItem(selectedClip.mediaId);
    if (!mediaItem) {
      console.error("[Subtitles] No media item found for clip");
      return;
    }

    setIsTranscribing(true);
    setTranscriptionProgress({
      phase: "extracting",
      progress: 0,
      message: "Preparing audio...",
    });

    try {
      const transcriptionService = initializeTranscriptionService({
        apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
        targetLanguage: targetLanguage !== "none" ? targetLanguage : undefined,
      });

      const regularClip = getClip(selectedClip.id);
      if (!regularClip) {
        throw new Error("Could not find clip data");
      }

      const subtitles = await transcriptionService.transcribeClip(
        regularClip,
        mediaItem,
        setTranscriptionProgress,
      );

      for (const subtitle of subtitles) {
        addSubtitle({
          ...subtitle,
          animationStyle: defaultAnimationStyle,
        });
      }

      setTranscriptionProgress({
        phase: "complete",
        progress: 100,
        message: `Added ${subtitles.length} subtitles`,
      });

      setTimeout(() => {
        setTranscriptionProgress(null);
        setIsTranscribing(false);
      }, 2000);
    } catch (error) {
      console.error("[Subtitles] Transcription failed:", error);
      setTranscriptionProgress({
        phase: "error",
        progress: 0,
        message:
          error instanceof Error ? error.message : "Transcription failed",
      });
      setTimeout(() => {
        setTranscriptionProgress(null);
        setIsTranscribing(false);
      }, 3000);
    }
  }, [
    selectedClip,
    isTranscribing,
    getMediaItem,
    getClip,
    addSubtitle,
    defaultAnimationStyle,
    targetLanguage,
  ]);

  const handleSRTImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const srtContent = await file.text();
        const result = await importSRT(srtContent);

        if (result.success) {
          if (result.errors.length > 0) {
            toast.warning(
              "SRT imported with warnings",
              `${result.errors.length} subtitle segment(s) were skipped.`,
            );
          } else {
            toast.success("SRT imported", "Subtitles were added to the Captions track.");
          }
        } else {
          toast.error("SRT import failed", result.errors[0] || "No valid subtitles found.");
        }
      } catch {
        toast.error("SRT import failed", "Could not read the selected subtitle file.");
      } finally {
        event.target.value = "";
      }
    },
    [importSRT],
  );

  const handleSubtitleFontUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !selectedSubtitle) return;

      const result = await registerCustomFont(file);
      if (!result.success) {
        toast.error("Font upload failed", result.error ?? "Unknown error.");
      } else {
        updateSubtitle(selectedSubtitle.id, {
          style: {
            ...(selectedSubtitle.style || {}),
            fontFamily: result.fontFamily,
          } as typeof selectedSubtitle.style,
        });
        toast.success("Custom font uploaded", `${result.fontFamily} is ready to use.`);
      }

      event.target.value = "";
    },
    [selectedSubtitle, updateSubtitle],
  );

  // Default transform
  const defaultTransform: Transform = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
    borderRadius: 0,
  };
  const transform = selectedClip?.transform || defaultTransform;

  // Derive UI state from engines
  const chromaKeyEnabled = chromaKeySettings?.enabled || false;
  const keyColor = chromaKeySettings
    ? `#${Math.round(chromaKeySettings.keyColor.r * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.g * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.b * 255)
        .toString(16)
        .padStart(2, "0")}`
    : "#00ff00";
  const tolerance = (chromaKeySettings?.tolerance || 0.3) * 100;

  /**
   * Detect clip type based on explicit clip.type first, then fall back to
   * track/media heuristics and engine-only clips (text/shape/svg/sticker).
   */
  const clipType = useMemo(() => {
    if (!selectedClip) return null;

    const MEDIA_ID_PREFIXES: [string, InspectorClipType][] = [
      ["text-", "text"],
      ["shape-", "shape"],
      ["svg-", "svg"],
      ["sticker-", "sticker"],
      ["emoji-", "sticker"],
    ];
    for (const [prefix, type] of MEDIA_ID_PREFIXES) {
      if (selectedClip.mediaId.startsWith(prefix)) return type;
    }

    if (selectedTimelineClip?.type) {
      const CLIP_TYPE_TO_INSPECTOR: Record<string, InspectorClipType> = {
        video: "video", audio: "audio", image: "image", metadata: "note",
        text: "text", shape: "shape", svg: "svg", sticker: "sticker",
      };
      return CLIP_TYPE_TO_INSPECTOR[selectedTimelineClip.type] ?? "video";
    }

    const track = project.timeline.tracks.find((t) =>
      t.clips.some((c) => c.id === selectedClip.id),
    );
    if (!track) return "video";

    const TRACK_TYPE_TO_INSPECTOR: Record<string, InspectorClipType> = {
      audio: "audio",
      image: "image",
    };
    const fromTrack = TRACK_TYPE_TO_INSPECTOR[track.type];
    if (fromTrack) return fromTrack;

    const mediaItem = project.mediaLibrary.items.find((item) => item.id === selectedClip.mediaId);
    if (mediaItem?.type === "image") return "image";

    return "video";
  }, [selectedClip, selectedTimelineClip, project.timeline.tracks, project.mediaLibrary.items]);

  /**
   * Determine which sections to show based on clip type
   */
  const showVideoEffects = clipType === "video" || clipType === "image";
  const showColorGrading = clipType === "video" || clipType === "image";
  const showAudioEffects = clipType === "video" || clipType === "audio";
  const showTextSection = clipType === "text";
  const showShapeSection = clipType === "shape";
  const showSVGSection = clipType === "svg";
  const selectedNoiseReductionEffect = selectedTimelineClip?.audioEffects?.find(
    (effect) => effect.type === "noiseReduction",
  );
  const noiseReductionSectionTitle = selectedNoiseReductionEffect
    ? selectedNoiseReductionEffect.enabled
      ? "Background Noise Removal (Active)"
      : "Background Noise Removal (Configured)"
    : "Background Noise Removal";
  const appliedEditingTemplates =
    selectedTimelineClip?.metadata?.appliedTemplates || [];
  const handleRecipeControlChange = useCallback(
    (
      applicationId: string,
      controlId: string,
      value: EditingTemplatePrimitive,
    ) => {
      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: {
          ...(current[applicationId] || {}),
          [controlId]: value,
        },
      }));
    },
    [],
  );
  const handleToggleRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template || !template.controls || template.controls.length === 0) {
        return;
      }

      setExpandedRecipeApplicationId((current) =>
        current === applicationId ? null : applicationId,
      );
      setRecipeControlValues((current) =>
        current[applicationId]
          ? current
          : {
              ...current,
              [applicationId]: mergeEditingTemplateControlValues(
                template,
                controlValues,
              ),
            },
      );
    },
    [getEditingTemplate],
  );
  const handleResetRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template) {
        return;
      }

      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: mergeEditingTemplateControlValues(template, controlValues),
      }));
    },
    [getEditingTemplate],
  );
  const handleUpdateRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      if (!selectedTimelineClip) {
        return;
      }

      const template = getEditingTemplate(templateId);
      if (!template) {
        toast.error("Recipe unavailable", "This recipe definition is no longer available.");
        return;
      }

      const nextControlValues =
        recipeControlValues[applicationId] ||
        mergeEditingTemplateControlValues(template, controlValues);
      const updated = updateEditingTemplateApplication(
        selectedTimelineClip.id,
        applicationId,
        nextControlValues,
      );

      if (!updated) {
        toast.error("Could not update recipe", "The recipe controls could not be saved for this clip.");
        return;
      }

      toast.success("Recipe updated", `${template.name} was updated on this clip.`);
    },
    [
      getEditingTemplate,
      recipeControlValues,
      selectedTimelineClip,
      updateEditingTemplateApplication,
    ],
  );
  const showVideoControls = clipType === "video" || clipType === "image";
  const showTransformControls =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  const problemCount = useProblemCount();

  const clipTabs = useMemo(() => {
    if (isSelectedMetadataClip) {
      return metadataKind === "note" ? getTabsForClipType("note") : [];
    }
    return getTabsForClipType(clipType as InspectorClipType | null);
  }, [clipType, isSelectedMetadataClip, metadataKind]);
  const clipTabIds = useMemo(() => {
    if (isSelectedMetadataClip) {
      return metadataKind === "note" ? getTabIdsForClipType("note") : [];
    }
    return getTabIdsForClipType(clipType as InspectorClipType | null);
  }, [clipType, isSelectedMetadataClip, metadataKind]);

  const inspectorActiveTab = useUIStore((s) => s.inspectorActiveTab);
  const setInspectorActiveTab = useUIStore((s) => s.setInspectorActiveTab);
  const sidebarTab = useUIStore((s) => s.sidebarTab);
  const setSidebarTab = useUIStore((s) => s.setSidebarTab);

  const activeTab: InspectorTabId =
    (clipTabIds.includes(inspectorActiveTab as InspectorTabId)
      ? (inspectorActiveTab as InspectorTabId)
      : clipTabIds[0]) ?? ("transform" as InspectorTabId);

  const modalReferenceRoute = useMemo(
    () =>
      activeModal === "reference-editor"
        ? readReferenceEditorRouteFromModalData(modalData)
        : null,
    [activeModal, modalData],
  );

  useEffect(() => {
    if (clipTabIds.length > 0 && !clipTabIds.includes(inspectorActiveTab as InspectorTabId)) {
      setInspectorActiveTab(clipTabIds[0]);
    }
  }, [clipTabIds, inspectorActiveTab, setInspectorActiveTab]);

  return (
    <div
      data-tour="inspector"
      className="w-full min-w-0 bg-bg-1 flex flex-col h-full"
    >
      {/* ── Primary sidebar tab bar ────────────────────────── */}
      <div
        role="tablist"
        aria-label="Sidebar tabs"
        className="flex items-center border-b border-border shrink-0 overflow-x-auto scrollbar-none"
      >
        {(
          [
            { id: "inspector" as const, label: "Inspector", Icon: Info },
            { id: "edit"      as const, label: "Edit",      Icon: Pencil },
            { id: "problems"  as const, label: "Problems",  Icon: AlertTriangle, badge: problemCount },
            { id: "log"       as const, label: "Log",       Icon: List },
          ]
        ).map(({ id, label, Icon, ...rest }) => {
          const badge = "badge" in rest ? rest.badge : undefined;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={sidebarTab === id}
              onClick={() => setSidebarTab(id)}
              className={[
                "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
                sidebarTab === id
                  ? "text-accent border-accent"
                  : "text-fg-3 border-transparent hover:text-fg",
              ].join(" ")}
            >
              <Icon size={12} />
              <span>{label}</span>
              {badge != null && badge > 0 && (
                <span className="ml-0.5 text-[9px] bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded-full leading-none font-medium">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Inspector pane ─────────────────────────────────── */}
      {sidebarTab === "inspector" && (
        <>
          {sceneEditorSelection ? (
            <SceneEditor {...sceneEditorSelection} />
          ) : effectiveInspectedAsset ? (
            <AssetInspectorWithTabs item={effectiveInspectedAsset} />
          ) : (
            <div className="overflow-y-auto flex-1 min-h-0 pb-3.5 custom-scrollbar">
              <EmptyState />
            </div>
          )}
        </>
      )}

      {/* ── Edit pane ──────────────────────────────────────── */}
      {sidebarTab === "edit" && (
        <>
          {selectedClip && (
            <InspectorClipHeader
              name={`${selectedClip.id.substring(0, 20)}\u2026`}
              durationSeconds={selectedClip.duration}
              typeLabel={clipType ?? "clip"}
            />
          )}
          {clipTabs.length > 0 && (
            <InspectorTabs
              tabs={clipTabs}
              activeId={activeTab}
              onSelect={(id) => setInspectorActiveTab(id)}
            />
          )}
          <div className="overflow-y-auto flex-1 min-h-0 pb-3.5 custom-scrollbar">
            {selectedClip && metadataKind !== "scene" && <ClipTimingSection clip={selectedClip} />}
            <ImportErrorsPanel errors={importErrors} />
            {referenceEditorInspectorRoute ? (
              <ReferenceEditorContent
                route={referenceEditorInspectorRoute}
                placement="inspector"
              />
            ) : isSelectedMetadataClip ? (
              metadataKind === "note" ? (
                <InspectorTabPanel tab="note" active={activeTab}>
                  <MetadataClipInspector clip={selectedTimelineClip!} kind="note" />
                </InspectorTabPanel>
              ) : (
                <MetadataClipInspector clip={selectedTimelineClip!} kind={metadataKind} />
              )
            ) : selectedClip ? (
              <>
                {selectedTimelineClip?.type === "video" && metadataKind === "scene" && (
                  <SceneMetadataInspector clip={selectedTimelineClip} />
                )}
                <InspectorTabErrorBoundary key={activeTab}>
                <InspectorTabPanel tab="effects" active={activeTab}>
                  <EffectsTab
                    clipId={clipId}
                    clipType={clipType}
                    selectedClip={selectedClip}
                    selectedTimelineClip={selectedTimelineClip}
                    showVideoControls={showVideoControls}
                    showVideoEffects={showVideoEffects}
                    showTextSection={showTextSection}
                    appliedEditingTemplates={appliedEditingTemplates}
                    getEditingTemplate={getEditingTemplate}
                    removeEditingTemplateApplication={removeEditingTemplateApplication}
                    expandedRecipeApplicationId={expandedRecipeApplicationId}
                    setExpandedRecipeApplicationId={setExpandedRecipeApplicationId}
                    recipeControlValues={recipeControlValues}
                    setRecipeControlValues={setRecipeControlValues}
                    handleRecipeControlChange={handleRecipeControlChange}
                    handleToggleRecipeControls={handleToggleRecipeControls}
                    handleResetRecipeControls={handleResetRecipeControls}
                    handleUpdateRecipeControls={handleUpdateRecipeControls}
                    chromaKeyEnabled={chromaKeyEnabled}
                    keyColor={keyColor}
                    tolerance={tolerance}
                    handleChromaKeyToggle={handleChromaKeyToggle}
                    handleKeyColorChange={handleKeyColorChange}
                    handleToleranceChange={handleToleranceChange}
                  />
                </InspectorTabPanel>
                <InspectorTabPanel tab="ai" active={activeTab}>
                  <AiTab
                    clipId={clipId}
                    clipType={clipType}
                    showVideoControls={showVideoControls}
                    showAudioEffects={showAudioEffects}
                    showVideoEffects={showVideoEffects}
                    transcriptionProgress={transcriptionProgress}
                    isTranscribing={isTranscribing}
                    targetLanguage={targetLanguage}
                    setTargetLanguage={setTargetLanguage}
                    defaultAnimationStyle={defaultAnimationStyle}
                    setDefaultAnimationStyle={setDefaultAnimationStyle}
                    handleGenerateSubtitles={handleGenerateSubtitles}
                    handleSRTImport={handleSRTImport}
                    srtInputRef={srtInputRef}
                    handleRemoveBackground={handleRemoveBackground}
                    handleEnhanceAudio={handleEnhanceAudio}
                    handleAutoColor={handleAutoColor}
                    isEnhancingAudio={isEnhancingAudio}
                    audioEnhanced={audioEnhanced}
                    isApplyingSelectedClipEffect={isApplyingSelectedClipEffect}
                  />
                </InspectorTabPanel>
                <InspectorTabPanel tab="generate" active={activeTab}>
                  <GenerateTab
                    projectId={project.id}
                    draftId={selectedClip?.id}
                    context="clip"
                    mode={generationRoute?.output ?? "image"}
                    models={generationModels}
                    modelId={generationModelId}
                    onModelChange={setGenerationModelId}
                    prompt={metadataKind === "scene" ? String(selectedTimelineClip?.metadata?.prompt ?? "") : ""}
                    timing={selectedClip ? { start: selectedClip.startTime, end: selectedClip.startTime + selectedClip.duration, source: "Timeline" } : undefined}
                    entryContextResult={generationEntryContextResult}
                    destination={generationEntryContextResult.placementPolicy}
                    placementDefault={generationEntryContextResult.defaultPlacementPolicy}
                    audioPresentation={generationAudioPresentation}
                    referenceRecovery={generationReferenceRecovery}
                    referenceLabels={generationReferenceLabels}
                    onReferenceCommand={handleGenerationReferenceCommand}
                    job={generationJob}
                    submitting={generationSubmitting}
                    onSubmit={handleGenerationSubmit}
                    onRecoveryAction={handleGenerationRecoveryAction}
                    onCancel={handleGenerationCancel}
                  />
                </InspectorTabPanel>
                <InspectorTabPanel tab="audio" active={activeTab}>
                  <AudioTab
                    clipId={clipId}
                    clipType={clipType}
                    showAudioEffects={showAudioEffects}
                    noiseReductionSectionTitle={noiseReductionSectionTitle}
                    selectedNoiseReductionEffect={selectedNoiseReductionEffect}
                  />
                </InspectorTabPanel>
                <InspectorTabPanel tab="transform" active={activeTab}>
                  <TransformTab
                    clipId={clipId}
                    clipType={clipType}
                    selectedClip={selectedClip}
                    showTransformControls={showTransformControls}
                    showVideoControls={showVideoControls}
                    transform={transform}
                    handleTransformChange={handleTransformChange}
                  />
                </InspectorTabPanel>
                <InspectorTabPanel tab="speed" active={activeTab}>
                  <SpeedTab showVideoControls={showVideoControls} selectedClip={selectedClip} />
                </InspectorTabPanel>
                <InspectorTabPanel tab="animate" active={activeTab}>
                  <AnimateTab clipId={clipId} clipType={clipType} showTextSection={showTextSection} />
                </InspectorTabPanel>
                <InspectorTabPanel tab="color" active={activeTab}>
                  <ColorTab clipId={clipId} showColorGrading={showColorGrading} />
                </InspectorTabPanel>
                <InspectorTabPanel tab="style" active={activeTab}>
                  <StyleTab
                    clipId={clipId}
                    showTextSection={showTextSection}
                    showShapeSection={showShapeSection}
                    showSVGSection={showSVGSection}
                  />
                </InspectorTabPanel>
                </InspectorTabErrorBoundary>
              </>
            ) : selectedSubtitle ? (
              <>
                <div className="mb-4 p-3 bg-primary/10 rounded-lg border border-primary/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Captions size={14} className="text-primary" />
                    <span className="text-xs font-bold text-primary">Subtitle</span>
                  </div>
                  <p className="text-[10px] text-text-muted">
                    {selectedSubtitle.startTime.toFixed(2)}s -{" "}
                    {selectedSubtitle.endTime.toFixed(2)}s
                  </p>
                </div>
                <Section title="Text Content">
                  <div className="space-y-3">
                    <textarea value={selectedSubtitle.text}
                      onChange={(e) => updateSubtitle(selectedSubtitle.id, { text: e.target.value })}
                      className="w-full h-24 px-3 py-2 bg-background-tertiary border border-border rounded-lg text-xs text-text-primary resize-none focus:outline-none focus:border-primary"
                      placeholder="Enter subtitle text..." />
                  </div>
                </Section>
                <Section title="Timing">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">Start Time</span>
                      <Input type="number" step="0.1" value={selectedSubtitle.startTime.toFixed(2)}
                        onChange={(e) => updateSubtitle(selectedSubtitle.id, { startTime: parseFloat(e.target.value) || 0 })}
                        className="w-20 h-7 text-[10px] bg-background-tertiary border-border text-text-primary text-right" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">End Time</span>
                      <Input type="number" step="0.1" value={selectedSubtitle.endTime.toFixed(2)}
                        onChange={(e) => updateSubtitle(selectedSubtitle.id, { endTime: parseFloat(e.target.value) || 0 })}
                        className="w-20 h-7 text-[10px] bg-background-tertiary border-border text-text-primary text-right" />
                    </div>
                  </div>
                </Section>
                <Section title="Position">
                  <div className="grid grid-cols-3 gap-2">
                    {(["top", "center", "bottom"] as const).map((pos) => (
                      <button key={pos}
                        onClick={() => updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), position: pos } as typeof selectedSubtitle.style })}
                        className={`py-1.5 rounded text-[10px] capitalize transition-colors ${(selectedSubtitle.style?.position || "bottom") === pos ? "bg-primary text-white" : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"}`}
                      >{pos}</button>
                    ))}
                  </div>
                </Section>
                <Section title="Animation">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">Style</span>
                      <Select value={selectedSubtitle.animationStyle || "none"}
                        onValueChange={(v) => updateSubtitle(selectedSubtitle.id, { animationStyle: v as CaptionAnimationStyle })}>
                        <SelectTrigger className="w-auto min-w-[100px] bg-background-tertiary border-border text-text-primary text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-background-secondary border-border">
                          {CAPTION_ANIMATION_STYLES.map((style) => (
                            <SelectItem key={style} value={style}>{getAnimationStyleDisplayName(style)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[9px] text-text-muted">
                      {selectedSubtitle.animationStyle === "karaoke" && "Words fill with color as they\u2019re spoken"}
                      {selectedSubtitle.animationStyle === "word-highlight" && "Current word is highlighted and scaled"}
                      {selectedSubtitle.animationStyle === "word-by-word" && "Shows one word at a time"}
                      {selectedSubtitle.animationStyle === "bounce" && "Words bounce in as they appear"}
                      {selectedSubtitle.animationStyle === "typewriter" && "Words appear progressively like typing"}
                      {(!selectedSubtitle.animationStyle || selectedSubtitle.animationStyle === "none") && "Static text, no animation"}
                    </p>
                    {selectedSubtitle.animationStyle && selectedSubtitle.animationStyle !== "none" && !selectedSubtitle.words?.length && (
                      <p className="text-[9px] text-amber-400 bg-amber-400/10 p-2 rounded">
                        \u26a0\ufe0f No word-level timing data. Re-generate captions to enable animation.
                      </p>
                    )}
                    {selectedSubtitle.animationStyle && selectedSubtitle.animationStyle !== "none" &&
                      selectedSubtitle.animationStyle !== "typewriter" && selectedSubtitle.animationStyle !== "word-by-word" && (
                      <div className="pt-2 border-t border-border space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-text-secondary">Highlight Color</span>
                          <div className="flex items-center gap-2">
                            <input type="color" value={selectedSubtitle.style?.highlightColor || "#ffff00"}
                              onChange={(e) => updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), highlightColor: e.target.value } as typeof selectedSubtitle.style })}
                              className="w-6 h-6 rounded border border-border cursor-pointer" />
                            <span className="text-[9px] font-mono text-text-muted uppercase">{selectedSubtitle.style?.highlightColor || "#ffff00"}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-6 gap-1">
                          {["#ffff00","#00ff00","#ff6b6b","#4ecdc4","#ff9f43","#a55eea"].map((color) => (
                            <button key={color}
                              onClick={() => updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), highlightColor: color } as typeof selectedSubtitle.style })}
                              className={`w-6 h-6 rounded border-2 transition-transform hover:scale-110 ${(selectedSubtitle.style?.highlightColor || "#ffff00") === color ? "border-white" : "border-transparent"}`}
                              style={{ backgroundColor: color }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Section>
                <Section title="Font">
                  <div className="space-y-3">
                    <input ref={subtitleFontInputRef} type="file" accept={FONT_FILE_ACCEPT} onChange={handleSubtitleFontUpload} className="hidden" />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">Font Family</span>
                      <Select value={selectedSubtitle.style?.fontFamily || "Inter"}
                        onValueChange={(v) => updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), fontFamily: v } as typeof selectedSubtitle.style })}>
                        <SelectTrigger className="max-w-[120px] bg-background-tertiary border-border text-text-primary text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-background-secondary border-border max-h-60">
                          {Object.entries(FONT_CATEGORIES).map(([category, fonts]) => (
                            <SelectGroup key={category}>
                              <SelectLabel className="text-text-muted text-[10px] font-medium">{category}</SelectLabel>
                              {fonts.map((font) => (<SelectItem key={font} value={font} style={{ fontFamily: font }}>{font}</SelectItem>))}
                            </SelectGroup>
                          ))}
                          {customFonts.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="text-text-muted text-[10px] font-medium">Custom Uploads</SelectLabel>
                              {customFonts.map((font) => (<SelectItem key={font} value={font} style={{ fontFamily: font }}>{font}</SelectItem>))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <button onClick={() => subtitleFontInputRef.current?.click()}
                      className="w-full py-1.5 px-2 bg-background-secondary border border-border rounded text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center gap-1.5">
                      <Upload size={11} /> Upload Custom Font
                    </button>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">Font Size</span>
                      <Input type="number" min={12} max={72} value={selectedSubtitle.style?.fontSize || 24}
                        onChange={(e) => updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), fontSize: parseInt(e.target.value) || 24 } as typeof selectedSubtitle.style })}
                        className="w-16 h-7 text-[10px] bg-background-tertiary border-border text-text-primary text-right" />
                    </div>
                  </div>
                </Section>
                <Section title="Colors">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">Text Color</span>
                      <div className="flex items-center gap-2">
                        <input type="color" value={selectedSubtitle.style?.color || "#ffffff"}
                          onChange={(e) => updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), color: e.target.value } as typeof selectedSubtitle.style })}
                          className="w-6 h-6 rounded border border-border cursor-pointer" />
                        <span className="text-[10px] font-mono text-text-muted uppercase">{selectedSubtitle.style?.color || "#ffffff"}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">Background</span>
                      <div className="flex items-center gap-2">
                        <input type="color"
                          value={selectedSubtitle.style?.backgroundColor?.replace(/rgba?\([^)]+\)/, "#000000") || "#000000"}
                          onChange={(e) => {
                            const hex = e.target.value;
                            updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), backgroundColor: `rgba(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)}, 0.7)` } as typeof selectedSubtitle.style });
                          }}
                          className="w-6 h-6 rounded border border-border cursor-pointer" />
                        <Select
                          value={selectedSubtitle.style?.backgroundColor?.includes("0.7") ? "0.7" : selectedSubtitle.style?.backgroundColor?.includes("0.5") ? "0.5" : "1"}
                          onValueChange={(v) => {
                            const newBg = (selectedSubtitle.style?.backgroundColor || "rgba(0, 0, 0, 0.7)").replace(/[\d.]+\)$/, `${v})`);
                            updateSubtitle(selectedSubtitle.id, { style: { ...(selectedSubtitle.style || {}), backgroundColor: newBg } as typeof selectedSubtitle.style });
                          }}>
                          <SelectTrigger className="w-auto min-w-[50px] bg-background-tertiary border-border text-text-primary text-[9px] h-6"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-background-secondary border-border">
                            <SelectItem value="0">None</SelectItem>
                            <SelectItem value="0.5">50%</SelectItem>
                            <SelectItem value="0.7">70%</SelectItem>
                            <SelectItem value="1">100%</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </Section>
                <div className="pt-4 border-t border-border">
                  <button
                    onClick={() => { const { removeSubtitle } = useProjectStore.getState(); removeSubtitle(selectedSubtitle.id); }}
                    className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg text-[10px] transition-all"
                  >Delete Subtitle</button>
                </div>
              </>
            ) : (
              <EmptyState />
            )}
          </div>
        </>
      )}

      {/* ── Problems pane ─────────────────────────────────── */}
      {sidebarTab === "problems" && (
        <div className="overflow-y-auto flex-1 min-h-0 pb-3.5 custom-scrollbar">
          <ProblemsPanel />
        </div>
      )}

      {/* ── Log pane ──────────────────────────────────────── */}
      {sidebarTab === "log" && (
        <div className="overflow-y-auto flex-1 min-h-0 pb-3.5 custom-scrollbar">
          <LogPanel />
        </div>
      )}
      <ReferenceEditorModal
        open={modalReferenceRoute !== null}
        route={modalReferenceRoute}
        onClose={closeModal}
      />
    </div>
  );
};

export default InspectorPanel;
