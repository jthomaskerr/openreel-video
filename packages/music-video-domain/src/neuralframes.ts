/**
 * Neural Frames storyboard import mapper.
 *
 * Maps a NeuralFramesStoryboard JSON file into MusicVideoProject fragments:
 *   - metadataTracks: characters, LoRAs, notes
 *   - shots: one StoryboardShot per scene, with scene_image_url as a realized GeneratedAsset
 *   - audio: trimmed audio metadata and artwork references
 *
 * Strips all account/user identity fields (email, credits, subscription, owner, referral).
 */

import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_SHOT_MODEL,
} from "./types.js";
import type {
  GeneratedAsset,
  MetadataBlock,
  MetadataTrack,
  NeuralFramesAudio,
  NeuralFramesImportResult,
  NeuralFramesStoryboard,
  StoryboardShot,
  ValidationState,
} from "./types.js";

/**
 * Normalize a character's `image_job` field, which may arrive as embedded JSON
 * text from Neural Frames exports. Returns a parsed `{ assets }` object or
 * `undefined` when the field is missing/invalid.
 */
export function normalizeImageJob(
  imageJob: unknown,
): { assets: Array<{ url: string }> } | undefined {
  if (!imageJob) return undefined;
  if (typeof imageJob === "string") {
    try {
      imageJob = JSON.parse(imageJob);
    } catch {
      return undefined;
    }
  }
  if (typeof imageJob !== "object" || imageJob === null) return undefined;
  const job = imageJob as Record<string, unknown>;
  let assets = job.assets;
  if (typeof assets === "string") {
    try {
      assets = JSON.parse(assets);
    } catch {
      assets = undefined;
    }
  }
  if (!Array.isArray(assets)) return undefined;
  return { assets: assets as Array<{ url: string }> };
}

function uuid(): string {
  return crypto.randomUUID();
}

const EMPTY_VALIDATION: ValidationState = { valid: true, warnings: [], errors: [] };

