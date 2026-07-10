# WaveSpeed Image and Video Generation Implementation Plan

**Date:** 2026-07-10  
**Spec:** `docs/spec/wavespeed-generation.md`  
**Status:** Ready for implementation  
**Outcome:** A shot-aware WaveSpeed image/video generation flow resolves stable references and exact shot audio, survives reload/retry, finalizes one versioned asset, and applies an explicit idempotent timeline placement policy.

## Current-state findings

Serena semantic exploration found the existing path is useful scaffolding but not a safe base to extend in place:

- `GenerateAssetDialog` creates a placeholder after provider submission, does not put its ID in the job, resets drafts on open, guesses model modes, injects local URLs, and silently skips failed KieAI reference uploads.
- `GenerationJob` persists in browser local storage with overloaded `linkedMediaIds`; it has no typed target/context, attempt number, structured errors, output identity, placement state, or durable completion checkpoint.
- `processGenerationJobOnce` requires a source media item, infers it from references, reads shot/timing from provider inputs, downloads in the browser, and marks placement failure as provider failure.
- `apps/orchestrator/src/routes/wavespeed.ts` accepts a browser-supplied provider key, stores jobs in a process-local `Map`, forwards unvalidated inputs, and combines polling with output caching.
- `StoryboardShot` already owns prompt/timing/reference IDs/output history in `packages/music-video-domain/src/types.ts`; the implementation must extend this contract rather than duplicate shot intent in clip metadata.
- `placeGeneratedAssetOnTimeline` already prevents one class of duplicate placement and should be expanded for explicit create-versus-replace policies.
- `InspectorTabs` and `clip-tabs.config.ts` provide the tab shell, but the current `ai` tab is not the specified shot-aware `Generate` workflow and its keyboard/ARIA behavior needs a focused audit.
- Character data currently comes primarily from NeuralFrames metadata/import structures. There is no canonical project character slug + primary-image contract suitable for stable `@token` resolution.

## Architecture decision

Use the orchestrator as the authoritative generation/job/finalization boundary. Keep project media and timeline mutations in the web project store, but drive them from an orchestrator-owned, resumable finalization record with explicit checkpoints.

The browser-local Zustand job store becomes a cached view/draft index, not the source of truth. Shared Zod schemas and TypeScript types live in `packages/music-video-domain/src/generation/` and are consumed by both web and orchestrator. Provider inputs remain a sanitized schema-derived record; all project identity and placement data live in `GenerationContext`.

Do not add a new database framework solely for this feature. Implement a small filesystem-backed JSON repository under the orchestrator's existing data directory with atomic temp-file + rename writes and keyed locks. This fits the local-first application, survives process restart, is deterministic in tests, and can later be replaced behind the repository interface. SQLite is the main alternative if concurrent multi-process orchestrators become a requirement.

## Delivery sequence

### 1. Shared contracts and migrations

**Files:**

- Add `packages/music-video-domain/src/generation/contracts.ts`
- Add `packages/music-video-domain/src/generation/schemas.ts`
- Update `packages/music-video-domain/src/types.ts` and `src/index.ts`
- Update project serialization/migration fixtures in web and domain tests

**Work:**

- Define `GenerationContext`, target, timing, reference, audio, placement policy, output, structured error, attempt, checkpoint, and normalized model-capability contracts.
- Add stable character identity to the project domain: ID, slug, display name, primary image media/version IDs. Migrate imported NeuralFrames characters deterministically without relying on display-name lookup at submission.
- Extend generation provenance and `GenerationAttempt` without storing secrets, signed URLs, upload tokens, or blob URLs.
- Version persisted generation jobs and browser drafts. Migrate old jobs to a terminal legacy state when target identity cannot be reconstructed; never guess a source from `linkedMediaIds`.
- Add Zod schemas used at both network boundaries and fixture tests proving client/server acceptance and rejection agree.

**Gate:** focused domain tests cover parse/serialize/migration, zero-valued fields, and redaction-safe provenance.

### 2. Deterministic generation context

**Files:**

- Add `apps/web/src/features/generation/context/resolve-timing.ts`
- Add `resolve-character-tokens.ts`, `resolve-references.ts`, `resolve-audio-source.ts`
- Add adjacent focused tests and fixtures

