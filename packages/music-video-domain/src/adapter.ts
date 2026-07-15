import { DEFAULT_IMAGE_MODEL } from "./types.js";
import type {
  GeneratedAsset,
  MetadataBlock,
  NeuralFramesCharacter,
  NeuralFramesImportResult,
  NeuralFramesLora,
  NeuralFramesStoryboard,
  StoryboardShot,
} from "./types.js";
import { normalizeImageJob } from "./neuralframes.js";
import { createSceneProjectionMetadata } from "./scene-projection.js";

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
    bpm?: number;
    key?: string;
    scale?: string;
    has_lyrics?: boolean;
    audioTrackCount?: number;
  };
  thumbnailUrl: string | null;
  originalUrl?: string;
  assetGroupId?: string;
  group?: string;
  tags?: string[];
  generationMeta?: NeuralFramesGenerationMeta;
  sourceFile: { name: string; size: number; lastModified: number };
}

export interface NeuralFramesGenerationMeta {
  provider: string;
  model: string;
  prompt?: string;
  negativePrompt?: string;
  inputs?: Record<string, unknown>;
  jobId?: string;
  status?: string;
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
  description?: string;
  generationMeta?: NeuralFramesGenerationMeta;
  metadata: Record<string, unknown>;
}

/** One media item per character, reused for every per-scene clip on that character's track. */
export interface CharacterTrackSpec {
  /** Track name = character name */
  trackName: string;
  /** Single media item shared across all clips on this track */
  mediaSpec: NeuralFramesMediaSpec;
  /** The resolved thumbnail URL (character reference image) */
  thumbnailUrl?: string;
  /** One entry per scene the character appears in */
  clips: Array<{
    startSeconds: number;
    duration: number;
    metadata: Record<string, unknown>;
  }>;
}

export interface AudioClipSpec {
  mediaSpec: NeuralFramesMediaSpec;
  duration: number;
  clipMetadata: {
    sourceFile: { name: string; size: number; lastModified: number };
    importSource: "neuralframes";
    kind: "audio";
    bpm?: number;
    key?: string;
    scale?: string;
    has_lyrics?: boolean;
    videoIdea?: string;
  };
}

export interface NeuralFramesImportPlan {
  sceneClips: SceneClipSpec[];
  orphanedAssets: NeuralFramesMediaSpec[];
  /** Non-character metadata clips (LoRA, notes, beats, etc.) */
  metadataClips: MetadataClipSpec[];
  /** One entry per character — each holds a single media asset reused for N scene clips */
  characterTracks: CharacterTrackSpec[];
  referenceImages: NeuralFramesMediaSpec[];
  audioClip: AudioClipSpec | null;
}

