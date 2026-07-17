# WaveSpeed Image and Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement one package at a time. Steps use checkbox syntax for tracking.

**Goal:** Ship one secure, resumable WaveSpeed image/video workflow whose
references, projection-only audio, routing, finalization, and placement are
explicit and create no duplicate provider or project artifacts.

**Architecture:** The orchestrator owns provider credentials, validation,
durable jobs, attempts, uploads, polling, recovery, and output finalization.
The web app owns one provider-neutral draft/controller and idempotent project
mutations. Shared strict contracts make client and server validation agree.

**Tech stack:** TypeScript, React, Zustand, Zod, Vitest, filesystem-backed
orchestrator repositories, Playwright/browser verification, WaveSpeed provider
adapter.

## Global constraints

- Canonical requirements: [AI Generation and Providers](../../spec/generation.md),
  especially sections 1 through 11 and the WaveSpeed adapter in section 9.2.
- Compatibility entry point:
  [WaveSpeed Image and Video Generation](../../spec/superseded/wavespeed-generation.md).
- Provider credentials remain server-only. Never persist credentials, signed
  URLs, upload tokens, local/blob URLs, or unredacted sensitive provider data.
- Every durable job, output, provenance, project, media/version, mutation,
  event, and evidence boundary rejects `blob:`/`local:` URLs with
  `generation-local-url-forbidden`.
- Tests use fixed IDs and clocks, no real network, no wall-clock sleeps, and
  stable error codes.
- Do not mark browser or provider work complete without dated, reviewable
  evidence for the exact scenario.
- Do not enable or describe the feature as release-ready until every gate in
  the Definition of Done is evidenced.

---

## Current state, audited 2026-07-16

**Overall status:** ISOLATED DETERMINISTIC MODULES EXIST; PRODUCTION WIRING,
LIVE BROWSER PROOF, OBSERVABILITY PROOF, AND AUTHORIZED PROVIDER PROOF ARE
INCOMPLETE.

This table distinguishes code existence from active application behavior. A
focused test reference is not evidence that the production controller calls a
module.

| Area | Isolated deterministic state | Production state and evidence gap |
|---|---|---|
| Shared contracts and migrations | V2 contracts, strict schemas, migrations, and tests exist under `packages/music-video-domain/src/generation/` | Web still persists a legacy job shape; duplicated local types remain; effective client/server boundaries are not reconciled |
| Context and references | Pure timing, token, reference, audio-source, and projection-selection functions have focused tests | General resolvers are bypassed by the live dialog; per-item reference failure state and `Deactivate` are not wired |
| WaveSpeed normalization | Normalizer, sanitizer, fixtures, and focused tests exist | Multi-schema selection still depends on incomplete identity and a first-array-element path; live client/server submit paths bypass one shared decision |
| Server boundary | Filesystem job and upload repositories plus limited route tests exist | Authentication/ownership, request limits/content types, allowlists, strict shared schemas, timeouts, durable pre-submit reservation, upload leases, output identity, and real route recovery remain incomplete |
| Timed audio | Deterministic PCM WAV/hash/cache core has focused tests, including a zero-work unsupported-model path | No production decode/upload adapter calls it; live UI neither enforces projection-only eligibility nor proves zero work for non-audio models |
| Submission | `submitGeneration` covers validation, in-flight dedupe, placeholder compensation, staged failures, and retryable drafts in tests | Inspector and dialog do not use it as one controller; optional-reference failure is still generic or silently filtered in legacy paths |
| Finalization and placement | Checkpoint finalizer, idempotent project mutations, and placement helpers have focused tests | Active poller and routes bypass them; completed route/poller output contracts disagree; local save/finalization/placement retry is not active |
| Recovery | Web and orchestrator state machines have unit tests | HTTP actions and inspector handlers are not connected; cancel/retry semantics are not proven in the live flow |
| Inspector | Generate sections and component tests exist | Live inspector has no submit/status/recovery controller and can latch a no-op submit |
| Verification and release | Focused test files exist | Dependencies were absent during the 2026-07-16 audit, so gates did not execute; no fake-provider harness, browser evidence, redacted event/metric evidence, paid-provider matrix result, or enabled release flag exists |

The active route currently reports provider completion without the output
identity required by the active browser poller. Even if that seam were patched,
the poller still uses the legacy `linkedMediaIds[0]` finalization rule. Neither
path is the required typed, checkpointed finalizer.

## Normative decisions to implement

### Context and placement defaults

MINI-01 exports the exact durable `GenerationEntryContext` union and
`GenerationPlacementPolicy` type consumed by every package. `GenerationContext`
contains required `entryContext: GenerationEntryContext`; entry identity is not
duplicated in or inferred from `references`. The only serialized placement
values are `none`, `create-linked-clip`, and `replace-selected-clip-media`.
The UI may display `none` as “Library only”, but `library-only` is not a
serialized value.

| Explicit entry context | Timing/audio eligibility | Initial placement |
|---|---|---|
| `entryContext: { kind: "new-asset" }` | None; never infer shot, clip, range, or audio | `none` (UI: Library only) |
| `entryContext: { kind: "unplaced-shot"; shotId }`, even with valid stored shot timing | None until a valid projection is explicitly selected | `none` (UI: Library only) |
| `entryContext: { kind: "unlinked-range"; rangeId; startTime; endTime; destinationTrackId? }` | That exact range for timing; no audio source and zero audio work | `create-linked-clip` |
| `entryContext: { kind: "linked-projection"; shotId; clipId; startTime; endTime }` | That exact projection range; audio only if model capability permits | `replace-selected-clip-media` |

