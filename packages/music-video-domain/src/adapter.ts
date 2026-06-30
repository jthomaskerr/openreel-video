import { DEFAULT_IMAGE_MODEL } from "./types.js";
import type {
  GeneratedAsset,
  MetadataBlock,
  NeuralFramesImportResult,
  NeuralFramesStoryboard,
  StoryboardShot,
} from "./types.js";
import { normalizeImageJob } from "./neuralframes.js";

export interface NeuralFramesMediaSpec {
  id: string;
  name: string;
  title?: string;
  description?: string;
  type: "image" | "video" | "audio";
  fileHandle: null;
  blob: null;
  metadata: {
    duration: number;
    width: number;
    height: number;
    frameRate: number;
    codec: string;
    sampleRate: number;
    channels: number;
    fileSize: number;
  };
  thumbnailUrl: string | null;
  originalUrl?: string;
  waveformData: null;
  isPlaceholder: boolean;
  isPending?: boolean;
  kieaiError?: boolean;
  assetGroupId?: string;
  group?: string;
  tags?: string[];
  generationMeta?: {
    provider: string;
    model: string;
    prompt?: string;
    negativePrompt?: string;
    inputs?: Record<string, unknown>;
    jobId?: string;
    status?: string;
  };
  sourceFile: { name: string; size: number; lastModified: number };
}

export interface SceneClipSpec {
  mediaSpec: NeuralFramesMediaSpec;
  trackName: string;
  startSeconds: number;
  duration: number;
  clipMetadata: Record<string, unknown>;
  fetchUrl: string | null;
}

export interface MetadataClipSpec {
  trackName: string;
  kind: string;
  label: string;
  color: string;
  startSeconds: number;
  duration: number;
  trackType: "video" | "metadata";
  thumbnailUrl?: string;
  metadata: Record<string, unknown>;
}

export interface AudioClipSpec {
  mediaSpec: NeuralFramesMediaSpec;
  duration: number;
  clipMetadata: {
    sourceFile: { name: string; size: number; lastModified: number };
    importSource: "neuralframes";
    kind: "audio";
  };
}

export interface NeuralFramesImportPlan {
  sceneClips: SceneClipSpec[];
  orphanedAssets: NeuralFramesMediaSpec[];
  metadataClips: MetadataClipSpec[];
  referenceImages: NeuralFramesMediaSpec[];
  audioClip: AudioClipSpec | null;
}

