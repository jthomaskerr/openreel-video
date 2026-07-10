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

## Execution protocol for GPT-5.6-Luna subagents

This section is normative for parallel execution. A subagent owns only the files in its work package unless the package explicitly lists a shared file. When a shared file must change, the subagent records the required edit in its handoff and the integration owner applies it. Subagents must not reformat unrelated code, delete user changes, or infer contracts that are owned by an earlier package.

Every package follows the same loop:

1. Read this plan, the cited spec sections, the package's existing files, and the nearest tests. Do not load unrelated directories.
2. State the package's measurable outcome before editing.
3. Add or update a deterministic failing test for each behavior being introduced.
4. Implement the smallest permanent change that makes the focused tests pass.
5. Run the focused test command, TypeScript checking for the affected workspace, and lint when an affected workspace exposes a lint script.
6. Inspect `git diff --check` and the package-scoped diff. Do not stage or commit because multiple agents share the working tree; the integration owner commits after reconciliation.
7. Return a handoff containing files changed, contract decisions, exact commands and results, known failure modes, and any work that remains blocked by another package.

Tests must use fixed IDs and timestamps, no network, no real provider credentials, and no wall-clock sleeps. Prefer table-driven tests. Error assertions use stable codes, not complete English messages. No persisted fixture may contain an API key, signed URL, upload token, `blob:` URL, or localhost provider input.

### Dependency graph and execution waves

| Wave | Packages | May run in parallel | Starts when | Integration gate |
|---|---|---|---|---|
| 0 | WP-00 | No | Immediately | Expanded plan reviewed against spec |
| 1 | WP-01, WP-02, WP-03 | Yes | Wave 0 complete | Shared contracts compile; all three focused suites pass |
| 2 | WP-04, WP-05 | Yes | WP-01 and relevant WP-02/WP-03 contracts merged | Restart/redaction and PCM/cache suites pass |
| 3 | WP-06 | No | WP-04 and WP-05 merged | Failure-injection submission suite passes |
| 4 | WP-07A, WP-07B | Yes, with disjoint ownership | WP-06 merged | Finalization and placement suites pass together |
| 5 | WP-08, WP-09 | Yes | WP-06 and status contracts from WP-07A merged | Component and state-machine suites pass |
| 6 | WP-10 | No | All implementation packages merged | Full deterministic, browser, and provider gates evidenced |

`WP-01` owns exported shared types and schemas. `WP-02` and `WP-03` may define package-private provisional types while running in parallel, but the integration owner must replace them with `WP-01` exports before Wave 1 closes. This is the only intentional Wave 1 reconciliation point.

### Repository-wide contract decisions

- All durations and timeline/source positions are finite seconds. Validation rejects `NaN`, infinities, negatives, reversed ranges, and zero-length ranges. Zero is valid for a start or in-point.
- Persisted timestamps are Unix milliseconds. Tests inject them; business logic must not call `Date.now()` internally when a timestamp parameter or clock dependency can be supplied.
- Logical job IDs are application IDs. Provider job IDs identify attempts. Idempotency keys are derived from provider plus provider job ID and are never inferred from prompt or media identity.
- `GenerationContext` contains project linkage only. `providerInputs` contains only keys accepted by the selected recorded schema. A serializer must make this separation visible.
- Remote provider inputs persist only opaque upload-token IDs. Signed provider URLs may exist in memory during a provider call but never in job JSON, media provenance, browser storage, logs, or test snapshots.
- Placement is a sub-state independent of provider completion. A completed provider job with failed placement remains completed and offers placement retry.
- Legacy jobs missing an explicit target become terminal `needs-attention` records. Migration never treats the first reference as a version source.
- Character slugs are normalized once when stored. Prompt resolution is exact against the canonical slug and retains stable character IDs after rename.

### Standard handoff template

```text
Outcome: <measurable result>
Files changed: <paths>
Contracts added/consumed: <symbols and schema versions>
Tests: <exact command and pass/fail count>
Typecheck/lint: <exact command and result>
Failure modes checked: <list>
Integration notes: <shared export edits or ordering requirements>
Unverified: <explicit gaps, or none>
```

## Executable work packages

### WP-00: Plan expansion and execution control

**Owner:** integration owner. **Dependencies:** none. **Owned file:** this plan.

