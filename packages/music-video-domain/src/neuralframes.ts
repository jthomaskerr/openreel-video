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
  DEFAULT_RESOLUTION,
  DEFAULT_SHOT_MODEL,
} from "./types.js";
import type {
  MetadataBlock,
  MetadataTrack,
  NeuralFramesAudio,
  NeuralFramesImportResult,
  NeuralFramesStoryboard,
  StoryboardShot,
  ValidationState,
} from "./types.js";

export interface NormalizedNeuralFramesImageAsset {
  url: string;
}

/**
 * Normalize a character's `image_job` field, which may arrive as embedded JSON
 * text from Neural Frames exports. `assets` may itself be JSON and may contain
 * raw URL strings or `{ url }` objects.
 */
export function normalizeImageJob(
  imageJob: unknown,
): { assets: NormalizedNeuralFramesImageAsset[] } | undefined {
  const job = parseMaybeJson(imageJob);
  if (typeof job !== "object" || job === null) return undefined;

  const assets = parseMaybeJson((job as { assets?: unknown }).assets);
  if (!Array.isArray(assets)) return undefined;

  const normalized = assets
    .map((asset) => {
      if (typeof asset === "string") return { url: asset };
      if (typeof asset === "object" && asset !== null) {
        const url = (asset as { url?: unknown }).url;
        if (typeof url === "string") return { url };
      }
      return null;
    })
    .filter((asset): asset is NormalizedNeuralFramesImageAsset => asset !== null && asset.url.length > 0);

  return normalized.length > 0 ? { assets: normalized } : undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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

  const sbFps = props.fps;
  const sbAspectRatio = props.aspect_ratio ?? DEFAULT_ASPECT_RATIO;
  const sbResolution = props.resolution;
  const sbStyle = props.style;
  const sbRenderMode = props.render_mode;
  const shotModel = props.model ?? DEFAULT_SHOT_MODEL;

  // ── Shots (all unrealized — video not yet generated) ──────────────────────
  // scene_image_url is a reference preview image, NOT a generated output.
  const shots: StoryboardShot[] = scenes.map((scene, i) => {
    const shot: StoryboardShot = {
      id: uuid(),
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
      generatedAssetIds: [],
      referenceImageUrl: scene.scene_image_url,
      validation: EMPTY_VALIDATION,
      outputs: [],
      selected: false,
    };
    if (sbFps !== undefined) shot.fps = sbFps;
    if (sbStyle !== undefined) shot.style = sbStyle;
    if (sbRenderMode !== undefined) shot.renderMode = sbRenderMode;
    return shot;
  });

  // ── Characters → one track per character, clips only for scenes where
  //    the character's ID appears in the scene prompt ────────────────────────
  const charTracks: MetadataTrack[] = rawCharacters
    .map((char) => {
      const trackId = uuid();
      const imageJob = normalizeImageJob(char.image_job);
      const thumbnailUrl = imageJob?.assets[0]?.url;

      // Find shots where this character's ID is referenced in the prompt
      const mentionedScenes = scenes.filter((scene) =>
        scene.scene_prompt.includes(char.id),
      );

      // Fall back to a single full-duration block if no scene mentions the character
      const blocks: MetadataBlock[] = mentionedScenes.length > 0
        ? mentionedScenes.map((scene) => ({
            id: uuid(),
            trackId,
            label: char.name,
            kind: "continuity_note" as const,
            startSeconds: scene.start_time,
            endSeconds: scene.end_time,
            text: `Character: ${char.name}`,
            linkedShotIds: [],
            linkedGeneratedAssetIds: [],
            source: "neuralframes" as const,
            importSource: "neuralframes" as const,
            importId: char.id,
            thumbnailUrl,
          }))
        : [{
            id: uuid(),
            trackId,
            label: char.name,
            kind: "continuity_note" as const,
            startSeconds: 0,
            endSeconds: duration,
            text: `Character: ${char.name}`,
            linkedShotIds: [],
            linkedGeneratedAssetIds: [],
            source: "neuralframes" as const,
            importSource: "neuralframes" as const,
            importId: char.id,
            thumbnailUrl,
          }];

      return {
        id: trackId,
        label: char.name,
        kind: "continuity" as const,
        visible: true,
        locked: false,
        blocks,
      };
    })
    .filter((t) => t.blocks.length > 0);

  // ── LoRAs → metadata track ─────────────────────────────────────────────────
  const loraTrackId = uuid();
  const loraBlocks: MetadataBlock[] = rawLoras.map((lora) => ({
    id: uuid(),
    trackId: loraTrackId,
    label: lora.name,
    kind: "visual_motif" as const,
    startSeconds: 0,
    endSeconds: duration,
    text:
      lora.visual_style ??
      `Style LoRA: ${lora.name} (${(lora.training_image_urls ?? []).length} training images)`,
    linkedShotIds: [],
    linkedGeneratedAssetIds: [],
    source: "neuralframes" as const,
    importSource: "neuralframes" as const,
    importId: lora.id,
    thumbnailUrl: lora.training_image_urls?.[0],
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
        text: [props.storyboard_prompt, audioMeta?.video_idea]
          .filter(Boolean)
          .join("\n\nVideo concept: "),
        linkedShotIds: [],
        linkedGeneratedAssetIds: [],
        source: "neuralframes" as const,
        importSource: "neuralframes" as const,
      },
    ],
  };

  // ── Audio ──────────────────────────────────────────────────────────────────
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
    metadataTracks: [...charTracks, loraTrack, notesTrack].filter((t) => t.blocks.length > 0),
    shots,
    generatedAssets: [],
    audio,
  };
}