Every placement default is visible and user-changeable. Invalid or ambiguous
context blocks the dependent operation and never falls through to another row.

### Per-reference recovery

Each failed reference card retains a stable item ID, origin, order, error, and
active state and exposes `Retry`, `Remove`, and `Deactivate`:

- `Retry` retries only that item, preserves successful uploads/order, and does
  not submit a provider job.
- `Remove` removes the item from the active draft and revalidates.
- `Deactivate` retains its card/origin/error, marks it inactive, excludes it
  from provider inputs, and revalidates.
- Removal or deactivation never makes a required source/reference silently
  valid. Submission remains blocked with `generation-reference-required` when
  the selected mode/model still requires it.

### Multi-schema routing

The requested normalized mode plus exact provider instance, provider model,
schema, endpoint, and schema-version identifiers form the routing identity.
Persist it on each attempt. Client and orchestrator parse and validate the same
contract and must reach the same route. Missing, ambiguous, unsupported, stale,
or drifted identity fails closed. Provider array order is never consulted.

The paid matrix pins every routing field before authorization. An incomplete
entry is invalid and cannot authorize or execute a provider call.

### Recovery and exactly-once behavior

- Provider completion plus local download/validation/save/shot-link/placement
  failure retries only finalization; it never performs another provider submit.
- Cancel always stops local polling and calls provider cancel when supported.
- Provider retry increments the logical attempt and records a new provider job
  ID. Late responses from prior/canceled attempts are ignored.
- Reload resumes each active logical job once and produces one output, one shot
  attempt when applicable, and at most one requested placement.
- Models without audio capability perform zero audio resolution, extraction,
  cache, or upload calls.

### Persisted job dispositions and V2 rollback contract

MINI-01 implements the exhaustive disposition matrix in section 7 of the
canonical spec. `needs-attention` is persisted and recoverable, but is not
automatically polled. The acceptance fixture
`generation-job-dispositions.fixture.ts` must prove every legal transition,
reject every illegal transition without mutation, distinguish active versus
terminal dispositions, migrate unsafe legacy jobs without guessing, resume
each active job once after reload, ignore canceled late responses, use a new
provider ID on provider retry, and keep provider-submit count unchanged on
finalization retry.

V2 eligibility is `GenerationJob.contractVersion === 2` plus the server-owned
`generationV2ReleaseEnabled` configuration flag; the release flag is never
persisted in `GenerationJob`, `GenerationContext`, or project data. Rollback
hides/disables every new V2 entry point and rejects new V2
submissions before reservation/provider calls with
`generation-v2-rollback-active`. It continues polling, cancellation, recovery,
and finalization for already submitted V2 jobs. The deterministic fixture
`generation-v2-rollback.fixture.ts` and browser scenario 14 must prove no new
submit during rollback and successful completion/finalization of an already
submitted job.

### Implementation dependencies versus evidence ownership

Implementation dependencies mean required code contracts or handoffs that must
exist before a package can implement its behavior. Evidence ownership means the
package that runs or records the proof after integration; it does not make the
evidence owner an implementation prerequisite. MINI-01 owns shared contracts;
MINI-05 owns the durable route ports; MINI-08 depends on both for finalization
and recovery; MINI-11 owns shared-file integration; MINI-10 owns integrated
deterministic, browser, observability, and paid-provider evidence. Earlier
packages may declare evidence requests to MINI-10 without depending on MINI-10
to implement their code.

## Execution protocol and routing

Every implementation package is assigned to an exact `gpt-5.6-luna` Codex
implementer. A separate exact `gpt-5.6-sol` Codex verifier that implemented no
package performs the integrated final review. If either exact model is
unavailable, dispatch stops; no model substitution is allowed.

The verifier reads the canonical spec, this plan, all diffs, focused/full gate
output, browser evidence, redacted event/metric evidence, and authorized
provider evidence. It returns exactly `PASS`, `FAIL`, or `BLOCKED` with
requirement-level file/symbol evidence. Tests alone cannot produce `PASS`.

For each package, the implementer must:

1. State its measurable outcome before editing.
2. Read only its owned files, contracts, nearest tests, and cited spec sections.
3. Add a deterministic failing regression/acceptance test for each behavior.
4. Implement the smallest permanent change and run the focused gate.
5. Run the affected workspace typecheck/lint and `rtk git diff --check`.
6. Return changed paths, exact commands/results, failure modes, and unverified
   integration assumptions. Shared-file changes are recorded as typed handoff
   requests for MINI-11 rather than edited concurrently. MINI-11 alone owns the
   listed shared integration files.

## Independent remaining mini work packages

Packages in the same wave have disjoint owned paths and may run independently.
Each package is narrow enough for one `gpt-5.6-luna` implementer.

### MINI-01: Shared route and recovery contracts

**Wave:** 1

**Dependencies:** None.

**Owned files:** `packages/music-video-domain/src/generation/**` and adjacent
generation tests.

**Shared-file request:** MINI-11 applies exports from
`packages/music-video-domain/src/index.ts`.

**Outcome:** One strict schema owns routing identity, `GenerationEntryContext`,
`GenerationPlacementPolicy`, `GenerationContext`, per-reference state, attempts,
recovery commands, checkpoints, and
redacted provenance for both web and orchestrator.

- [ ] Add routing fields for requested mode, provider instance/model,
  provider schema/endpoint, and schema version; require them on each attempt.
