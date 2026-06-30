import type { MediaItem, Track } from "@openreel/core";
import {
  buildImportPlan,
  type AudioClipSpec,
  type CharacterTrackSpec,
  type MetadataClipSpec,
  type NeuralFramesImportPlan,
  type NeuralFramesImportResult,
  type NeuralFramesMediaSpec,
  type NeuralFramesStoryboard,
  type SceneClipSpec,
} from "@openreel/music-video-domain";
import { v4 as uuidv4 } from "uuid";
import { addTimelineClip, type TimelineClipStore } from "./timeline/timeline-clips";
import { createMetadataMedia, type MetadataKind } from "./timeline/metadata-media";
import { useProjectStore, type ProjectState } from "../../stores/project-store";
import { useMusicVideoStore } from "../../stores/music-video-store";
import { useUIStore } from "../../stores/ui-store";
import type { ImportError } from "../../stores/ui-store";
import { toast, useNotificationStore } from "../../stores/notification-store";

class HandledImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandledImportError";
  }
}

interface ImporterResponseData extends Partial<NeuralFramesImportResult> {
  error?: string;
  detail?: string;
}

async function readImporterResponse(response: Response): Promise<ImporterResponseData> {
  const responseReaders = response as Response & {
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
  };

  if (typeof responseReaders.text === "function") {
    const text = await responseReaders.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as ImporterResponseData;
    } catch {
      return { error: text };
    }
  }

  if (typeof responseReaders.json === "function") {
    return (await responseReaders.json()) as ImporterResponseData;
  }

  return {};
}

function importerErrorMessage(data: ImporterResponseData, response: Response): string {
  return data.error ?? data.detail ?? `Importer returned HTTP ${response.status}`;
}


type ProjectStore = ProjectState;

function queueReplacement(
  url: string,
  mediaItem: MediaItem,
  replacePlaceholderMedia: ProjectStore["replacePlaceholderMedia"],
  label: string,
): void {
  void fetch(url)
    .then((response) => response.blob())
    .then((blob) => replacePlaceholderMedia(mediaItem.id, blob, mediaItem.name))
    .catch((error) => console.warn(`[NeuralFramesImport] ${label}:`, error));
}

async function findOrCreateTrack(trackType: Track["type"], trackName: string): Promise<string | null> {
  const store = useProjectStore.getState();
  const existing = store.project.timeline.tracks.find((track) => track.type === trackType);
  if (existing) return existing.id;

  const beforeIds = new Set(store.project.timeline.tracks.map((track) => track.id));
  const result = await store.addTrack(trackType);
  if (!result.success) return null;

  const created = useProjectStore.getState().project.timeline.tracks.find(
    (track) => track.type === trackType && !beforeIds.has(track.id),
  );
  if (created && created.name !== trackName) {
    useProjectStore.getState().renameTrack(created.id, trackName);
  }
  return created?.id ?? null;
}

async function placeSceneClip(
  spec: SceneClipSpec,
  store: ProjectStore,
  addPlaceholderMedia: ProjectStore["addPlaceholderMedia"],
  replacePlaceholderMedia: ProjectStore["replacePlaceholderMedia"],
): Promise<{ success: true } | { success: false; failure: string }> {
  const labelValue = spec.clipMetadata["label"];
  const label = typeof labelValue === "string" && labelValue.trim() ? labelValue : spec.trackName;
  const trackId = await findOrCreateTrack("video", spec.trackName);
  if (!trackId) {
    return { success: false, failure: `${label} (no_track)` };
  }

  const mediaSpec: NeuralFramesMediaSpec = spec.mediaSpec;
  const mediaItem: MediaItem = mediaSpec;
  addPlaceholderMedia(mediaItem);
  if (spec.fetchUrl) {
    queueReplacement(spec.fetchUrl, mediaItem, replacePlaceholderMedia, "scene asset");
  }

  const clipResult = await store.addClip(trackId, mediaItem.id, spec.startSeconds, {
    duration: spec.duration,
    metadata: spec.clipMetadata,
  });
  if (!clipResult.success) {
    return { success: false, failure: `${label} (${clipResult.error?.code ?? "unknown"})` };
  }

  return { success: true };
}

