# Timeline-native AI Music Video Implementation Plan

## Current State (Audited 2026-07-13 16:16 AEST)

**Overall:** PARTIAL. Tasks 1-6 and 8-16 have implementation evidence; Task 7 is narrower than planned and Task 17 has no current browser evidence. Canonical owners are [Music Video Workflow](../../spec/music-video-workflow.md), [Timeline](../../spec/timeline.md), [Storyboard](../../spec/storyboard.md), and [Generation](../../spec/generation.md).

This section is authoritative. Unchecked boxes below are execution instructions, not current status.

| Task | State | Current evidence and remaining work |
|---|---|---|
| 01 metadata media factory | Implemented | `createMetadataMedia` and deterministic tests exist in `features/music-video/timeline/metadata-media.*`. |
| 02 generated-media insertion | Implemented | `ProjectState.addGeneratedMedia` and project-store tests create durable media records. |
| 03 metadata clip helper | Implemented | `addTimelineClip` creates/finds tracks, creates real metadata media, and adds clips with tests. |
| 04 music-video audio import | Implemented | `createMusicVideoFlow` creates audio and full-duration metadata clips; tests cover the flow. |
| 05 AI-tab tool actions | Implemented | `AIGenTab` exposes music-video and Neural Frames file actions plus generation/jobs surfaces. |
| 06 metadata inspector routing | Implemented | `MetadataClipInspector` routes music-video, scene, character, style, note, and director-note kinds; routing tests exist. |
| 07 music-video inspector workflow | Partial | `MusicVideoMetadataInspector` exists, but it is a compact metadata/create surface rather than the complete workflow described by this task. |
| 08 Neural Frames metadata import | Implemented | `importNeuralFramesFile` and `NeuralFramesImportTab` use real generated media; the component suite covers metadata import. |
| 09 scene/character/style inspectors | Implemented | Dedicated scene, character, and style metadata inspectors exist. |
| 10 asset-group versions | Implemented | `MediaItem.assetGroupId`, add/switch-version store actions, and version tests exist. |
| 11 generated timeline placement | Implemented | `placeGeneratedAssetOnTimeline` and tests cover shot-timed image/video placement. |
| 12 persistent generation jobs | Implemented | Persisted `useGenerationJobStore` and shared generation contracts exist. |
| 13 polling outside dialogs | Implemented | `useGenerationJobPoller` owns polling/finalization outside `GenerateAssetDialog`. |
| 14 job management | Implemented | `JobManagementPanel` provides retry/cancel/status UI with component tests. |
| 15 reference selection/upload | Implemented | `ReferenceImagePicker` supports library selection/upload and has tests. |
| 16 project recovery | Implemented, browser-unverified | `useProjectRecovery` and its regression suite cover backend/local recovery paths; no current real-browser recovery record was found. |
| 17 end-to-end smoke flow | Not verified | No timestamped browser run proves the complete import, inspect, generate, poll, version, place, save, and reload workflow. |

**Conformance gaps:** Task 7 needs the full selected-music-video workflow; generation completion must continue to satisfy the canonical server-secret and idempotency contracts. **Next action:** finish Task 7, then execute and record Task 17 before archival.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new timeline-native Music Video workflow without dummy media IDs, wizard UI, or dialog-local generation jobs.

**Architecture:** The timeline is the source of truth. Music Video starts by importing audio, then creates real-media metadata clips. Selected metadata clips drive inspector UI. Generated assets are stored as versioned MediaItems and placed on normal timeline tracks.

**Tech Stack:** React, Zustand, Vitest, @openreel/core timeline actions, existing KieAI service, WaveSpeed SDK-backed orchestrator route.

---

## Execution contract

