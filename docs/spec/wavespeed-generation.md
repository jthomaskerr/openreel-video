# WaveSpeed Image and Video Generation

**Status:** Proposed operational specification  
**Version:** 1.0  
**Date:** 2026-07-10  
**Outcome:** A user can select or edit a storyboard shot, generate a new image or video with WaveSpeed, automatically provide the shot's timed audio segment and all prompt-referenced character images, monitor the job, and receive a versioned result linked to the shot and placed at the correct timeline range without duplicate assets or clips.

## 1. Purpose

This specification defines the complete WaveSpeed generation path across the storyboard, timeline, right-pane inspector, media library, orchestrator, persistent job system, and generated-asset version history.

It closes the operational gap between the existing provider client and a demonstrably working user workflow. In particular, it requires:

- image and video generation from the right pane;
- explicit support for user-selected reference images;
- automatic inclusion of character images referenced in a prompt;
- automatic extraction and upload of the relevant main-audio segment when a shot has a valid range, whether that range comes from a timeline clip or `StoryboardShot.startSeconds`/`endSeconds`;
- persistent, retryable jobs;
- correct creation, versioning, shot linkage, and optional timeline placement of generated results;
- deterministic tests and a browser-verified end-to-end acceptance run.

This document specializes [AI Generation & Providers](./ai-generation-providers.md) for WaveSpeed and extends [Storyboard](./storyboard.md). Where the documents conflict, the ownership model in `storyboard.md` remains authoritative and this document is authoritative for WaveSpeed-specific generation behavior.

## 2. Fit with the storyboard ownership model

`StoryboardShot` owns creative intent and generation history. A timeline `Clip` owns placement. A generated image or video is a `MediaItem` referenced by the shot and optionally used by one or more clips.

The implementation MUST preserve these boundaries:

- Prompt, negative prompt, style, seed, render mode, shot timing, reference asset IDs, and generation attempts belong to `StoryboardShot`.
- Timeline start, duration, in/out points, track, and clip-level effects belong to `Clip`.
- Binary output, technical media metadata, provider metadata, and version grouping belong to `MediaItem`.
- A timeline clip MUST reference the generated media item through `mediaId` and the shot through `metadata.shotId`.
- A generated asset MUST NOT be represented by a second metadata-only "scene" asset.
- Changing a shot prompt MUST NOT silently rewrite an existing clip's placement.
- Moving or trimming a linked clip MAY change the effective generation range for the next generation, but MUST NOT mutate the shot's stored range until the user explicitly chooses **Use timeline timing for shot**.

## 3. Current implementation audit

This table records the baseline that implementation and verification must replace. It is not evidence of completion.

| Capability | Current evidence | Required disposition |
|---|---|---|
| WaveSpeed models, submit, and poll | `apps/orchestrator/src/routes/wavespeed.ts`; `apps/web/src/services/wavespeed/index.ts` | Retain, harden validation and secret handling |
| Unified model dialog | `GenerateAssetDialog.tsx` lists KieAI and WaveSpeed models | Reuse as the expanded model picker, not as the primary inspector workflow |
| Reference picker | `ReferenceImagePicker` and `schema-injector.ts` exist | Replace URL guessing with a resolved provider-input contract |
| Persistent jobs | `generation-job-store.ts` and `useGenerationJobPoller.ts` exist | Add explicit target, shot, timing, audio, and output IDs; enforce idempotency |
| Output placeholder | Dialog creates a placeholder `MediaItem` | Job currently does not carry the placeholder ID, so completion cannot reliably update it |
| Reference semantics | `linkedMediaIds` stores reference IDs | Poller currently treats its first entry as the source asset to version; split these concepts |
| New output without source | Poller requires a source media ID | Support a new asset group when no source exists |
| Timeline placement | Poller checks `inputs.shotId`, `startTime`, and `duration` | Use typed job context, not provider input fields |
| Audio extraction | Media engines can extract audio, but generation has no shot-audio flow | Add deterministic range resolution, extraction, caching, upload, and cleanup |
| Character prompt references | Storyboard requires `@token` pills | Add token resolution and automatic character-image references |
| Inspector generation UI | Clip tabs include an `AI` tab; generation is primarily modal | Add an explicit `Generate` secondary tab in the Edit section of the right pane |
| Provider key boundary | Browser client reads and forwards a WaveSpeed secret | Move the provider credential to the orchestrator as required by `ai-generation-providers.md` |

