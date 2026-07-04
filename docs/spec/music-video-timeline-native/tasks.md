# Music Video Timeline Native SDD Tasks

Execution rule: complete the first unchecked task whose dependencies are checked. Each task is RED/GREEN/COMMIT.

## music-video-timeline-native-01: Create real metadata media factory

- Status: pending
- Dependencies: none
- Objective: Generate real lightweight image MediaItems for metadata clips so clip/add always receives a valid mediaId.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/metadata-media.test.ts`
- Expected red: FAIL because metadata-media module does not exist.
- Commit: `feat: add real metadata media factory`
- Acceptance:
  - createMetadataMedia returns an image MediaItem with a non-empty id.
  - createMetadataMedia returns a Blob/File that can be saved in media storage.
  - Metadata item carries kind, label, color, and duration in metadata-compatible fields.

## music-video-timeline-native-02: Add generated media insertion API

- Status: pending
- Dependencies: music-video-timeline-native-01
- Objective: Add one project-store method that inserts a fully available generated MediaItem and persists its blob without placeholder semantics.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts`
- Expected red: FAIL because addGeneratedMedia is missing.
- Commit: `feat: add generated media insertion`
- Acceptance:
  - ProjectState exposes addGeneratedMedia(item, blob).
  - addGeneratedMedia saves the blob through saveMediaBlob.
  - Inserted item has isPlaceholder false/undefined and isPending false/undefined.

## music-video-timeline-native-03: Add metadata clip creation helper

- Status: pending
- Dependencies: music-video-timeline-native-02
- Objective: Create a single helper that creates/finds a metadata track, creates real metadata media, adds it to the library, then adds a metadata clip.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/metadata-clips.test.ts`
- Expected red: FAIL because metadata-clips module does not exist.
- Commit: `feat: add metadata clip creation helper`
- Acceptance:
  - Creates a metadata track when one with the requested name is absent.
  - Reuses the named metadata track when present.
  - Adds a clip whose mediaId resolves to a real media library item.
  - Clip metadata includes kind, label, color, and supplied payload.

## music-video-timeline-native-04: Implement music video audio import flow

- Status: pending
- Dependencies: music-video-timeline-native-03
- Objective: Turn an audio File into an audio timeline clip plus a full-duration music-video metadata clip.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/create-music-video-flow.test.ts`
- Expected red: FAIL because create-music-video-flow module does not exist.
- Commit: `feat: create timeline-native music video flow`
- Acceptance:
  - Audio File is imported into media library.
  - An audio track exists and contains the audio clip at t=0.
  - A Music Video metadata track exists.
  - A full-duration clip with metadata.kind="music-video" exists on that track.
  - The created metadata clip is selected/openable by existing selection state.

## music-video-timeline-native-05: Replace AI tab cards with tool actions

- Status: pending
- Dependencies: music-video-timeline-native-04
- Objective: Remove the wrong MusicVideoPanel card and expose Music Video, Neural Frames Import, Generate Image/Video, and Jobs as tool actions.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/AIGenTab.music-video.test.tsx`
- Expected red: FAIL because the new action labels/handlers do not exist.
- Commit: `feat: make ai tools timeline-native`
- Acceptance:
  - Music Video action accepts audio/* files and calls createMusicVideoFromAudio.
  - Neural Frames action accepts JSON files and calls the import flow.
  - MusicVideoPanel is no longer imported or rendered from AIGenTab.
  - Generate Image/Video action still opens unified generation UI.

## music-video-timeline-native-06: Add metadata clip inspector routing

- Status: pending
- Dependencies: music-video-timeline-native-03
- Objective: Route selected metadata clips to a MetadataClipInspector instead of generic clip controls.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/MetadataClipInspector.test.tsx`
- Expected red: FAIL because MetadataClipInspector does not exist.
- Commit: `feat: route metadata clips to inspector`
- Acceptance:
  - Selected kind music-video renders music video inspector shell.
  - Selected kind scene renders scene inspector shell.
  - Selected kind character renders character inspector shell.
  - Selected kind style renders style inspector shell.

## music-video-timeline-native-07: Build music video inspector workflow

- Status: pending
- Dependencies: music-video-timeline-native-06
- Objective: Move the whole music-video workflow into the selected music-video metadata clip inspector.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/MusicVideoMetadataInspector.test.tsx`
- Expected red: FAIL because MusicVideoMetadataInspector does not exist.
- Commit: `feat: add music video metadata inspector`
- Acceptance:
  - Inspector displays editable creative brief fields.
  - Inspector shows audio analysis state and action.
  - Inspector lists storyboard shots and generated assets.
  - Inspector lists characters and reference images.
  - Inspector exposes shot generation actions.

## music-video-timeline-native-08: Fix Neural Frames metadata import

- Status: pending
- Dependencies: music-video-timeline-native-03
- Objective: Replace empty-media metadata clips in Neural Frames import with real metadata media and timeline metadata clips.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/components/NeuralFramesImportTab.test.tsx`
- Expected red: FAIL because current implementation passes empty mediaId for metadata clips.
- Commit: `fix: create real neural frames metadata clips`
- Acceptance:
  - Every imported metadata block becomes a valid timeline clip.
  - Storyboard scenes have timeline metadata clips at their scene timings.
  - Characters span full duration or their referenced scene range.
  - Imported LoRAs/styles default to full duration when no tighter range exists.

## music-video-timeline-native-09: Add scene character style inspectors