- One task = one atomic commit.
- Each task uses TDD: write the failing test, run it and record the expected failure, implement minimum code, run passing test, commit.
- Do not batch unrelated tasks into one commit.
- Do not create metadata clips with empty, fake, or missing media IDs.
- Do not restore the Music Video wizard/panel. Music Video UI lives in the selected metadata clip inspector.
- Do not guess provider APIs. Use existing services or source-verified API behavior only.

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Create real metadata media factory | none | false | `feat: add real metadata media factory` |
| 02 | Add generated media insertion API | music-video-timeline-native-01 | false | `feat: add generated media insertion` |
| 03 | Add metadata clip creation helper | music-video-timeline-native-02 | false | `feat: add metadata clip creation helper` |
| 04 | Implement music video audio import flow | music-video-timeline-native-03 | false | `feat: create timeline-native music video flow` |
| 05 | Replace AI tab cards with tool actions | music-video-timeline-native-04 | false | `feat: make ai tools timeline-native` |
| 06 | Add metadata clip inspector routing | music-video-timeline-native-03 | true | `feat: route metadata clips to inspector` |
| 07 | Build music video inspector workflow | music-video-timeline-native-06 | false | `feat: add music video metadata inspector` |
| 08 | Fix Neural Frames metadata import | music-video-timeline-native-03 | true | `fix: create real neural frames metadata clips` |
| 09 | Add scene character style inspectors | music-video-timeline-native-06, music-video-timeline-native-08 | false | `feat: edit timeline metadata clips` |
| 10 | Add asset group version fields | music-video-timeline-native-02 | true | `feat: add asset group version history` |
| 11 | Place generated assets on timeline | music-video-timeline-native-10, music-video-timeline-native-08 | false | `feat: place generated assets by shot timing` |
| 12 | Add persistent generation job store | music-video-timeline-native-10 | true | `feat: persist generation jobs` |
| 13 | Move polling out of generation dialog | music-video-timeline-native-11, music-video-timeline-native-12 | false | `feat: centralize generation job polling` |
| 14 | Build job management panel | music-video-timeline-native-12, music-video-timeline-native-13 | false | `feat: add generation job manager` |
| 15 | Add reference image selection and upload | music-video-timeline-native-05, music-video-timeline-native-13 | false | `feat: add generation reference images` |
| 16 | Diagnose and fix project recovery | none | true | `fix: restore project recovery flow` |
| 17 | Run end to end smoke flow | music-video-timeline-native-07, music-video-timeline-native-09, music-video-timeline-native-14, music-video-timeline-native-15, music-video-timeline-native-16 | false | `chore: verify music video workflow` |


## Atomic task plans

### Task 01: Create real metadata media factory

**Goal:** Generate real lightweight image MediaItems for metadata clips so clip/add always receives a valid mediaId.

**Files:**
- Modify/Create: `apps/web/src/features/music-video/timeline/metadata-media.ts`
- Modify/Create: `apps/web/src/features/music-video/timeline/metadata-media.test.ts`

**Reference files:**
- `packages/core/src/types/project.ts`
- `apps/web/src/stores/project-store.ts`
- `packages/core/src/actions/action-validator.ts`

**TDD steps:**
- [ ] Write failing test: Add tests for metadata image blob creation and MediaItem fields before adding the helper.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/metadata-media.test.ts`
- [ ] Confirm expected red: FAIL because metadata-media module does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/metadata-media.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/features/music-video/timeline/metadata-media.ts apps/web/src/features/music-video/timeline/metadata-media.test.ts && git commit -m "feat: add real metadata media factory"`

**Acceptance criteria:**
- createMetadataMedia returns an image MediaItem with a non-empty id.
- createMetadataMedia returns a Blob/File that can be saved in media storage.
- Metadata item carries kind, label, color, and duration in metadata-compatible fields.

**Constraints:**
- No dummy or empty mediaId values.
- Generated media must be a real Blob/File-backed image item.
- No network calls for initial metadata media.

### Task 02: Add generated media insertion API

**Goal:** Add one project-store method that inserts a fully available generated MediaItem and persists its blob without placeholder semantics.