The feature MUST NOT be declared working while any row above lacks its required disposition.

## 4. User-visible workflows

### 4.1 Generate a new image for a shot

1. The user selects a storyboard shot or its linked timeline clip.
2. The right pane opens **Edit → Generate**.
3. The form is prefilled from the authoritative `StoryboardShot`.
4. The user chooses **Image**, a compatible WaveSpeed model, and optional parameters.
5. Explicit shot reference images and prompt-referenced character images appear in the References section with their origin labels.
6. The user submits.
7. The form becomes a non-blocking job summary. Editing elsewhere remains possible.
8. On completion, a new image `MediaItem` or asset version is created, linked to the shot, appended to its generation history, and selectable as the current shot output.
9. Image output is not automatically placed on the timeline unless **Place result on timeline** is enabled.

### 4.2 Generate a new video for a shot

The image flow applies with these additions:

- **Video** filters models to text-to-video and image-to-video.
- The effective duration comes from the linked clip or shot range, subject to model constraints.
- A source image is required for image-to-video models.
- When enabled and supported by the selected model, the effective timed audio segment is included.
- **Place result on timeline** defaults on when the shot already has a linked clip or a valid range.
- Placement replaces the selected linked clip's media reference only when **Replace selected clip media** is chosen. Otherwise it creates a new linked clip on the first compatible visual track.

### 4.3 Generate without an existing shot

From the Assets panel or an empty inspector state, **Generate asset** opens the expanded model picker.

- No timeline or audio context is assumed.
- The result creates a new asset group.
- The user may optionally set a timeline start and duration before submission.
- The result is not attached to a storyboard shot unless the user explicitly chooses one.

### 4.4 Regenerate or create a variation

From a generated asset or shot output:

- **Regenerate** reuses the recorded model and inputs, then re-resolves live references and audio.
- **Create variation** copies the prior configuration into an editable draft.
- The result is a new immutable version in the same asset group.
- Setting an older version current MUST NOT delete later versions.

## 5. Right-pane information architecture

### 5.1 Location

The selected clip/shot inspector MUST expose a secondary tab named **Generate** within the existing **Edit** section of the right pane. It is a peer of clip editing tabs, not a separate provider tab and not hidden inside a generic AI panel.

Recommended order for a storyboard-linked visual clip:

`Clip | Transform | Color | Effects | Audio | Speed | Animate | Generate | File | Versions | Usages`

All secondary tab bars MUST scroll horizontally, preserve the active tab, support Home/End and arrow-key navigation, move DOM focus with selection, and expose correct `tablist`, `tab`, `tabpanel`, `aria-selected`, and `aria-controls` semantics.

### 5.2 Generate tab layout

The desktop right pane uses a dense, dark editor style consistent with the existing semantic tokens. It MUST use a single vertical scroll region and this order:

1. **Output**
   - segmented control: Image / Video;
   - model combobox with search, provider badge, capability badges, and loading/error states;
   - a **Browse all models** action opening the expanded unified picker.
2. **Prompt**
   - visible Prompt label;
   - multiline prompt editor with `@character` pills;
   - negative prompt under progressive disclosure when supported;
   - unresolved tokens shown inline as errors, not silently ignored.
3. **References**
   - source/first-frame image, when applicable;
   - automatic character references;
   - shot references;
   - user-added references;
   - each thumbnail shows origin and inclusion state.
4. **Timing and audio**
   - read-only effective range and duration with its source: Timeline, Shot, or Manual;
   - **Use shot audio** toggle, visible for video and only enabled for audio-capable models;
   - compact waveform/range preview after extraction;
   - explicit reason when audio is unavailable.
5. **Model options**
   - schema-driven compatible fields only;
   - advanced options collapsed by default;
   - units and model bounds displayed next to numeric controls.
6. **Destination**
   - New asset or New version of…;
   - Place result on timeline;
   - Replace selected clip media, only when replacement is safe.
7. **Primary action and status**
   - one full-width primary **Generate image** or **Generate video** button;
   - estimated cost when WaveSpeed provides a calculable price formula;
   - persistent job card after submission with status, elapsed time, cancel, retry, and reveal actions.

### 5.3 Interaction and accessibility requirements