- [ ] Add stable per-reference `active | failed` state, origin/error history,
  and command payload schemas for retry/remove/deactivate.
- [ ] Add strict schemas for submit, status, cancel, provider retry,
  finalization retry, placement retry, and normalized route errors.
- [ ] Add shared fixtures proving client and server parsing accept and reject
  identical payloads, including unknown keys and zero/false/empty values.
- [ ] Add redaction-safe provenance fields for routing, reference origins,
  timing/audio hash, output identity, and recovery checkpoints.
- [ ] Add the persisted `GenerationJob` disposition union and exhaustive
  transition matrix, including recoverable `needs-attention`, active polling
  membership, terminality, migration, and explicit retry/cancel commands.
- [ ] Persist `GenerationJob.contractVersion` as the literal `2`; keep
  `generationV2ReleaseEnabled` server configuration out of all persisted job,
  context, and project schemas.
- [ ] Add strict fixtures for all four `GenerationEntryContext` variants and
  assert exact `rangeId`, `shotId`, `clipId`, `startTime`, `endTime`, and optional
  `destinationTrackId` coverage without identity inference from references.
- [ ] Add `generation-job-dispositions.fixture.ts` with one assertion per legal
  and illegal transition, reload/poll behavior, late-response ownership,
  provider-retry ID history, and no-resubmit finalization recovery.
- [ ] Add strict V2 identity/release-gate commands and
  `generation-v2-rollback.fixture.ts`, proving rollback rejects new submissions
  while allowing already submitted jobs to poll, cancel, recover, and finalize.
- [ ] Add `generation-local-url-boundaries.fixture.ts` covering every durable
  job/output/provenance/project serializer with injected `blob:` and `local:`
  values and zero-write assertions.

**Deterministic gate:** domain generation tests and domain typecheck. Tests must
parse the exact `GenerationContext.entryContext` variants and
`GenerationPlacementPolicy` values, require `GenerationJob.contractVersion: 2`,
and reject missing/ambiguous routing, required inactive references, reused
provider job ID on retry, temporary/secret/local URL values in provenance, every
illegal job transition, unsafe legacy migration guesses, and rollback submissions.

**Evidence handoff:** MINI-01 supplies fixture results and sanitized transition
matrix to MINI-10; MINI-10 owns browser/provider execution and release evidence.

**Browser evidence:** N/A for this pure shared-contract package. MINI-10's
evidence-manifest checker proves every browser artifact parses MINI-01
contracts.

**Provider evidence:** N/A for direct execution. MINI-10 rejects every paid
case before execution unless its request and result parse these contracts.

### MINI-02: Explicit context defaults and projection-only audio

**Wave:** 1

**Dependencies:** None. MINI-11 later reconciles provisional local types with
MINI-01 exports.

**Owned files:** `apps/web/src/features/generation/context/**` and adjacent
tests.

**Consumes:** MINI-01 contracts after integration; local provisional test types
may be used before reconciliation.

**Outcome:** A pure resolver accepts `entryContext: GenerationEntryContext` and
maps each explicit variant to exact timing, audio eligibility, the serialized
`GenerationPlacementPolicy`, and stable validation errors.

- [ ] Replace broad timing fallback with the four-row normative table.
- [ ] Require explicit projection selection for shot audio; never use stored
  shot start/end alone and never choose among multiple projections.
- [ ] Preserve exact zero starts; reject negative, non-finite, half, equal, and
  reversed ranges with stable codes.
- [ ] Prove non-audio models return before audio-source resolution.
- [ ] Return visible, changeable `GenerationPlacementPolicy` defaults without
  mutating a saved user override; UI labels must not replace serialized values.

**Deterministic gate:** table-driven context tests under two seconds. Include
`GenerationEntryContext` fixtures for `new-asset`, `unplaced-shot` with `shotId`,
`unlinked-range` with `rangeId`/`startTime`/`endTime` and optional
`destinationTrackId`, and `linked-projection` with `shotId`/`clipId`/
`startTime`/`endTime`,
multiple projections, partial audio coverage, invalid ranges, and a zero-call
audio-source spy for unsupported models.

**Browser evidence:** MINI-10 owns scenarios 2-5 and records visible defaults,
exact timing, required projection selection, and zero audio work for unlinked
ranges and unsupported models.

**Provider evidence:** MINI-10 owns the selected-projection audio case with
exact requested/actual range and hash; unlinked-range cases omit audio.

### MINI-03: Stable WaveSpeed multi-schema routing

**Wave:** 1

**Dependencies:** None. MINI-11 later connects MINI-01 and MINI-03 exports.

**Owned files:** `apps/web/src/services/wavespeed/model-capabilities.ts`,
`apps/web/src/services/wavespeed/adapters/**`,
`apps/web/src/services/wavespeed/__fixtures__/**`, and adjacent tests.

**Shared caller changes:** MINI-11.

**Outcome:** One pure normalizer selects only a pinned supported routing
identity and one sanitizer validates declared fields without array-order or URI
guessing.

- [ ] Normalize recorded multi-schema fixtures by requested mode and stable
  model/schema/endpoint identifiers.
- [ ] Fail closed for missing, ambiguous, unsupported, stale, and drifted
  routes; reorder fixture schema arrays to prove invariant selection.
- [ ] Canonicalize a schema-version fingerprint and require submit-time match.
- [ ] Preserve declared `false`, `0`, and `[]`, strip unknown fields, and reject
  untyped media/audio URI fields.
- [ ] Export a maintained routing manifest schema used by paid-matrix
  validation; reject incomplete entries.