**Outcome:** Every implementation package can be assigned without requiring architectural invention, and parallel packages have non-overlapping ownership plus a stated reconciliation point.

**Tasks:**

1. Confirm every normative requirement in spec sections 6–17 maps to one package and one deterministic or browser/provider gate.
2. Record current dirty files before dispatch and preserve all pre-existing modifications.
3. Create the execution waves above. Dispatch only a wave whose dependencies are green.
4. After each wave, review package diffs, replace provisional types with shared exports, run the combined gate, then make one conventional commit per coherent behavior.

**Acceptance:** The traceability matrix at the end of this document has no unowned requirement; each package below has inputs, outputs, test cases, commands, and failure behavior.

### WP-01: Shared generation contracts, schemas, and migrations

**Owner:** domain-contract agent. **Dependencies:** none. **Exclusive files:** `packages/music-video-domain/src/generation/**` and generation-specific domain tests. **Shared-file requests:** `packages/music-video-domain/src/types.ts`, `packages/music-video-domain/src/index.ts`, and existing adapter fixtures are applied by the integration owner.

**Outcome:** Web and orchestrator import one versioned, secret-safe contract that parses valid generation jobs and rejects ambiguous targets or malformed state.

**Required public symbols:**

- `GENERATION_JOB_SCHEMA_VERSION` starting at `2`.
- `GenerationTarget`, `GenerationTiming`, `GenerationPlacementPolicy`, `GenerationPlacementState`, `GenerationReferenceOrigin`, `ResolvedGenerationReference`, `ResolvedGenerationAudio`, `GenerationContext`, `GenerationError`, `GenerationAttempt`, `GenerationCheckpointName`, `GenerationCheckpointState`, `GenerationOutput`, `GenerationJob`, and `GenerationModelCapability`.
- Zod schemas with matching names suffixed `Schema`, plus `parseGenerationJob` and `migratePersistedGenerationJob`.
- `SanitizedGenerationProvenance`, which permits IDs, model/schema identity, timing, hash, dimensions, sanitized inputs, and reference origins, but has no fields for secrets or temporary URLs.
- `ProjectCharacter` with stable `id`, canonical `slug`, `displayName`, `primaryImageMediaId`, and optional `primaryImageVersionId`.

**Contract details:**

- Target is exactly `{kind:'new-asset', placeholderMediaId}` or `{kind:'new-version', sourceMediaId, placeholderMediaId}`.
- Placement policy is exactly `none`, `create-linked-clip`, or `replace-selected-clip-media`; replace requires `clipId` at context validation time.
- Job status includes `preparing`, `queued`, `running`, `completed`, `failed`, `canceling`, `canceled`, and `needs-attention` for migrated unsafe legacy records.
- Attempt history records attempt number, provider job ID when submission occurred, start/end timestamps, terminal error, and does not duplicate current secret-bearing inputs.
- Checkpoints separately represent output claimed/downloaded/verified/inspected, placeholder finalized, shot linked, and placement applied. Each stores status and timestamp, not arbitrary provider payload.
- Schemas use strict objects at network and persistence boundaries. Provider inputs remain a JSON-value record and are sanitized separately by WP-03.

**Deterministic tests:**

1. Parse a complete new-asset and new-version job.
2. Preserve `0`, `false`, and `[]` in JSON-valued sanitized inputs.
3. Reject missing placeholder, replacement without clip, invalid timing, duplicate/invalid attempt numbers, and unknown boundary keys.
4. Serialize/parse round-trip without signed URLs or temporary URLs.
5. Migrate a reconstructable legacy job only when explicit placeholder/target fields exist.
6. Migrate an ambiguous `linkedMediaIds` job to `needs-attention` without creating `sourceMediaId`.
7. Convert NeuralFrames character fixtures deterministically to stable IDs/slugs; collision handling is deterministic and tested.

**Focused gate:** use the domain workspace's existing test and typecheck scripts discovered from `package.json`; the suite must remain below two seconds on a warm run.

**Subagent prompt:** Implement WP-01 exactly. Do not edit web or orchestrator. If shared exports/types need changes, report the exact patch in the handoff rather than editing shared files. Start from tests, keep Zod schemas strict, and prove unsafe legacy jobs never infer a source from references.

### WP-02: Pure timing, character, reference, and audio-source resolvers

**Owner:** context-resolver agent. **Dependencies:** consumes WP-01 concepts but may use local provisional interfaces until reconciliation. **Exclusive files:** `apps/web/src/features/generation/context/**`.