- All controls MUST have visible labels. Placeholder text is never the only label.
- Icon-only controls MUST have accessible names and at least a 44×44 CSS-pixel hit target where panel width permits; compact desktop controls MAY use a 32-pixel visual box with an expanded hit area.
- Keyboard order MUST follow visual order.
- Focus MUST move to the first invalid control on submit.
- Field errors MUST appear adjacent to their control and in an error summary when more than one field fails.
- Job updates MUST use `aria-live="polite"`; failures use `role="alert"`.
- Status MUST not rely on color alone. Use icon, label, and semantic color.
- Thumbnails MUST have descriptive alt text and fixed aspect-ratio boxes to prevent layout shift.
- Loading longer than 300 ms MUST show a status indicator. The UI MUST not look frozen.
- Model changes MUST preserve compatible user input and explicitly list any fields that were reset.
- Motion is limited to 150–250 ms opacity/transform transitions and respects `prefers-reduced-motion`.
- Closing or changing selection MUST preserve the generation draft by shot ID. A dirty draft requires confirmation before destructive reset.
- At panel widths below 320 px, paired controls stack. The right pane MUST not introduce horizontal page scrolling.

## 6. Effective generation context

Generation MUST operate on a typed context assembled before provider input mapping.

```typescript
interface GenerationContext {
  projectId: string;
  shotId?: string;
  clipId?: string;
  target: GenerationTarget;
  timing?: GenerationTiming;
  references: ResolvedGenerationReference[];
  audio?: ResolvedGenerationAudio;
}

type GenerationTarget =
  | { kind: "new-asset"; placeholderMediaId: string }
  | { kind: "new-version"; sourceMediaId: string; placeholderMediaId: string };

interface GenerationTiming {
  source: "timeline" | "shot" | "manual";
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

interface ResolvedGenerationAudio {
  sourceMediaId: string;
  sourceVersionId: string;
  sourceClipId: string;
  projectStartSeconds: number;
  projectEndSeconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  mimeType: string;
  sha256: string;
  remoteInput: { kind: "url" | "upload-token"; value: string };
}
```

Provider `inputs` MUST contain only fields accepted by the selected WaveSpeed model. Project linkage, placement, target identity, and local media IDs MUST live in `GenerationContext`, not be smuggled into provider inputs.

### 6.1 Timing precedence

Resolve timing once, deterministically:

1. If a selected linked timeline clip exists, use `clip.startTime` and `clip.startTime + clip.duration`.
2. Otherwise, if the shot has finite `startSeconds` and `endSeconds` with end greater than start, use the shot range.
3. Otherwise, use a complete finite manual range supplied by the user.
4. Otherwise, timing is absent.

The displayed source MUST match the selected branch. A zero start is valid. Negative, non-finite, zero-length, or reversed ranges are invalid.

If a clip uses a non-zero media in-point, timeline placement still defines the soundtrack range. Clip media in/out points MUST NOT offset the project's main-audio extraction range.

### 6.2 Duration mapping

- Clamp or quantize duration only according to the selected model schema.
- Never silently change the storyboard or clip range to satisfy a provider.
- If the exact range is unsupported, show the submitted model duration and the source range before confirmation.
- Placement duration remains the effective shot range unless the user chooses **Fit clip to generated duration**.

## 7. Automatic shot-audio extraction

### 7.1 Audio source

The main soundtrack is resolved in this order:

1. the project-level music-video audio asset, when defined;
2. the audio clip explicitly linked as the project's main audio;
3. the first audible, non-hidden audio clip covering the complete effective generation range.

The implementation MUST NOT choose narration, sound effects, or a generated video's embedded audio merely because it is the first audio media item.

If multiple candidates remain ambiguous, audio inclusion is disabled with **Choose main audio**. Generation without audio remains available unless the selected model requires audio.

### 7.2 Extraction

When **Use shot audio** is enabled and timing is valid:

1. Intersect the effective range with the main audio clip's audible project range.
2. Convert project time to source-media time using the audio clip's start, in-point, speed, and trim values.
3. Reject an empty intersection. Warn when the requested range is partially outside the audio clip.
4. Extract a deterministic PCM WAV or the model-required format using the existing media engine, with FFmpeg fallback.
5. Record actual start, end, duration, MIME type, sample rate, channels, byte length, and a SHA-256 content hash.
6. Upload through an orchestrator-owned provider-input endpoint and obtain a provider-reachable URL or upload token.
7. Map that remote input only into an audio-capable schema field.