**Work:**

- Implement timing precedence exactly: linked selected clip, valid shot range, complete manual range, absent.
- Reject negative, non-finite, reversed, and zero-length ranges while accepting `startSeconds = 0`.
- Tokenize canonical `@slug` text while retaining stable character IDs in the draft. Report unresolved, ambiguous, inaccessible, and missing-image tokens as blocking field errors.
- Merge source, first-mentioned characters, shot references, and user references in stable order. Deduplicate by canonical media/version identity while retaining all origin labels.
- Resolve the main soundtrack by explicit project audio identity before eligible timeline coverage. Return ambiguity/unavailability reasons rather than guessing.
- Convert project time to source time from clip start, trim/in-point, speed, and audible intersection. Return partial-range warnings separately from errors.

**Gate:** every resolver is a pure function with table-driven tests under two seconds.

### 3. WaveSpeed schema normalization and validation

**Files:**

- Add `apps/web/src/services/wavespeed/model-capabilities.ts`
- Replace `components/editor/generate/schema-injector.ts` with explicit adapters
- Add matching orchestrator validation in `apps/orchestrator/src/services/wavespeed/`
- Store recorded schemas in test fixtures

**Work:**

- Normalize API schemas into `GenerationModelCapability`; classify output/mode from explicit schema evidence plus maintained per-model overrides, never from a generic `type.includes("video")` shortcut.
- Recognize media fields only from schema annotations or a reviewed adapter. Encode source position, reference min/max, audio field, duration bounds/steps/allowed values, and request schema version.
- Build one sanitizer/validator contract that preserves `false`, `0`, and empty arrays, strips unknown keys server-side, and returns stable field error codes.
- Keep cached models usable during refresh failure with a visible stale state. Treat a schema version change as mandatory draft revalidation.
- Add cost calculation only where WaveSpeed exposes a deterministic formula that can be evaluated without arbitrary code execution.

**Gate:** recorded-schema adapter tests cover every supported WaveSpeed family and prove no untyped URI receives image/audio data.

### 4. Orchestrator secret, upload, and persistence boundary

**Files:**

- Refactor `apps/orchestrator/src/routes/wavespeed.ts`
- Add `services/generation/job-repository.ts`, `upload-repository.ts`, `redaction.ts`, and route tests
- Update `apps/orchestrator/src/app.ts`, `env.ts`, and package test scripts
- Update `apps/web/src/services/wavespeed/index.ts` and settings UI/tests

**Work:**

- Remove `X-WaveSpeed-Api-Key` support and browser secret reads. Load only `WAVESPEED_API_KEY` in the orchestrator. Settings reports configured/unconfigured state without exposing the key.
- Split routes into model discovery, provider-input upload, submit, status, cancel, retry, output/finalization status, and cleanup endpoints.
- Enforce auth/session boundary, JSON/multipart content types, body/file size limits, model allowlist, shared schema validation, timeouts, and safe errors.
- Persist logical jobs and attempts atomically. Add per-job locks and durable unique indexes represented by repository keys for `(provider, providerJobId)` and logical job ID.
- Store upload leases with expiry and reference counts. Accept blobs/local media from the authenticated browser, return opaque upload tokens, and resolve provider-reachable URLs only inside the orchestrator.
- Redact provider keys, authorization headers, full signed URLs, prompt text when disabled, and sensitive input fields from logs/errors.

**Gate:** orchestrator restart tests recover jobs; malformed/oversized requests fail safely; redaction tests contain no known secret or signed URL.

### 5. Audio extraction and cache

**Files:**

- Add `apps/web/src/features/generation/audio/extract-generation-audio.ts`
- Reuse the existing media decode/FFmpeg bridge through a narrow adapter
- Add extraction cache store and orchestrator upload client

**Work:**

- Extract deterministic PCM WAV at a fixed documented sample rate/channel layout unless a maintained model adapter requires another format.
- Record requested and actual project/source ranges, sample rate, channels, byte length, MIME type, SHA-256, source IDs/version, trim, and speed.
- Key the cache by all provenance that changes bytes: project/source/version, source range, trim, speed, and output format.
- Reuse valid local extraction and upload leases. Revoke object URLs and release unreferenced uploads on cancel/failure/reset.
- Skip all work for models without audio support. Surface missing timing, ambiguous source, empty intersection, and partial coverage distinctly.