async function placeMetadataClip(
  spec: MetadataClipSpec,
  store: TimelineClipStore,
): Promise<{ success: true } | { success: false; failure: string }> {
  const clipResult = await addTimelineClip(store, {
    trackName: spec.trackName,
    kind: spec.kind as MetadataKind,
    label: spec.label,
    color: spec.color,
    startTime: spec.startSeconds,
    duration: spec.duration,
    metadata: spec.metadata,
    trackType: spec.trackType,
    thumbnailUrl: spec.thumbnailUrl,
    description: spec.description,
    group: spec.kind === "style" ? "Reference Images" : undefined,
    tags: spec.kind === "style" ? ["reference", "style", "neuralframes"] : undefined,
    generationMeta: spec.generationMeta,
  });
  if (!clipResult.success) {
    return { success: false, failure: `${spec.label} (${clipResult.error?.code ?? "unknown"})` };
  }

  return { success: true };
}

async function placeAudioClip(
  spec: AudioClipSpec,
  store: ProjectStore,
  addPlaceholderMedia: ProjectStore["addPlaceholderMedia"],
  replacePlaceholderMedia: ProjectStore["replacePlaceholderMedia"],
): Promise<boolean> {
  const mediaSpec: NeuralFramesMediaSpec = spec.mediaSpec;
  const mediaItem: MediaItem = mediaSpec;
  addPlaceholderMedia(mediaItem);
  if (mediaItem.originalUrl) {
    queueReplacement(mediaItem.originalUrl, mediaItem, replacePlaceholderMedia, "audio asset");
  }

  const audioTrackId = await findOrCreateTrack("audio", "Audio");
  if (!audioTrackId) return false;

  const clipResult = await store.addClip(audioTrackId, mediaItem.id, 0, {
    duration: spec.duration,
    metadata: spec.clipMetadata,
  });
  return clipResult.success;
}

type CharacterTrackResult =
  | { success: true; clipCount: number }
  | { success: false; failure: string };

type NamedTrackResult =
  | { success: true; trackId: string }
  | { success: false };

/**
 * Places a character track: one media item created once, then one clip per scene
 * the character appears in. All clips share the same media item ID.
 */
async function placeCharacterTrack(
  spec: CharacterTrackSpec,
  store: TimelineClipStore,
  replacePlaceholderMedia: ProjectStore["replacePlaceholderMedia"],
): Promise<CharacterTrackResult> {
  // 1. Create the character media item once
  const metaMedia = createMetadataMedia({
    kind: "character",
    label: spec.trackName,
    color: "#a855f7",
    duration: 0,
    thumbnailUrl: spec.mediaSpec.thumbnailUrl ?? spec.thumbnailUrl,
    description: spec.mediaSpec.description,
    group: spec.mediaSpec.group,
    tags: spec.mediaSpec.tags,
    generationMeta: spec.mediaSpec.generationMeta,
  });

  const mediaResult = await store.addGeneratedMedia(metaMedia.item, metaMedia.blob);
  if (!mediaResult.success) {
    return { success: false, failure: `${spec.trackName} (media: ${mediaResult.error?.code ?? "unknown"})` };
  }

  // Queue thumbnail replacement
  if (spec.thumbnailUrl) {
    queueReplacement(spec.thumbnailUrl, metaMedia.item, replacePlaceholderMedia, `character ${spec.trackName}`);
  }

  // 2. Find or create the character's own track (named after the character)
  const trackResult = await findOrCreateNamedTrack(store, spec.trackName, "metadata");
  if (!trackResult.success) {
    return { success: false, failure: `${spec.trackName} (track)` };
  }

  // 3. Add one clip per scene
  let clipsAdded = 0;
  for (const clip of spec.clips) {
    const clipResult = await store.addClip(
      trackResult.trackId,
      metaMedia.item.id,
      clip.startSeconds,
      {
        duration: clip.duration,
        metadata: {
          ...clip.metadata,
          kind: "character",
          label: spec.trackName,
          color: "#a855f7",
        },
      },
    );
    if (clipResult.success) clipsAdded++;
  }

  return { success: true, clipCount: clipsAdded };
}