Audio MUST be extracted when either condition supplies timing: the shot is placed on the timeline, or the shot has valid start/end values. Timeline placement takes precedence as defined in §6.1.

### 7.3 Caching and lifecycle

The extraction cache key is:

`projectId + sourceMediaId + sourceVersion + sourceStart + sourceEnd + outputFormat`

- Reusing the exact range MUST reuse the local extraction and remote upload while valid.
- Changing timing, trim, speed, or source version invalidates the cache key.
- Temporary object URLs MUST be revoked.
- Failed and canceled submissions MUST clean up unreferenced temporary uploads.
- The generated asset's metadata stores the immutable audio provenance, not the temporary local URL.

### 7.4 Unsupported models

If the selected model has no audio input field:

- **Use shot audio** is disabled;
- helper text reads **This model does not accept audio. The generated clip will still align to the shot range.**;
- no extraction or upload occurs.

The mapper MUST NOT place an audio URL into an untyped URI field based on guesswork.

## 8. Reference image resolution

### 8.1 Reference sources and order

References are assembled in stable order:

1. required source/first-frame image;
2. characters in first-mention order in the prompt;
3. `StoryboardShot.referenceAssetIds` order;
4. user-added references in selection order.

Duplicates are removed by canonical asset/version ID while preserving the first occurrence. A single image may display more than one origin label, such as **Character: Mara** and **Shot reference**.

```typescript
interface ResolvedGenerationReference {
  mediaId: string;
  assetGroupId: string;
  versionId: string;
  origin: "source" | "character" | "shot" | "user";
  originId?: string;
  promptToken?: string;
  displayName: string;
  localPreviewUrl: string;
  remoteInput: { kind: "url" | "upload-token"; value: string };
}
```

### 8.2 Character prompt references

The canonical token syntax is `@<character-slug>`, rendered as an inline pill while retaining a parseable textual representation.

For every resolved character token:

1. Resolve the token to exactly one character record in the current project.
2. Resolve that character's current primary image version.
3. Add the image as an automatic reference.
4. Show the character name and thumbnail in the References section.
5. Preserve the token and resolved character/media/version IDs in generation provenance.

Unresolved, ambiguous, missing-image, or inaccessible characters block submission and identify the exact token. The UI provides **Choose character** or **Add character image** recovery actions.

Character matching MUST use stable IDs/slugs, not a case-insensitive scan of display names at submission time. Renaming a character updates the display pill but preserves its identity.

### 8.3 User controls

- Automatic character references are selected by default.
- A user MAY exclude an automatic character reference for one generation, but the UI must warn that the prompt still mentions the character.
- Exclusion affects only the generation draft, not the character or shot record.
- Adding a reference imports it as a real `MediaItem` before submission.
- **Generate new reference** opens a nested image-generation flow and, on completion, returns the new image to this draft without losing form state.

### 8.4 Provider-reachable media

Local blob URLs, `file:` URLs, and localhost URLs MUST NOT be sent to WaveSpeed.

Every selected reference passes through a resolver that either:

- confirms an existing HTTPS URL is provider-reachable and authorized for the job lifetime; or
- uploads the blob through the orchestrator and returns an expiring provider input token/URL.

Failure to resolve one required reference blocks submission. Optional reference failures are shown individually and require explicit removal or retry. They MUST NOT be silently skipped.

### 8.5 Schema mapping

WaveSpeed model schemas are authoritative.

- Recognize image fields from explicit schema type, array item type, media annotations, or a maintained per-model adapter.
- Do not treat every unannotated `format: "uri"` field as an image field.
- Validate minimum/maximum reference count before submission.
- Preserve source-image position where the model distinguishes source from references.
- Reject excess references with a clear count and recovery action; do not truncate silently.
- Unit-test every maintained model adapter with recorded schemas.

## 9. Model discovery and form behavior

### 9.1 Model normalization

Normalize provider models into:

```typescript
interface GenerationModelCapability {
  provider: "wavespeed";
  modelId: string;
  displayName: string;
  output: "image" | "video";
  mode: "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video";
  accepts: {
    prompt: boolean;
    negativePrompt: boolean;
    sourceImage: boolean;
    referenceImages: { min: number; max: number } | false;
    audio: boolean;
    seed: boolean;
  };
  duration?: { min: number; max: number; step?: number; allowed?: number[] };
  aspectRatios?: string[];
  requestSchemaVersion: string;
}
```

