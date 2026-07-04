import { describe, expect, it } from "vitest";
import type {
  NeuralFramesImportResult,
  NeuralFramesStoryboard,
  MetadataTrack,
  MetadataBlock,
  StoryboardShot,
  NeuralFramesAudio,
  ValidationState,
} from "./types.js";
import { buildImportPlan } from "./adapter.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

const OK_VALIDATION: ValidationState = { valid: true, warnings: [], errors: [] };

function makeShot(overrides: Partial<StoryboardShot> & { id: string; label: string; prompt: string }): StoryboardShot {
  return {
    index: 0,
    startSeconds: 0,
    endSeconds: 5,
    model: "animatediff",
    resolution: "512x512",
    aspectRatio: "16:9",
    includeMainAudio: false,
    referenceAssetIds: [],
    generatedAssetIds: [],
    validation: OK_VALIDATION,
    outputs: [],
    selected: false,
    ...overrides,
  };
}

function makeBlock(overrides: Partial<MetadataBlock> & { id: string; kind: MetadataBlock["kind"] }): MetadataBlock {
  return {
    trackId: "track-1",
    label: overrides.id,
    startSeconds: 0,
    endSeconds: 5,
    text: "",
    linkedShotIds: [],
    linkedGeneratedAssetIds: [],
    source: "neuralframes",
    importSource: "neuralframes",
    ...overrides,
  };
}