**Outcome:** Given explicit project/shot/clip/media inputs, pure functions return one deterministic generation context or stable errors/warnings without network, stores, browser APIs, or provider assumptions.

**Required functions:**

- `resolveGenerationTiming({linkedClip, shot, manualRange})` returns `{timing, errors, warnings}` using timeline > shot > complete manual precedence.
- `tokenizeCharacterMentions(prompt)` returns exact textual spans and first-mention canonical slug order.
- `resolveCharacterTokens({tokens, characters, mediaVersions, priorBindings})` retains valid prior stable-ID bindings after character display-name changes and emits `unresolved-token`, `ambiguous-token`, `missing-primary-image`, or `inaccessible-primary-image` errors.
- `resolveGenerationReferences({source, characters, shotReferences, userReferences})` merges in normative order, deduplicates by `mediaId + versionId`, and accumulates all origin labels on the first item.
- `resolveMainAudioSource({projectAudioId, linkedMainAudioClipId, clips, media, timing})` returns a selected source or `audio-ambiguous`, `audio-unavailable`, `audio-no-coverage`, plus partial-coverage warning.
- `projectRangeToAudioSourceRange({timing, clip})` accounts for clip start, source in-point/trim, speed, and audible intersection. It does not use a selected visual clip's in-point.

**Input discipline:** Define narrow readonly input types rather than importing the project store. URLs are not resolved here. References carry canonical identity and local access state only; WP-04/WP-06 converts them to upload tokens.

**Deterministic test table:**

- Timing: timeline wins, valid shot fallback, complete manual fallback, zero start accepted, half-manual absent/error, negative/non-finite/reversed/equal rejected.
- Tokens: punctuation and repeated mentions, first-mention order, exact slug rather than display-name match, rename with prior binding, slug collision ambiguity, missing/inaccessible image.
- References: four-source order, source position retained, duplicate accumulates origins, same media/different version remains distinct, excluded automatic reference stays excluded only in draft.
- Audio: explicit project identity wins, linked main clip second, unique fully covering eligible clip third, narration/SFX/hidden/muted/generated embedded audio excluded, ambiguous candidates do not guess.
- Conversion: speed 0.5/1/2, non-zero in-point and trims, exact and partial overlap, empty overlap, fixed numeric expectations with tolerance no larger than one microsecond.

**Focused gate:** run only context resolver tests plus web TypeScript checking. No jsdom is required.

**Subagent prompt:** Implement WP-02 only under the owned directory. Use pure functions and table-driven Vitest tests. Do not touch Zustand, React, fetch, media decoding, or shared domain files. Return any provisional-to-shared type mapping in the handoff.

### WP-03: WaveSpeed model normalization and input validation

**Owner:** schema-adapter agent. **Dependencies:** consumes `GenerationModelCapability` from WP-01 after reconciliation. **Exclusive files:** `apps/web/src/services/wavespeed/model-capabilities.ts`, `apps/web/src/services/wavespeed/adapters/**`, `apps/web/src/services/wavespeed/__fixtures__/**`, and adjacent tests. **Deferred orchestrator mirror:** WP-04 imports the pure adapter package or moves it to shared domain during integration; do not duplicate logic.

**Outcome:** Recorded WaveSpeed schemas normalize into explicit capabilities, and one pure sanitizer maps user values plus resolved media only into reviewed provider fields.

**Adapter contract:**

- `normalizeWaveSpeedModel(rawModel, overrideRegistry)` returns a capability or stable `unsupported-schema` result with evidence describing which schema/override established output and mode.
- `sanitizeWaveSpeedInputs({schema, capability, draftValues, source, references, audio})` returns sanitized JSON inputs and ordered field errors.
- Only explicit media annotations, typed array items, or a reviewed model override may identify source/reference/audio fields. Generic URI format alone is insufficient.
- Unknown draft keys are stripped. Required, enum, numeric, string/array length, conditional source, reference min/max, audio, and duration rules are applied deterministically.
- Defaults are exposed separately as `getModelDefaults`; sanitizer does not reapply defaults during render/submit.
- A stable schema version is computed from a canonicalized subset of request schema plus override version. No arbitrary provider code or formulas are evaluated.