export function buildImportPlan(
  result: NeuralFramesImportResult,
  raw: NeuralFramesStoryboard,
): NeuralFramesImportPlan {
  const resolveUrl = (url: string) => result.remoteUrlMap?.[url] ?? url;
  const referenceModel = raw.storyboard_props?.model ?? DEFAULT_IMAGE_MODEL;
  const timelineDuration = storyboardDuration(result, raw);

  // ── Scene clips (shots are unrealized — no generatedAssetIds) ────────────
  // referenceImageUrl is a preview only, NOT a generated output.
  const sceneClips: SceneClipSpec[] = result.shots.flatMap((shot) => {
    // Manual scenes are valid without storyboard planning timing and must not
    // be projected merely because an import plan was requested.
    if (shot.startSeconds === undefined || shot.endSeconds === undefined) return [];
    const duration = clampDuration(shot.startSeconds, shot.endSeconds);
    const thumbUrl = shot.referenceImageUrl ? resolveUrl(shot.referenceImageUrl) : null;
    return [{
      mediaSpec: buildUnrealizedSceneMediaSpec(shot, thumbUrl),
      trackName: "Neural Frames Scenes",
      startSeconds: shot.startSeconds,
      duration,
      clipMetadata: buildSceneClipMetadata(shot, thumbUrl),
      fetchUrl: null,
    }];
  });

  // Orphaned generated assets (empty for normal NF imports; kept for compatibility)
  const orphanedAssets = result.generatedAssets.map((asset) =>
    buildGeneratedMediaSpec(result, asset),
  );

  // ── Separate character tracks (continuity_note blocks) from other tracks ──
  const characterTracks: CharacterTrackSpec[] = [];
  const metadataClips: MetadataClipSpec[] = [];

  for (const track of result.metadataTracks) {
    const isCharacterTrack =
      track.blocks.length > 0 && track.blocks.every((b) => b.kind === "continuity_note");

    if (isCharacterTrack) {
      const firstBlock = track.blocks[0]!;
      const character = findCharacter(raw, firstBlock.importId);
      const imageUrls = characterImageUrls(character, resolveUrl);
      const thumbUrl = firstBlock.thumbnailUrl ? resolveUrl(firstBlock.thumbnailUrl) : imageUrls[0];
      const generationMeta = buildCharacterGenerationMeta(
        character,
        track.label,
        imageUrls,
        referenceModel,
        firstBlock.id,
        thumbUrl ? "realized" : "unrealized",
      );
      characterTracks.push({
        trackName: track.label,
        thumbnailUrl: thumbUrl,
        mediaSpec: buildCharacterMediaSpec(track.label, thumbUrl, generationMeta, character),
        clips: track.blocks.map((block) => ({
          startSeconds: block.startSeconds,
          duration: clipDuration(block.startSeconds, block.endSeconds, timelineDuration),
          metadata: buildBlockMetadata(block, result, raw),
        })),
      });
    } else {
      for (const block of track.blocks) {
        const lora = block.kind === "visual_motif" ? findLora(raw, block.importId) : undefined;
        const loraUrls = lora ? loraTrainingImageUrls(lora, resolveUrl) : [];
        const metadata = buildBlockMetadata(block, result, raw);
        metadataClips.push({
          trackName: track.label,
          kind: blockKindToClipKind(block.kind),
          label: block.label,
          color: block.color ?? "#94a3b8",
          startSeconds: block.startSeconds,
          duration: clipDuration(block.startSeconds, block.endSeconds, timelineDuration),
          trackType: track.kind === "sections" ? "video" : "metadata",
          thumbnailUrl: block.thumbnailUrl ? resolveUrl(block.thumbnailUrl) : loraUrls[0],
          description: lora?.visual_style,
          generationMeta: lora
            ? buildStyleGenerationMeta(lora, loraUrls, block.id, lora.visual_style ? "realized" : "unrealized")
            : undefined,
          metadata,
        });
      }
    }
  }

  // ── Reference images ──────────────────────────────────────────────────────
  const referenceImages: NeuralFramesMediaSpec[] = [];

  // Scene preview images (scene_image_url)
  for (const shot of result.shots) {
    if (!shot.referenceImageUrl) continue;
    const url = resolveUrl(shot.referenceImageUrl);
    const name = displayFileName(url) || `${shot.label}.png`;
    referenceImages.push(
      buildReferenceMediaSpec({
        id: uuid(),
        name,
        title: `Reference: ${shot.label}`,
        description: `Scene reference: ${shot.label}`,
        thumbnailUrl: url,
        prompt: shot.prompt,
        model: referenceModel,
        tags: ["reference", "scene", "neuralframes"],
      }),
    );
  }

  // Character generated images
  for (const character of raw.storyboard_props?.characters ?? []) {
    const urls = characterImageUrls(character, resolveUrl);
    const generationMeta = buildCharacterGenerationMeta(
      character,
      character.name,
      urls,
      referenceModel,
      character.id,
      "realized",
    );
    for (const url of urls) {
      const name = displayFileName(url) || `${character.name || "character"}.png`;
      orphanedAssets.push(
        buildGeneratedImageMediaSpec({
          id: uuid(),
          name,
          title: character.name,
          description: character.description ?? character.physical_identity ?? `Character: ${character.name}`,
          thumbnailUrl: url,
          tags: ["generated", "character", "neuralframes"],
          generationMeta,
          group: "Generated",
        }),
      );
    }
  }

  // LoRA training reference images
  for (const lora of raw.storyboard_props?.loras ?? []) {
    const urls = loraTrainingImageUrls(lora, resolveUrl);
    const generationMeta = buildStyleGenerationMeta(lora, urls, lora.id, "realized");
    for (const url of urls) {
      const name = displayFileName(url) || `${lora.name || "training"}.png`;
      referenceImages.push(
        buildReferenceMediaSpec({
          id: uuid(),
          name,
          title: `Training: ${lora.name}`,
          description: lora.visual_style ?? `LoRA training: ${lora.name}`,
          thumbnailUrl: url,
          prompt: lora.visual_style ?? lora.trigger_word ?? `LoRA training: ${lora.name}`,
          model: lora.base_model ?? referenceModel,
          tags: ["reference", "training", "lora", "neuralframes"],
          inputs: generationMeta.inputs,
        }),
      );
    }
  }

  // Audio artwork
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

  // ── Audio clip ────────────────────────────────────────────────────────────
  let audioClip: AudioClipSpec | null = null;
  const audioDuration = result.audio ? result.audio.duration || timelineDuration : 0;
  if (result.audio && (audioDuration > 0 || result.audio.audioUrl)) {
    const localAudioUrl = result.audio.audioUrl ? resolveUrl(result.audio.audioUrl) : undefined;
    const name = displayFileName(localAudioUrl) || `${result.title || "audio"}.audio`;
    audioClip = {
      mediaSpec: buildAudioMediaSpec(
        result.title,
        result.audio,
        name,
        `audio-${uuid()}`,
        localAudioUrl,
        result.audio.artworkUrl ? resolveUrl(result.audio.artworkUrl) : undefined,
      ),
      duration: audioDuration,
      clipMetadata: {
        sourceFile: { name, size: 0, lastModified: 0 },
        importSource: "neuralframes",
        kind: "audio",
        bpm: result.audio.bpm,
        key: result.audio.key,
        scale: result.audio.scale,
        has_lyrics: result.audio.hasLyrics,
        videoIdea: result.audio.videoIdea,
      },
    };
  }

  return { sceneClips, orphanedAssets, metadataClips, characterTracks, referenceImages, audioClip };
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

function buildGeneratedImageMediaSpec(input: {
  id: string;
  name: string;
  title: string;
  description?: string;
  thumbnailUrl: string;
  tags: string[];
  generationMeta: NeuralFramesGenerationMeta;
  group: string;
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
    group: input.group,
    tags: input.tags,
    generationMeta: { ...input.generationMeta, jobId: input.id, status: "realized" },
    sourceFile: { name: input.name, size: 0, lastModified: 0 },
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
  inputs?: Record<string, unknown>;
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
    group: "Reference Images",
    tags: input.tags,
    generationMeta: {
      provider: "neuralframes",
      model: input.model,
      prompt: input.prompt,
      inputs: input.inputs,
      jobId: input.id,
      status: "realized",
    },
    sourceFile: { name: input.name, size: 0, lastModified: 0 },
  };
}

function buildAudioMediaSpec(
  resultTitle: string,
  audio: NeuralFramesImportResult["audio"],
  name: string,
  id: string,
  originalUrl?: string,
  thumbnailUrl?: string,
): NeuralFramesMediaSpec {
  return {
    id,
    name,
    title: resultTitle || "audio",
    description: audio.videoIdea,
    type: "audio",
    fileHandle: null,
    blob: null,
    metadata: {
      ...mediaMetadata(audio.duration),
      bpm: audio.bpm,
      key: audio.key,
      scale: audio.scale,
      has_lyrics: audio.hasLyrics,
    },
    thumbnailUrl: thumbnailUrl ?? null,
    originalUrl,
    group: "Imported Audio",
    tags: ["audio", "neuralframes"],
    sourceFile: { name, size: 0, lastModified: 0 },
  };
}

function buildSceneClipMetadata(shot: StoryboardShot, referenceImageUrl: string | null): Record<string, unknown> {
  return {
    ...createSceneProjectionMetadata(shot, "neuralframes"),
    text: shot.prompt,
    importSource: "neuralframes",
    importId: shot.id,
    linkedShotIds: [shot.id],
    linkedGeneratedAssetIds: [],
    color: "#4da8ff",
    generatedAssetIds: [],
    referenceImageUrl: referenceImageUrl ?? undefined,
  };
}

/** Media spec for an unrealized scene slot (no video generated yet). */
function buildUnrealizedSceneMediaSpec(
  shot: StoryboardShot,
  thumbnailUrl: string | null,
): NeuralFramesMediaSpec {
  const id = uuid();
  return {
    id,
    name: shot.label,
    title: shot.label,
    description: shot.prompt || undefined,
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: mediaMetadata(),
    thumbnailUrl,
    assetGroupId: id,
    group: "Neural Frames Scenes",
    tags: ["scene", "neuralframes", "unrealized"],
    generationMeta: {
      provider: "neuralframes",
      model: shot.model,
      prompt: shot.prompt,
      jobId: id,
      status: "unrealized",
    },
    sourceFile: { name: shot.label, size: 0, lastModified: 0 },
  };
}

/** Single media spec for a character — shared across all of the character's timeline clips. */
function buildCharacterMediaSpec(
  characterName: string,
  thumbnailUrl: string | undefined,
  generationMeta: NeuralFramesGenerationMeta,
  character: NeuralFramesCharacter | undefined,
): NeuralFramesMediaSpec {
  const id = uuid();
  return {
    id,
    name: `Character: ${characterName}`,
    title: characterName,
    description: character?.description ?? character?.physical_identity ?? `Character reference: ${characterName}`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: mediaMetadata(),
    thumbnailUrl: thumbnailUrl ?? null,
    group: "Characters",
    tags: ["character", "neuralframes"],
    generationMeta: { ...generationMeta, jobId: id },
    sourceFile: { name: `character: ${characterName}`, size: 0, lastModified: 0 },
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
    const character = findCharacter(raw, block.importId);
    const urls = characterImageUrls(character, resolveUrl);
    return {
      ...base,
      name: character?.name ?? block.label,
      description: character?.description ?? block.text,
      physical_identity: character?.physical_identity,
      reference_wardrobe: character?.reference_wardrobe,
      reference_phrase: character?.reference_phrase,
      thumbnailUrl: block.thumbnailUrl ?? urls[0],
      referenceImageUrls: urls,
    };
  }

  if (block.kind === "visual_motif") {
    const lora = findLora(raw, block.importId);
    const urls = lora ? loraTrainingImageUrls(lora, resolveUrl) : [];
    return {
      ...base,
      name: lora?.name ?? block.label,
      description: lora?.visual_style ?? block.text,
      trainingImageUrls: urls,
      visual_style: lora?.visual_style,
      trigger_word: lora?.trigger_word,
      base_model: lora?.base_model,
      loraId: lora?.id,
    };
  }

  if (block.kind === "note") {
    return {
      ...base,
      ...(block.storyboard_prompt != null && { storyboard_prompt: block.storyboard_prompt }),
      ...(block.video_idea != null && { video_idea: block.video_idea }),
      ...(block.storyboard_style_prompt != null && { storyboard_style_prompt: block.storyboard_style_prompt }),
    };
  }

  return base;
}

function findCharacter(
  raw: NeuralFramesStoryboard,
  importId: string | undefined,
): NeuralFramesCharacter | undefined {
  return raw.storyboard_props?.characters?.find((candidate) => candidate.id === importId);
}

function findLora(raw: NeuralFramesStoryboard, importId: string | undefined): NeuralFramesLora | undefined {
  return raw.storyboard_props?.loras?.find((candidate) => candidate.id === importId);
}

function characterImageUrls(
  character: NeuralFramesCharacter | undefined,
  resolveUrl: (url: string) => string,
): string[] {
  const imageJob = normalizeImageJob(character?.image_job);
  return (imageJob?.assets ?? []).map((asset) => resolveUrl(asset.url));
}

function loraTrainingImageUrls(
  lora: NeuralFramesLora,
  resolveUrl: (url: string) => string,
): string[] {
  return (lora.training_image_urls ?? []).map((url) => resolveUrl(url));
}

function buildCharacterGenerationMeta(
  character: NeuralFramesCharacter | undefined,
  fallbackName: string,
  imageUrls: string[],
  model: string,
  jobId: string,
  status: string,
): NeuralFramesGenerationMeta {
  const prompt = character?.reference_phrase ?? character?.description ?? `Character reference: ${fallbackName}`;
  return {
    provider: "neuralframes",
    model,
    prompt,
    inputs: compactInputs({
      physical_identity: character?.physical_identity,
      reference_wardrobe: character?.reference_wardrobe,
      description: character?.description,
      reference_phrase: character?.reference_phrase,
      image_job_assets: imageUrls,
    }),
    jobId,
    status,
  };
}

function buildStyleGenerationMeta(
  lora: NeuralFramesLora,
  trainingImageUrls: string[],
  jobId: string,
  status: string,
): NeuralFramesGenerationMeta {
  return {
    provider: "neuralframes",
    model: lora.base_model ?? DEFAULT_IMAGE_MODEL,
    prompt: lora.visual_style ?? lora.trigger_word ?? lora.name,
    inputs: compactInputs({
      training_image_urls: trainingImageUrls,
      visual_style: lora.visual_style,
      trigger_word: lora.trigger_word,
      base_model: lora.base_model,
    }),
    jobId,
    status,
  };
}

function compactInputs(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return value !== "";
    }),
  );
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


function clipDuration(startSeconds: number, endSeconds: number | undefined, fallbackEndSeconds: number): number {
  const duration = clampDuration(startSeconds, endSeconds);
  if (duration > 0) return duration;
  const fallback = fallbackEndSeconds - startSeconds;
  return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
}

function clampDuration(startSeconds: number, endSeconds: number | undefined): number {
  const end = endSeconds ?? startSeconds;
  const raw = end - startSeconds;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function storyboardDuration(result: NeuralFramesImportResult, raw: NeuralFramesStoryboard): number {
  const candidates = [
    result.audio?.duration,
    ...result.shots.map((shot) => shot.endSeconds),
    ...(raw.storyboard_props?.scenes ?? []).map((scene) => scene.end_time),
  ];
  return candidates.reduce<number>((max, value) => {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
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