**Deterministic gate:** adapter tests and web typecheck, with no network snapshots.

**Browser evidence:** MINI-10 owns scenario 7 and records the exact routing
identity through selection, refresh, reload, and drift rejection.

**Provider evidence:** MINI-10 requires every paid case to pin the exact
provider/model/mode/schema/endpoint/version identity and forbids substitution.

### MINI-04: Per-reference draft preparation and recovery

**Wave:** 2 after MINI-01

**Dependencies:** MINI-01.

**Owned files:**
`apps/web/src/features/generation/drafts/**`,
`apps/web/src/features/generation/submit-generation.ts`, and adjacent tests.

**Shared UI caller changes:** MINI-11.

**Outcome:** A failure at reference N is represented and recovered per item,
while successful items retain order/uploads and no provider submit occurs.

- [ ] Consume the shared submit-preparation contracts with stable item ID,
  order, active boolean, ready-or-failed preparation status, error history,
  origin, and opaque `uploadLeaseId`.
- [ ] Implement item-scoped retry, remove, and deactivate commands.
- [ ] Define retry, upload, and release port interfaces for draft preparation.
- [ ] Add a cross-boundary parser test proving client and orchestrator accept
  and reject the same submit-preparation payloads.
- [ ] Revalidate model/source/reference minima after remove/deactivate and
  block with `generation-reference-required` when unsatisfied.
- [ ] Preserve all successful uploads and ordered identities when one item is
  retried; release only removed unreferenced leases.
- [ ] Assert provider submit count remains zero during reference recovery and
  one after the corrected draft is explicitly submitted.

**Deterministic gate:** submission/draft tests inject first/middle/last reference
failure, required source failure, optional remove/deactivate, retry failure,
and successful retry without duplicate uploads or provider calls.

**Browser evidence:** MINI-10 owns scenario 6 and records each failed card,
origin, error, Retry/Remove/Deactivate result, retained order, and required
blocking.

**Provider evidence:** MINI-10 owns the multi-reference case and proves only
active ordered references are submitted with no hidden omission or duplicate
provider submission.

### MINI-05: Strict durable orchestrator boundary

**Wave:** 2 after MINI-01 and MINI-03

**Dependencies:** MINI-01 and MINI-03 for shared schemas, job identity, and
upload contracts. MINI-11 is an integration handoff, not an implementation
dependency; MINI-10 is evidence ownership, not an implementation dependency.

**Owned files:** `apps/orchestrator/src/services/generation/index.ts`,
`apps/orchestrator/src/services/generation/lock.ts`,
`apps/orchestrator/src/services/generation/repository.ts`,
`apps/orchestrator/src/services/generation/uploads.ts`,
`apps/orchestrator/src/services/wavespeed/**`, and adjacent tests. MINI-05 MUST
NOT edit `apps/orchestrator/src/services/generation/finalization.ts`,
`apps/orchestrator/src/services/generation/recovery.ts`,
`apps/orchestrator/src/services/generation/observability.ts`, or
`apps/orchestrator/src/services/generation/evidence-manifest.ts`.

**Shared route/app/env/package-script changes:** MINI-11 applies only changes
outside MINI-05's explicit owned files.

**Outcome:** Provider mutation begins only after a durable logical attempt with
`GenerationJob.contractVersion: 2` is reserved, and this package owns the submit/status/cancel/provider-retry
boundary plus typed finalization and recovery ports. MINI-08 owns the
finalization-retry and placement-retry implementation/wiring, and MINI-11 owns
the shared route surface that connects those ports.

- [ ] Inject provider, job/upload repositories, allowlist, authenticated
  project owner, clock, timeout, finalizer, recovery service, and logger.
- [ ] Resolve opaque uploads only in memory; lock atomic retain/release and
  surface missing/corrupt state distinctly.
- [ ] Reserve logical job/attempt before provider submit and persist provider
  ID immediately after success.
- [ ] Make status return normalized output identity and route completion to the
  durable finalizer.
- [ ] Reject local/blob URLs at job, output, provenance, repository, and route
  persistence boundaries; preserve the stable error and zero-write behavior.
- [ ] Enforce the V2 rollback gate before reservation/provider submission while
  computing V2 eligibility from persisted `GenerationJob.contractVersion` plus
  server `generationV2ReleaseEnabled` configuration, and leaving already
  submitted V2 status, cancel, recovery, and finalization paths available.
- [ ] Wire cancel and provider retry to their named services, and expose typed
  finalization/recovery ports without implementing stage-specific retry wiring
  here.

**Deterministic gate:** restart-through-route, ownership, JSON/multipart size and
content-type, model allowlist, client/server schema parity for
`GenerationContext`/`GenerationJob`, timeout, upload lease, duplicate
submit/provider ID, output identity, cancel, retry, and redaction tests. The
rollback fixture must derive eligibility from `GenerationJob.contractVersion`
and server `generationV2ReleaseEnabled`, with no persisted release flag.

**Browser evidence:** MINI-10 owns scenarios 8-10 and 13 plus sanitized network
captures proving normalized completion, ownership, limits, no browser provider
key, and no secret/temporary/local URL leaks.

**Provider evidence:** MINI-10 exercises every paid case through this boundary
and records one provider submit per attempt, normalized status, cancel/retry,
and output identity.

**Evidence handoff:** MINI-05 exposes sanitized route/rollback counters and
boundary rejection results; MINI-10 owns integrated browser/provider evidence.