**Files:**
- Modify/Create: `apps/web/src/stores/project-store.ts`
- Modify/Create: `apps/web/src/stores/project-store.test.ts`

**Reference files:**
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/stores/project-store.test.ts`
- `apps/web/src/services/media-storage.ts`

**TDD steps:**
- [ ] Write failing test: Add a store test that inserts an image with a Blob and confirms mediaLibrary contains a non-placeholder item.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts`
- [ ] Confirm expected red: FAIL because addGeneratedMedia is missing.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/stores/project-store.ts apps/web/src/stores/project-store.test.ts && git commit -m "feat: add generated media insertion"`

**Acceptance criteria:**
- ProjectState exposes addGeneratedMedia(item, blob).
- addGeneratedMedia saves the blob through saveMediaBlob.
- Inserted item has isPlaceholder false/undefined and isPending false/undefined.

**Constraints:**
- Do not reuse addPlaceholderMedia for available generated assets.
- Do not overwrite existing media IDs.
- Return ActionResult for failure visibility.

### Task 03: Add metadata clip creation helper

**Goal:** Create a single helper that creates/finds a metadata track, creates real metadata media, adds it to the library, then adds a metadata clip.

**Files:**
- Modify/Create: `apps/web/src/features/music-video/timeline/metadata-clips.ts`
- Modify/Create: `apps/web/src/features/music-video/timeline/metadata-clips.test.ts`

**Reference files:**
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/features/music-video/timeline/metadata-media.ts`
- `apps/web/src/components/editor/timeline/TrackLane.tsx`

**TDD steps:**
- [ ] Write failing test: Add helper tests proving addMetadataClip never calls addClip with an empty mediaId.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/metadata-clips.test.ts`
- [ ] Confirm expected red: FAIL because metadata-clips module does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/metadata-clips.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/features/music-video/timeline/metadata-clips.ts apps/web/src/features/music-video/timeline/metadata-clips.test.ts && git commit -m "feat: add metadata clip creation helper"`

**Acceptance criteria:**
- Creates a metadata track when one with the requested name is absent.
- Reuses the named metadata track when present.
- Adds a clip whose mediaId resolves to a real media library item.
- Clip metadata includes kind, label, color, and supplied payload.

**Constraints:**
- Use existing addTrack, renameTrack, addGeneratedMedia, and addClip APIs.
- Do not bypass ActionValidator.
- Return the created trackId, mediaId, and clipId.

### Task 04: Implement music video audio import flow

**Goal:** Turn an audio File into an audio timeline clip plus a full-duration music-video metadata clip.

**Files:**
- Modify/Create: `apps/web/src/features/music-video/timeline/create-music-video-flow.ts`
- Modify/Create: `apps/web/src/features/music-video/timeline/create-music-video-flow.test.ts`

**Reference files:**
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/features/music-video`
- `apps/web/src/stores/ui-store.ts`

**TDD steps:**
- [ ] Write failing test: Add a flow test that imports audio and asserts audio track, audio clip, metadata track, and music-video metadata clip exist.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/create-music-video-flow.test.ts`
- [ ] Confirm expected red: FAIL because create-music-video-flow module does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/create-music-video-flow.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/features/music-video/timeline/create-music-video-flow.ts apps/web/src/features/music-video/timeline/create-music-video-flow.test.ts && git commit -m "feat: create timeline-native music video flow"`

**Acceptance criteria:**
- Audio File is imported into media library.
- An audio track exists and contains the audio clip at t=0.
- A Music Video metadata track exists.
- A full-duration clip with metadata.kind="music-video" exists on that track.
- The created metadata clip is selected/openable by existing selection state.

**Constraints:**
- Do not show a wizard.
- Place audio at startTime 0.
- Metadata clip spans imported audio duration.
- If duration is unavailable, use project timeline duration only as a documented fallback and keep the clip adjustable.

### Task 05: Replace AI tab cards with tool actions

**Goal:** Remove the wrong MusicVideoPanel card and expose Music Video, Neural Frames Import, Generate Image/Video, and Jobs as tool actions.

**Files:**
- Modify/Create: `apps/web/src/components/editor/AIGenTab.tsx`
- Modify/Create: `apps/web/src/components/editor/AIGenTab.music-video.test.tsx`

**Reference files:**
- `apps/web/src/components/editor/AIGenTab.tsx`
- `apps/web/src/features/music-video/components/NeuralFramesImportTab.tsx`
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`

