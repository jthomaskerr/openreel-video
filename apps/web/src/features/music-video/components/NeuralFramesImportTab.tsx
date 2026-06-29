import React, { useCallback, useImperativeHandle, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../../../stores/project-store";
import { addTimelineClip, type TimelineClipStore } from "../timeline/timeline-clips";
import type { GeneratedAsset, MetadataBlock, NeuralFramesImportResult, NeuralFramesStoryboard } from "@openreel/music-video-domain";
import { normalizeImageJob } from "@openreel/music-video-domain";
import type { MediaItem, Track } from "@openreel/core";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import { useUIStore } from "../../../stores/ui-store";
import type { ImportError } from "../../../stores/ui-store";
import { toast, useNotificationStore } from "../../../stores/notification-store";

/** Map NeuralFrames MetadataBlockKind → MetadataKind for timeline clips. */
function blockKindToMetadataKind(kind: string): string {
  if (kind === "section") return "scene";
  if (kind === "continuity_note") return "character";
  if (kind === "visual_motif") return "style";
  return kind;
}


function pickString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function pickNumber(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function getAudioFileName(raw: NeuralFramesStoryboard): string | null {
  const audio = (raw as unknown as Record<string, unknown>)["audio"];
  if (!audio || typeof audio !== "object") return null;
  return pickString(audio, ["file_name", "filename", "fileName", "audio_url", "audio_file", "name", "localPath", "path", "url"]);
}

function extensionFromPath(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  try {
    const pathname = path.startsWith("http") ? new URL(path).pathname : path;
    const ext = pathname.match(/\.[a-z0-9]+$/i)?.[0];
    return ext ?? fallback;
  } catch {
    return fallback;
  }
}

function displayFileName(path: string | undefined): string {
  if (!path) return "";
  return path.split(/[\\/]/).pop() ?? path;
}

function metadataForBlock(block: MetadataBlock, result: NeuralFramesImportResult, raw: NeuralFramesStoryboard) {
  const resolveUrl = (url: string) => result.remoteUrlMap?.[url] ?? url;
  const base: Record<string, unknown> = {
    text: block.text,
    importSource: block.importSource,
    importId: block.importId,
    source: block.source,
    linkedShotIds: block.linkedShotIds,
    linkedGeneratedAssetIds: block.linkedGeneratedAssetIds,
  };

  if (block.kind === "section") {
    const shot = result.shots.find((candidate) => block.linkedShotIds.includes(candidate.id));
    return {
      ...base,
      prompt: block.text,
      shotId: shot?.id,
      shotIndex: shot?.index,
      generatedAssetIds: shot?.generatedAssetIds ?? block.linkedGeneratedAssetIds,
    };
  }

  if (block.kind === "continuity_note") {
    const characters = raw.storyboard_props?.characters ?? [];
    const character = characters.find((candidate) => candidate.id === block.importId);
    const imageJob = normalizeImageJob(character?.image_job);
    const urls = (imageJob?.assets.map((asset) => asset.url) ?? []).map(resolveUrl);
    return {
      ...base,
      name: character?.name ?? block.label,
      description: block.text,
      thumbnailUrl: block.thumbnailUrl ?? urls[0],
      referenceImageUrls: urls,
    };
  }

  if (block.kind === "visual_motif") {
    const loras = raw.storyboard_props?.loras ?? [];
    const lora = loras.find((candidate) => candidate.id === block.importId);
    return {
      ...base,
      name: lora?.name ?? block.label,
      trainingImageUrls: (lora?.training_image_urls ?? []).map(resolveUrl),
      loraId: lora?.id,
    };
  }

  return base;
}

function createGeneratedMediaItem(result: NeuralFramesImportResult, asset: GeneratedAsset): MediaItem {
  const ext = extensionFromPath(asset.outputPath, asset.mediaType === "video" ? ".mp4" : ".png");
  const title = asset.label || asset.prompt.slice(0, 60) || result.title;
  const fileName = `${title}${title.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext}`;
  const hasOutput = !!asset.outputPath;
  const isResolved = asset.status === "realized" && hasOutput;

  return {
    id: asset.id,
    name: fileName,
    title,
    description: asset.prompt || undefined,
    tags: ["generated", asset.provider, asset.status].filter(Boolean),
    group: "Generated",
    type: asset.mediaType === "video" ? "video" : "image",
    fileHandle: null,
    blob: null,
    metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
    thumbnailUrl: asset.outputPath ?? null,
    waveformData: null,
    isPlaceholder: !hasOutput,
    isPending: !isResolved && asset.status !== "failed" && asset.status !== "cancelled",
    kieaiError: asset.status === "failed" || asset.status === "cancelled",
    assetGroupId: asset.id,
    generationMeta: {
      provider: asset.provider,
      model: asset.model,
      prompt: asset.prompt,
      jobId: asset.id,
      status: asset.status,
      inputs: {
        sourceAssets: asset.sourceAssets,
        sourceMetadataBlockIds: asset.sourceMetadataBlockIds,
        validation: asset.validation,
      },
    },
    sourceFile: asset.outputPath
      ? { name: displayFileName(asset.outputPath), size: 0, lastModified: 0 }
      : { name: fileName, size: 0, lastModified: 0 },
  };
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
    store.renameTrack(created.id, trackName);
  }
  return created?.id ?? null;
}

function blockDurationSeconds(block: MetadataBlock): number {
  const end = block.endSeconds ?? block.startSeconds;
  const rawDuration = end - block.startSeconds;
  return Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : 0;
}

export interface NeuralFramesImportTabHandle {
  openFilePicker: () => void;
}

interface Props {
  openreelProjectId: string;
  orchestratorUrl: string;
  onImported?: () => void;
}

export const NeuralFramesImportTab = React.forwardRef<NeuralFramesImportTabHandle, Props>(
  ({ openreelProjectId, orchestratorUrl, onImported }, ref) => {
    const { addTrack, addClip, addPlaceholderMedia, replacePlaceholderMedia, addGeneratedMedia, renameTrack } = useProjectStore();

    const inputRef = useRef<HTMLInputElement>(null);
    const progressToastId = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      openFilePicker: () => {
        inputRef.current?.click();
      },
    }));

    const showProgress = useCallback((message: string) => {
      if (progressToastId.current) {
        useNotificationStore.getState().removeNotification(progressToastId.current);
      }
      progressToastId.current = toast.info("Importing…", message);
    }, []);

    const clearProgress = useCallback(() => {
      if (progressToastId.current) {
        useNotificationStore.getState().removeNotification(progressToastId.current);
        progressToastId.current = null;
      }
    }, []);

    const handleFile = useCallback(async (file: File) => {
      showProgress(`Parsing ${file.name}…`);

      let raw: NeuralFramesStoryboard;
      try {
        raw = JSON.parse(await file.text()) as NeuralFramesStoryboard;
      } catch {
        clearProgress();
        toast.error("Import failed", "Not valid JSON.");
        return;
      }

      let result: NeuralFramesImportResult;
      try {
        showProgress("Importing scenes…");
        const res = await fetch(`${orchestratorUrl}/api/import/neuralframes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(raw),
        });
        const data = (await res.json()) as NeuralFramesImportResult & { error?: string };
        if (!res.ok || data.error) {
          clearProgress();
          toast.error("Import failed", data.error ?? "Import failed");
          return;
        }
        result = data;
      } catch (e) {
        clearProgress();
        toast.error("Import failed", (e as Error).message);
        return;
      }

      try {
        const musicVideoStore = useMusicVideoStore.getState();
        if (!musicVideoStore.getProject(openreelProjectId)) {
          musicVideoStore.createProject(openreelProjectId, result.title);
        }
        musicVideoStore.applyNeuralFramesImport(openreelProjectId, result);

        // Name the main OpenReel project after the imported storyboard
        useProjectStore.getState().renameProject(result.title);

        // ── Each MetadataTrack → real metadata clips via addTimelineClip ──
        const storeIface: TimelineClipStore = {
          get project() { return useProjectStore.getState().project; },
          addTrack,
          renameTrack,
          addGeneratedMedia,
          addClip,
        };

        let trackBlocksSucceeded = 0;
        let trackBlocksFailed = 0;
        const failedBlocks: string[] = [];

        for (const track of result.metadataTracks) {
          showProgress(`Creating track "${track.label}"…`);
          const isSceneTrack = track.kind === "sections";
          for (const block of track.blocks) {
            const duration = blockDurationSeconds(block);
            const clipResult = await addTimelineClip(storeIface, {
              trackName: track.label,
              kind: blockKindToMetadataKind(block.kind),
              label: block.label,
              color: block.color ?? "#94a3b8",
              startTime: block.startSeconds,
              duration,
              metadata: metadataForBlock(block, result, raw),
              trackType: isSceneTrack ? "video" : "metadata",
            });
            if (clipResult.success) {
              trackBlocksSucceeded++;
            } else {
              trackBlocksFailed++;
              failedBlocks.push(`${block.label} (${clipResult.error?.code ?? "unknown"})`);
            }
          }
        }

        if (trackBlocksFailed > 0 && trackBlocksSucceeded === 0) {
          clearProgress();
          toast.error("Import failed", `Failed to create any timeline tracks: ${failedBlocks.slice(0, 3).join(", ")}${failedBlocks.length > 3 ? ` and ${failedBlocks.length - 3} more` : ""}`);
          return;
        }

        // ── Scene images → media library, flagged as generated ───────────────────
        let imageCount = 0;
        for (let i = 0; i < result.generatedAssets.length; i++) {
          const asset = result.generatedAssets[i];

          showProgress(`Adding image ${i + 1} / ${result.generatedAssets.length}…`);

          const item = createGeneratedMediaItem(result, asset);
          addPlaceholderMedia(item);

          if (asset.outputPath) {
            fetch(asset.outputPath)
              .then((r) => r.blob())
              .then((blob) => replacePlaceholderMedia(item.id, blob, item.name))
              .catch((err) => console.warn(`[NF] image ${i + 1}:`, err));
          }

          imageCount++;
        }

        // ── Character & LoRA reference images → placeholder media ────────────────
        const resolveUrl = (url: string) => result.remoteUrlMap?.[url] ?? url;
        const characters = Array.isArray(raw.storyboard_props?.characters) ? raw.storyboard_props.characters : [];
        for (const character of characters) {
          const imageJob = normalizeImageJob(character.image_job);
          const urls = imageJob?.assets.map((asset) => asset.url) ?? [];
          for (const url of urls) {
            const localUrl = resolveUrl(url);
            const refName = displayFileName(localUrl);
            const refId = uuidv4();
            addPlaceholderMedia({
              id: refId,
              name: refName,
              title: `Reference: ${character.name}`,
              type: "image",
              fileHandle: null,
              blob: null,
              metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
              thumbnailUrl: localUrl,
              waveformData: null,
              isPlaceholder: false,
              tags: ["reference", "character", "neuralframes"],
              group: "Reference Images",
              generationMeta: { provider: "neuralframes", model: "nf", prompt: `Character reference: ${character.name}`, jobId: refId, status: "realized" },
              sourceFile: { name: refName, size: 0, lastModified: 0 },
            });
            imageCount++;
          }
        }
        const loras = Array.isArray(raw.storyboard_props?.loras) ? raw.storyboard_props.loras : [];
        for (const lora of loras) {
          const urls = lora.training_image_urls ?? [];
          for (const url of urls) {
            const localUrl = resolveUrl(url);
            const refName = displayFileName(localUrl);
            const refId = uuidv4();
            addPlaceholderMedia({
              id: refId,
              name: refName,
              title: `Training: ${lora.name}`,
              type: "image",
              fileHandle: null,
              blob: null,
              metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
              thumbnailUrl: localUrl,
              waveformData: null,
              isPlaceholder: false,
              tags: ["training", "lora", "neuralframes"],
              group: "Reference Images",
              generationMeta: { provider: "neuralframes", model: "nf", prompt: `LoRA training: ${lora.name}`, jobId: refId, status: "realized" },
              sourceFile: { name: refName, size: 0, lastModified: 0 },
            });
            imageCount++;
          }
        }
        // ── Audio reference → relinkable placeholder clip ────────────────────────
        let audioCount = 0;
        const hasAudioMeta = raw.audio != null;
        if (hasAudioMeta) {
          const audioDuration = raw.audio?.duration ?? 0;
          const audioName = getAudioFileName(raw);
          const audioTitle = result.title || "audio";
          const sourceName = audioName ? displayFileName(audioName) : `${audioTitle}.audio`;
          const audioMediaId = `audio-${uuidv4()}`;
          const audioItem: MediaItem = {
            id: audioMediaId,
            name: sourceName,
            type: "audio",
            fileHandle: null,
            blob: null,
            metadata: {
              duration: audioDuration,
              width: 0,
              height: 0,
              frameRate: 0,
              codec: "",
              sampleRate: 0,
              channels: 0,
              fileSize: pickNumber(raw.audio, ["size", "fileSize"]) ?? 0,
            },
            thumbnailUrl: null,
            waveformData: null,
            isPlaceholder: true,
            title: audioTitle,
            group: "Imported Audio",
            tags: ["audio", "neuralframes"],
            sourceFile: {
              name: sourceName,
              size: pickNumber(raw.audio, ["size", "fileSize"]) ?? 0,
              lastModified: pickNumber(raw.audio, ["lastModified"]) ?? 0,
            },
          };
          addPlaceholderMedia(audioItem);
          const audioTrackId = await findOrCreateTrack("audio", "Audio");
          if (audioTrackId) {
            const clipResult = await addClip(audioTrackId, audioMediaId, 0, {
              duration: audioDuration,
              metadata: {
                sourceFile: audioItem.sourceFile,
                importSource: "neuralframes",
                kind: "audio",
              },
            });
            if (clipResult.success) audioCount++;
          }
        }

        clearProgress();
        const trackCount = result.metadataTracks.length;
        if (trackBlocksFailed > 0) {
          const errors: ImportError[] = [];
          for (const entry of failedBlocks) {
            errors.push({
              id: `nf-block-${uuidv4().slice(0, 8)}`,
              kind: "block_failed",
              message: entry,
              label: entry.split(" (")[0] ?? entry,
            });
          }
          useUIStore.getState().addImportErrors(errors);
        }
        const warning = trackBlocksFailed > 0
          ? ` (${trackBlocksFailed} block${trackBlocksFailed === 1 ? "" : "s"} failed)`
          : "";
        toast.success(
          "Import complete",
          `${trackBlocksSucceeded} blocks across ${trackCount} track${trackCount !== 1 ? "s" : ""} · ${imageCount} images · ${audioCount} audio in media library${warning}`,
        );
        setTimeout(() => onImported?.(), 600);
      } catch (e) {
        console.error("[NeuralFramesImport] Unexpected error during import:", e);
        clearProgress();
        toast.error("Import failed", e instanceof Error ? e.message : "Unexpected error");
      }
    }, [openreelProjectId, orchestratorUrl, onImported, showProgress, clearProgress, addTrack, addClip, addPlaceholderMedia, replacePlaceholderMedia, addGeneratedMedia, renameTrack]);

    return (
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleFile(file).catch((err) => {
              console.error("[NeuralFramesImport] Unhandled import error:", err);
            });
          }
          e.target.value = "";
        }}
      />
    );
  },
);

NeuralFramesImportTab.displayName = "NeuralFramesImportTab";
