# Media Import & Timeline Placement — Operational Spec

> **Status:** Operational — derived from user directives and implementation plans.
> **Sources:**
> - [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §10
> - [OpenReel Spec Implications report](../superpowers/plans/spec-update/openreel-spec-implications-report.json) (Media Import / Timeline category, 184 messages)
> - [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) — timeline-native Music Video workflow
> - [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md) — storyboard clip metadata contract and track grouping
> - [Music Video Timeline Native decisions](./music-video-timeline-native/decisions.md) — architectural decisions

---

## 1. Scope

This spec defines the normative requirements for importing media into an OpenReel project and placing clips on the timeline. It covers:

- Scene, character, style, and audio import from external formats (Neural Frames JSON, audio files)
- Clip placement rules on timeline tracks
- Metadata clip creation and the storyboard-specialized video clip contract
- Generated asset placement on the timeline
- Missing-file handling and clip status display
- Thumbnail rendering for all clip types
- Track layout consistency across track types

---

## 2. Track Model

### 2.1 Track Types

The timeline supports the following track types, each with a distinct role:

| Track Type | Purpose |
|---|---|
| `video` | Video clips, including storyboard-specialized scene clips |
| `audio` | Audio clips (imported audio, generated audio) |
| `image` | Still image clips (generated images, reference images) |
| `text` | Text clips |
| `graphics` | Shape, SVG, and sticker clips |
| `metadata` | Non-playback metadata clips (characters, sections, styles/LoRAs, music-video workflow) |
| `subtitle` | Timed subtitle clips and imported SRT media |

### 2.2 New Track Dropdown

The timeline's new-track dropdown MUST expose Video Track, Audio Track, Image Track, Text Track, Graphics Track, Metadata Track, Subtitle Track, and Scene Track.

Scene Track is a user-facing specialization of a `video` track, not a new serialized `Track.type`. Creating one MUST create a video track named "Scene Track" and mark clips created through its scene workflow with `metadata.kind === "storyboard-shot"`. This preserves compatibility with playback, persistence, grouping, and the storyboard inspector.

### 2.3 Empty-Space Context Menu

Right-clicking empty space inside a track row MUST open a context menu anchored at the pointer's viewport coordinates. The click determines both the target track and an exact timeline time derived from the pointer's horizontal position. The menu MUST contain:

- Add `<clip type>` for every clip type valid on the target track, as defined below;
- Paste at Clicked Time, enabled only when the clipboard contains a compatible clip;
- Select All Clips on Track;
- Add Track, opening the same new-track choices as the new-track dropdown;
- Rename Track, Duplicate Track, and Delete Track.

Commands that create or paste a clip MUST use the clicked timeline time as `startTime`; they MUST NOT silently append to the end or substitute the playhead time. Delete Track MUST use the standard destructive-action confirmation when the track is non-empty. Locked tracks MUST disable all mutating commands.

| Target track | Valid Add commands |
|---|---|
| `video` | Add Video Clip; Add Image Clip |
| Scene Track (`video` specialization) | Add Scene Clip; Add Video Clip; Add Image Clip |
| `audio` | Add Audio Clip |
| `image` | Add Image Clip |
| `text` | Add Text Clip |
| `graphics` | Add Shape Clip; Add SVG Clip; Add Sticker Clip |
| `metadata` | Add Metadata Clip |
| `subtitle` | Add Subtitle Clip |

An Add command that needs source media MUST open the appropriate media picker filtered to compatible media, then insert the chosen media at the captured clicked time. Commands for source-free types MUST create a default editable clip at that time.

### 2.4 Clip Context Menu Placement

Right-clicking a timeline clip MUST open its context menu at the pointer's viewport coordinates, clamped only as needed to keep the full menu within the visible viewport. The menu MUST be positioned from the context-menu event that opened it, not from the clip's origin, selection rectangle, timeline container, playhead, or a stale previous click. Pointer coordinates MUST remain correct when the timeline is horizontally scrolled, vertically scrolled, or zoomed.

### 2.5 Metadata Track Layout

Metadata tracks MUST reuse the same visual layout as audio and video tracks. They share the same row height, clip rendering primitives, and timeline interaction model (selection, drag, trim). The only difference is that metadata clips do not contribute to playback output.

> **Rationale:** User directives require metadata tracks to look and behave like other tracks, not as a separate UI surface. See implications report: "Metadata tracks should be rendered with the same layout as audio/video tracks."

### 2.6 Track Grouping

Tracks are organized into logical groups for the timeline UI. Grouping is derived from track content and clip metadata — it is view state only and MUST NOT mutate timeline `Track` data or project serialization.

| Group | Membership Rule |
|---|---|
| Storyboard | `video` tracks whose clips carry `metadata.kind === "storyboard-shot"` |
| Characters | Tracks named `Character:*` or containing clips with `metadata.kind === "continuity_note"` |
| Sections | Tracks named `Sections` or containing clips with `metadata.kind === "section"` |
| Metadata | All remaining `metadata` tracks not captured above |
| Audio | All `audio` tracks |
| Fallback | Any track not matching a group above (rendered as a single-track group) |

> **Source:** [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md) Task 04.

---

## 3. Scene Import (Neural Frames)

### 3.1 Import Source

Neural Frames JSON import produces timeline clips from storyboard shot data. The import flow is triggered from the AI Tools tab via a file picker that accepts `.json` files.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 05, Task 08.

### 3.2 Scene Clips on Video Track

Scenes MUST be imported as video clips on a `video` track, NOT as metadata-track entries. Each scene becomes a timeline `Clip` with:

- `trackId` pointing to a `video`-type track (e.g., "Neural Frames Scenes")
- `startTime` and `duration` derived from the shot's `startSeconds` / `endSeconds`
- `mediaId` referencing a real `MediaItem` in the media library (see §3.3)

> **Rationale:** User directives explicitly reject scenes on metadata tracks. Scenes are visual content that belongs on video tracks. See implications report: "Scenes must be imported as video clips on a video track, not metadata track."

### 3.3 Real Metadata Media

Every imported metadata clip (scene, character, style) MUST reference a real `MediaItem` with a non-empty `mediaId`. The system MUST NOT create clips with empty, fake, or placeholder media IDs.

Metadata media is created by a factory (`createMetadataMedia`) that generates a lightweight local image `Blob`/`File` and registers it as a `MediaItem` in the media library. The generated image carries `kind`, `label`, `color`, and `duration` in metadata-compatible fields.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 01, Task 03.
> **Decision:** [Music Video Timeline Native decisions](./music-video-timeline-native/decisions.md) — "Real media for metadata clips."

### 3.4 Storyboard-Specialized Video Clip Metadata Contract

A video clip that represents a storyboard shot MUST carry the following metadata contract:

```ts
interface StoryboardClipMetadata {
  kind: "storyboard-shot";
  shotId: string;
  shotIndex: number;
  label: string;
  prompt: string;
  referenceImageUrl?: string;
  generatedAssetIds: string[];
  source: "neuralframes" | "storyboard-generation" | "manual";
  importSource?: string;
  importId?: string;
}
```

**Field semantics:**

- `kind` — MUST be the literal `"storyboard-shot"`. This is the discriminator that identifies a video clip as the timeline specialization of a `StoryboardShot`.
- `shotId` — MUST match the `StoryboardShot.id` this clip represents.
- `shotIndex` — ordinal position of the shot within the storyboard.
- `label` — human-readable shot label.
- `prompt` — generation prompt text.
- `referenceImageUrl` — URL to the shot's reference image, when available.
- `generatedAssetIds` — array of media IDs for assets generated from this shot.
- `source` — origin of the clip: `"neuralframes"` for Neural Frames imports, `"storyboard-generation"` for in-app storyboard generation, `"manual"` for manually created shots.
- `importSource` — when `source` is `"neuralframes"`, this SHOULD be `"neuralframes"`.
- `importId` — the original import identifier, when available.

> **Source:** [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md) Task 01.

### 3.5 Type Guards

The system MUST provide type guards to identify storyboard-specialized video clips:

- `isStoryboardVideoClip(track, clip)` — returns `true` when `track.type === "video"` AND `clip.metadata.kind === "storyboard-shot"` with a valid `shotId`.
- `getStoryboardClipMetadata(clip)` — extracts and validates `StoryboardClipMetadata` from a clip's metadata, returning `null` for non-storyboard clips.
- `joinStoryboardClipToShot(clip, shots)` — joins a storyboard clip to its matching `StoryboardShot` by `metadata.shotId`.

> **Source:** [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md) Task 02.

### 3.6 Character and Style Clips

Character and style/LoRA metadata from Neural Frames import MUST also create real metadata clips:

- **Character clips** — `metadata.kind === "character"`, placed on a metadata track named `Character: <name>`. Span the character's referenced scene range or full project duration when no tighter range exists.
- **Style/LoRA clips** — `metadata.kind === "style"`, placed on a metadata track. Default to full duration when no tighter range exists.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 08.

---

## 4. Audio Import

### 4.1 Music Video Audio Import Flow

The Music Video workflow starts by importing an audio file. The flow:

1. User triggers "Music Video" from AI Tools, which opens an `audio/*` file picker.
2. The selected audio `File` is imported into the media library.
3. An audio track is created (or reused) and the audio clip is placed at `startTime: 0`.
4. A Music Video metadata track is created with a full-duration metadata clip (`metadata.kind === "music-video"`).
5. The metadata clip is selected, opening the Music Video inspector.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 04.

### 4.2 Audio from Import JSON

When an import JSON references an audio file via `trimmed_audio_path`, the system MUST import that audio file as an audio clip on an audio track. The audio clip MUST be placed at the timeline position indicated by the import data.

> **Source:** Implications report: "Audio files referenced by import JSON (trimmed_audio_path) must be imported into audio clips."

### 4.3 Audio Clip Properties

Audio clips on the timeline MUST support:
- Waveform visualization in the inspector File tab
- Playback controls (play/pause, scrub)
- BPM, key, and scale display (when analysis data is available)
- Click-to-seek on the waveform

---

## 5. Clip Placement Rules

### 5.1 Overlapping Clips

Overlapping clips on a single track MUST be treated as an error. The system MUST validate clip placement and reject any operation that would cause two clips on the same track to overlap in time.

> **Source:** Implications report: "Overlapping clips on a single track must be an error."

### 5.2 Clip Timing

- Clips inherit `startTime` and `duration` from their source data (import JSON shot timing, audio file duration, or explicit user placement).
- When duration is unavailable, the system SHOULD use the project timeline duration as a documented fallback and keep the clip adjustable.
- Audio clips imported for Music Video MUST be placed at `startTime: 0`.

### 5.3 Generated Asset Placement

When a generated image or video asset is accepted, the system MUST place it on the appropriate track at the owning shot's timing:

- **Image results** → placed on an `image` track (created or reused).
- **Video results** → placed on a `video` track (created or reused).
- Clip `startTime` and `duration` MUST come from the shot timing, not the playhead.
- Clip metadata MUST link `shotId`, `assetGroupId`, and provider job ID when available.
- The system MUST NOT create duplicate clips if the same version is already placed for that shot.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 11.

---

## 6. Missing-File Handling

### 6.1 Placeholder Clips

When an import references a file that does not exist on disk, the system MUST still create a clip on the timeline. The clip MUST be created with a "Link file" action available to the user, allowing them to resolve the missing file later by providing a replacement.

> **Source:** Implications report: "Missing files during import must still create clips with a 'Link file' action."

### 6.2 Missing-File Thumbnail Fallback

When a video file is missing, the clip thumbnail MUST fall back to:
1. The first first-frame reference image, if available.
2. The first `reference_image` associated with the clip, if available.
3. A generic "missing file" placeholder as a last resort.

> **Source:** [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §12.

---

## 7. Clip Status Badges

### 7.1 Generation Status

Generated clips MUST display status badges reflecting their generation job state:

| Status | Badge | Meaning |
|---|---|---|
| `queued` | Pending | Job enqueued, not yet started |
| `running` | Generating | Job is actively running on the provider |
| `completed` | Done | Generation succeeded, asset is available |
| `failed` | Failed | Generation failed; retry available |
| `canceled` | Cancelled | Job was cancelled by user or system |

> **Source:** Implications report: "Generated clips must display status badges (pending, cancelled, failed, etc.)."
> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 12 (generation job store with explicit statuses).

### 7.2 Job Lifecycle

- Job status transitions: `queued` → `running` → `completed` | `failed` | `canceled`.
- Retry creates a new provider job ID while preserving logical job history.
- Cancellation marks the local job as `canceled`; provider-side cancellation is attempted only when the provider API supports it.
- The job management panel groups jobs by status and exposes retry, cancel, view result, and use-as-reference actions.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 12, Task 14.

---

## 8. Timeline Thumbnails

### 8.1 Thumbnail Requirements by Clip Type

Timeline thumbnails MUST be shown for all clip types that support visual representation:

| Clip Type | Thumbnail Source |
|---|---|
| Video clip (with available file) | Frame sequence extracted every N seconds |
| Video clip (missing file) | Reference image fallback (see §6.2) |
| Image clip | The image itself, repeated to fill clip width |
| Audio clip | Waveform visualization |
| Metadata clip (character) | Character reference image |
| Metadata clip (scene/storyboard) | Shot reference image |
| Metadata clip (style) | TODO: define style thumbnail representation |
| Metadata clip (section) | TODO: define section thumbnail representation |
| Metadata clip (music-video) | TODO: define music-video metadata thumbnail |

### 8.2 Character and Reference Clip Thumbnails

Characters and reference clips MUST use their associated reference images as thumbnails. When a character has a reference image, that image MUST appear as the clip thumbnail on the timeline.

> **Source:** Implications report: "Characters and reference clips must use reference images as thumbnails."

### 8.3 Video Frame Extraction

Video clips on the timeline MUST extract frames at a periodic interval (every N seconds) and display them as a frame sequence across the clip's width. The interval SHOULD be configurable but default to a value that produces a visually informative strip (e.g., every 2–5 seconds depending on clip duration).

> **Source:** [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §12.

---

## 9. Metadata Clip Creation Contract

### 9.1 Metadata Clip Helper

The system MUST provide a single helper (`addMetadataClip`) that:

1. Creates or finds a metadata track with the requested name.
2. Creates real metadata media via `createMetadataMedia`.
3. Adds the media to the library via `addGeneratedMedia`.
4. Adds a clip to the track via `addClip`.

The helper MUST return `{ trackId, mediaId, clipId }` and MUST NOT call `addClip` with an empty `mediaId`.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 03.

### 9.2 Metadata Clip Kinds

Metadata clips carry a `metadata.kind` field that determines their inspector routing and behavior:

| `kind` | Inspector | Track Type |
|---|---|---|
| `"music-video"` | Music Video metadata inspector | `metadata` |
| `"scene"` | Scene metadata inspector | `metadata` |
| `"character"` | Character metadata inspector | `metadata` |
| `"style"` | Style metadata inspector | `metadata` |
| `"storyboard-shot"` | Storyboard shot inspector (via video clip) | `video` |
| `"section"` | Section metadata inspector | `metadata` |
| `"continuity_note"` | Character continuity inspector | `metadata` |

Unknown `kind` values MUST render a minimal read-only fallback in the inspector, not crash.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 06, Task 08, Task 09.

---

## 10. Generated Media Insertion

### 10.1 API Contract

The project store MUST expose `addGeneratedMedia(item, blob)` that:

- Inserts a fully available generated `MediaItem` into the media library.
- Persists the blob through `saveMediaBlob`.
- Sets `isPlaceholder: false` (or `undefined`) and `isPending: false` (or `undefined`) on the inserted item.
- Returns an `ActionResult` for failure visibility.

This method MUST NOT reuse `addPlaceholderMedia` for available generated assets, and MUST NOT overwrite existing media IDs.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 02.

### 10.2 Asset Versioning

Generated assets support version history:

- Each version is a distinct `MediaItem` sharing `assetGroupId`.
- One item per group is marked `isCurrent: true`.
- `addAssetVersion` creates a distinct `MediaItem` and persists a distinct blob.
- `setCurrentAssetVersion` flips current flags inside only that asset group.
- Timeline clips always reference the current version's `mediaId`.

> **Source:** [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) Task 10.
> **Decision:** [Music Video Timeline Native decisions](./music-video-timeline-native/decisions.md) — "Asset version history."

---

## 11. Import Validation

### 11.1 Action Validation

All clip and media operations MUST pass through `ActionValidator`. The system MUST NOT bypass validation for metadata clips or generated media.

### 11.2 Required Validations

- `addClip` MUST reject calls where `mediaId` does not exist in the media library.
- `addClip` MUST reject calls that would create overlapping clips on the same track.
- `addGeneratedMedia` MUST reject calls that would overwrite an existing media ID.
- Neural Frames import MUST NOT produce clips with empty string media IDs.

---

## 12. Open Questions

- **Thumbnail interval:** What is the default N for video frame extraction? Should it adapt to clip duration?
- **Style thumbnail:** What visual representation should style/LoRA metadata clips use on the timeline?
- **Section thumbnail:** What visual representation should section metadata clips use?
- **Music-video metadata thumbnail:** What visual representation should the music-video workflow metadata clip use?
- **Link file UX:** What is the exact user interaction for resolving a missing-file clip? File picker? Drag-and-drop onto the clip?
- **Overlap resolution:** When a user attempts to place a clip that would overlap, what is the UX? Prevent the drop? Auto-trim? Show an error toast?
- **Migration path:** Existing Neural Frames imports may have `metadata.shotId` without `metadata.kind === "storyboard-shot"`. The type guard SHOULD temporarily accept `metadata.importSource === "neuralframes" && typeof metadata.shotId === "string"` during migration, but new imports MUST write the explicit marker.