export function buildImportPlan(
  result: NeuralFramesImportResult,
  raw: NeuralFramesStoryboard,
): NeuralFramesImportPlan {
  const assetById = new Map(result.generatedAssets.map((asset) => [asset.id, asset] as const));
  const placedAssetIds = new Set<string>();
  const resolveUrl = (url: string) => result.remoteUrlMap?.[url] ?? url;
  const referenceModel = raw.storyboard_props?.model ?? DEFAULT_IMAGE_MODEL;

  const sceneClips: SceneClipSpec[] = [];
  for (const shot of result.shots) {
    const duration = clampDuration(shot.startSeconds, shot.endSeconds);
    for (const assetId of shot.generatedAssetIds ?? []) {
      const asset = assetById.get(assetId);
      if (!asset) continue;
      sceneClips.push({
        mediaSpec: buildGeneratedMediaSpec(result, asset),
        trackName: "Neural Frames Scenes",
        startSeconds: shot.startSeconds,
        duration,
        clipMetadata: buildSceneClipMetadata(shot, asset),
        fetchUrl: asset.outputPath ?? null,
      });
      placedAssetIds.add(assetId);
    }
  }

  const orphanedAssets = result.generatedAssets
    .filter((asset) => !placedAssetIds.has(asset.id))
    .map((asset) => buildGeneratedMediaSpec(result, asset));

  const metadataClips: MetadataClipSpec[] = [];
  for (const track of result.metadataTracks) {
    for (const block of track.blocks) {
      metadataClips.push({
        trackName: track.label,
        kind: blockKindToClipKind(block.kind),
        label: block.label,
        color: block.color ?? "#94a3b8",
        startSeconds: block.startSeconds,
        duration: clampDuration(block.startSeconds, block.endSeconds),
        trackType: track.kind === "sections" ? "video" : "metadata",
        thumbnailUrl: block.thumbnailUrl ? resolveUrl(block.thumbnailUrl) : undefined,
        metadata: buildBlockMetadata(block, result, raw),
      });
    }
  }

  const referenceImages: NeuralFramesMediaSpec[] = [];
  for (const character of raw.storyboard_props?.characters ?? []) {
    const imageJob = normalizeImageJob(character.image_job);
    const urls = (imageJob?.assets ?? []).map((asset) => resolveUrl(asset.url));
    for (const url of urls) {
      const name = displayFileName(url) || `${character.name || "reference"}.png`;
      referenceImages.push(
        buildReferenceMediaSpec({
          id: uuid(),
          name,
          title: `Reference: ${character.name}`,
          description: `Character reference: ${character.name}`,
          thumbnailUrl: url,
          prompt: `Character reference: ${character.name}`,
          model: referenceModel,
          tags: ["reference", "character", "neuralframes"],
        }),
      );
    }
  }
  for (const lora of raw.storyboard_props?.loras ?? []) {
    const urls = (lora.training_image_urls ?? []).map((url) => resolveUrl(url));
    for (const url of urls) {
      const name = displayFileName(url) || `${lora.name || "training"}.png`;
      referenceImages.push(
        buildReferenceMediaSpec({
          id: uuid(),
          name,
          title: `Training: ${lora.name}`,
          description: `LoRA training: ${lora.name}`,
          thumbnailUrl: url,
          prompt: `LoRA training: ${lora.name}`,
          model: referenceModel,
          tags: ["training", "lora", "neuralframes"],
        }),
      );
    }
  }
  if (result.audio?.artworkUrl) {
    const url = resolveUrl(result.audio.artworkUrl);
    const name = displayFileName(url) || `${result.title || "artwork"}.png`;
    referenceImages.push(
      buildReferenceMediaSpec({
        id: uuid(),
        name,
        title: "Artwork",
        description: "Primary audio artwork",
        thumbnailUrl: url,
        prompt: "Primary audio artwork",
        model: referenceModel,
        tags: ["artwork", "audio", "neuralframes"],
      }),
    );
  }

  let audioClip: AudioClipSpec | null = null;
  if (result.audio && (result.audio.duration > 0 || result.audio.audioUrl)) {
    const localAudioUrl = result.audio.audioUrl ? resolveUrl(result.audio.audioUrl) : undefined;
    const name = displayFileName(localAudioUrl) || `${result.title || "audio"}.audio`;
    audioClip = {
      mediaSpec: buildAudioMediaSpec(
        result.title,
        result.audio.duration,
        name,
        `audio-${uuid()}`,
        localAudioUrl,
        result.audio.artworkUrl ? resolveUrl(result.audio.artworkUrl) : undefined,
      ),
      duration: result.audio.duration,
      clipMetadata: {
        sourceFile: { name, size: 0, lastModified: 0 },
        importSource: "neuralframes",
        kind: "audio",
      },
    };
  }

  return { sceneClips, orphanedAssets, metadataClips, referenceImages, audioClip };
}

function buildGeneratedMediaSpec(result: NeuralFramesImportResult, asset: GeneratedAsset): NeuralFramesMediaSpec {
  const title = asset.label || asset.prompt.slice(0, 60) || result.title;
  const hasOutput = !!asset.outputPath;
  const isResolved = asset.status === "realized" && hasOutput;
  const effectiveStatus = isResolved ? "realized" : asset.status === "realized" ? "unrealized" : asset.status;
  const sourceFileName = asset.outputPath ? displayFileName(asset.outputPath) || title : title;
  return {
    id: asset.id,
    name: title,
    title,
    description: asset.prompt || undefined,
    type: asset.mediaType,
    fileHandle: null,
    blob: null,
    metadata: mediaMetadata(),
    thumbnailUrl: asset.outputPath ?? null,
    waveformData: null,
    isPlaceholder: !hasOutput,
    isPending: !isResolved && asset.status !== "failed" && asset.status !== "cancelled",
    kieaiError: asset.status === "failed" || asset.status === "cancelled",
    assetGroupId: asset.id,
    group: "Generated",
    tags: ["generated", asset.provider, effectiveStatus],
    generationMeta: {
      provider: asset.provider,
      model: asset.model,
      prompt: asset.prompt,
      negativePrompt: asset.negativePrompt,
      jobId: asset.id,
      status: effectiveStatus,
      inputs: {
        sourceAssets: asset.sourceAssets,
        sourceMetadataBlockIds: asset.sourceMetadataBlockIds,
        validation: asset.validation,
      },
    },
    sourceFile: { name: sourceFileName, size: 0, lastModified: 0 },
  };
}