**Gate:** small generated PCM fixtures prove sample-accurate range conversion, stable hashes, invalidation, and no extraction for unsupported models.

### 6. Submission coordinator and placeholder integrity

**Files:**

- Add `apps/web/src/features/generation/submit-generation.ts`
- Refactor `GenerateAssetDialog.tsx` to consume the coordinator
- Replace the browser job store contract and tests

**Work:**

- Validate the complete draft before mutation, focus the first invalid control, and produce a multi-error summary.
- Create the placeholder first and include its exact ID in `GenerationTarget`.
- Resolve/upload required references and optional audio; required failures block submission and optional failures require explicit removal/retry.
- Submit only sanitized provider inputs plus typed context to the orchestrator.
- Persist the returned logical job locally as a cache. If preparation/submission persistence fails, mark the known placeholder failed and retain the retryable per-shot draft.
- Add an in-flight submission key to prevent double-click, Strict Mode, and retry duplicates.

**Gate:** integration tests prove one placeholder/one provider submit and no untracked pending placeholder at every injected failure point.

### 7. Idempotent finalization, shot history, and placement

**Files:**

- Replace completion logic in `useGenerationJobPoller.ts` with a thin status synchronizer
- Add orchestrator finalization state machine/checkpoints
- Extend `project-store` media/version and clip actions with idempotency/undo-aware APIs
- Expand `features/music-video/timeline/place-generated-asset.ts`

**Work:**

- Checkpoint claim, output download, MIME/size verification, metadata inspection, placeholder finalization, shot linkage, and placement independently.
- Finalize a new asset without a source; finalize a new version only into the explicit source asset group.
- Append the shot attempt and generated media ID once using stable provider/logical job keys.
- Implement `none`, `create-linked-clip`, and `replace-selected-clip-media`. Replacement changes only `mediaId`, preserves clip identity/edit state, and participates in undo.
- Keep provider completion successful when placement fails. Persist a placement sub-status and expose retry placement without redownload or provider resubmit.
- Ensure multiple tabs and repeated/reordered polls observe one durable completion owner.

**Gate:** fake-provider integration tests cover reload, two pollers, finalization retry, placement retry, new asset, new version, exact-one clip, and undoable replacement.

### 8. Generate inspector experience

**Files:**

- Add `components/editor/inspector/tabs/GenerateTab.tsx` and focused section components
- Update `clip-tabs.config.ts`, `InspectorPanel.tsx`, `InspectorTabs.tsx`
- Refactor `GenerateAssetDialog.tsx` into the expanded “Browse all models” entry point
- Add a per-shot/new-asset draft store

**Work:**

- Add `Generate` for storyboard-linked image/video clips and valid asset/empty entry points; retain the unified dialog as the expanded picker.
- Render the specified section order in one vertical scroll region. Keep provider badges/capability badges, compatible model filtering, explicit timing source, audio reason, origin-labelled references, destination policy, and persistent job card.
- Implement accessible textual `@slug` token pills with stable identity, inline errors, recovery actions, and warnings for excluded mentioned characters.
- Preserve compatible values on model switches and list reset fields. Apply defaults once per model selection.
- Persist drafts by shot ID or explicit new-asset draft ID. Confirm only destructive resets, not inspector close or selection changes.
- Upgrade the tab shell to horizontal scroll, roving focus, Home/End/arrows, correct `tablist/tab/tabpanel` linkage, and active-tab preservation.
- Meet 280/320/420 px layouts, 200% zoom, 44 px targets where possible, reduced motion, visible labels/focus, polite live job status, and alert failures.

**Gate:** component tests cover all specified contexts, field behavior, keyboard/focus/ARIA, draft restoration, duplicate-submit prevention, and recovery actions.

### 9. Regenerate, variation, cancel, and recovery

**Files:**

- Extend job/status UI and generated asset/shot output actions
- Add orchestrator cancel/retry endpoints and web commands

**Work:**