**Fixtures and tests:** Include anonymized recorded schemas for each family currently returned by the existing route. Test text-to-image, image-to-image, text-to-video, image-to-video, reference-array, audio-capable, misleading `type` string, untyped URI, unknown key stripping, `false`/`0`/`[]` preservation, reference count limits, duration bounds/allowed values, and schema-version drift.

**Focused gate:** adapter tests and web TypeScript checking; no network snapshots.

**Subagent prompt:** Implement WP-03 in the exclusive files. First inventory existing WaveSpeed route/client schema shapes. Do not edit `schema-injector.ts` yet; the integration owner replaces callers after the adapter contract is green. Unsupported schema must fail closed, especially for URI/media mapping.

### WP-04: Orchestrator security, uploads, persistence, and routes

**Owner:** orchestrator agent. **Dependencies:** WP-01 and WP-03. **Exclusive files:** new files under `apps/orchestrator/src/services/generation/**` and `apps/orchestrator/src/services/wavespeed/**`, route tests. **Shared files:** request integration-owner edits to `routes/wavespeed.ts`, `app.ts`, `env.ts`, route index, and package scripts.

**Outcome:** The orchestrator is the sole credential owner and authoritative durable job boundary; restart, replay, invalid input, and upload lifecycle behavior is deterministic.

**Repository interface and filesystem implementation:**

- `GenerationJobRepository`: create, get, update under keyed lock, find by provider completion key, list active by project, and compare-and-set checkpoint.
- JSON files live under a configurable generation data directory. Writes use same-directory temp file, fsync where existing repository conventions require it, then atomic rename. Startup ignores/removes only demonstrably orphaned temp files.
- Maintain durable lookup records for logical job ID and `(provider, providerJobId)`; conflicting provider keys fail with `generation-provider-id-conflict`.
- Tests use a unique temporary directory and instantiate a second repository to prove restart recovery.

**Upload repository:** validate MIME, byte limit, ownership, expiry, and reference count; return opaque IDs. Provider URL resolution is in-memory and redacted. Cleanup deletes only expired, unreferenced inputs.

**Routes:** configuration status, model discovery, upload, submit, status, cancel, retry, finalization-status, placement-retry, and cleanup. Enforce existing session/project authorization, exact content types, request limits, model allowlist, timeouts, strict shared schemas, and stable safe errors. Remove browser key headers and reject them if present. Configuration exposes only boolean state.

**Tests:** secret-header rejection, absent configuration, malformed/oversize bodies and files, unknown model/field stripping, ownership failures, restart recovery, concurrent duplicate submit/provider ID, upload expiry/refcount, safe cancel/retry, and redaction corpus covering headers, bearer values, provider keys, prompts when disabled, signed URLs, and upload tokens.

**Focused gate:** orchestrator route/repository/redaction tests, typecheck, and `git diff --check`.

### WP-05: Deterministic audio extraction and cache

**Owner:** media agent. **Dependencies:** WP-02 range contract and WP-01 audio provenance. **Exclusive files:** `apps/web/src/features/generation/audio/**`.

**Outcome:** Exact source ranges produce deterministic PCM WAV bytes and hashes, are cached by every byte-affecting input, and do no work for unsupported models.

**Contract:** A narrow injected decoder/extractor adapter receives source identity, resolved source range, output sample rate/channels/format, and returns bytes plus actual range. Default output is PCM WAV with a documented fixed format chosen from the existing media bridge's supported deterministic path. `buildGenerationAudioCacheKey` includes project, media/version, source range, in-point/trim, speed, sample rate, channels, and format using canonical number encoding.

**Tests:** generated PCM ramp/impulse fixtures verify header, sample count, exact converted range, partial-range metadata, stable SHA-256, cache reuse, invalidation for each key field, abort cleanup/object-URL revocation, and zero adapter calls when capability rejects audio.

**Focused gate:** audio tests under two seconds and web typecheck. Do not invoke a real FFmpeg process in gate tests.

### WP-06: Submission coordinator and draft/job cache

**Owner:** submission agent. **Dependencies:** WP-01–WP-05. **Exclusive files:** `apps/web/src/features/generation/submit-generation.ts`, adjacent tests, and new V2 draft/cache modules. **Shared callers:** dialog and existing job store edits are integration-owned.

**Outcome:** One accepted user action creates exactly one tracked placeholder and one provider submission, while every injected preparation failure leaves an explicit failed placeholder plus retryable draft.