Classification MUST use the API schema and maintained overrides. A model MUST NOT be classified as image-to-video solely because its general `type` string contains "video".

### 9.2 Dynamic form

- Render schema fields in provider order.
- Apply defaults once on model selection, not on every render.
- Preserve `false`, `0`, and empty-array values.
- Validate required, enum, min/max, length, media count, and conditional requirements client-side and server-side.
- Unsupported fields are hidden rather than submitted.
- The server strips unknown keys before forwarding.
- A schema change between draft creation and submit triggers revalidation and a visible message.

### 9.3 Availability states

- Cached models may render immediately with **Refreshing** status.
- If refresh fails and cached data exists, cached models remain usable with a stale warning.
- If no model data exists, show retry and settings actions.
- Missing WaveSpeed configuration does not hide the provider. It shows **Configure WaveSpeed**.

## 10. Submission and secret boundary

The orchestrator is the only component that communicates with WaveSpeed using the provider API key.

- The web client authenticates to the local orchestrator using the application's normal session boundary.
- The web client MUST NOT read, store, attach, or log the WaveSpeed API key.
- The orchestrator loads the key from server-side secure configuration.
- Request and error logs redact credentials, signed URLs, and sensitive provider payload fields.
- Submit endpoints enforce body-size limits, content types, model allowlists, schema validation, and timeouts.

Submission sequence:

1. Validate the generation draft locally.
2. Create and persist the placeholder media item.
3. Resolve/upload references and optional audio.
4. Submit the sanitized provider inputs.
5. Persist a job with its provider ID and typed context in one transaction-like operation.
6. If steps 3–5 fail, mark the placeholder failed and retain a retryable draft. Never leave an untracked pending placeholder.

## 11. Persistent job contract

Replace overloaded `linkedMediaIds` semantics with explicit fields:

```typescript
interface GenerationJob {
  id: string;
  provider: "wavespeed";
  providerJobId: string;
  projectId: string;
  model: string;
  schemaVersion: string;
  prompt: string;
  inputs: Record<string, unknown>;
  context: GenerationContext;
  referenceMediaIds: string[];
  status: "preparing" | "queued" | "running" | "completed" | "failed" | "canceling" | "canceled";
  output?: { mediaId: string; url: string; mimeType: string };
  error?: { code: string; message: string; retryable: boolean; field?: string };
  attempt: number;
  retryHistory: GenerationJobAttempt[];
  createdAt: number;
  updatedAt: number;
}
```

Requirements:

- `placeholderMediaId` identifies the exact media item to finalize.
- `sourceMediaId` exists only for a new version and is never inferred from references.
- `referenceMediaIds` are provenance only.
- Shot, clip, timing, destination, and placement policy are explicit context.
- Retry preserves logical job ID, increments attempt, records the previous provider job ID, and creates a new provider job.
- Cancel calls WaveSpeed cancellation when supported and always stops local polling.
- Polling validates project ownership before writing output.
- Active work survives reload and resumes exactly once.

## 12. Completion, assets, and placement

### 12.1 Idempotent finalization

Finalization MUST be guarded by a durable `(provider, providerJobId)` completion key.

Repeated polls, reloads, React Strict Mode, multiple tabs, or network retries MUST NOT create duplicate blobs, media items, versions, shot attempts, or timeline clips.

Finalization order:

1. Claim the completion key.
2. Download output through the orchestrator or an authorized provider URL.
3. Verify MIME type and enforce size limits.
4. Inspect media metadata using the existing media pipeline.
5. Finalize the known placeholder as a new asset or version.
6. Append a `GenerationAttempt` to the shot and add the media ID to `generatedAssetIds` once.
7. Apply the placement policy.
8. Mark the job completed.

If a later step fails, retry resumes from the last durable step rather than creating a second output.

### 12.2 Media and provenance

Generated media metadata MUST record:

- provider, model, provider job ID, schema version, prompt, negative prompt, seed, and sanitized inputs;
- resolved shot and clip IDs;
- reference media/version IDs with origins and prompt tokens;
- audio source media/version ID and exact extracted range;
- requested and actual duration/aspect ratio/resolution;
- generation timestamps and attempt number.