export function importNeuralFrames(
  raw: NeuralFramesStoryboard,
  sourcePath: string,
): NeuralFramesImportResult {
  const props = raw.storyboard_props ?? ({
    storyboard_prompt: "",
    scenes: [],
    characters: [],
    loras: [],
  } as NeuralFramesStoryboard["storyboard_props"]);
  const duration = raw.audio?.duration ?? 0;
  const audioMeta = raw.audio?.audio_analysis;

  const scenes = Array.isArray(props.scenes) ? props.scenes : [];
  const rawCharacters = Array.isArray(props.characters) ? props.characters : [];
  const rawLoras = Array.isArray(props.loras) ? props.loras : [];

  // ── Scenes → metadata track + shots ───────────────────────────────────────
  const sceneTrackId = uuid();
  const sceneBlocks: MetadataBlock[] = scenes.map((scene) => ({
    id: uuid(),
    trackId: sceneTrackId,
    label: `Scene ${scene.id}`,
    kind: "section" as const,
    startSeconds: scene.start_time,
    endSeconds: scene.end_time,
    text: scene.scene_prompt,
    color: "#4da8ff",
    linkedShotIds: [],
    linkedGeneratedAssetIds: [],
    source: "llm" as const,
    importSource: "neuralframes" as const,
    importId: scene.id,
  }));
  const sceneTrack: MetadataTrack = {
    id: sceneTrackId,
    label: "Neural Frames Scenes",
    kind: "sections",
    visible: true,
    locked: false,
    color: "#4da8ff",
    blocks: sceneBlocks,
  };
  void sceneTrack;

  // Build shots and generated assets together so IDs stay consistent.
  const generatedAssets: GeneratedAsset[] = [];

  const sbFps = props.fps;
  const sbAspectRatio = props.aspect_ratio ?? DEFAULT_ASPECT_RATIO;
  const sbResolution = props.resolution;
  const sbStyle = props.style;
  const sbRenderMode = props.render_mode;
  const shotModel = props.model ?? DEFAULT_SHOT_MODEL;
  const imageModel = props.model ?? DEFAULT_IMAGE_MODEL;

  const shots: StoryboardShot[] = scenes.map((scene, i) => {
    const shotId = uuid();
    const assetIds: string[] = [];

    if (scene.scene_image_url) {
      const assetId = uuid();
      generatedAssets.push({
        id: assetId,
        label: `Scene ${i + 1} keyframe`,
        mediaType: "image",
        status: "realized",
        provider: "neuralframes",
        model: imageModel,
        prompt: scene.scene_prompt,
        sourceAssets: [],
        sourceMetadataBlockIds: [],
        outputPath: scene.scene_image_url,
        validation: EMPTY_VALIDATION,
        attempts: [],
      });
      assetIds.push(assetId);
    }

    const block = sceneBlocks[i];
    if (block) block.linkedShotIds.push(shotId);

    const shot: StoryboardShot = {
      id: shotId,
      index: i,
      label: `Scene ${i + 1}`,
      startSeconds: scene.start_time,
      endSeconds: scene.end_time,
      prompt: scene.scene_prompt,
      model: shotModel,
      resolution: sbResolution ?? DEFAULT_RESOLUTION,
      aspectRatio: sbAspectRatio,
      includeMainAudio: true,
      referenceAssetIds: [],
      generatedAssetIds: assetIds,
      validation: EMPTY_VALIDATION,
      outputs: [],
      selected: false,
    };
    if (sbFps !== undefined) shot.fps = sbFps;
    if (sbStyle !== undefined) shot.style = sbStyle;
    if (sbRenderMode !== undefined) shot.renderMode = sbRenderMode;
    return shot;
  });

  // ── Characters → metadata track ────────────────────────────────────────────
  const charTrackId = uuid();
  const charBlocks: MetadataBlock[] = rawCharacters.map((char) => {
    const imageJob = normalizeImageJob(char.image_job);
    return {
      id: uuid(),
      trackId: charTrackId,
      label: char.name,
      kind: "continuity_note" as const,
      startSeconds: 0,
      endSeconds: duration,
      text: `Character: ${char.name}`,
      linkedShotIds: [],
      linkedGeneratedAssetIds: [],
      source: "llm" as const,
      importSource: "neuralframes" as const,
      importId: char.id,
      thumbnailUrl: imageJob?.assets[0]?.url,
    };
  });
  const charTrack: MetadataTrack = {
    id: charTrackId,
    label: "Characters",
    kind: "continuity",
    visible: true,
    locked: false,
    blocks: charBlocks,
  };

  // ── LoRAs → metadata track ─────────────────────────────────────────────────
  const loraTrackId = uuid();
  const loraBlocks: MetadataBlock[] = rawLoras.map((lora) => ({
    id: uuid(),
    trackId: loraTrackId,
    label: lora.name,
    kind: "visual_motif" as const,
    startSeconds: 0,
    endSeconds: duration,
    text: `Style LoRA: ${lora.name} (${(lora.training_image_urls ?? []).length} training images)`,
    linkedShotIds: [],
    linkedGeneratedAssetIds: [],
    source: "llm" as const,
    importSource: "neuralframes" as const,
    importId: lora.id,
  }));
  const loraTrack: MetadataTrack = {
    id: loraTrackId,
    label: "Style / LoRAs",
    kind: "motifs",
    visible: true,
    locked: false,
    blocks: loraBlocks,
  };

  // ── Storyboard prompt → notes track ────────────────────────────────────────
  const notesTrackId = uuid();
  const notesTrack: MetadataTrack = {
    id: notesTrackId,
    label: "Director Notes",
    kind: "notes",
    visible: true,
    locked: false,
    blocks: [
      {
        id: uuid(),
        trackId: notesTrackId,
        label: "Storyboard brief",
        kind: "note" as const,
        startSeconds: 0,
        endSeconds: duration,
        text: props.storyboard_prompt,
        linkedShotIds: [],
        linkedGeneratedAssetIds: [],
        source: "llm" as const,
        importSource: "neuralframes" as const,
      },
      ...(audioMeta?.video_idea
        ? [
            {
              id: uuid(),
              trackId: notesTrackId,
              label: "Video concept",
              kind: "note" as const,
              startSeconds: 0,
              endSeconds: duration,
              text: audioMeta.video_idea,
              linkedShotIds: [],
              linkedGeneratedAssetIds: [],
              source: "llm" as const,
              importSource: "neuralframes" as const,
            },
          ]
        : []),
    ],
  };

  // ── Audio ─────────────────────────────────────────────────────────────────
  const audio: NeuralFramesAudio = {
    duration,
    bpm: audioMeta?.bpm,
    key: audioMeta?.key,
    scale: audioMeta?.scale,
    hasLyrics: audioMeta?.has_lyrics,
    videoIdea: audioMeta?.video_idea,
    audioUrl: raw.audio?.trimmed_audio_path,
    artworkUrl: raw.audio?.primary_audio_artwork_image_url,
  };

  return {
    sourcePath,
    storyboardId: uuid(),
    title: props.title ?? audioMeta?.video_idea?.slice(0, 60) ?? sourcePath.split("/").pop() ?? "Neural Frames Import",
    scenesImported: scenes.length,
    charactersImported: rawCharacters.length,
    lorasImported: rawLoras.length,
    metadataTracks: [charTrack, loraTrack, notesTrack].filter((t) => t.blocks.length > 0),
    shots,
    generatedAssets,
    audio,
  };
}
