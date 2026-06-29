/**
 * Neural Frames storyboard import mapper.
 *
 * Maps a NeuralFramesStoryboard JSON file into MusicVideoProject fragments:
 *   - metadataTracks: scenes, characters, LoRAs, audio analysis, storyboard prompt
 *   - shots: one StoryboardShot per scene, with scene_image_url as a realized GeneratedAsset
 *   - timingHints: BPM and a single song section covering the full duration
 *
 * Strips all account/user identity fields (email, credits, subscription, owner, referral).
 */

import type {
  NeuralFramesStoryboard,
  NeuralFramesImportResult,
  MetadataTrack,
  MetadataBlock,
  StoryboardShot,
  GeneratedAsset,
  ValidationState,
  SongSection,
} from "./types.js";

function uuid(): string {
  // crypto.randomUUID is available in Node 18+ and modern browsers
  return crypto.randomUUID();
}

const EMPTY_VALIDATION: ValidationState = { valid: true, warnings: [], errors: [] };

export function importNeuralFrames(
  raw: NeuralFramesStoryboard,
  sourcePath: string,
): NeuralFramesImportResult {
  const props = raw.storyboard_props ?? { storyboard_prompt: "", scenes: [], characters: [], loras: [] } as NeuralFramesStoryboard["storyboard_props"];
  const audioMeta = raw.audio?.audio_analysis ?? {};
  const bpm: number = audioMeta.bpm ?? 120;
  const duration: number = raw.audio?.duration ?? 0;

  // ── Scenes → metadata track + shots ───────────────────────────────────────
  const sceneTrackId = uuid();
  const sceneBlocks: MetadataBlock[] = props.scenes.map((scene) => ({
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

  // Build shots and generated assets together so IDs stay consistent
  const generatedAssets: GeneratedAsset[] = [];

  const shots: StoryboardShot[] = props.scenes.map((scene, i) => {
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
        model: "neuralframes",
        prompt: scene.scene_prompt,
        sourceAssets: [],
        sourceMetadataBlockIds: [],
        outputPath: scene.scene_image_url,
        validation: EMPTY_VALIDATION,
        attempts: [],
      });
      assetIds.push(assetId);
    }

    // Back-link the sceneBlock to this shot
    const block = sceneBlocks[i];
    if (block) block.linkedShotIds.push(shotId);

    return {
      id: shotId,
      index: i,
      label: `Scene ${i + 1}`,
      startSeconds: scene.start_time,
      endSeconds: scene.end_time,
      prompt: scene.scene_prompt,
      model: "veo3_fast",
      resolution: "720p",
      aspectRatio: "16:9",
      includeMainAudio: true,
      referenceAssetIds: [],
      generatedAssetIds: assetIds,
      validation: EMPTY_VALIDATION,
      outputs: [],
      selected: false,
    };
  });

  const sceneTrack: MetadataTrack = {
    id: sceneTrackId,
    label: "Neural Frames Scenes",
    kind: "sections",
    visible: true,
    locked: false,
    color: "#4da8ff",
    blocks: sceneBlocks,
  };

  // ── Characters → metadata track ────────────────────────────────────────────
  const charTrackId = uuid();
  const rawCharacters: typeof props.characters = Array.isArray(props.characters) ? props.characters : [];
  const charBlocks: MetadataBlock[] = rawCharacters.map((char) => ({
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
  }));

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
  const rawLoras: typeof props.loras = Array.isArray(props.loras) ? props.loras : [];
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
        kind: "note",
        startSeconds: 0,
        endSeconds: duration,
        text: props.storyboard_prompt,
        linkedShotIds: [],
        linkedGeneratedAssetIds: [],
        source: "llm",
        importSource: "neuralframes",
      },
      ...(audioMeta.video_idea
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

  // ── Timing hints ───────────────────────────────────────────────────────────
  const section: SongSection = {
    id: uuid(),
    label: "Full song",
    type: "custom",
    startSeconds: 0,
    endSeconds: duration,
    confidence: 0.5,
  };

  return {
    sourcePath,
    storyboardId: uuid(),
    title: audioMeta.video_idea?.slice(0, 60) ?? sourcePath.split("/").pop() ?? "Neural Frames Import",
    scenesImported: (Array.isArray(props.scenes) ? props.scenes : []).length,
    charactersImported: rawCharacters.length,
    lorasImported: rawLoras.length,
    metadataTracks: [sceneTrack, charTrack, loraTrack, notesTrack].filter(
      (t) => t.blocks.length > 0,
    ),
    shots,
    generatedAssets,
    timingHints: { bpm, sections: [section] },
  };
}
