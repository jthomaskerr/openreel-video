/**
 * @openreel/music-video-domain — shared types for the music video feature.
 *
 * These are pure TypeScript interfaces used by both the React frontend and the
 * Node orchestrator. No runtime dependencies.
 */

// ── Primitives ────────────────────────────────────────────────────────────────

export type GenerationProvider = "wavespeed" | "kie-ai" | "veo" | "kling" | "runway" | string;

export const DEFAULT_SHOT_MODEL = "veo3_fast";
export const DEFAULT_IMAGE_MODEL = "flux-kontext-pro";
export const DEFAULT_RESOLUTION = "720p";
export const DEFAULT_ASPECT_RATIO = "16:9";

export interface GenerationDefaults {
  provider: GenerationProvider;
  shotModel: string;
  referenceModel: string;
  resolution: string;
  aspectRatio: string;
  seed?: number;
}

export interface TimingMarker {
  id: string;
  timeSeconds: number;
  kind: "beat" | "bar" | "downbeat" | "section_boundary" | "custom";
  confidence?: number;
}

export interface EnergyPoint {
  timeSeconds: number;
  value: number; // 0..1
}

export interface ValidationMessage {
  code: string;
  message: string;
  field?: string;
  fixHint?: string;
}

export interface ValidationState {
  valid: boolean;
  warnings: ValidationMessage[];
  errors: ValidationMessage[];
}

export interface GenerationJob {
  id: string;
  kind: "generated_asset_batch" | "shot_batch";
  shotIds: string[];
  generatedAssetIds: string[];
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  progress: number; // 0..1
  createdAt: string;
  completedAt?: string;
}