### MINI-06: Production audio adapter and zero-work capability path

**Wave:** 2 after MINI-02 and MINI-05

**Dependencies:** MINI-02 and MINI-05.

**Owned files:** `apps/web/src/features/generation/audio/**` and adjacent tests.

**Shared upload/controller caller changes:** MINI-11.

**Outcome:** Exact explicitly selected valid linked ranges produce deterministic
uploaded audio, and unsupported models perform no shot-audio work.

- [ ] Use the opaque audio upload-lease ports from MINI-02 and MINI-05 rather
  than introducing new shared upload callers here.
- [ ] Add the production decoder/extractor and cache lifecycle behind existing
  injected ports.
- [ ] Record requested/actual project/source ranges, format, byte length, and
  SHA-256 without temporary URLs in persisted provenance.
- [ ] Make abort/reset revoke local resources and release only unreferenced
  upload leases.
- [ ] Return partial coverage as a warning and invalid/empty extraction as a
  typed recoverable error.
- [ ] Prove unsupported capability calls no resolver, decoder, cache, upload,
  or cleanup port.

**Deterministic gate:** generated PCM fixtures plus web typecheck; no real FFmpeg or
provider process in deterministic tests.

**Browser evidence:** MINI-10 owns scenarios 4-5 and records zero audio calls
for unlinked ranges/unsupported models and exact range/hash for a selected
projection.

**Provider evidence:** MINI-10 owns the selected-projection audio-capable case;
all non-audio and unlinked-range cases must omit audio.

### MINI-07: One web controller and authoritative job cache

**Wave:** 3 after MINI-02, MINI-04, MINI-05, and MINI-06

**Dependencies:** MINI-02, MINI-04, MINI-05, and MINI-06.

**Owned files:** new modules under
`apps/web/src/features/generation/controller/**` and adjacent tests.

**Shared callers/stores:** changes to `GenerateAssetDialog.tsx`,
`InspectorPanel.tsx`, `apps/web/src/hooks/useGenerationJobPoller.ts`, and
`apps/web/src/stores/generation-job-store.ts` are MINI-11 patches.

**Outcome:** Inspector and dialog invoke one controller that creates one
placeholder and one durable provider submission, carries the exact
`entryContext: GenerationEntryContext` and `placementPolicy: GenerationPlacementPolicy`,
reconciles authoritative status on reload, and never infers entry identity from
references.

- [ ] Compose context, references, audio, sanitizer, submit, job cache, and
  recovery ports through one typed controller.
- [ ] Scope drafts/jobs by project and explicit `GenerationEntryContext` identity;
  never use references as an entry identity or duplicate its fields elsewhere.
- [ ] Replace direct dialog submit and no-op inspector submit with the same
  controlled lifecycle and `try/finally` release.
- [ ] Reduce the browser poller to authoritative status synchronization; remove
  browser output download/finalization and `linkedMediaIds[0]` inference.
- [ ] Migrate unsafe legacy jobs to `needs-attention` without guessing a source.

**Deterministic gate:** fake controller ports prove one placeholder/submit across
double click and React replay, reload/two pollers resume once, the
`{ kind: "new-asset" }` entry uses serialized `placementPolicy: "none"`, and the
exact `GenerationContext` manifest reaches the server.

**Browser evidence:** MINI-10 owns scenarios 1-2 and 8-10, proving dialog and
inspector share one controller, duplicate submit is blocked, and reload resumes
once.

**Provider evidence:** MINI-10 routes every paid case through this controller
and records the exact sanitized manifest and logical attempt IDs.

### MINI-08: Durable finalization, project mutations, and recovery wiring

**Wave:** 3 after MINI-01 and MINI-05

**Dependencies:** MINI-01 for the disposition/checkpoint/output contracts and
MINI-05 for durable status, provider identity, and recovery ports. MINI-11
owns shared store/action wiring as an integration handoff; MINI-10 owns
end-to-end evidence and is not an implementation dependency.

**Owned files:**
`apps/orchestrator/src/services/generation/finalization.ts`,
`apps/orchestrator/src/services/generation/recovery.ts`,
`apps/web/src/features/generation/finalize-generated-asset.ts`,
`apps/web/src/features/generation/recovery/**`,
`apps/web/src/features/music-video/timeline/place-generated-asset.ts`, and
adjacent tests. Existing store/action edits are MINI-11 patches.

**Outcome:** Provider completion finalizes exactly once, and every recovery
action resumes only its owned stage.

- [ ] Persist claim/download/verify/inspect/save/shot-link/placement/persistence
  checkpoints with idempotency keys.
- [ ] Make local save/finalization/placement retry reuse provider completion and
  output identity with provider submit count unchanged.
- [ ] Make provider retry increment attempt and require a new provider job ID.
- [ ] Make cancel stop polling immediately, call provider cancel when
  supported, reject late ownership, and clean only unreferenced inputs.
- [ ] Preserve clip identity, timing, trim, effects, and undo/redo on replacement.
- [ ] Finalize `entryContext.kind === "new-asset"` jobs with
  `placementPolicy === "none"` without source media, shot timing, audio, or
  placement calls, and add
  `generation-finalization-new-asset-no-source.fixture.ts` proving one
  media/version and `succeeded` with zero provider resubmits.
- [ ] Reject `blob:`/`local:` values at every finalizer checkpoint and project
  mutation boundary using `generation-local-url-boundaries.fixture.ts`.
- [ ] Continue polling, cancellation, recovery, and finalization for already
  submitted V2 jobs during rollback; reject only new V2 entry-point submits.