**Coordinator phases:** validate draft; acquire in-flight key; create/persist placeholder; resolve references; extract/upload optional audio; sanitize inputs; submit logical job; cache returned status; release key. Use injected ports for project mutations, upload, submit, clock, and ID generation. Compensations never delete the placeholder; they mark it failed with stage/error code. Optional input failures require explicit draft removal or retry, never silent omission.

**Tests:** invalid draft focuses first field without mutation; double click and concurrent identical calls; Strict Mode replay; failures after placeholder, each reference, audio extraction/upload, provider submit, and local cache write; new-asset and new-version targets; exact placeholder ID in submitted context; no local/blob URL; no source inferred from reference.

### WP-07A: Durable finalization state machine

**Owner:** finalization agent. **Dependencies:** WP-04 and WP-06. **Exclusive files:** orchestrator finalization service and tests.

**Outcome:** Repeated/reordered completion signals, restart, and two workers produce one verified output and resumable checkpoints without resubmitting the provider.

**States:** claim provider completion key; download; verify MIME/size; inspect metadata through injected port; request placeholder finalization mutation; request shot linkage mutation; request placement; record terminal completion. Each successful side effect stores an idempotency key returned to the web mutation boundary. Placement failure is recorded separately and does not undo job completion.

**Tests:** two concurrent callers, restart after every checkpoint, corrupted/oversize output, new asset without source, explicit new version, shot-link retry, placement retry, and provider submission count remaining one.

### WP-07B: Project-store finalization and placement mutations

**Owner:** project/timeline agent. **Dependencies:** WP-01 placement contracts; may start after those merge while WP-07A runs. **Exclusive files:** new V2 mutation helpers/tests and `place-generated-asset.ts` tests. **Shared existing store/action files:** integration owner applies a minimal reviewed patch.

**Outcome:** Idempotency-keyed mutations finalize one placeholder, append one shot attempt, and apply at most one undo-aware timeline mutation.

**Tests:** new asset group; new immutable version in exact source group; duplicate key replay; append shot generated media/attempt once; `none`; create one linked clip at exact zero/non-zero timing; replace only `mediaId` while preserving clip ID/start/duration/in-out/effects/transforms/metadata; invalid shot mismatch; placement retry; undo/redo replacement.

### WP-08: Generate inspector and accessible draft experience

**Owner:** UI agent. **Dependencies:** WP-06 and stable status contracts. **Exclusive files:** new `GenerateTab` and section components/tests plus a V2 draft store. **Shared tab/dialog files:** integration owner applies reviewed edits.

**Outcome:** All valid entry contexts expose one accessible shot-aware Generate workflow whose draft survives selection changes and whose submit/status/recovery controls reflect the coordinator.

Use the `ui-ux-pro-max` skill before implementation. Follow spec section 5 exactly. Component tests cover context visibility, model filtering, token pills, reference origins/exclusion warning, timing/audio reasons, model switch preservation/reset list, first-invalid focus and error summary, duplicate submit, draft restoration, recovery actions, `aria-live`, alerts, tab roles/relationships, roving focus/Home/End/arrows, and narrow layouts without horizontal page overflow.

Browser behavior is not accepted from jsdom alone; WP-10 owns the mandatory live verification.

### WP-09: Regenerate, variation, cancel, retry, and recovery

**Owner:** recovery agent. **Dependencies:** WP-04, WP-06, WP-07A. **Exclusive files:** generation command/state-machine modules and tests. **Shared status UI:** integration owner applies reviewed wiring.

**Outcome:** Every recovery action resumes the correct stage and preserves attempt history without duplicate provider work.

Define an explicit transition table. Regenerate copies recorded configuration then re-runs live context resolution. Variation creates an editable draft only. Provider retry increments attempt and may submit a new provider job. Save retry and placement retry never submit. Cancel moves through canceling, stops polling regardless of provider support, and releases only unreferenced uploads.

Tests enumerate every allowed transition and reject all others; assert provider call counts, attempt history, polling behavior, and cleanup reference counts.

### WP-10: Integration, observability, browser verification, eval, and delivery

**Owner:** integration owner. **Dependencies:** all packages. **Owned scope:** caller wiring, docs, fake provider harness, evidence, commits, and final verification.