function makeTrack(overrides: Partial<MetadataTrack> & { id: string; blocks: MetadataBlock[] }): MetadataTrack {
  return {
    label: overrides.id,
    kind: "notes",
    visible: true,
    locked: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<NeuralFramesImportResult> = {}): NeuralFramesImportResult {
  return {
    sourcePath: "",
    storyboardId: "sb-1",
    title: "Test Storyboard",
    scenesImported: 0,
    charactersImported: 0,
    lorasImported: 0,
    metadataTracks: [],
    shots: [],
    generatedAssets: [],
    audio: { duration: 0 },
    ...overrides,
  };
}

function makeRaw(overrides: Partial<NeuralFramesStoryboard> = {}): NeuralFramesStoryboard {
  return {
    storyboard_props: {
      storyboard_prompt: "test prompt",
      scenes: [],
      characters: [],
      loras: [],
      ...(overrides.storyboard_props ?? {}),
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildImportPlan", () => {
  // [regression] Jun 28, Jul 3 — scene clips all getting the same prompt/title;
  // importer was returning only one entry or collapsing distinct shots.
  it("produces one sceneClip per shot with distinct prompts and labels", () => {
    const shots: StoryboardShot[] = [
      makeShot({ id: "shot-1", label: "Scene 1", prompt: "a red sky at dusk", index: 0, startSeconds: 0, endSeconds: 5 }),
      makeShot({ id: "shot-2", label: "Scene 2", prompt: "a blue ocean wave", index: 1, startSeconds: 5, endSeconds: 10 }),
    ];
    const result = makeResult({ shots });
    const raw = makeRaw();

    const plan = buildImportPlan(result, raw);

    expect(plan.sceneClips).toHaveLength(2);
    const [clip1, clip2] = plan.sceneClips;
    // Prompts must be distinct — both come from the shot's prompt field
    expect(clip1!.mediaSpec.generationMeta?.prompt).toBe("a red sky at dusk");
    expect(clip2!.mediaSpec.generationMeta?.prompt).toBe("a blue ocean wave");
    // Labels must be distinct
    expect(clip1!.mediaSpec.title).toBe("Scene 1");
    expect(clip2!.mediaSpec.title).toBe("Scene 2");
  });

  // [regression] Jun 30, Jul 3 — audio clip not produced even when audio is present.
  it("produces a non-null audioClip when result.audio has an audioUrl", () => {
    const audio: NeuralFramesAudio = { duration: 180, audioUrl: "https://cdn.example.com/track.mp3" };
    const result = makeResult({ audio });

    const plan = buildImportPlan(result, makeRaw());

    expect(plan.audioClip).not.toBeNull();
    expect(plan.audioClip!.duration).toBe(180);
  });

  // [regression] Jun 30 — crash or unexpected clip when audio field is absent/empty.
  it("returns null audioClip and does not crash when audio has no url and zero duration", () => {
    const audio: NeuralFramesAudio = { duration: 0 };
    const result = makeResult({ audio });

    const plan = buildImportPlan(result, makeRaw());

    expect(plan.audioClip).toBeNull();
  });

  // [regression] Jun 28, Jun 30 — director/note blocks not appearing in metadataClips.
  it("places a 'note' (director) block into metadataClips", () => {
    const block = makeBlock({ id: "block-note-1", kind: "note", label: "Director note", text: "Keep it dark and moody" });
    const track = makeTrack({ id: "Director Notes", kind: "notes", blocks: [block] });
    const result = makeResult({ metadataTracks: [track] });

    const plan = buildImportPlan(result, makeRaw());

    expect(plan.metadataClips.length).toBeGreaterThan(0);
    const clip = plan.metadataClips.find((c) => c.trackName === "Director Notes");
    expect(clip).toBeDefined();
    expect(clip!.label).toBe("Director note");
    // Must not leak into characterTracks
    expect(plan.characterTracks).toHaveLength(0);
  });

  // [regression] Jun 30 — style/LoRA track added but style clip missing from metadataClips.
  it("places a 'visual_motif' block into metadataClips and preserves its thumbnailUrl", () => {
    const block = makeBlock({
      id: "block-motif-1",
      kind: "visual_motif",
      label: "Cinematic grain",
      thumbnailUrl: "https://cdn.example.com/lora-thumb.jpg",
      importId: "lora-abc",
    });
    const track = makeTrack({ id: "Style Track", kind: "motifs", blocks: [block] });
    const result = makeResult({ metadataTracks: [track] });

    const plan = buildImportPlan(result, makeRaw());

    expect(plan.metadataClips.length).toBeGreaterThan(0);
    const clip = plan.metadataClips.find((c) => c.trackName === "Style Track");
    expect(clip).toBeDefined();
    expect(clip!.thumbnailUrl).toBe("https://cdn.example.com/lora-thumb.jpg");
    // Must not appear in characterTracks
    expect(plan.characterTracks).toHaveLength(0);
  });

  // [regression] Jun 28, Jun 30, Jul 3 — continuity_note blocks (characters) not
  // populating characterTracks; they were silently dropped or merged into metadataClips.
  it("places a track of all-continuity_note blocks into characterTracks, not metadataClips", () => {
    const block = makeBlock({
      id: "block-char-1",
      kind: "continuity_note",
      label: "Zara",
      importId: "char-zara",
    });
    const track = makeTrack({ id: "Zara", kind: "continuity", blocks: [block] });
    const raw = makeRaw({
      storyboard_props: {
        storyboard_prompt: "test",
        scenes: [],
        characters: [{ id: "char-zara", name: "Zara" }],
        loras: [],
      },
    });
    const result = makeResult({ metadataTracks: [track] });

    const plan = buildImportPlan(result, raw);

    expect(plan.characterTracks).toHaveLength(1);
    expect(plan.characterTracks[0]!.trackName).toBe("Zara");
    // Must not bleed into metadataClips
    expect(plan.metadataClips).toHaveLength(0);
  });

  it("returns empty sceneClips without crashing when shots array is empty", () => {
    const result = makeResult({ shots: [] });

    const plan = buildImportPlan(result, makeRaw());

    expect(plan.sceneClips).toHaveLength(0);
  });

  // [regression] Jun 28 — reference images missing from plan.
  it("populates referenceImages for shots that have a referenceImageUrl", () => {
    const shot = makeShot({
      id: "shot-ref-1",
      label: "Scene A",
      prompt: "golden hour",
      referenceImageUrl: "https://cdn.example.com/preview.jpg",
    });
    const result = makeResult({ shots: [shot] });

    const plan = buildImportPlan(result, makeRaw());

    expect(plan.referenceImages.length).toBeGreaterThan(0);
    const refImage = plan.referenceImages.find((r) => r.thumbnailUrl === "https://cdn.example.com/preview.jpg");
    expect(refImage).toBeDefined();
  });
});