**Deterministic gate:** concurrent callers, restart after each checkpoint, corrupt
or oversize output, local save/shot-link/placement/persistence failure, cancel
late response, provider retry ID history, exact-one media/version/shot/clip, and
provider-submit call-count assertions. The no-source fixture must use
`entryContext: { kind: "new-asset" }` and `placementPolicy: "none"`.

**Browser evidence:** MINI-10 owns scenarios 9-11 and records stage-only retry,
one output/shot/placement, preserved clip edits, and undo/redo.

**Provider evidence:** MINI-10 owns cancellation, retry, and successful-job
reload cases; finalization/placement retry must not create a second provider
submission.

**Evidence handoff:** MINI-08 supplies checkpoint traces, no-source call counts,
URL rejection fixtures, and rollback continuation results to MINI-10.

**Typed MINI-11 recovery handoff:** wire the authenticated `reconcile-placement`
command to `GenerationRecoveryService.reconcilePlacement(jobId)` with
`GenerationFinalizer` injected as the structural reconciler; hydrate the
returned durable job into the shared store; expose the action only when
`isPlacementReconciliationCandidate(job)` is true; never poll
`needs-attention` or invoke browser-side placement; and migrate the current
poller's direct placement call onto the durable claim/reconciliation protocol.
MINI-08 owns the typed orchestrator and web command contracts only. MINI-11
owns the shared route, store, poller, and visible action integration.

### MINI-09: Inspector recovery and accessibility presentation

**Wave:** 4 after MINI-07 and MINI-08

**Dependencies:** MINI-07 and MINI-08.

**Owned files:**
`apps/web/src/components/editor/inspector/tabs/generation/**`,
`apps/web/src/components/editor/inspector/InspectorTabs.tsx`,
`apps/web/src/components/editor/inspector/clip-tabs.config.ts`, and adjacent
component tests. MINI-11 owns only final `InspectorPanel.tsx` wiring.

**Outcome:** The live inspector exposes exact context/defaults, per-reference
recovery, routing/audio explanations, persistent status, and every valid
recovery action with accessible focus and announcements.

- [ ] Render failed references individually with origin/error and
  Retry/Remove/Deactivate; retain deactivated cards visibly.
- [ ] Show the placement default and allow change before submission.
- [ ] Show explicit projection timing/audio provenance and an unsupported-audio
  zero-work explanation.
- [ ] Map every stable error category to edit/revalidate/item retry/provider
  retry/finalization retry/placement retry/cancel or a terminal explanation.
- [ ] Complete tab roles, roving arrows/Home/End, first-invalid focus, error
  summary, `aria-live`/alerts, visible focus, reduced motion, 280/320/420 px,
  and 200% zoom behavior.

**Deterministic gate:** component tests cover all rows above; browser acceptance is
owned separately and cannot be inferred from jsdom.

**Browser evidence:** MINI-10 owns scenarios 1, 6, and 12, including keyboard
navigation, 280/320/420 px, 200% zoom, reduced motion, visible focus, live
status, alerts, and no horizontal page overflow.

**Provider evidence:** N/A for presentation-only behavior. MINI-10 validates
that UI actions altering requests produce the expected sanitized manifests.

### MINI-11: Shared production integration

**Wave:** 5 after MINI-01 through MINI-09

**Dependencies:** MINI-01 through MINI-09.

**Model:** exact `gpt-5.6-luna` Codex; substitution is forbidden.

**Owned files:** `packages/music-video-domain/src/index.ts`,
`apps/orchestrator/src/routes/wavespeed.ts`,
`apps/orchestrator/src/app.ts`, `apps/orchestrator/src/env.ts`,
`apps/orchestrator/package.json`,
`apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`,
`apps/web/src/components/editor/settings/SingleServiceSettings.tsx`,
`apps/web/src/components/editor/InspectorPanel.tsx`,
`apps/web/src/hooks/useGenerationJobPoller.ts`,
`apps/web/src/stores/generation-job-store.ts`,
`apps/web/src/stores/project-store.ts`, and adjacent integration tests. No other
package may edit these files while MINI-11 runs.

**Outcome:** Every green package is connected through one typed production
path: shared exports, normalized route identity, projection-only audio,
per-reference actions, authoritative status, checkpoint finalization/recovery,
idempotent project actions, and one dialog/inspector controller.

- [ ] Apply each typed handoff request without duplicating package-private
  logic.
- [ ] Remove legacy direct WaveSpeed submission, browser provider-key header,
  browser provider-key state, `linkedMediaIds[0]` inference, browser output
  finalization, and no-op inspector submission.
- [ ] Wire the orchestrator config capability endpoint so browser settings read
  only non-secret capabilities, and keep browser provider keys, provider
  headers, and browser storage forbidden.
- [ ] Reconcile unsafe legacy jobs to `needs-attention` without guessing a
  source.
- [ ] Prove completed status carries output identity and invokes the durable
  finalizer exactly once.
- [ ] Prove project media/version/shot/clip mutations are idempotent and
  undo-aware.
- [ ] Apply the V2 rollback entry-point gate using
  `GenerationJob.contractVersion === 2` plus server
  `generationV2ReleaseEnabled` configuration, and prove new submissions are
  rejected before provider reservation while already submitted jobs continue
  polling, cancellation, recovery, and finalization. Never persist the release
  flag in `GenerationJob`, `GenerationContext`, or project data.