**Outcome:** One controller serves inspector and dialog, deterministic suites pass, live browser scenarios prove the UI behavior, and paid provider evidence meets the spec threshold before the feature flag is enabled.

**Integration order:**

1. Export WP-01 contracts and replace Wave 1 provisional types.
2. Wire the WP-03 sanitizer into both client and orchestrator; delete guessing behavior only after adapter fixtures pass.
3. Wire orchestrator routes and remove all browser key reads/headers. Add configuration migration docs before removal is committed.
4. Wire coordinator into dialog and job cache, then finalization/store ports, then inspector/recovery UI.
5. Add redacted structured events with injected logger tests. Do not log raw prompts unless diagnostic prompt logging is explicitly enabled.
6. Add fake-provider integration cases from spec 14.3 and failure injection at upload, provider, save, and placement boundaries.
7. Run affected tests after each atomic commit, then full workspace test, lint, typecheck, and build.
8. Start the app with `pnpm dev` on port 5173 and use the browser tool for every spec section 15 scenario. Capture exact IDs and screenshots/recordings in a dated evidence directory that is ignored unless Joseph approves tracking it.
9. Run the paid matrix only when credentials and spend authorization are available. The threshold is 100% technical pipeline cases, zero duplicates/leaks, and at least 90% subjective adherence across fixed prompts.

**Stop conditions:** Do not enable `wavespeedGenerationV2`, claim UI completion, or push a release-ready commit if browser verification is unavailable. Do not run paid evals without explicit authorization. If credentials are unavailable, deterministic and fake-provider work may be complete but final status is `BLOCKED` or `DONE_WITH_CONCERNS` according to whether release readiness was requested.

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

## Requirement traceability

| Spec requirement | Implementation owner | Primary deterministic evidence | Live evidence |
|---|---|---|---|
| §2 ownership boundaries | WP-01, WP-07B | contract and store mutation tests | asset/shot/clip inspection |
| §4 image/video/new asset/variation workflows | WP-06, WP-08, WP-09 | coordinator and component tests | browser cases 4–6 |
| §5 inspector information architecture/accessibility | WP-08 | component keyboard/ARIA/draft tests | browser case 9 |
| §6 typed context/timing/duration | WP-01, WP-02, WP-03 | schema, resolver, duration-adapter tests | timing labels and submitted manifest |
| §7 audio source/extraction/cache | WP-02, WP-05 | range conversion, PCM, hash, cache tests | waveform plus recorded hash/range |
| §8 reference and character resolution | WP-02, WP-04, WP-06 | order/dedupe/token/upload tests | character/reference thumbnails and manifest |
| §9 model discovery/forms/schema drift | WP-03, WP-08 | recorded adapter and component reset tests | model refresh/switch scenarios |
| §10 secret and submission boundary | WP-04, WP-06 | route, redaction, failure-injection tests | browser network/log inspection |
| §11 persistent jobs | WP-01, WP-04, WP-09 | migration/restart/retry/cancel tests | reload-during-job scenario |
| §12 completion/versioning/placement | WP-07A, WP-07B | checkpoint/concurrency/undo tests | exact media/shot/clip IDs |
| §13 status/errors/recovery | WP-08, WP-09 | state transition and recovery-action tests | four injected failure scenarios |
| §14.1–14.3 deterministic suites | WP-10 | focused and fake-provider command logs | not applicable |
| §14.4 paid provider eval | WP-10 | sanitized eval manifest validator | paid outputs after authorization |
| §15 browser verification | WP-10 | fixture/setup scripts | screenshots/recordings for all nine cases |
| §16 observability | WP-04, WP-07A, WP-10 | redacted event/logger tests | sanitized event capture |
| §17 rollout/compatibility | WP-01, WP-04, WP-10 | migration and feature-flag tests | rollback/poll-existing-job check |

## Canonical verification commands

Subagents may narrow test paths during development. The integration owner runs these gates after reconciliation, using the actual test filenames created by the packages:

```bash
pnpm --filter @openreel/music-video-domain test:run
pnpm --filter @openreel/music-video-domain typecheck
pnpm --filter @openreel/web test:run
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web lint
pnpm --filter @openreel/orchestrator test:run
pnpm --filter @openreel/orchestrator typecheck
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Any pre-existing unrelated failure is recorded with its exact command and output. It is not silently attributed to this feature, and it does not excuse a failure in a focused WaveSpeed gate.

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