- Regenerate from recorded configuration but re-resolve current references/audio; variation opens an editable copied draft.
- Retry keeps the logical job ID, increments attempt, records the previous provider job ID/error, and creates a new provider attempt only when needed.
- Finalization retry and placement retry resume their checkpoint without resubmitting WaveSpeed.
- Cancel transitions through `canceling`, calls WaveSpeed when supported, always stops local polling, and cleans only unreferenced temporary inputs.
- Expose stable error categories and the exact recovery actions in the spec.

**Gate:** state-machine tests reject invalid transitions and prove cancellation/retry history and cleanup behavior.

### 10. Observability, full verification, and documentation

**Files:**

- Add structured generation event helpers and metrics hooks
- Update orchestrator/web READMEs, `.env.example`, and user-facing configuration docs
- Add fake WaveSpeed integration harness and paid eval manifest/result format

**Work:**

- Emit redacted events for validation, preparation, upload, submit/poll/cancel/retry, checkpoint finalization, idempotency replay, shot linkage, and placement.
- Run focused suites, full affected workspace tests, lint, typecheck, and build.
- Run the paid provider matrix from spec §14.4. Require 100% technical pipeline success, zero duplicates/secret leaks, and >=90% subjective adherence across fixed prompts.
- Start `pnpm dev`, open port 5173, and execute every browser scenario in spec §15 including reload while running and injected reference/provider/save/placement failures.
- Capture screenshots/recordings, sanitized manifests, logical/provider job IDs, media/clip IDs, audio hash/range, and exact command outputs in a dated evidence directory outside tracked generated assets unless explicitly approved.

**Gate:** all deterministic gates pass, provider eval reaches threshold, and exact browser behavior is evidenced. UI completion cannot be claimed without this step.

## Commit sequence

1. `feat(domain): add typed generation contracts and migrations`
2. `test(generation): add context and resolver fixtures`
3. `feat(wavespeed): normalize schemas and validate inputs`
4. `feat(orchestrator): persist WaveSpeed jobs and secure credentials`
5. `feat(generation): resolve references and timed audio inputs`
6. `feat(generation): coordinate tracked placeholder submission`
7. `feat(generation): finalize outputs idempotently`
8. `feat(timeline): add explicit generated asset placement policies`
9. `feat(inspector): add shot-aware Generate workflow`
10. `feat(generation): add retry cancel variation and recovery`
11. `test(generation): add fake-provider integration and browser fixtures`
12. `docs(generation): document WaveSpeed operations and evidence`

Each commit must keep affected focused tests green. Do not combine the secret-boundary change with the inspector UI change.

## Important failure modes and controls

| Failure mode | Control and evidence |
|---|---|
| Duplicate assets/clips from reload or two tabs | Durable completion key + checkpoint tests with concurrent pollers |
| Placeholder cannot be finalized | Placeholder ID created before submit and required by target schema |
| Reference mistaken for version source | Separate `GenerationTarget` and provenance-only `referenceMediaIds`; migration rejects guessing |
| Local/blob URL reaches WaveSpeed | Opaque upload tokens and orchestrator-only URL resolution; adapter tests reject local schemes |
| Wrong audio slice | Pure timing/source conversion tests plus PCM hash/range browser evidence |
| Character rename breaks prompt identity | Stable character ID/slug tokens with migration and rename tests |
| Schema drift forwards unsafe fields | Shared schema version, submit-time revalidation, server stripping, recorded fixtures |
| Secret leaks to browser or logs | Remove key header/client storage; redaction and browser-network assertions |
| Save/placement failure resubmits provider job | Independent finalization/placement checkpoints and injected-failure integration tests |
| Browser job cache diverges from truth | Orchestrator authoritative status; Zustand reconciles by logical job ID on load |

## Definition of done

- All rows in the spec's current implementation audit have their required disposition.
- Deterministic unit/component/integration suites pass locally and remain non-flaky.
- Paid eval threshold passes for the maintained WaveSpeed matrix.
- Browser verification proves the exact image, video, references, audio, reload, failure, accessibility, and narrow-panel workflows.
- No API key, full signed URL, upload token, or blob URL appears in persistent state, provenance, logs, or captured manifests.
- One logical successful job produces exactly one finalized media output, one shot attempt, and at most one requested timeline mutation.
- Atomic conventional commits are pushed and restart instructions are reported.