- [ ] Add integration regressions for `generation-job-dispositions.fixture.ts`,
  `generation-v2-rollback.fixture.ts`,
  `generation-finalization-new-asset-no-source.fixture.ts`, and
  `generation-local-url-boundaries.fixture.ts` through the production route.

**Deterministic gate:** integrated web/orchestrator fake-port tests cover one
dialog/inspector `GenerationContext` request, persisted
`GenerationJob.contractVersion: 2`, completion output identity, reload/two
pollers, per-reference commands, all `GenerationPlacementPolicy` defaults, and
stage-only recovery; affected workspace typechecks pass.

**Browser evidence:** MINI-10 owns mandatory scenarios 1-14 against the MINI-11
production path. Component-only fixtures cannot satisfy this gate.

**Evidence handoff:** MINI-11 supplies the integrated route/store traces and
fixture results; MINI-10 owns browser capture, observability artifacts, and the
release decision.

**Provider evidence:** MINI-10 routes every authorized case through the MINI-11
path and records exact routing/context IDs, one submit per attempt, and
exactly-once output/project mutations.

### MINI-10: Fake provider, observability, evidence, and release gate

**Wave:** 6 after MINI-11

**Dependencies:** MINI-11.

**Owned files:** `apps/orchestrator/src/testing/wavespeed-fake-provider.ts`,
`apps/orchestrator/src/routes/wavespeed.integration.test.ts`,
`apps/orchestrator/src/services/generation/observability.ts`,
`apps/orchestrator/src/services/generation/observability.test.ts`,
`apps/orchestrator/src/services/generation/evidence-manifest.ts`,
`apps/orchestrator/src/services/generation/evidence-manifest.test.ts`,
`apps/web/e2e/wavespeed-generation.spec.ts`,
`apps/web/src/features/generation/feature-flag.ts`,
`docs/runbooks/wavespeed-generation.md`, `.env.example`, and directly adjacent
fixtures. Existing `apps/web/playwright.config.ts` may be changed only if the
scenario cannot run under its current `./e2e` test directory.

**Outcome:** Deterministic integration, browser, structured event/metric, and
authorized paid-provider evidence is complete and independently reviewable.

- [ ] Add a deterministic fake provider with controlled IDs, status sequences,
  output bytes, cancel/retry, submit counters, and failure injection without
  sleeps.
- [ ] Emit and test redacted structured events for every stage and recovery
  action with the fields required by canonical section 10.
- [ ] Record stage latency and the success/retry/cancel/reload/failure/duplicate
  metrics listed in canonical section 10.
- [ ] Add an evidence-manifest schema/checker requiring exact sanitized IDs,
  routing, references, audio, provenance, errors/actions, artifact counts, and
  dated browser/provider artifact links.
- [ ] Run the complete deterministic disposition, rollback, no-source
  finalization, and durable-local-URL fixture matrix and fail the release gate
  on any illegal transition, new submit during rollback, source/audio call for
  a new asset, or boundary write containing `blob:`/`local:`.
- [ ] Capture explicit evidence ownership for each requirement separately from
  implementation dependencies: package fixtures are implementation evidence;
  MINI-10 owns integrated browser/provider/release evidence.
- [ ] Keep the release flag disabled until the independent verifier returns
  `PASS` after every gate.

**Deterministic gate:** fake-provider technical matrix 100%, evidence manifest schema
valid, redaction corpus zero leaks, and duplicate counters all zero.

**Browser evidence:** MINI-10 owns and captures all mandatory browser scenarios
with screenshots/recordings, sanitized network/events, exact IDs, audio
ranges/hashes, recovery actions, and artifact counts.

**Provider evidence:** MINI-10 validates the pinned paid manifest before any
call and, only after Joseph's explicit authorization, executes and records every
paid matrix case. Without authorization this field remains `BLOCKED`.

## Decision acceptance matrix

| Decision | Deterministic acceptance | Browser evidence | Paid-provider evidence after authorization |
|---|---|---|---|
| Projection-only audio and placement defaults | Table test covers all four `GenerationEntryContext` variants with exact identity fields, invalid/ambiguous projections, exact ranges, user override, and zero audio-port calls for unlinked ranges and unsupported models; serialized values are the `GenerationPlacementPolicy` union | New asset shows no timing/audio and serialized `none` (UI: Library only); unplaced shot requires projection; an unlinked range shows timing/default placement but no audio; a selected linked projection shows exact timing and eligible audio; model switch proves no audio work | Sanitized manifests prove unlinked ranges omit audio; only the selected-projection case records requested/actual audio range/hash and routing identity |
| Retry/Remove/Deactivate per reference | Failure at N retains successful order/uploads; each action changes only N; required minima continue to block; provider submit count remains zero until explicit valid submit | Each failed card shows origin/error/actions; deactivated card remains; removed card disappears; required validation is actionable | Ordered active-reference manifest before/after recovery; no hidden omission or duplicate provider submission |
| Stable multi-schema routing | Reordered/missing/ambiguous/unsupported/stale/drift fixtures fail or select invariantly; client/server acceptance matrix agrees | Requested mode and route identity persist through model refresh/reload; drift blocks with refresh/revalidate action | Exact provider/model/mode/schema/endpoint/version pinned and submitted; no case substitutes a model or route |
| Recovery and exactly once | Cancel stops poller; retry records new provider ID; finalization retry keeps provider count; reload/two pollers yield one output/shot/placement | Reload, cancel, provider failure, local save, shot-link, placement, and persistence failures expose exact recovery and finish with one output/placement | Logical/provider IDs and attempt history prove one submit per attempt and no duplicate output/media/version/shot/clip |
| Persisted dispositions and rollback | Every legal/illegal transition, `needs-attention` recovery, terminality, `GenerationJob.contractVersion: 2` rollback rejection/continuation, and no-submit counter pass; `GenerationEntryContext` new-asset/no-source and local-URL fixtures pass | Scenario 14 hides/rejects new V2 submissions while an existing V2 job reaches finalization; scenario 2 completes a `{ kind: "new-asset" }` entry with serialized `placementPolicy: "none"` and no source media | No new paid submit during rollback recovery/finalization; sanitized evidence proves exact disposition, checkpoint, output, and artifact counts |