**TDD steps:**
- [ ] Write failing test: Add component tests for file input action wiring and absence of MusicVideoPanel rendering.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/AIGenTab.music-video.test.tsx`
- [ ] Confirm expected red: FAIL because the new action labels/handlers do not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/AIGenTab.music-video.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/AIGenTab.tsx apps/web/src/components/editor/AIGenTab.music-video.test.tsx && git commit -m "feat: make ai tools timeline-native"`

**Acceptance criteria:**
- Music Video action accepts audio/* files and calls createMusicVideoFromAudio.
- Neural Frames action accepts JSON files and calls the import flow.
- MusicVideoPanel is no longer imported or rendered from AIGenTab.
- Generate Image/Video action still opens unified generation UI.

**Constraints:**
- Music Video opens an audio file picker.
- Neural Frames opens a JSON file picker directly; no card/panel.
- Generate Image/Video opens GenerateAssetDialog.
- Jobs opens the job manager entry point when available.

### Task 06: Add metadata clip inspector routing

**Goal:** Route selected metadata clips to a MetadataClipInspector instead of generic clip controls.

**Files:**
- Modify/Create: `apps/web/src/components/editor/inspector/MetadataClipInspector.tsx`
- Modify/Create: `apps/web/src/components/editor/inspector/MetadataClipInspector.test.tsx`
- Modify/Create: `apps/web/src/components/editor/InspectorPanel.tsx`

**Reference files:**
- `apps/web/src/components/editor/InspectorPanel.tsx`
- `apps/web/src/components/editor/inspector`
- `apps/web/src/stores/project-store.ts`

**TDD steps:**
- [ ] Write failing test: Add inspector test that selects a metadata clip and expects MetadataClipInspector content.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/MetadataClipInspector.test.tsx`
- [ ] Confirm expected red: FAIL because MetadataClipInspector does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/MetadataClipInspector.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/inspector/MetadataClipInspector.tsx apps/web/src/components/editor/inspector/MetadataClipInspector.test.tsx apps/web/src/components/editor/InspectorPanel.tsx && git commit -m "feat: route metadata clips to inspector"`

**Acceptance criteria:**
- Selected kind music-video renders music video inspector shell.
- Selected kind scene renders scene inspector shell.
- Selected kind character renders character inspector shell.
- Selected kind style renders style inspector shell.

**Constraints:**
- Do not create a sidebar wizard.
- Inspector must be driven only by selected timeline metadata clips.
- Unknown metadata kind shows a minimal read-only fallback, not a crash.

### Task 07: Build music video inspector workflow

**Goal:** Move the whole music-video workflow into the selected music-video metadata clip inspector.

**Files:**
- Modify/Create: `apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx`
- Modify/Create: `apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.test.tsx`

**Reference files:**
- `apps/web/src/features/music-video/components/MusicVideoPanel.tsx`
- `apps/web/src/components/editor/inspector/MetadataClipInspector.tsx`
- `apps/web/src/stores/music-video-store.ts`

**TDD steps:**
- [ ] Write failing test: Add inspector tests for brief editing, analysis status, storyboard list, characters, references, and generation sections.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.test.tsx`
- [ ] Confirm expected red: FAIL because MusicVideoMetadataInspector does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.tsx apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.test.tsx && git commit -m "feat: add music video metadata inspector"`

**Acceptance criteria:**
- Inspector displays editable creative brief fields.
- Inspector shows audio analysis state and action.
- Inspector lists storyboard shots and generated assets.
- Inspector lists characters and reference images.
- Inspector exposes shot generation actions.

**Constraints:**
- No wizard and no hidden global panel.
- Keep editing scoped to selected metadata clip/project.
- Use existing music-video store actions where they already exist.

### Task 08: Fix Neural Frames metadata import

**Goal:** Replace empty-media metadata clips in Neural Frames import with real metadata media and timeline metadata clips.

**Files:**
- Modify/Create: `apps/web/src/features/music-video/components/NeuralFramesImportTab.tsx`
- Modify/Create: `apps/web/src/features/music-video/components/NeuralFramesImportTab.test.tsx`

**Reference files:**
- `apps/web/src/features/music-video/components/NeuralFramesImportTab.tsx`
- `apps/web/src/features/music-video/timeline/metadata-clips.ts`

**TDD steps:**
- [ ] Write failing test: Add an import test that fails if addClip receives an empty mediaId.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/components/NeuralFramesImportTab.test.tsx`
- [ ] Confirm expected red: FAIL because current implementation passes empty mediaId for metadata clips.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/components/NeuralFramesImportTab.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/features/music-video/components/NeuralFramesImportTab.tsx apps/web/src/features/music-video/components/NeuralFramesImportTab.test.tsx && git commit -m "fix: create real neural frames metadata clips"`

**Acceptance criteria:**
- Every imported metadata block becomes a valid timeline clip.
- Storyboard scenes have timeline metadata clips at their scene timings.
- Characters span full duration or their referenced scene range.
- Imported LoRAs/styles default to full duration when no tighter range exists.

**Constraints:**
- No empty string media IDs.
- Storyboard metadata clips use kind="scene".
- Character clips use kind="character".
- Style/LoRA clips use kind="style".

### Task 09: Add scene character style inspectors

**Goal:** Make scene, character, and style metadata clips editable from the inspector.

**Files:**
- Modify/Create: `apps/web/src/components/editor/inspector/SceneMetadataInspector.tsx`
- Modify/Create: `apps/web/src/components/editor/inspector/CharacterMetadataInspector.tsx`
- Modify/Create: `apps/web/src/components/editor/inspector/StyleMetadataInspector.tsx`
- Modify/Create: `apps/web/src/components/editor/inspector/TimelineMetadataInspectors.test.tsx`

**Reference files:**
- `apps/web/src/components/editor/inspector/MetadataClipInspector.tsx`
- `apps/web/src/stores/music-video-store.ts`

**TDD steps:**
- [ ] Write failing test: Add inspector tests for editing scene prompt, character references, and style prompt/LoRA metadata.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/TimelineMetadataInspectors.test.tsx`
- [ ] Confirm expected red: FAIL because specialized metadata inspectors do not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/TimelineMetadataInspectors.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/inspector/SceneMetadataInspector.tsx apps/web/src/components/editor/inspector/CharacterMetadataInspector.tsx apps/web/src/components/editor/inspector/StyleMetadataInspector.tsx apps/web/src/components/editor/inspector/TimelineMetadataInspectors.test.tsx && git commit -m "feat: edit timeline metadata clips"`

**Acceptance criteria:**
- Scene inspector edits prompt/reference asset IDs.
- Character inspector edits name/description/reference asset IDs.
- Style inspector edits style prompt/LoRA metadata and generation inputs.

**Constraints:**
- Edits update clip metadata and associated music-video store data consistently.
- Do not add project-wide side panels.
- Keep controls small and specific to the selected clip kind.

### Task 10: Add asset group version fields

**Goal:** Represent generated asset versions as multiple MediaItems that share assetGroupId with one current item.

**Files:**
- Modify/Create: `packages/core/src/types/project.ts`
- Modify/Create: `apps/web/src/stores/project-store.ts`
- Modify/Create: `apps/web/src/stores/project-store.test.ts`

**Reference files:**
- `packages/core/src/types/project.ts`
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/stores/project-store.test.ts`

**TDD steps:**
- [ ] Write failing test: Add store tests for creating a version, switching current version, and preserving old MediaItems.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts`
- [ ] Confirm expected red: FAIL because assetGroupId/isCurrent APIs do not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts` and confirm PASS.
- [ ] Commit: `git add packages/core/src/types/project.ts apps/web/src/stores/project-store.ts apps/web/src/stores/project-store.test.ts && git commit -m "feat: add asset group version history"`

**Acceptance criteria:**
- MediaItem supports assetGroupId, isCurrent, and generationMeta.
- addAssetVersion creates a distinct MediaItem and persists a distinct blob.
- setCurrentAssetVersion flips current flags inside only that asset group.

**Constraints:**
- Never overwrite a blob to create history.
- Each version gets a distinct media ID.
- All versions in a group share assetGroupId.

### Task 11: Place generated assets on timeline

**Goal:** When generated image/video assets are accepted, add them to the appropriate image/video track at the shot timing.

**Files:**
- Modify/Create: `apps/web/src/features/music-video/timeline/place-generated-asset.ts`
- Modify/Create: `apps/web/src/features/music-video/timeline/place-generated-asset.test.ts`

**Reference files:**
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/features/music-video`

**TDD steps:**
- [ ] Write failing test: Add tests that accepting an image/video result creates a clip on image/video track at shot start and duration.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/place-generated-asset.test.ts`
- [ ] Confirm expected red: FAIL because placement helper does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/place-generated-asset.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/features/music-video/timeline/place-generated-asset.ts apps/web/src/features/music-video/timeline/place-generated-asset.test.ts && git commit -m "feat: place generated assets by shot timing"`

**Acceptance criteria:**
- Image result creates/reuses an image track and clip.
- Video result creates/reuses a video track and clip.
- Clip metadata links shotId, assetGroupId, and provider job id when available.

**Constraints:**
- Images go to image tracks; videos go to video tracks.
- Start/duration comes from shot timing, not the playhead.
- Do not duplicate clips if the same version is already placed for that shot.

### Task 12: Add persistent generation job store

**Goal:** Track KieAI and WaveSpeed jobs persistently with provider, model, prompt, status, output, media linkage, and timestamps.

**Files:**
- Modify/Create: `apps/web/src/stores/generation-job-store.ts`
- Modify/Create: `apps/web/src/stores/generation-job-store.test.ts`

**Reference files:**
- `apps/web/src/stores/kieai-store.ts`
- `apps/web/src/services/wavespeed/index.ts`
- `apps/web/src/services/kieai/image-generation.ts`

**TDD steps:**
- [ ] Write failing test: Add store tests for enqueue, status update, completion, failure, retry, and persistence shape.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/generation-job-store.test.ts`
- [ ] Confirm expected red: FAIL because generation-job-store does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/generation-job-store.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/stores/generation-job-store.ts apps/web/src/stores/generation-job-store.test.ts && git commit -m "feat: persist generation jobs"`

**Acceptance criteria:**
- Jobs persist through Zustand persist.
- Jobs carry provider/model/prompt/inputs/linked media ids.
- Retry creates a new provider job id while preserving logical job history.

**Constraints:**
- One store covers KieAI and WaveSpeed.
- Job status is explicit: queued, running, completed, failed, canceled.
- Do not poll inside dialogs.

### Task 13: Move polling out of generation dialog

**Goal:** Make KieAI/WaveSpeed submission enqueue persistent jobs and let poller completion create media versions and timeline clips.

**Files:**
- Modify/Create: `apps/web/src/hooks/useGenerationJobPoller.ts`
- Modify/Create: `apps/web/src/stores/generation-job-poller.test.ts`
- Modify/Create: `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`

**Reference files:**
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`
- `apps/web/src/services/wavespeed/index.ts`
- `apps/web/src/stores/generation-job-store.ts`

**TDD steps:**
- [ ] Write failing test: Add tests that submit closes dialog with queued job and poller completion creates a media version plus shot clip.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/generation-job-poller.test.ts`
- [ ] Confirm expected red: FAIL because generation-job-poller does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/generation-job-poller.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/hooks/useGenerationJobPoller.ts apps/web/src/stores/generation-job-poller.test.ts apps/web/src/components/editor/generate/GenerateAssetDialog.tsx && git commit -m "feat: centralize generation job polling"`

**Acceptance criteria:**
- Submitting a WaveSpeed job records a queued/running job immediately.
- Submitting a KieAI job records a queued/running job immediately.
- Poller updates job status and outputUrl.
- Completion creates an asset version and places a shot clip when shot timing exists.

**Constraints:**
- No fire-and-forget polling inside GenerateAssetDialog.
- Poller must be idempotent across re-renders.
- Completed output is downloaded/saved as a new MediaItem version.

### Task 14: Build job management panel

**Goal:** Expose all active and historical KieAI/WaveSpeed jobs with retry/cancel/view/use-as-reference actions.

**Files:**
- Modify/Create: `apps/web/src/components/editor/generate/JobManagementPanel.tsx`
- Modify/Create: `apps/web/src/components/editor/generate/JobManagementPanel.test.tsx`
- Modify/Create: `apps/web/src/components/editor/AIGenTab.tsx`

**Reference files:**
- `apps/web/src/components/editor/AIGenTab.tsx`
- `apps/web/src/stores/generation-job-store.ts`
- `apps/web/src/components/editor/AssetsPanel.tsx`

**TDD steps:**
- [ ] Write failing test: Add UI tests for active badge, status list, retry, cancel, view result, and use-as-reference action callbacks.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/generate/JobManagementPanel.test.tsx`
- [ ] Confirm expected red: FAIL because JobManagementPanel does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/generate/JobManagementPanel.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/generate/JobManagementPanel.tsx apps/web/src/components/editor/generate/JobManagementPanel.test.tsx apps/web/src/components/editor/AIGenTab.tsx && git commit -m "feat: add generation job manager"`

**Acceptance criteria:**
- AI Tools shows an active job count badge.
- Panel groups running, completed, failed, and canceled jobs.
- Retry action re-enqueues failed jobs.
- Cancel action stops local polling.
- View result selects or previews generated media.

**Constraints:**
- Panel is a tool/panel for jobs, not the Music Video workflow.
- Cancel marks local job canceled unless provider cancellation is available from known API.
- Use-as-reference selects a completed media item as a reference input.

### Task 15: Add reference image selection and upload

**Goal:** Let generation choose reference images from the media library or upload new files, then inject them into KieAI/WaveSpeed inputs.

**Files:**
- Modify/Create: `apps/web/src/components/editor/generate/ReferenceImagePicker.tsx`
- Modify/Create: `apps/web/src/components/editor/generate/ReferenceImagePicker.test.tsx`
- Modify/Create: `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`

**Reference files:**
- `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`
- `apps/web/src/components/editor/AssetsPanel.tsx`
- `apps/web/src/services/kieai/image-generation.ts`
- `apps/web/src/services/wavespeed/index.ts`

**TDD steps:**
- [ ] Write failing test: Add tests for media-library pick, upload, and provider input mapping.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/generate/ReferenceImagePicker.test.tsx`
- [ ] Confirm expected red: FAIL because ReferenceImagePicker does not exist.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/generate/ReferenceImagePicker.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/generate/ReferenceImagePicker.tsx apps/web/src/components/editor/generate/ReferenceImagePicker.test.tsx apps/web/src/components/editor/generate/GenerateAssetDialog.tsx && git commit -m "feat: add generation reference images"`

**Acceptance criteria:**
- User can select existing image references.
- User can upload an image reference and see it selected.
- KieAI requests include selected reference images for supported models.
- WaveSpeed schema URI/image fields can be populated from selected references.

**Constraints:**
- Reference picker only exposes image media.
- Upload imports/saves real media before use.
- Do not guess provider field names; map only known KieAI fields and WaveSpeed schema URI/image fields.

### Task 16: Diagnose and fix project recovery

**Goal:** Reproduce the broken recovery path and fix restoration of saved project state and media blobs.

**Files:**
- Modify/Create: `apps/web/src/hooks/useProjectRecovery.test.ts`
- Modify/Create: `apps/web/src/hooks/useProjectRecovery.ts`
- Modify/Create: `apps/web/src/stores/project-store.ts`
- Modify/Create: `apps/web/src/services/auto-save.ts`

**Reference files:**
- `apps/web/src/hooks/useProjectRecovery.ts`
- `apps/web/src/services/auto-save.ts`
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/components/welcome/RecoveryDialog.test.tsx`

**TDD steps:**
- [ ] Write failing test: Add a failing recovery test that saves a project with media and verifies recover restores project plus media items.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useProjectRecovery.test.ts apps/web/src/stores/project-store.test.ts`
- [ ] Confirm expected red: FAIL reproducing the user-reported recovery bug.
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useProjectRecovery.test.ts apps/web/src/stores/project-store.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/hooks/useProjectRecovery.test.ts apps/web/src/hooks/useProjectRecovery.ts apps/web/src/stores/project-store.ts apps/web/src/services/auto-save.ts && git commit -m "fix: restore project recovery flow"`

**Acceptance criteria:**
- A regression test reproduces current broken recovery behavior.
- Recover button restores the saved project state.
- Recovered media items with stored blobs render as available, not Missing.
- Recovery failure surfaces a clear error.

**Constraints:**
- Use the debugger/systematic-debugging workflow before proposing the fix during execution.
- Do not suppress recovery errors.
- Recovered project must not silently drop media.

### Task 17: Run end to end smoke flow

**Goal:** Verify the user-facing workflow end to end and remove only scaffolding introduced by these tasks.

**Files:**
- Modify/Create: `verified working tree`
- Modify/Create: `final atomic commit for cleanup only if cleanup changes are needed`

**Reference files:**
- `package.json`
- `apps/web/package.json`
- `apps/orchestrator/package.json`

**TDD steps:**
- [ ] Write failing test: No new production behavior; this is final verification after all task tests pass.
- [ ] Run: `pnpm --filter @openreel/web test:run && pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/orchestrator typecheck`
- [ ] Confirm expected red: N/A
- [ ] Implement the smallest production change that makes the test pass.
- [ ] Re-run: `pnpm --filter @openreel/web test:run && pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/orchestrator typecheck` and confirm PASS.
- [ ] Commit: `git add verified working tree final atomic commit for cleanup only if cleanup changes are needed && git commit -m "chore: verify music video workflow"`

**Acceptance criteria:**
- All targeted tests pass.
- Web typecheck passes.
- Orchestrator typecheck passes.
- Manual smoke: Music Video asks for audio, creates audio clip and metadata clip, selecting clip opens inspector.
- Manual smoke: Neural Frames import creates metadata clips without validation errors.
- Manual smoke: Generate Image/Video queues a job visible in job panel.
- Manual smoke: recovery restores a saved project with media.

**Constraints:**
- Do not claim done without observed command output.
- Do not broaden scope during cleanup.
- Use pnpm --parallel for manual dev smoke when running web and orchestrator together.

## Final verification

After Task 17, record observed output for:

```bash
pnpm --filter @openreel/web test:run
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/orchestrator typecheck
pnpm dev
```

Manual smoke with browser/dev server:
- Music Video asks for audio, creates audio clip at t=0, creates full-duration metadata clip, and selecting it opens inspector.
- Neural Frames import creates storyboard/character/style metadata clips without validation errors.
- Generate Image/Video queues a job visible in job management.
- Completed generated asset appears as an asset version and a timeline image/video clip at shot timing.
- Recovery restores a saved project with media available, not Missing.