API keys, signed upload URLs, blob URLs, and raw temporary tokens MUST NOT be persisted.

### 12.3 Placement policies

`none`:
- Create/finalize the asset only.

`create-linked-clip`:
- Require valid timing.
- Find or create a compatible visual track.
- Add one clip at `startSeconds` with `durationSeconds`.
- Set `metadata.kind = "storyboard-shot"`, `metadata.shotId`, provider job ID, and source `"generated"`.

`replace-selected-clip-media`:
- Require the selected clip to link to the same shot.
- Preserve clip ID, start, duration, effects, transforms, and metadata.
- Change only the clip's current media reference, with undo support.

Placement failure MUST leave the completed asset available and mark the placement sub-status failed with **Retry placement**. It MUST NOT mark provider generation failed.

## 13. Status, errors, and recovery

| State | User message | Available actions |
|---|---|---|
| Preparing | Preparing references and shot audio | Cancel |
| Queued | Waiting for WaveSpeed | Cancel, view details |
| Running | Generating image/video | Cancel when supported, view details |
| Completed | Result ready | Reveal asset, reveal timeline clip, create variation |
| Provider failure | WaveSpeed could not generate this request | Retry, edit settings, view sanitized details |
| Input upload failure | A reference or audio clip could not be prepared | Retry item, remove optional item |
| Finalization failure | Result generated but could not be saved | Retry save; do not resubmit provider job |
| Placement failure | Result saved but could not be placed | Retry placement, reveal asset |
| Canceled | Generation canceled | Retry |

Errors MUST carry stable codes and user-safe messages. Raw provider responses may be retained only in redacted diagnostic logs.

## 14. Deterministic test requirements

### 14.1 Unit tests

- Timing resolver selects timeline, then shot, then manual timing and accepts zero start.
- Invalid and partial ranges produce the specified errors/warnings.
- Audio source resolver selects only the main soundtrack and converts project time to source time correctly for trim and speed.
- Audio cache keys change for source version, timing, trim, speed, and output format.
- Character tokenizer resolves stable IDs, preserves first-mention order, reports ambiguity/missing images, and deduplicates references.
- Reference resolver merges all four sources in stable order and never emits local-only URLs.
- WaveSpeed schema adapters map source images, reference arrays, and audio only to supported fields.
- Model normalization correctly separates image/video and text/image-conditioned modes.
- Client and server schema validation agree for fixtures.
- Job creation never infers `sourceMediaId` from reference IDs.
- New-asset completion works with no source media.
- New-version completion targets the specified source group.
- Repeated completion calls create exactly one asset/version, shot attempt, and clip.
- Placement replacement preserves clip identity and edit state.
- Cancellation stops polling; retry records history and uses a new provider job ID.
- Secret and signed-URL redaction tests cover request and error logging.

Gate tests MUST be local, deterministic, non-flaky, and preferably complete in under two seconds per focused suite. Provider HTTP behavior uses recorded schemas and mocked responses.

### 14.2 Component tests

- Generate tab appears for storyboard shots, linked visual clips, generated visual assets, and valid empty/new-asset entry points.
- Output type filters compatible models.
- Prompt tokens render as accessible pills and unresolved tokens block submission.
- Automatic character and shot references display correct origin badges.
- User removal/exclusion updates the draft without mutating the shot.
- Audio toggle and reason text respond to timing, audio source, and model capability.
- Form labels, tab semantics, focus management, keyboard navigation, and live status regions are correct.
- Model switching preserves compatible values and reports resets.
- Submitting disables duplicate submission and creates one job.
- Closing/reopening or changing selection restores the correct per-shot draft.
- All error categories expose their required recovery actions.

### 14.3 Integration tests

Use a fake WaveSpeed server and real local stores/media processing fixtures:

1. text-to-image with no source creates a new asset and shot output;
2. image-to-video uploads source, shot references, and two prompt-referenced character images in stable order;
3. a timeline-linked shot extracts the exact audio segment and places one video clip at the same range;
4. an unplaced shot with start/end extracts the same range but follows the chosen placement policy;
5. a reference upload failure leaves a retryable placeholder and does not submit;
6. provider completion followed by local save failure retries finalization without a second provider submission;
7. reload during running and completion does not duplicate output;
8. two tabs polling the same job still finalize once;
9. replacing clip media is undoable and retains subsequent asset versions.

### 14.4 Provider eval