export interface AssetRef {
  id: string;
  kind: "imported" | "generated";
  assetId: string;
  role: "source" | "reference" | "first_frame" | "last_frame" | "style" | "mask" | "audio";
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioAsset {
  id: string;
  name: string;
  durationSeconds: number;
  localPath: string; // absolute path on local filesystem
  bpm?: number;
  waveformData?: number[]; // normalised amplitude samples for display
}

// ── Timing ────────────────────────────────────────────────────────────────────

export type SongSectionType =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "drop"
  | "outro"
  | "custom";

export interface SongSection {
  id: string;
  label: string;
  type: SongSectionType;
  startSeconds: number;
  endSeconds: number;
  energyLevel?: "low" | "medium" | "high";
  confidence?: number;
}

export interface TimingAnalysis {
  bpm: number | null;
  timeSignature?: number;
  beats: TimingMarker[];
  bars: TimingMarker[];
  sections: SongSection[];
  energy: EnergyPoint[];
  lyrics: LyricSegment[];
  source: "auto" | "manual" | "llm-assisted" | "neuralframes";
}

export interface LyricSegment {
  id: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

// ── Metadata tracks ───────────────────────────────────────────────────────────

export type MetadataTrackKind =
  | "sections"
  | "notes"
  | "lyrics"
  | "beats"
  | "motifs"
  | "continuity"
  | "custom";

export type MetadataBlockKind =
  | "section"
  | "note"
  | "lyric"
  | "beat_cue"
  | "visual_motif"
  | "continuity_note"
  | "custom";

export interface MetadataBlock {
  id: string;
  trackId: string;
  label: string;
  kind: MetadataBlockKind;
  startSeconds: number;
  endSeconds?: number;
  text: string;
  color?: string;
  linkedShotIds: string[];
  linkedGeneratedAssetIds: string[];
  source: "user" | "timing-analysis" | "llm";
  importSource?: "neuralframes" | "manual" | "llm" | "audio-analysis";
  importId?: string;
  /** Thumbnail URL from external import sources (e.g. Neural Frames image_job.assets). */
  thumbnailUrl?: string;
}

export interface MetadataTrack {
  id: string;
  label: string;
  kind: MetadataTrackKind;
  visible: boolean;
  locked: boolean;
  color?: string;
  blocks: MetadataBlock[];
}

// ── Creative brief ────────────────────────────────────────────────────────────

export interface CreativeBrief {
  format: string;       // "performance" | "narrative" | "abstract" | "lyric video" | "hybrid"
  genre: string;        // "pop" | "rock" | "hip-hop" | etc.
  visualStyle: string;  // "noir" | "VHS" | "documentary" | etc.
  pacing: string;       // "sparse" | "medium" | "rapid" | "beat-cut"
  continuity: string;   // "independent shots" | "continuous story" | etc.
  colorPalette: string[];
  cameraLanguage: string;
  subjectNotes: string;
  customPrompt: string;
  defaults: GenerationDefaults;
}

// ── Generated assets ──────────────────────────────────────────────────────────

export type GeneratedAssetStatus =
  | "unrealized"
  | "queued"
  | "submitting"
  | "processing"
  | "realized"
  | "failed"
  | "cancelled";

export interface GenerationAttempt {
  id: string;
  kind: "reference" | "shot";
  status:
    | "pending"
    | "queued"
    | "submitting"
    | "submitted"
    | "processing"
    | "complete"
    | "failed"
    | "cancelled";
  provider: GenerationProvider;
  model: string;
  requestId?: string;
  submittedAt?: string;
  completedAt?: string;
  outputAssetId?: string;
  outputPath?: string;
  error?: string;
  costUsd?: number;
  creditsConsumed?: number;
  planSnapshot: unknown;
}

export interface GeneratedAsset {
  id: string;
  label: string;
  mediaType: "image" | "video";
  status: GeneratedAssetStatus;
  provider: GenerationProvider;
  model: string;
  prompt: string;
  negativePrompt?: string;
  sourceAssets: AssetRef[];
  sourceMetadataBlockIds: string[];
  outputAssetId?: string;
  outputPath?: string; // local filesystem path once realized
  validation: ValidationState;
  attempts: GenerationAttempt[];
}

// ── Storyboard shots ──────────────────────────────────────────────────────────

export interface StoryboardShot {
  id: string;
  index: number;
  label: string;
  sectionId?: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  videoPrompt?: string;
  negativePrompt?: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  fps?: number;
  style?: string;
  renderMode?: string;
  seed?: number;
  includeMainAudio: boolean;
  referenceAssetIds: string[];
  generatedAssetIds: string[];
  validation: ValidationState;
  outputs: GenerationAttempt[];
  selected: boolean;
}

// ── Project ───────────────────────────────────────────────────────────────────

export interface MusicVideoProject {
  id: string;
  title: string;
  /** ID of the corresponding OpenReel project */
  openreelProjectId?: string;
  audio: AudioAsset | null;
  creativeBrief: CreativeBrief;
  timing: TimingAnalysis | null;
  metadataTracks: MetadataTrack[];
  generatedAssets: GeneratedAsset[];
  shots: StoryboardShot[];
  generationJobs: GenerationJob[];
  neuralFramesImportId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Neural Frames import ──────────────────────────────────────────────────────

export interface NeuralFramesAudio {
  duration: number;
  bpm?: number;
  key?: string;
  scale?: string;
  hasLyrics?: boolean;
  videoIdea?: string;
  /** URL of the trimmed audio file (from trimmed_audio_path). */
  audioUrl?: string;
  /** URL of the album artwork (from primary_audio_artwork_image_url). */
  artworkUrl?: string;
}

/** Raw Neural Frames storyboard JSON shape (only fields we use) */
export interface NeuralFramesStoryboard {
  storyboard_props: {
    storyboard_prompt: string;
    title?: string;
    model?: string;
    resolution?: string;
    fps?: number;
    aspect_ratio?: string;
    style?: string;
    render_mode?: string;
    scenes: Array<{
      id: string;
      scene_prompt: string;
      start_time: number;
      end_time: number;
      status: string;
      scene_image_url?: string;
    }>;
    characters: Array<{
      id: string;
      name: string;
      image_job?: { assets: Array<{ url: string }> };
    }>;
    loras: Array<{
      id: string;
      name: string;
      training_image_urls: string[];
    }>;
  };
  audio?: {
    duration: number;
    trimmed_audio_path?: string;
    primary_audio_artwork_image_url?: string;
    audio_analysis: {
      bpm?: number;
      key?: string;
      scale?: string;
      video_idea?: string;
      has_lyrics?: boolean;
    };
  };
}

export interface NeuralFramesImportResult {
  sourcePath: string;
  storyboardId: string;
  title: string;
  scenesImported: number;
  charactersImported: number;
  lorasImported: number;
  metadataTracks: MetadataTrack[];
  shots: StoryboardShot[];
  generatedAssets: GeneratedAsset[];
  audio: NeuralFramesAudio;
  /** Map of original remote URL → backend-served local URL. Populated by the import route after downloading assets. */
  remoteUrlMap?: Record<string, string>;
}