- Status: pending
- Dependencies: music-video-timeline-native-06, music-video-timeline-native-08
- Objective: Make scene, character, and style metadata clips editable from the inspector.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/TimelineMetadataInspectors.test.tsx`
- Expected red: FAIL because specialized metadata inspectors do not exist.
- Commit: `feat: edit timeline metadata clips`
- Acceptance:
  - Scene inspector edits prompt/reference asset IDs.
  - Character inspector edits name/description/reference asset IDs.
  - Style inspector edits style prompt/LoRA metadata and generation inputs.

## music-video-timeline-native-10: Add asset group version fields

- Status: pending
- Dependencies: music-video-timeline-native-02
- Objective: Represent generated asset versions as multiple MediaItems that share assetGroupId with one current item.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts`
- Expected red: FAIL because assetGroupId/isCurrent APIs do not exist.
- Commit: `feat: add asset group version history`
- Acceptance:
  - MediaItem supports assetGroupId, isCurrent, and generationMeta.
  - addAssetVersion creates a distinct MediaItem and persists a distinct blob.
  - setCurrentAssetVersion flips current flags inside only that asset group.

## music-video-timeline-native-11: Place generated assets on timeline

- Status: pending
- Dependencies: music-video-timeline-native-10, music-video-timeline-native-08
- Objective: When generated image/video assets are accepted, add them to the appropriate image/video track at the shot timing.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/features/music-video/timeline/place-generated-asset.test.ts`
- Expected red: FAIL because placement helper does not exist.
- Commit: `feat: place generated assets by shot timing`
- Acceptance:
  - Image result creates/reuses an image track and clip.
  - Video result creates/reuses a video track and clip.
  - Clip metadata links shotId, assetGroupId, and provider job id when available.

## music-video-timeline-native-12: Add persistent generation job store

- Status: pending
- Dependencies: music-video-timeline-native-10
- Objective: Track KieAI and WaveSpeed jobs persistently with provider, model, prompt, status, output, media linkage, and timestamps.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/stores/generation-job-store.test.ts`
- Expected red: FAIL because generation-job-store does not exist.
- Commit: `feat: persist generation jobs`
- Acceptance:
  - Jobs persist through Zustand persist.
  - Jobs carry provider/model/prompt/inputs/linked media ids.
  - Retry creates a new provider job id while preserving logical job history.

## music-video-timeline-native-13: Move polling out of generation dialog

- Status: pending
- Dependencies: music-video-timeline-native-11, music-video-timeline-native-12
- Objective: Make KieAI/WaveSpeed submission enqueue persistent jobs and let poller completion create media versions and timeline clips.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/stores/generation-job-poller.test.ts`
- Expected red: FAIL because generation-job-poller does not exist.
- Commit: `feat: centralize generation job polling`
- Acceptance:
  - Submitting a WaveSpeed job records a queued/running job immediately.
  - Submitting a KieAI job records a queued/running job immediately.
  - Poller updates job status and outputUrl.
  - Completion creates an asset version and places a shot clip when shot timing exists.

## music-video-timeline-native-14: Build job management panel

- Status: pending
- Dependencies: music-video-timeline-native-12, music-video-timeline-native-13
- Objective: Expose all active and historical KieAI/WaveSpeed jobs with retry/cancel/view/use-as-reference actions.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/generate/JobManagementPanel.test.tsx`
- Expected red: FAIL because JobManagementPanel does not exist.
- Commit: `feat: add generation job manager`
- Acceptance:
  - AI Tools shows an active job count badge.
  - Panel groups running, completed, failed, and canceled jobs.
  - Retry action re-enqueues failed jobs.
  - Cancel action stops local polling.
  - View result selects or previews generated media.

## music-video-timeline-native-15: Add reference image selection and upload

- Status: pending
- Dependencies: music-video-timeline-native-05, music-video-timeline-native-13
- Objective: Let generation choose reference images from the media library or upload new files, then inject them into KieAI/WaveSpeed inputs.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/generate/ReferenceImagePicker.test.tsx`
- Expected red: FAIL because ReferenceImagePicker does not exist.
- Commit: `feat: add generation reference images`
- Acceptance:
  - User can select existing image references.
  - User can upload an image reference and see it selected.
  - KieAI requests include selected reference images for supported models.
  - WaveSpeed schema URI/image fields can be populated from selected references.

## music-video-timeline-native-16: Diagnose and fix project recovery

- Status: pending
- Dependencies: none
- Objective: Reproduce the broken recovery path and fix restoration of saved project state and media blobs.
- Red command: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useProjectRecovery.test.ts apps/web/src/stores/project-store.test.ts`
- Expected red: FAIL reproducing the user-reported recovery bug.
- Commit: `fix: restore project recovery flow`
- Acceptance:
  - A regression test reproduces current broken recovery behavior.
  - Recover button restores the saved project state.
  - Recovered media items with stored blobs render as available, not Missing.
  - Recovery failure surfaces a clear error.

## music-video-timeline-native-17: Run end to end smoke flow

- Status: pending
- Dependencies: music-video-timeline-native-07, music-video-timeline-native-09, music-video-timeline-native-14, music-video-timeline-native-15, music-video-timeline-native-16
- Objective: Verify the user-facing workflow end to end and remove only scaffolding introduced by these tasks.
- Red command: `pnpm --filter @openreel/web test:run && pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/orchestrator typecheck`
- Expected red: N/A
- Commit: `chore: verify music video workflow`
- Acceptance:
  - All targeted tests pass.
  - Web typecheck passes.
  - Orchestrator typecheck passes.
  - Manual smoke: Music Video asks for audio, creates audio clip and metadata clip, selecting clip opens inspector.
  - Manual smoke: Neural Frames import creates metadata clips without validation errors.
  - Manual smoke: Generate Image/Video queues a job visible in job panel.
  - Manual smoke: recovery restores a saved project with media.