Because real WaveSpeed behavior is external and may vary by model, run a paid pre-ship eval against a maintained model matrix:

| Case | Minimum coverage | Pass condition |
|---|---|---|
| Text to image | 2 current models | Valid image received and finalized for both |
| Image to image | 1 model | Source and at least one reference are accepted |
| Text to video | 1 model | Valid playable video received |
| Image to video | 1 model | First frame/source is visibly respected |
| Multiple references | 1 supporting model | All submitted references appear in provider request evidence |
| Audio-conditioned video | Every supported model family | Exact audio file/range accepted and job completes |
| Failure mapping | invalid input and forced provider failure | Stable field/provider error shown with recovery |

Release threshold: 100% of required cases complete the technical pipeline, no duplicate artifacts, no secret leakage, and at least 90% of subjective reference-adherence checks pass across three fixed prompts. Store request manifests, hashes, sanitized responses, and output IDs as eval evidence.

## 15. Browser verification

UI completion requires browser verification against the running app on port 5173. The verifier MUST capture evidence for the exact workflow, not only page load:

1. Open a project with main audio, two characters with images, and a storyboard shot mentioning both characters.
2. Select the shot's timeline clip and open **Edit → Generate**.
3. Confirm prompt, character pills, reference thumbnails, timeline timing, and audio range.
4. Generate an image and confirm the job survives closing the inspector and completes as a shot output.
5. Generate a video using the image, references, and audio.
6. Confirm one result asset, correct provenance, correct shot history, and exactly one correctly placed/replaced clip.
7. Reload during a running job and confirm resumption without duplication.
8. Trigger reference, provider, save, and placement failures and confirm the specified recovery UI.
9. Verify keyboard-only tab and form operation, visible focus, screen-reader names, 200% zoom, reduced motion, and right-pane widths of 280, 320, and 420 px.

Evidence MUST include screenshots or recordings, job IDs, sanitized request manifests, output media IDs, clip IDs, extracted-audio hash/range, and the exact test commands/results.

## 16. Operational observability

Emit structured, redacted events for:

- draft validation failure by code;
- reference resolution/upload result by origin and count;
- audio extraction source, range, duration, hash prefix, and elapsed time;
- provider submit, poll transition, cancel, and retry;
- output download, inspection, finalization, shot linkage, and placement;
- idempotency claim/replay;
- failure stage and retryability.

Metrics SHOULD include submit-to-queue latency, queue-to-complete latency, extraction/upload latency, success rate by model and mode, finalization/placement failure rates, retry success, and duplicate-prevention count.

No event may contain API keys, full signed URLs, raw blobs, or unredacted prompts when diagnostic prompt logging is disabled.

## 17. Rollout and compatibility

- Introduce a persisted job-store migration from `linkedMediaIds` to `referenceMediaIds` plus explicit target context.
- Legacy active jobs without a placeholder or target MUST be marked **Needs attention** and offer safe relinking; they MUST NOT infer a source from references.
- Gate the new inspector flow behind `wavespeedGenerationV2` until deterministic suites and provider eval pass.
- Keep the unified `GenerateAssetDialog` as the expanded picker and new-asset entry point, backed by the same controller and job contract as the inspector.
- Remove direct browser secret access only after orchestrator configuration migration and a clear settings status are available.
- Rollback may hide new entry points and stop new submissions, but MUST continue polling/finalizing already submitted V2 jobs.

## 18. Definition of done

WaveSpeed generation is fully working only when all statements are true:

- A user can create both a new image and a new video from the right-pane Generate tab.
- The same generation controller serves the right pane and expanded dialog.
- Valid timeline or shot timing produces the exact expected audio extraction when the model supports audio.
- Every prompt-referenced character with an image is visibly and verifiably included.
- Explicit references are provider-reachable, schema-valid, ordered, and recorded in provenance.
- New assets and new versions both finalize without requiring a reference image to masquerade as a source asset.
- Completed results update the correct placeholder, shot history, asset group, and placement exactly once.
- Jobs survive reload, cancel, retry, provider failure, local save failure, and placement failure with correct recovery.
- Provider credentials never enter browser storage, requests, or logs.
- Required unit, component, integration, and provider eval gates pass.
- The complete workflow has been reproduced and verified in the browser with recorded evidence.

Until every item is evidenced, the correct status is **not fully verified**.