## Mandatory browser evidence

Run the app on port 5173 only after deterministic and fake-provider gates pass.
For every scenario, capture a screenshot or recording, sanitized network/events,
logical and provider job IDs, provider/model/mode/schema/endpoint/version,
reference IDs/origins/order/active state, requested/actual audio timing and hash,
output identity, media/version/shot/clip IDs, recovery error/action, and expected
versus actual artifact counts.

Required scenarios:

1. Inspector and dialog produce the same sanitized request through one controller.
2. `{ kind: "new-asset" }` has no inferred timeline/audio context and uses
   serialized `placementPolicy: "none"` (UI: Library only).
3. Unplaced shot blocks audio; multiple projections require explicit selection.
4. Valid unlinked range and selected linked projection show exact timing and
   visible/changeable default placement.
5. Non-audio model performs no shot-audio work.
6. Ordered source/character/shot references include per-item Retry, Remove, and
   Deactivate, including required-reference blocking.
7. Multi-schema routing persists exact identity; stale/drifted routing blocks.
8. Double click, React replay, reload, and two pollers produce one placeholder,
   one provider submit for the attempt, one output, one shot attempt when
   applicable, and at most one requested placement.
9. Cancel stops polling; provider retry records a new provider job ID.
10. Provider, download, validation, save, shot-link, placement, and persistence
    failures expose their recovery actions; finalization retries do not resubmit.
11. All placement policies behave explicitly; replacement preserves clip state
    and undo/redo.
12. Keyboard-only use, 280/320/420 px, 200% zoom, reduced motion, focus/error
    summary, live status, and alerts pass without horizontal page overflow.
13. Browser storage, project JSON, provenance, network capture, and events have
    zero credentials, authorization values, signed URLs, upload tokens,
    local/blob URLs, or raw prompts when diagnostic logging is disabled.
14. With V2 rollback active, new dialog/inspector/direct-route submissions are
    hidden or rejected before provider reservation, while an already submitted
    V2 job continues polling, cancellation, recovery, and finalization without
    any new submit.

## Paid-provider authorization and matrix

No paid call is permitted without Joseph explicitly authorizing all of:

- credential/provider instance and account/region;
- exact model, requested mode, provider schema, endpoint, and schema version for
  each case;
- maximum total spend;
- evidence-retention location and retention period.

Deterministic, fake-provider, browser, observability, and manifest validation
must already pass. The matrix covers text-to-image, image-to-image,
text-to-video, image-to-video, multi-reference/character, selected-projection
audio, cancellation, retry, and successful-job reload. Pass threshold is 100%
technical cases, zero duplicates/leaks, and at least 90% subjective adherence
across fixed prompts. A failed or incomplete case blocks enablement; never
substitute a model, schema, endpoint, prompt, asset, or audio fixture silently.

## Canonical verification commands

Focused commands are run per package. After MINI-11 reconciliation, MINI-10
runs the actual scripts exposed by each workspace:

```bash
rtk proxy pnpm --filter @openreel/music-video-domain test:run -- src/generation
rtk proxy pnpm --filter @openreel/music-video-domain typecheck
rtk proxy pnpm --filter @openreel/web test:run -- src/features/generation src/services/wavespeed src/components/editor/inspector/tabs/generation
rtk proxy pnpm --filter @openreel/web typecheck
rtk proxy pnpm --filter @openreel/web lint
rtk proxy pnpm --filter @openreel/orchestrator test:run -- src/routes/wavespeed.test.ts src/services/generation src/services/wavespeed
rtk proxy pnpm --filter @openreel/orchestrator typecheck
rtk proxy pnpm test
rtk proxy pnpm typecheck
rtk proxy pnpm lint
rtk proxy pnpm build
rtk git diff --check
```

If a script does not exist or dependencies are absent, record the exact blocker;
do not translate a command that did not start into passing evidence.

## Definition of Done

- Client and server strict schema validation agree for every accepted/rejected
  routing and command fixture.
- Endpoints enforce authenticated ownership, limits, content types, allowlisted
  models, strict schemas, and timeouts.
- Projection-only audio, all placement defaults, per-reference actions, stable
  multi-schema routing, cancel/retry, reload, finalization retry, and every error
  recovery action pass deterministic and fake-provider gates.
- Models without audio perform zero shot-audio work.
- Redacted events and all listed latency/success/retry/cancel/reload/failure/
  duplicate metrics are evidenced with zero leaks.
- Browser evidence records exact timing, audio, references, routing,
  provenance, IDs, recovery failures/actions, and proves exactly one output and
  at most one requested placement.
- The explicitly authorized paid matrix passes its technical, leak, duplicate,
  and subjective thresholds.
- The exact independent `gpt-5.6-sol` verifier returns `PASS`.

Until every item is evidenced, the truthful status remains incomplete and no
browser/provider/release-complete claim is allowed.