function buildReferenceMediaSpec(input: {
  id: string;
  name: string;
  title: string;
  description?: string;
  thumbnailUrl: string;
  prompt: string;
  model: string;
  tags: string[];
}): NeuralFramesMediaSpec {
  return {
    id: input.id,
    name: input.name,
    title: input.title,
    description: input.description,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: mediaMetadata(),
    thumbnailUrl: input.thumbnailUrl,
    waveformData: null,
    isPlaceholder: false,
    group: "Reference Images",
    tags: input.tags,
    generationMeta: {
      provider: "neuralframes",
      model: input.model,
      prompt: input.prompt,
      jobId: input.id,
      status: "realized",
    },
    sourceFile: { name: input.name, size: 0, lastModified: 0 },
  };
}

function buildAudioMediaSpec(
  resultTitle: string,
  duration: number,
  name: string,
  id: string,
  originalUrl?: string,
  thumbnailUrl?: string,
): NeuralFramesMediaSpec {
  return {
    id,
    name,
    title: resultTitle || "audio",
    type: "audio",
    fileHandle: null,
    blob: null,
    metadata: mediaMetadata(duration),
    thumbnailUrl: thumbnailUrl ?? null,
    originalUrl,
    waveformData: null,
    isPlaceholder: true,
    group: "Imported Audio",
    tags: ["audio", "neuralframes"],
    sourceFile: { name, size: 0, lastModified: 0 },
  };
}

function buildSceneClipMetadata(shot: StoryboardShot, asset: GeneratedAsset): Record<string, unknown> {
  const generatedAssetIds = shot.generatedAssetIds.length > 0 ? shot.generatedAssetIds : [asset.id];
  return {
    text: shot.prompt,
    importSource: "neuralframes",
    importId: shot.id,
    source: "llm",
    linkedShotIds: [shot.id],
    linkedGeneratedAssetIds: [asset.id],
    kind: "scene",
    label: shot.label,
    color: "#4da8ff",
    prompt: shot.prompt,
    shotId: shot.id,
    shotIndex: shot.index,
    generatedAssetIds,
  };
}

function buildBlockMetadata(
  block: MetadataBlock,
  result: NeuralFramesImportResult,
  raw: NeuralFramesStoryboard,
): Record<string, unknown> {
  const resolveUrl = (url: string) => result.remoteUrlMap?.[url] ?? url;
  const base = {
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
      shotId: shot?.id ?? block.linkedShotIds[0],
      shotIndex: shot?.index,
      generatedAssetIds:
        shot?.generatedAssetIds && shot.generatedAssetIds.length > 0
          ? shot.generatedAssetIds
          : block.linkedGeneratedAssetIds,
    };
  }

  if (block.kind === "continuity_note") {
    const characters = raw.storyboard_props?.characters ?? [];
    const character = characters.find((candidate) => candidate.id === block.importId);
    const imageJob = normalizeImageJob(character?.image_job);
    const urls = (imageJob?.assets ?? []).map((asset) => resolveUrl(asset.url));
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
    const urls = (lora?.training_image_urls ?? []).map((url) => resolveUrl(url));
    return {
      ...base,
      name: lora?.name ?? block.label,
      trainingImageUrls: urls,
      loraId: lora?.id,
    };
  }

  return base;
}

function blockKindToClipKind(kind: MetadataBlock["kind"]): string {
  switch (kind) {
    case "section":
      return "scene";
    case "continuity_note":
      return "character";
    case "visual_motif":
      return "style";
    default:
      return kind;
  }
}


function clampDuration(startSeconds: number, endSeconds: number | undefined): number {
  const end = endSeconds ?? startSeconds;
  const raw = end - startSeconds;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function mediaMetadata(duration = 0): NeuralFramesMediaSpec["metadata"] {
  return {
    duration,
    width: 0,
    height: 0,
    frameRate: 0,
    codec: "",
    sampleRate: 0,
    channels: 0,
    fileSize: 0,
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

function displayFileName(path: string | undefined): string {
  if (!path) return "";
  const pathname = pathName(path);
  return pathname.split(/[\\/]/).pop() ?? pathname;
}

function pathName(path: string): string {
  try {
    return new URL(path).pathname;
  } catch {
    return path;
  }
}