/** Find or create a named track of the given type using the TimelineClipStore interface. */
async function findOrCreateNamedTrack(
  store: TimelineClipStore,
  trackName: string,
  trackType: Track["type"],
): Promise<NamedTrackResult> {
  const existing = store.project.timeline.tracks.find(
    (t) => t.type === trackType && t.name === trackName,
  );
  if (existing) return { success: true, trackId: existing.id };

  const beforeIds = new Set(store.project.timeline.tracks.map((t) => t.id));
  const addResult = await store.addTrack(trackType);
  if (!addResult.success) return { success: false };

  const created = store.project.timeline.tracks.find(
    (t) => t.type === trackType && !beforeIds.has(t.id),
  );
  if (!created) return { success: false };

  store.renameTrack(created.id, trackName);
  return { success: true, trackId: created.id };
}

export async function importNeuralFramesFile(
  file: File,
  opts: { orchestratorUrl: string; openreelProjectId: string },
): Promise<void> {
  const progressToastIds: string[] = [];
  const showProgress = (message: string) => {
    progressToastIds.push(
      useNotificationStore.getState().addNotification({
        type: "info",
        title: "Importing…",
        message,
        duration: 0,
      }),
    );
  };
  const clearProgress = () => {
    const store = useNotificationStore.getState();
    for (const id of progressToastIds) {
      store.removeNotification(id);
    }
    progressToastIds.length = 0;
  };
  const failHandled = (message: string): never => {
    clearProgress();
    toast.error("Import failed", message);
    throw new HandledImportError(message);
  };

  showProgress(`Parsing ${file.name}…`);

  let raw!: NeuralFramesStoryboard;
  try {
    raw = JSON.parse(await file.text()) as NeuralFramesStoryboard;
  } catch {
    failHandled("Not valid JSON.");
  }

  let result!: NeuralFramesImportResult;
  try {
    showProgress("Importing scenes…");
    const response = await fetch(`${opts.orchestratorUrl}/api/import/neuralframes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    });
    const data = await readImporterResponse(response);
    if (!response.ok || data.error) {
      failHandled(importerErrorMessage(data, response));
    }
    result = data as NeuralFramesImportResult;
  } catch (error) {
    if (error instanceof HandledImportError) throw error;
    clearProgress();
    const message = error instanceof Error ? error.message : "Unexpected error";
    toast.error("Import failed", message);
    throw error instanceof Error ? error : new Error(message);
  }

  try {
    const store = useProjectStore.getState();
    useMusicVideoStore.getState().applyNeuralFramesImport(opts.openreelProjectId, result);
    await useProjectStore.getState().renameProject(result.title);

    const plan: NeuralFramesImportPlan = buildImportPlan(result, raw);
    const { addPlaceholderMedia, replacePlaceholderMedia } = store;
    const storeIface: TimelineClipStore = {
      get project() {
        return useProjectStore.getState().project;
      },
      addTrack: store.addTrack,
      renameTrack: store.renameTrack,
      addGeneratedMedia: store.addGeneratedMedia,
      addClip: store.addClip,
    };

    let trackBlocksSucceeded = 0;
    let trackBlocksFailed = 0;
    const failedBlocks: string[] = [];

    for (const spec of plan.sceneClips) {
      showProgress(`Creating track "${spec.trackName}"…`);
      const placement = await placeSceneClip(spec, store, addPlaceholderMedia, replacePlaceholderMedia);
      if (placement.success) {
        trackBlocksSucceeded++;
      } else {
        trackBlocksFailed++;
        failedBlocks.push(placement.failure);
      }
    }

    // Character tracks: one media item per character, clips for each scene it appears in
    for (const spec of plan.characterTracks) {
      showProgress(`Creating character "${spec.trackName}"…`);
      const placement = await placeCharacterTrack(spec, storeIface, replacePlaceholderMedia);
      if (placement.success) {
        trackBlocksSucceeded += placement.clipCount;
      } else {
        trackBlocksFailed++;
        failedBlocks.push(placement.failure);
      }
    }

    for (const spec of plan.metadataClips) {
      showProgress(`Creating track "${spec.trackName}"…`);
      const placement = await placeMetadataClip(spec, storeIface);
      if (placement.success) {
        trackBlocksSucceeded++;
      } else {
        trackBlocksFailed++;
        failedBlocks.push(placement.failure);
      }
    }

    const errors: ImportError[] =
      trackBlocksFailed > 0
        ? failedBlocks.map((entry) => ({
            id: `nf-block-${uuidv4().slice(0, 8)}`,
            kind: "block_failed",
            message: entry,
            label: entry.split(" (")[0] ?? entry,
          }))
        : [];

    if (trackBlocksFailed > 0 && trackBlocksSucceeded === 0) {
      useUIStore.getState().addImportErrors(errors);
      failHandled(
        `Failed to create any timeline tracks: ${failedBlocks.slice(0, 3).join(", ")}${
          failedBlocks.length > 3 ? ` and ${failedBlocks.length - 3} more` : ""
        }`,
      );
    }

    let imageCount = 0;
    for (const spec of plan.orphanedAssets) {
      showProgress(`Adding image ${imageCount + 1} / ${plan.orphanedAssets.length}…`);
      const mediaSpec: NeuralFramesMediaSpec = spec;
      const mediaItem: MediaItem = mediaSpec;
      addPlaceholderMedia(mediaItem);
      if (mediaItem.thumbnailUrl) {
        queueReplacement(mediaItem.thumbnailUrl, mediaItem, replacePlaceholderMedia, "orphaned asset");
      }
      imageCount++;
    }

    for (const spec of plan.referenceImages) {
      const mediaSpec: NeuralFramesMediaSpec = spec;
      const mediaItem: MediaItem = mediaSpec;
      addPlaceholderMedia(mediaItem);
      if (mediaItem.thumbnailUrl) {
        queueReplacement(mediaItem.thumbnailUrl, mediaItem, replacePlaceholderMedia, "reference image");
      }
      imageCount++;
    }

    let audioCount = 0;
    if (plan.audioClip) {
      showProgress("Adding audio…");
      if (await placeAudioClip(plan.audioClip, store, addPlaceholderMedia, replacePlaceholderMedia)) {
        audioCount = 1;
      }
    }

    if (trackBlocksFailed > 0) {
      useUIStore.getState().addImportErrors(errors);
    }

    clearProgress();
    const nonCharacterTrackNames = new Set(plan.metadataClips.map((s) => s.trackName));
    const trackCount =
      (plan.sceneClips.length > 0 ? 1 : 0) +
      plan.characterTracks.length +
      nonCharacterTrackNames.size +
      audioCount;
    const warning = trackBlocksFailed > 0 ? ` (${trackBlocksFailed} block${trackBlocksFailed === 1 ? "" : "s"} failed)` : "";
    toast.success(
      "Import complete",
      `${trackBlocksSucceeded} blocks across ${trackCount} track${trackCount !== 1 ? "s" : ""} · ${imageCount} images · ${audioCount} audio in media library${warning}`,
      10000,
    );
  } catch (error) {
    if (error instanceof HandledImportError) throw error;
    console.error("[NeuralFramesImport] Unexpected error during import:", error);
    clearProgress();
    toast.error("Import failed", error instanceof Error ? error.message : "Unexpected error");
    throw error instanceof Error ? error : new Error("Unexpected error");
  }
}
