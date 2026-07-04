# Music Video Workflow — Operational Spec

**Status:** Operational (derived from plan)
**Date:** 2026-07-04
**Sources:**
- `docs/superpowers/plans/2026-06-28-music-video-timeline-native.md` (primary)
- `docs/superpowers/plans/2026-07-03-storyboard-ui.md`
- `docs/superpowers/plans/2026-07-03-track-grouping-expansion.md`
- `docs/superpowers/plans/2026-07-03-generate-storyboard-tool.md`
- `docs/superpowers/plans/2026-07-03-alter-storyboard-tool.md`
- `docs/superpowers/plans/2026-07-03-section-identification-flow.md`
- `docs/superpowers/plans/2026-07-03-atlascloud-support.md`
- `docs/superpowers/plans/2026-07-03-audio-auto-subtitle-extraction.md`
- `docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md`

---

## 1. Scope

This spec covers the timeline-native Music Video workflow, replacing the deprecated Music Video wizard/sidebar panel. The workflow MUST:

1. **Start from audio import** — user imports an audio file → creates audio clip + full-duration metadata clip
2. **Use timeline as source of truth** — no wizard, no dialog-local state, all metadata stored as timeline clips and project state
3. **Drive inspector UI with metadata clips** — selected metadata clips route to specialized inspectors (music-video, scene, character, style)
4. **Generate and place assets on timeline** — generated images/videos placed as clips on image/video tracks at shot timings
5. **Centralize job polling** — generation jobs tracked persistently, polling happens out of dialogs in a dedicated hook

### 1.1 No Wizard, No Dummy Media

The implementation MUST NOT:
- Restore a Music Video wizard or panel sidebar
- Use empty/fake mediaId values in clips
- Treat generated assets as placeholders that need finalization
- Poll for generation status inside dialogs

---

## 2. Architecture: Timeline-Native Workflow

### 2.1 Audio Import Flow

When the user selects "Music Video" from AI Tools and imports an audio file:

1. Audio file is imported into the media library
2. An audio track is created (or reused if it exists)
3. An audio clip is added at startTime 0 with the full duration
4. A "Music Video" metadata track is created (or reused)
5. A full-duration metadata clip is added with:
   - `metadata.kind = "music-video"`
   - Clip duration equals audio duration (or project timeline duration as fallback)
   - Real metadata media (not empty/dummy)

The audio clip and metadata clip MUST be in separate tracks. The metadata clip becomes the single source of truth for all music-video state: brief, analysis, storyboard, characters, generation job references.

### 2.2 Metadata Clips: Core Abstraction

Metadata clips are special timeline clips that carry non-visual state. They MUST:

- Always have a non-empty `mediaId` referencing a real `MediaItem`
- Carry metadata in the clip's `metadata` field (not in a separate store)
- Be selectable from the timeline → route to an inspector
- Support arbitrary `kind` values: `"music-video"`, `"scene"`, `"character"`, `"style"`, etc.

Metadata media MUST be lightweight, non-visual items (a small image blob). They SHOULD NOT be expensive to create or persist.

### 2.3 Metadata Media Factory

A dedicated factory MUST create real metadata MediaItems:

```typescript
// apps/web/src/features/music-video/timeline/metadata-media.ts

function createMetadataMedia(
  kind: string,
  label: string,
  color?: string,
  payload?: Record<string, unknown>
): { mediaItem: MediaItem; blob: Blob }

// Returns:
// - mediaItem: a real MediaItem with non-empty id, type="image", and metadata containing kind/label/color/payload
// - blob: a small image Blob that can be saved via saveMediaBlob
```

Requirements:
- No network calls for initial metadata media creation
- Metadata media MUST be a real Blob/File that can be persisted
- `MediaItem.metadata` MUST carry `kind`, `label`, `color`, and any supplied payload
- No dummy or empty mediaId values

### 2.4 Generated Media Insertion API

The project store MUST expose a method to add generated assets as full-fledged MediaItems:

```typescript
// apps/web/src/stores/project-store.ts

function addGeneratedMedia(
  item: MediaItem,
  blob: Blob,
  options?: { assetGroupId?: string; isCurrent?: boolean }
): ActionResult
```

Requirements:
- Saves the blob through `saveMediaBlob`
- Inserts the item into the media library with `isPlaceholder: false` and `isPending: false`
- Does NOT overwrite existing media IDs
- Returns `ActionResult` for failure visibility
- Do NOT reuse `addPlaceholderMedia` for available generated assets

