# Music Video Workflow — Operational Spec

**Status:** Canonical cross-subsystem workflow
**Owner:** Music-video orchestration
**Incorporates:** Architectural decisions formerly recorded in [Music Video Timeline Native Decisions](./music-video-timeline-native/decisions.md)

## Scope

This specification defines the ordered user workflow and cross-subsystem invariants for creating an AI-assisted music video. It does not redefine the functional contracts owned by Timeline, Storyboard, Generation, Media Assets, Audio/Subtitles, Song Sections, Inspector, or Project persistence.

## 1. Locked Decisions

1. The workflow is timeline-native; there is no separate wizard as a second project state.
2. Every clip references a real persisted `MediaItem`; dummy or empty media IDs are prohibited.
3. Creative storyboard truth lives in `StoryboardShot`; timeline clips reference shots for placement.
4. Asset variations are immutable media versions, not overwritten files.
5. Generation jobs are persistent and centrally polled outside dialogs.
6. Domain editing occurs through specialized inspectors routed from selected timeline/domain records.

## 2. Workflow

### 2.1 Start from Audio

The user imports audio through [Media Assets](./media-assets.md). The application explicitly places an audio clip and a full-duration music-video metadata record through [Timeline](./timeline.md). The audio and metadata records occupy compatible separate tracks.

The metadata record identifies the workflow instance and references, rather than copies, audio analysis, sections, storyboard shots, characters, style, and generation jobs.

### 2.2 Analyze Audio

The user runs [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) against the selected source. Analysis results remain keyed to the exact media/version. Applying analysis supplies beat, energy, tempo, genre, and sentiment evidence without silently changing user edits.

### 2.3 Identify Song Sections

The user infers, edits, and confirms sections through [Song Sections](./song-sections.md). Storyboard generation is blocked until the required confirmed-section contract is satisfied or the user explicitly chooses a sectionless workflow.

### 2.4 Establish Creative Brief and Assets

The music-video inspector collects the creative brief, recurring characters, style references, and constraints. Characters and references use real media assets and the canonical pill behavior from [Inspector Shell](./inspector-shell.md).

### 2.5 Generate or Import Storyboard

[Storyboard](./storyboard.md) generates or imports creative shots. Neural Frames import maps external scenes, characters, and styles into validated domain records and real media assets; it does not create empty metadata media or a competing storyboard model.

Shot-to-clip projection and grouping follow [Timeline](./timeline.md). Reordering or editing creative shots does not silently mutate clip placement.

### 2.6 Generate Media

The user selects a shot or linked clip and submits through [AI Generation and Providers](./generation.md). Generation resolves prompt references, optional shot audio, timing, target, and placement policy explicitly.

Completed output becomes an immutable version through [Media Assets](./media-assets.md), updates the shot attempt through [Storyboard](./storyboard.md), and requests placement through [Timeline](./timeline.md). Repeated completion is idempotent.

### 2.7 Review, Revise, and Export

The user reviews timeline placement and preview, edits shots or generation parameters, creates further versions, and selects current assets without losing history. [Export](./export.md) renders the resulting project, including subtitles where present.

### 2.8 Persist and Recover

Every semantic change is persisted through [Project Lifecycle and Persistence](./project.md). Reload restores the same workflow identity, domain records, active jobs, assets, and clips. Backend outage is not treated as media absence; availability follows [Media Assets](./media-assets.md).

## 3. Workflow State

The music-video metadata record may store references and completion state for workflow phases, but MUST NOT embed independent copies of canonical subsystem data.

```ts
interface MusicVideoWorkflowState {
  id: string;
  audioMediaId: string;
  audioClipId: string;
  analysisRef?: { sourceHash: string; analyzerVersion: string };
  sectionSetId?: string;
  storyboardId?: string;
  characterIds: string[];
  styleAssetIds: string[];
  generationJobIds: string[];
  updatedAt: string;
}
```

References are validated on load. A dangling reference produces a recoverable problem and does not cause unrelated workflow state to be discarded.

## 4. Inspector Routing

Selecting the workflow metadata record opens the music-video inspector. Selecting a scene, character, style, subtitle, asset, or ordinary clip routes according to [Inspector Shell](./inspector-shell.md). The workflow inspector links to subsystem actions rather than implementing private copies of their stores or forms.

## 5. Cross-Subsystem Invariants

- Timeline is authoritative for placement; Storyboard is authoritative for creative shots.
- Media IDs are never empty and remain stable for a concrete version.
- Confirmed song sections are referenced by ID and exact boundary version.
- Generation output is finalized once and persisted before being reported as fully successful.
- Provider credentials never enter workflow or project data.
- Runtime availability never becomes semantic missing state without authoritative verification.
- User edits are never overwritten by reanalysis, regeneration, import, or restore without an explicit accepted operation.

## 6. Required End-to-End Evidence

The deterministic integration flow covers audio import, metadata record creation, analysis, section confirmation, storyboard creation/import, character references, generation submission, reload during a job, idempotent completion, version creation, timeline placement, persistence, restore, and export handoff.

Browser verification performs the same workflow with real local fixtures and mocked or authorized provider boundaries. It verifies that no dummy media, duplicate outputs, duplicate clips, lost edits, secret leakage, or false missing-media states occur.

## 7. Failure Modes

- A sidebar or dialog becomes a second store of workflow truth.
- Metadata clips use empty or fabricated media IDs.
- Storyboard creative edits and timeline placement overwrite each other.
- Generation reload creates duplicate outputs or clips.
- Neural Frames import creates incompatible parallel domain types.
- Restore loses workflow references or interprets backend outage as deletion.