### 2.5 Metadata Clip Creation Helper

A helper MUST atomically create a metadata track, media, and clip:

```typescript
// apps/web/src/features/music-video/timeline/metadata-clips.ts

interface AddMetadataClipParams {
  trackName: string;  // e.g., "Music Video", "Scenes"
  kind: string;       // e.g., "music-video", "scene", "character"
  label: string;      // display name
  color?: string;
  startTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

function addMetadataClip(
  params: AddMetadataClipParams
): { trackId: string; mediaId: string; clipId: string }
```

Requirements:
- Creates or finds the named metadata track
- Creates real metadata media via the factory
- Adds the media to the library via `addGeneratedMedia`
- Adds the clip via `addClip`
- Never calls `addClip` with an empty mediaId
- Returns track/media/clip IDs

---

## 3. AI Tools as Timeline Actions

The AI Tools tab (AIGenTab.tsx) MUST expose these actions:

| Action | Behavior | Input |
|--------|----------|-------|
| Music Video | Asks for audio file, calls createMusicVideoFromAudio flow | audio/* file picker |
| Neural Frames Import | Asks for storyboard JSON, creates timeline metadata clips | JSON file picker |
| Generate Image/Video | Opens generation dialog for current shot/section | no file input |
| Jobs | Opens job management panel | none |

Requirements:
- Music Video action does NOT open a wizard or panel
- Neural Frames action does NOT open a card/panel; metadata clips appear directly on timeline
- Generate Image/Video action opens unified `GenerateAssetDialog` (not music-video-specific)
- Jobs action routes to job management panel (see §6)
- MusicVideoPanel MUST NOT be imported or rendered from AIGenTab

---

## 4. Metadata Clip Inspector Routing

### 4.1 Routing by Kind

When a timeline clip is selected and its metadata has a `kind` field, the inspector MUST route to a specialized handler:

| kind | Inspector | File |
|------|-----------|------|
| `"music-video"` | MusicVideoMetadataInspector | `apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx` |
| `"scene"` | SceneMetadataInspector | `apps/web/src/components/editor/inspector/SceneMetadataInspector.tsx` |
| `"character"` | CharacterMetadataInspector | `apps/web/src/components/editor/inspector/CharacterMetadataInspector.tsx` |
| `"style"` | StyleMetadataInspector | `apps/web/src/components/editor/inspector/StyleMetadataInspector.tsx` |
| unknown | MinimalMetadataFallback | (inline in MetadataClipInspector) |

Implementation MUST be in:
- `apps/web/src/components/editor/inspector/MetadataClipInspector.tsx` (routing dispatch)
- `apps/web/src/components/editor/InspectorPanel.tsx` (register detector)

Requirements:
- Unknown metadata kind shows a minimal read-only fallback, not a crash
- Routing is driven ONLY by selected timeline metadata clips
- No sidebar wizard
- Each inspector is a specialized React component scoped to the selected clip

### 4.2 Inspector Shell

The `MetadataClipInspector` MUST:

1. Detect when selected clip has `metadata.kind`
2. Route to the appropriate specialized inspector
3. Provide a shared header showing:
   - Clip timeline position and duration
   - Edit timing controls (trim)
   - Metadata label/color picker

---

## 5. Music Video Inspector Workflow

### 5.1 Workflow Phases

The `MusicVideoMetadataInspector` MUST support these sequential phases:

#### Phase 1: Creative Brief

Editable fields:
- **Title** — song/video title
- **Description** — narrative summary
- **Tone/Mood** — drop-down or free text (uplifting, dark, surreal, etc.)
- **Visual Style** — e.g., "abstract geometric", "photorealistic", "claymation"

Behavior:
- Changes persist to the selected metadata clip's metadata
- No requirement to lock/finalize; editing is continuous

#### Phase 2: Audio Analysis

Display:
- Analysis status (not analyzed / analyzing / complete)
- "Analyze Audio" button when no analysis exists
- Results summary: BPM, genre, mood, energy, section count

Button: "Review Analysis" → opens analysis dialog to selectively apply results

Behavior:
- Triggers analysis via `AudioAnalysisBridge` (see Audio Analysis & Subtitles spec)
- Results persist to project state

#### Phase 3: Storyboard Generation & Management

Display:
- List of generated storyboard shots (if any)
- Buttons: "Generate Storyboard" (new), "Alter Storyboard" (edit existing)
- For each shot: start time, duration, description, characters list

Behavior:
- "Generate Storyboard" button opens dialog → collects brief, confirmed sections, lyrics → calls orchestrator
- "Alter Storyboard" button (when shots exist) → opens alter dialog → refines shots
- Generated shots stored in music-video store, visible in inspector

#### Phase 4: Characters

Display:
- List of characters referenced in storyboard shots
- For each character: name, description, reference image (if any), link to character metadata clips

Behavior:
- Selecting a character shows its timeline character metadata clips (if any)
- "Add Character" button creates a new character metadata clip on a Characters track
- Character mentions inside scene/shot prompts elsewhere in the workflow (e.g., Phase 3 storyboard shot prompts) MUST render as inline pills that link back to this character's clip, per `inspector-shell.md` §3.8 (Character Pills in Prompt Fields).

#### Phase 5: Reference Images

Display:
- Grid of selected reference images
- "Add Reference" button → opens reference picker

Behavior:
- Used by generation (see §6.3)
- Stored in music-video project store
- Reference image grid entries MUST be clickable and MUST link to their source character/clip when resolvable, per `inspector-shell.md` §3.8.6 (Reference Images Pane).

#### Phase 6: Generation Actions

Display:
- For each shot in the storyboard, a "Generate Image/Video" button
- Shows job status for in-progress or completed generations (if linked via assetGroupId)

Behavior:
- Clicking triggers `GenerateAssetDialog` with shot timing and metadata context
- Completed output appears as a job in the job panel and as an asset version in the library

### 5.2 Store Integration

The `music-video-store` MUST provide these actions:

```typescript
interface MusicVideoProjectState {
  projectId: string;

  // Creative brief
  brief?: CreativeBrief;
  setBrief(projectId: string, brief: CreativeBrief): void;

  // Storyboard shots
  shots?: Shot[];
  setShots(projectId: string, shots: Shot[]): void;
  addShot(projectId: string, shot: Shot): void;
  updateShot(projectId: string, shotId: string, patch: Partial<Shot>): void;
  removeShot(projectId: string, shotId: string): void;

  // Characters
  characters?: CharacterRef[];
  addCharacter(projectId: string, char: CharacterRef): void;
  updateCharacter(projectId: string, charId: string, patch: Partial<CharacterRef>): void;

  // Reference images
  referenceImageIds?: string[];
  addReferenceImage(projectId: string, mediaId: string): void;
  removeReferenceImage(projectId: string, mediaId: string): void;

  // Audio analysis
  audioAnalysis?: AudioAnalysisData;
  setAudioAnalysis(projectId: string, data: AudioAnalysisData): void;
}
```

---

## 6. Neural Frames Metadata Import

### 6.1 Storyboard JSON Structure

Storyboard JSON files MUST be imported to create timeline metadata clips, one per scene/character/style block in the JSON.

Behavior:
- Each storyboard scene becomes a `"scene"` metadata clip
- Scene start/end times come from the JSON
- Scene metadata carries: prompt, referenced asset IDs, etc.

- Each character block becomes a `"character"` metadata clip
- Character span: either full duration, or the range of scenes it appears in
- Character metadata carries: name, description, reference asset IDs

- Each style/LoRA block becomes a `"style"` metadata clip
- Style span: full duration if not tied to a specific scene range; otherwise the range it covers
- Style metadata carries: style prompt, LoRA name/weight, generation inputs

### 6.2 Real Metadata Media

The Neural Frames import tab MUST use `addMetadataClip` helper to create timeline metadata clips:

```typescript
// apps/web/src/features/music-video/components/NeuralFramesImportTab.tsx

function importNeuralFramesStoryboard(json: StoryboardJSON) {
  for (const scene of json.scenes) {
    addMetadataClip({
      trackName: "Scenes",
      kind: "scene",
      label: scene.name,
      startTime: scene.startSeconds,
      duration: scene.endSeconds - scene.startSeconds,
      metadata: { prompt: scene.prompt, assetIds: scene.assetIds }
    });
  }
  // Similar for characters and styles...
}
```

Requirements:
- Every imported metadata block becomes a valid timeline clip
- No empty mediaId values
- Storyboard scenes use `kind="scene"`
- Character clips use `kind="character"`
- Style/LoRA clips use `kind="style"`

---

## 7. Metadata Clip Inspectors: Scene, Character, Style

### 7.1 Scene Inspector

Editable fields:
- **Prompt** — generation prompt for this scene. Character and reference-asset mentions in this field (`@token` syntax) MUST render as inline pills per `inspector-shell.md` §3.8 (Character Pills in Prompt Fields) — never as plain text or a separate mention list.
- **Duration** — trim handles to adjust shot timing
- **Referenced Assets** — list of asset IDs (images, 3D models, textures)
- **Generated Assets** — shows linked generated images/videos (via assetGroupId)

### 7.2 Character Inspector

Editable fields:
- **Name** — character name
- **Description** — physical description, personality
- **Reference Images** — grid of uploaded reference images; entries MUST link back to the source clip/media item, per `inspector-shell.md` §3.8.6 (Reference Images Pane)
- **Clip Timing** — adjust when the character appears (trim handles)

### 7.3 Style Inspector

Editable fields:
- **Style Prompt** — textual description of the visual style
- **LoRA Name & Weight** — if using fine-tuned LoRA
- **Generation Inputs** — provider-specific inputs (e.g., guidance scale, sampler)
- **Scope** — applies to all scenes or a specific range (trim handles)

### 7.4 Implementation

All three inspectors MUST:
- Update clip metadata and music-video store data consistently
- Use clip trim handles for timing adjustment
- Not add project-wide side panels
- Keep controls small and specific to the clip kind

Files:
- `apps/web/src/components/editor/inspector/SceneMetadataInspector.tsx`
- `apps/web/src/components/editor/inspector/CharacterMetadataInspector.tsx`
- `apps/web/src/components/editor/inspector/StyleMetadataInspector.tsx`
- `apps/web/src/components/editor/inspector/TimelineMetadataInspectors.test.tsx`

---

## 8. Asset Versioning and Timeline Placement

### 8.1 Asset Group Version Fields

The `MediaItem` type MUST be extended with:

```typescript
interface MediaItem {
  // ...existing fields...

  assetGroupId?: string;      // links multiple versions of the same generated asset
  isCurrent?: boolean;        // marks the active version in the group (default: true)
  generationMeta?: {
    providerId: string;       // "kieai" or "wavespeed"
    jobId: string;
    prompt: string;
    inputs?: Record<string, unknown>;
    completedAt?: number;
  };
}
```

Requirements:
- Each version gets a distinct media ID
- All versions in a group share the same `assetGroupId`
- Only one version in a group has `isCurrent: true`
- Each version has its own persistent blob

Store actions:
```typescript
function addAssetVersion(
  projectId: string,
  item: MediaItem,
  blob: Blob,
  assetGroupId: string
): ActionResult

function setCurrentAssetVersion(
  projectId: string,
  assetGroupId: string,
  mediaId: string
): ActionResult
```

### 8.2 Placing Generated Assets on Timeline

When the user accepts a generated image/video result:

1. The completion handler receives the output (image/video blob)
2. An `addAssetVersion` call creates a MediaItem with `assetGroupId` and generation metadata
3. A timeline clip is created on the appropriate track (image/video):
   - Track type: "image" for image results, "video" for video results
   - Timing: shot's `startTime` and `duration`
   - Clip metadata: links `shotId`, `assetGroupId`, provider job ID

Implementation:
- `apps/web/src/features/music-video/timeline/place-generated-asset.ts`
- Called by the job completion poller (see §9)

Requirements:
- Images go to image tracks; videos go to video tracks
- Start time and duration come from shot timing, not the playhead
- Do not duplicate clips if the same version is already placed for that shot

---

## 9. Persistent Generation Job Store and Polling

### 9.1 Generation Job Store

A new `generation-job-store.ts` MUST track KieAI and WaveSpeed jobs persistently:

```typescript
interface GenerationJob {
  id: string;                           // unique local job ID
  projectId: string;
  kind: "image" | "video" | "audio";
  provider: "kieai" | "wavespeed";     // generation provider
  model: string;                        // e.g., "flux-pro", "runway-gen-3"
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  prompt: string;
  inputs?: Record<string, unknown>;
  providerId?: string;                  // external job ID from KieAI/WaveSpeed
  outputUrl?: string;                   // URL to the generated output
  linkedMediaIds?: string[];            // media IDs created from this job
  linkedShotIds?: string[];             // shots that will receive placed clips
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retriedFrom?: string;                 // original job ID if this is a retry
}

interface GenerationJobState {
  jobs: GenerationJob[];
  enqueue(job: GenerationJob): void;
  updateStatus(jobId: string, status: string, updates?: Partial<GenerationJob>): void;
  markCompleted(jobId: string, outputUrl: string, mediaIds: string[]): void;
  markFailed(jobId: string, error: string): void;
  retry(jobId: string): string;         // returns new job ID
  cancel(jobId: string): void;
}
```

Requirements:
- Jobs persist through Zustand `persist` middleware
- One store covers both KieAI and WaveSpeed
- Job status is explicit (queued, running, completed, failed, canceled)
- Retry creates a new provider job ID while preserving logical history
- Store is loaded on app startup; jobs in "running" state are polled

### 9.2 Centralized Job Polling

A hook `useGenerationJobPoller` MUST handle polling out of dialogs:

```typescript
// apps/web/src/hooks/useGenerationJobPoller.ts

function useGenerationJobPoller(projectId: string) {
  // Polls all "running" jobs in the project
  // On completion:
  //   1. Downloads output
  //   2. Calls addAssetVersion to create media
  //   3. Calls placeGeneratedAsset to create timeline clip(s)
  //   4. Updates job status to "completed"
  // On failure:
  //   1. Updates job status to "failed"
  //   2. Stores error message
}
```

Requirements:
- Polling happens centrally, not inside `GenerateAssetDialog`
- Poller is idempotent across re-renders
- On job completion, download output and call `placeGeneratedAsset` automatically
- No blocking await; poller runs in background via `useEffect`
- Job status updates trigger UI re-renders (showing job panel updates in real time)

### 9.3 Submission Flow

`GenerateAssetDialog` MUST:

1. On submit: call the KieAI or WaveSpeed API to queue the job
2. Immediately enqueue the job in `generation-job-store` with provider job ID
3. Close the dialog (do NOT wait for completion)
4. Job poller takes over from here

Behavior:
- User sees the dialog close immediately after submission
- Job progress is visible in the job panel (see §9.4)
- No modal polling inside the dialog

---

## 9.4 Job Management Panel

A new `JobManagementPanel` component MUST display all active and historical generation jobs:

```typescript
// apps/web/src/components/editor/generate/JobManagementPanel.tsx
```

Display:
- Active job count badge on the AI Tools tab
- Panel lists jobs grouped by status:
  - **Running** — with progress indicator if available
  - **Completed** — with generated output thumbnail
  - **Failed** — with error message
  - **Canceled**

Actions per job:
- **Retry** — re-enqueue a failed job (creates new provider job ID)
- **Cancel** — mark local job as canceled, stop polling
- **View Result** — select or preview the generated media in assets panel
- **Use as Reference** — select as reference image for next generation

Requirements:
- Panel is a dedicated tool, not part of the Music Video workflow inspector
- Active job count badge updates in real time
- Cancel action marks job canceled locally; provider cancellation is optional
- Use-as-Reference selects the media item as a reference input

---

## 10. Reference Image Selection and Upload

### 10.1 Reference Picker

A new `ReferenceImagePicker` component MUST allow users to select or upload reference images during generation:

```typescript
// apps/web/src/components/editor/generate/ReferenceImagePicker.tsx
```

Features:
- Grid view of media library images
- Upload new image button → opens file picker
- Selected images marked with a checkmark
- Drag to reorder selected images
- "Clear" button to deselect all

Behavior:
- Supports multi-select
- Upload immediately imports the file and persists blob
- Selected images persist to music-video store

### 10.2 Provider Integration

The `GenerateAssetDialog` MUST map selected reference images to provider inputs:

**KieAI:**
- Image models that support references → include in request as base images or guidance inputs
- Mapping: look for "reference_image", "image", "guidance_image" fields in model schema

**WaveSpeed:**
- Schema-based: for each selected image, populate the appropriate URI/image field in the request schema
- Mapping: use the schema `properties` to find image-accepting fields

Requirements:
- Do NOT guess provider field names
- Map only documented KieAI fields and WaveSpeed schema URI/image fields
- Reference picker only exposes image media (not video/audio)

---

## 11. Project Recovery

### 11.1 Recovery Flow

The project recovery system MUST restore saved project state AND associated media blobs:

```typescript
// apps/web/src/hooks/useProjectRecovery.ts
// apps/web/src/services/auto-save.ts
```

Behavior:
1. On startup, check for a saved project in IndexedDB
2. If found, show recovery dialog with project name and timestamp
3. On "Recover" click:
   - Load project JSON from IndexedDB
   - Load media blobs from IndexedDB
   - Re-populate `project-store` with project state
   - Restore media library items as available (not Missing)
   - Mark project as recovered

### 11.2 Acceptance Criteria

Requirements:
- A regression test reproduces the broken recovery behavior
- Recovered project state is fully restored
- Recovered media items with stored blobs render as available, NOT Missing
- Recovery failure surfaces a clear error message
- Recovered project must not silently drop media

---

## 12. Backend-First Persistence (Orchestrator Route)

### 12.1 Metadata Clip Storage

The orchestrator MUST NOT require special handling for metadata clips. Metadata clips:
- Are persisted as normal timeline clips in the project JSON
- Have a real `mediaId` that references a media library item
- Store all music-video state in the clip's `metadata` field

No special backend serialization is needed.

### 12.2 Audio Analysis Results

If using a Python FastAPI audio analysis service (see Audio Analysis & Subtitles spec), the orchestrator MUST:
- Cache results by SHA-256 hash of the audio file
- Return cached results on repeat requests
- Persist cache in a simple file-based or database store

---

## 13. TODO: Future Enhancements

- [ ] **Chunked Audio Upload** — support very long audio files (>1 hour) via streaming or chunked upload
- [ ] **Collaborative Storyboarding** — real-time sync of scene/character edits across multiple users
- [ ] **Dynamic Shot Generation** — auto-generate missing shots based on filled gaps
- [ ] **Multi-Language Support** — translate brief, prompts, and UI for international workflows
- [ ] **Asset Library Sync** — two-way sync between local library and cloud assets (AtlasCloud)
- [ ] **Advanced LoRA Management** — UI for fine-tuning and versioning style LoRAs
- [ ] **Automated Subtitle Burn-In** — generate SRT subtitles from audio and auto-burn into render
- [ ] **Provider Load Balancing** — automatically choose between KieAI/WaveSpeed based on queue depth

---

## 14. Implementation Roadmap

This spec maps to the atomic tasks in the plan:

| Task | Deliverable | Spec Section |
|------|-------------|--------------|
| 01 | Metadata media factory | §2.3 |
| 02 | Generated media insertion API | §2.4 |
| 03 | Metadata clip creation helper | §2.5 |
| 04 | Audio import flow | §2.1 |
| 05 | AI Tools as timeline actions | §3 |
| 06 | Metadata clip inspector routing | §4 |
| 07 | Music Video inspector workflow | §5 |
| 08 | Neural Frames metadata import | §6 |
| 09 | Scene/character/style inspectors | §7 |
| 10 | Asset group version fields | §8.1 |
| 11 | Place generated assets on timeline | §8.2 |
| 12 | Persistent generation job store | §9.1 |
| 13 | Centralized job polling | §9.2–9.3 |
| 14 | Job management panel | §9.4 |
| 15 | Reference image selection and upload | §10 |
| 16 | Project recovery diagnosis and fix | §11 |
| 17 | E2E smoke test | (all sections) |

---

## 15. Related Specifications

- **Audio Analysis & Subtitles** — audio analysis pipeline, sentiment time-series, section identification, subtitle track/clip type
- **Export** — how to export storyboard and generated assets
- **Backend Persistence & Versioning** — project save/load contract
- **AI Generation Providers** — KieAI and WaveSpeed API contracts
- **Inspector Shell** — generic inspector architecture

---

## 16. Key Principles

1. **Timeline as source of truth:** All music-video state lives on the timeline (metadata clips + project store), never in a separate wizard or sidebar.

2. **Real media, no dummies:** Every clip, including metadata clips, MUST have a real, non-empty mediaId pointing to a persisted MediaItem.

3. **Metadata clips as first-class citizens:** Clips can carry semantic metadata (kind, brief, analysis, etc.); the inspector routes based on kind.

4. **No blocking UI during generation:** Jobs are enqueued and polled centrally; the dialog closes immediately after submission.

5. **Backward compatibility:** Existing code that interacts with clips, tracks, and media MUST NOT break; metadata clips extend existing abstractions, not replace them.
