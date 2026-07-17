# AI Generation and Providers — Operational Spec

**Status:** Canonical operational specification
**Owner:** Generation subsystem
**Supersedes:** [AI Generation & Providers](./superseded/ai-generation-providers.md), [Atlascloud Provider Support](./superseded/atlascloud-provider.md), and [WaveSpeed Image and Video Generation](./superseded/wavespeed-generation.md)

## Scope

This specification owns provider discovery, unified generation controls, provider-neutral submission, persistent jobs, polling, cancellation, retry, reference resolution, output finalization, provenance, and provider adapters.

[Storyboard](./storyboard.md) owns creative shots. [Media Assets](./media-assets.md) owns created assets and versions. [Timeline](./timeline.md) owns placement mutations. [Inspector Shell](./inspector-shell.md) owns where generation controls appear.

## 1. Architecture and Security Boundary

The orchestrator is the sole component that authenticates to generation providers. The browser MUST NOT read, persist, transmit, or log provider API keys, provider headers, upload tokens, or other provider secrets.

- Credentials live in server-side secure configuration.
- Browser settings contain provider instance ID, label, availability, and non-secret capabilities only.
- The orchestrator exposes a non-secret configuration capability endpoint so the browser can read supported capabilities without any provider secret or browser-side credential state.
- A request identifies a configured provider instance; the orchestrator resolves its credential.
- Logs redact credentials, signed URLs, temporary tokens, and sensitive payload fields.
- Provider routes enforce authentication, body limits, content type, allowlisted models, schema validation, timeouts, and project ownership.

The provider-neutral route family is:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/generate/:provider/models` | Return normalized cached models |
| `POST` | `/api/generate/:provider` | Validate and submit a job |
| `GET` | `/api/generate/:provider/:jobId` | Return normalized job status |
| `POST` | `/api/generate/:provider/:jobId/cancel` | Cancel when supported and stop local polling |

## 2. Provider and Model Contracts

```ts
type GenerationProvider = "kieai" | "wavespeed" | "atlascloud";

interface GenerationModel {
  provider: GenerationProvider;
  providerInstanceId: string;
  id: string;
  label: string;
  modes: Array<"text-to-image" | "image-to-image" | "text-to-video" | "image-to-video">;
  inputSchema: Record<string, unknown>;
  routing: {
    providerModelId: string;
    requestedMode: GenerationModel["modes"][number];
    providerSchemaId: string;
    providerEndpointId: string;
    providerSchemaVersion: string;
  };
  capabilities: {
    referenceImages?: boolean;
    audio?: boolean;
    negativePrompt?: boolean;
    duration?: { min: number; max: number; values?: number[] };
  };
}
```

Provider model lists are normalized by the orchestrator and cached with stale-while-revalidate behavior. Cache entries are scoped by provider instance and configuration version. Failure to refresh MAY return a non-expired/stale result with an explicit stale marker; it MUST NOT combine results from different credentials.

Provider schemas are authoritative for supported parameters. Adapters map the normalized form to provider inputs without guessing unknown URL, image, audio, or duration fields.

For providers that expose multiple request schemas, routing uses the requested
mode plus stable provider model, schema, and endpoint identifiers. The selected
routing identity is persisted on every attempt and is revalidated before
authorization and submission. Routing MUST fail closed with a stable,
actionable error when any identity is missing, ambiguous, unsupported, stale,
or differs between client and orchestrator validation. Provider array order is
never a routing signal.

| Routing condition | Required result |
|---|---|
| Exactly one maintained route matches requested mode and pinned identifiers | Validate the same schema on client and server, then submit and persist the identity on the attempt |
| No maintained route or an incomplete manifest entry | Block with `generation-route-unsupported` |
| More than one matching route | Block with `generation-route-ambiguous` |
| Schema or endpoint identity changed after draft creation | Block with `generation-route-stale`; refresh models and revalidate the draft |
| Client and server select different schema identity or acceptance result | Block with `generation-schema-drift`; do not authorize or submit |

The maintained paid-provider matrix pins exact provider instance, model,
requested mode, schema, endpoint, and schema-version identifiers. A matrix
entry missing any of these fields is invalid and MUST NOT authorize a paid call.

## 3. Unified Generation UI

The prompt and reference controls are the shared surfaces defined by
[References and Generated Images](./references.md). All modal and sidebar
generated-image editors use the same controller, draft, schemas, job store, and
finalizer as **Edit → Generate**. The form includes the rich `@` mention editor,
inline character/image pills, derived reference cards, and model-supported
reference-role selection. References invalidated by a model change remain
visible but inactive and are omitted only after the warning contract in that
specification.

Generation uses one controller and one provider-agnostic form. There are no independent provider dialogs with separate job logic.

The primary editor surface is **Edit → Generate** for a selected compatible shot
or clip. New-asset generation and generated-image editing MAY render in a modal
or sidebar, but use the same controller, schemas, draft, job store, and
finalizer.

The form presents:

- mode and compatible model;
- shared `@` media mention prompt editor with inline character/image pills;
- negative prompt only when supported;
- schema-derived settings such as duration, dimensions, resolution, seed, and quality;
- derived reference cards with origin labels, availability, and supported role controls;
- timed audio when required and supported;
- validation, availability, cost/limit information when known;
- submission status and recovery action.

Unsupported fields are hidden or disabled with an explanation. Unresolved prompt tokens, unavailable required references, invalid duration, or missing provider configuration block submission.

## 4. Effective Generation Context

Generation context is explicit and immutable for an attempt:

```ts
interface GenerationContext {
  projectId: string;
  entryContext: GenerationEntryContext;
  mode: GenerationModel["modes"][number];
  placementPolicy: GenerationPlacementPolicy;
  prompt: string;
  negativePrompt?: string;
  references: ResolvedGenerationReference[];
  audioAssetId?: string;
  audioRange?: { startTime: number; endTime: number };
}

type GenerationPlacementPolicy =
  | "none"
  | "create-linked-clip"
  | "replace-selected-clip-media";

type GenerationEntryContext =
  | { kind: "new-asset" }
  | { kind: "unplaced-shot"; shotId: string }
  | {
      kind: "unlinked-range";
      rangeId: string;
      startTime: number;
      endTime: number;
      destinationTrackId?: string;
    }
  | {
      kind: "linked-projection";
      shotId: string;
      clipId: string;
      startTime: number;
      endTime: number;
    };
```

`entryContext` is the complete durable entry identity for the attempt. It is
required, immutable, and is never duplicated in `references`, inferred from
reference order, or reconstructed from stored shot timing. The serialized
placement policy is exactly `GenerationPlacementPolicy`: `none`,
`create-linked-clip`, or `replace-selected-clip-media`. The UI MAY label
`none` as “Library only”, but that label is not a serialized value.

For a storyboard shot, [Storyboard](./storyboard.md) is authoritative for prompt, timing, characters, and explicit references. A selected clip supplies placement context but does not override creative truth unless the user explicitly edits the generation form.

The controller derives defaults only from the explicit entry context below.
Every placement default remains visible and user-changeable before submission.

| Entry context | Timing and audio context | Default placement |
|---|---|---|
| `new-asset` entry context | Do not infer a shot, clip, range, or audio source; perform zero audio work | `none` (UI: Library only) |
| `unplaced-shot` entry context | No generation timing or audio until one valid linked projection is explicitly selected; perform zero audio work | `none` (UI: Library only) |
| Explicitly selected valid unlinked timeline range | Use that range for timing; it identifies no audio source and performs zero audio work | `create-linked-clip` |
| Explicitly selected valid linked projection | Use that projection's exact range; audio may be prepared only when the model accepts audio | `replace-selected-clip-media` |

An incomplete, invalid, or ambiguous entry context does not fall through to a
different row. It blocks the dependent field with an actionable validation
error. In particular, an unplaced shot, new-asset draft, or explicitly selected
valid unlinked range never infers timeline or audio context from stored shot
timing or other projections.

## 5. Reference Resolution

The canonical typed tokens, reference keys, normalized roles, card behavior,
and `ResolvedGenerationReference` contract are owned by
[References and Generated Images](./references.md). Prompt-selected references
are characters and image media in first-mention order. They replace the legacy
concept of a separately selected user-reference list.

Provider adapters rewrite canonical typed-ID tokens only after active
references have been validated, deduplicated, and ordered. They map normalized
roles to exact schema-accepted fields or provider-native prompt syntax.
Canonical project tokens, project IDs, and media IDs MUST NOT be sent unless a
provider schema explicitly defines that exact value. Every supported
provider/model mapping requires an authoritative sanitized fixture; guessed
token spellings or fields are forbidden.

References are resolved in stable order:

1. required source or first-frame image;
2. prompt-mentioned characters and image media in first-mention order;
3. shot references in stored order.

Duplicates are removed by canonical asset-version ID while preserving the first occurrence and all origin labels. Resolution records media ID, version ID, origin, and provider-reachable representation.

The orchestrator uploads or proxies local references as required. Signed upload URLs and provider temporary handles are operational state and MUST NOT be persisted in project data.

Reference preparation is tracked per stable draft item. A failed reference is
never collapsed into a generic stage error and is never silently omitted.

| Action | Draft effect | Submission effect |
|---|---|---|
| `Retry` | Preserve the item, origin, order, error history, and successful uploads for all other items; retry only the failed item | Does not submit or duplicate a provider job |
| `Remove` | Remove the item from the active draft | Revalidate; remain blocked if the selected mode/model still requires the missing source/reference |
| `Deactivate` | Retain the card, origin, and error in the draft; mark it inactive | Exclude it from provider inputs, then revalidate under the same blocking rule |

Every failed card exposes all three actions when applicable. Successful
references retain their order and upload lease. Required source/reference
failure, or removal/deactivation that leaves a model requirement unsatisfied,
blocks submission with `generation-reference-required` and identifies the
affected item and required recovery.

## 6. Timed Audio

Audio authorization is only for an explicitly selected valid linked timeline
projection. A valid unlinked timeline range may provide timing and a placement
default, but it does not identify an audio source and therefore does not
authorize any audio work. A shot's stored start/end values do not independently
authorize audio work. An unplaced shot and a new-asset draft do zero audio
work. If multiple linked projections exist, the caller must select one; the
controller never chooses by array order.

When a model supports or requires audio and an explicitly selected valid linked
projection is eligible, the controller extracts that exact range from the
project audio source. Extraction is bounded, cancellable, cached by source hash
and range, and produces a provider-supported format.

If the selected model does not accept audio, the UI states this and performs no
audio resolution, extraction, cache, or upload work. Audio extraction failure
blocks only jobs that require audio and provides a retryable typed error.

## 7. Persistent Job Contract

```ts
interface GenerationJob {
  id: string;
  projectId: string;
  contractVersion: 2;
  provider: GenerationProvider;
  providerInstanceId: string;
  modelId: string;
  routing: GenerationModel["routing"];
  providerJobId?: string;
  status: "queued" | "submitting" | "running" | "completed" | "finalizing" | "succeeded" | "failed" | "canceled" | "needs-attention";
  attempt: number;
  context: GenerationContext;
  outputUrls?: string[];
  outputMediaIds?: string[];
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
}
```

`status` is persisted durable state, not a view-only label. `needs-attention` is
both a persisted disposition and a non-terminal recovery state: it records that
the job cannot safely continue automatically, but an explicit repair, retry,
or cancellation command may move it back into an active or terminal state.

### Persisted disposition and transition matrix

The following table is exhaustive. A transition not listed is rejected with
`generation-invalid-transition`, leaves the persisted job unchanged, and emits
the attempted source, target, job ID, and logical attempt in the redacted event.

| Current disposition | Legal next disposition | Event/condition | Polling and finalization behavior |
|---|---|---|---|
| `queued` | `submitting`, `canceled`, `needs-attention` | reserved attempt starts, user cancellation, or unrecoverable pre-submit data problem | Polling is off; `submitting` may submit exactly once; `canceled` is terminal; `needs-attention` is recoverable but not polled |
| `submitting` | `running`, `failed`, `canceled`, `needs-attention` | provider ID accepted, provider rejects/fails, cancellation wins, or provider ID cannot be durably recorded | Poll only after durable provider ID; no finalization before `completed`; `failed` is terminal unless provider retry is explicitly requested; `needs-attention` is not polled |
| `running` | `completed`, `failed`, `canceled`, `needs-attention` | provider completion, terminal provider failure, cancellation, or ownership/response ambiguity | Poll while active; `completed` immediately enters finalization dispatch; no finalizer for other outcomes |
| `completed` | `finalizing`, `needs-attention`, `failed` | output identity is present, finalizer claims it, or completion data is missing/invalid | Polling stops; `finalizing` runs durable checkpoints; missing/invalid output goes to `needs-attention` or terminal `failed` only when retry is unsafe |
| `finalizing` | `succeeded`, `needs-attention`, `failed` | all required local mutations complete, recoverable checkpoint failure, or terminal validation/persistence failure | Polling remains off; finalization retry resumes the failed checkpoint without provider submit; `succeeded` and terminal `failed` are terminal |
| `needs-attention` | `queued`, `submitting`, `running`, `finalizing`, `failed`, `canceled` | explicit repair/retry/cancel command with validated checkpoint and ownership | Never auto-polled; explicit repair selects the exact resume state; finalization retry uses recorded output identity and never submits |
| `failed` | `queued`, `canceled` | explicit provider retry creates a new logical attempt/provider submission, or user cancels | Terminal until explicit command; retry starts at `queued` with incremented `attempt` and a new provider job ID |
| `canceled` | none | cancellation is persisted | Terminal; late provider responses are ignored and no polling/finalization occurs |
| `succeeded` | none | all required finalization is durable | Terminal; no polling, retry, or further mutation |

`completed` is an external-provider disposition and is never left active after
the status response is persisted: the poller dispatches `finalizing` exactly
once, or persists `needs-attention` when output identity is absent. A provider
retry never reuses an old provider job ID. Reload resumes only `queued`,
`submitting` with a durable provider ID, `running`, and `finalizing`; it resumes
each logical job once and never auto-resumes `needs-attention`, `failed`,
`canceled`, or `succeeded`.

The deterministic acceptance fixture `generation-job-dispositions.fixture.ts`
must enumerate every row and assert: all listed transitions succeed; every
unlisted pair is rejected without mutation; polling membership matches the
reload rule; cancellation ignores late responses; provider retry increments
`attempt` and uses a new provider ID; finalization retry keeps provider submit
count unchanged; and only `canceled`, `failed` without an explicit retry,
`succeeded`, and an explicitly terminal validation failure are terminal. The
fixture must also prove an unsafe legacy job is migrated to `needs-attention`
without inventing source, output, timing, or audio data.

Jobs survive reload. Polling is centralized outside dialogs and processes only active jobs for the current authenticated project context. Poll frequency uses provider guidance or bounded exponential backoff with jitter.

- Cancellation stops local polling and calls provider cancellation when supported.
- Cancellation stops local polling even when provider cancellation is unavailable or fails; late responses cannot reclaim the canceled attempt.
- Provider retry preserves logical job history, increments `attempt`, and records a new provider job ID. It never reuses the prior attempt's provider job ID.
- Reload resumes each active job exactly once.
- Late provider responses are rejected when project or attempt ownership no longer matches.

## 8. Idempotent Finalization

Finalization uses a durable completion claim keyed by provider instance, provider job ID, and output identity. Repeated polls, reloads, Strict Mode, multiple tabs, or network retries MUST NOT create duplicate blobs, media items, versions, storyboard attempts, or timeline clips.

Finalization order is:

1. claim output finalization;
2. download and validate output bytes;
3. create immutable media/version records through [Media Assets](./media-assets.md);
4. attach provenance and update the target shot attempt when applicable;
5. request placement through [Timeline](./timeline.md) according to the explicit policy;
6. persist the project through [Project Lifecycle and Persistence](./project.md);
7. mark the job succeeded only after required local finalization completes.

Provider completion followed by local download, validation, save, shot-link,
placement, or persistence failure retries only the failed finalization stage
without submitting another provider job. A local save retry uses the recorded
provider completion and output identity.

New-asset finalization is a first-class path. A
`entryContext.kind === "new-asset"` job with `placementPolicy === "none"`
MUST complete, create the
immutable media/version and provenance records, persist the project, and reach
`succeeded` without source media, shot timing, clip identity, timeline range,
or audio input. The finalizer must not call source lookup, audio extraction,
shot-link, or placement for this path. The deterministic fixture
`generation-finalization-new-asset-no-source.fixture.ts` runs a fake provider
from `completed` through `succeeded` with all source/media lookup ports empty
and asserts exactly one media/version, no source or audio calls, no timeline
mutation, and no provider resubmission.

### Durable URL invariant

`blob:` and other browser-local URLs, including `local:` URLs and object URLs,
are forbidden at every durable boundary. Repository, finalizer, job, output,
provenance, project JSON, media/version, shot/clip mutation, event, and
evidence-manifest serializers MUST reject them with
`generation-local-url-forbidden`; they must never sanitize them into persisted
data or silently drop the affected field. Provider-reachable HTTPS data and
opaque server/provider output identities are allowed only in their typed
non-durable or redacted forms. This invariant applies to job creation,
status/output persistence, each finalization checkpoint, recovery writes, and
project save, not only browser storage.

The deterministic regression fixture
`generation-local-url-boundaries.fixture.ts` injects `blob:` and `local:` values
into every durable job/output/provenance/project serializer and finalizer input,
asserts the stable error and zero writes at each boundary, and proves valid
opaque output identities still finalize. Browser scenario 13 separately proves
the rejected values are absent from storage, project JSON, provenance, network
capture, and events.

### V2 rollback and release gate

V2 eligibility is `job.contractVersion === 2` combined with the server-owned
`generationV2ReleaseEnabled` configuration flag. The release flag is server
configuration only and is never persisted in `GenerationJob`, `GenerationContext`,
or project data. The release gate has two independent controls: entry-point
availability and submission authorization. When rollback is active, the server
must hide/deactivate all V2 submission controls and reject every new V2 submit
with `generation-v2-rollback-active` before provider reservation or upload
retention. Existing V2 jobs whose provider submission was already durably
recorded continue through polling, cancellation, recovery, and finalization.

| Operation during rollback | Required result |
|---|---|
| New V2 submit from dialog, inspector, or direct route | Entry point hidden/disabled; route rejects before provider call and durable submit reservation |
| Poll an already submitted V2 job | Allowed; normal disposition matrix applies |
| Cancel an already submitted V2 job | Allowed; stops local polling and calls provider cancellation when supported |
| Retry a failed already submitted V2 job | Allowed only as recovery of that logical V2 job; it creates a new attempt under the same rollback-compatible contract, never a new unrelated submission |
| Finalize or retry finalization for an already submitted V2 job | Allowed; resumes the recorded checkpoint/output identity without provider resubmission |
| Recover `needs-attention` for an already submitted V2 job | Allowed when the command references the persisted job and checkpoint; no new entry-point submission |

Rollback is not a global provider shutdown: it must not cancel, hide status for,
or strand already submitted V2 jobs. The release gate is closed only after a
deterministic fixture proves every new V2 entry point is unavailable/rejected,
an already submitted job reaches finalization while rollback is active, and
the provider submit counter remains zero for polling, cancel, recovery, and
finalization retry. Browser scenario 14 proves the same behavior through the
production route and visible UI status.

## 9. Provider Adapters

### 9.1 KieAI

The adapter normalizes model discovery, submission, polling, output URLs, and known reference fields. Unknown fields are not populated speculatively.

### 9.2 WaveSpeed

WaveSpeed model schemas control dynamic form fields and reference mapping. Image and audio fields are identified through explicit schema metadata or maintained model adapters, never by treating every URI as media. Multi-schema models obey the routing contract in section 2: requested mode and pinned provider model/schema/endpoint identity select the route, the attempt persists that identity, and missing, ambiguous, unsupported, stale, or drifted routes fail closed.

WaveSpeed supports shot-scoped image/video generation, timed audio for compatible models, automatic character references, cancellation when exposed by the provider, and server-side output download.

Scene generation resolves creative data from the authoritative `StoryboardShot` and
timing only from an explicitly selected, valid `GenerationEntryContext` projection
or explicitly selected valid unlinked timeline range. Include Audio on an unplaced scene is disabled with an
instruction to place and select a projection. Stored shot start/end values do not
authorize audio. If a scene has multiple projections, callers MUST supply the chosen
`clipId`; the adapter never guesses by array order. There is no user-editable or
persisted scene audio range. The request carries the exact `entryContext` union,
including its required `shotId`/`clipId` or `rangeId` and exact `startTime`/`endTime`,
the full routing identity, and ordered active references.
Generation completion MUST NOT mutate projection placement, duration, or trim except
for the explicit placement policy selected in the generation context.

### 9.3 Atlascloud

Atlascloud uses the same normalized store, poller, UI, secret boundary, and finalizer. Provider endpoint paths, request schemas, output shape, rate limits, retry headers, cancellation, and webhook support remain unavailable until verified from authoritative provider documentation. Unknown facts MUST remain marked unsupported rather than implemented from assumptions.

## 10. Observability and Problems

Structured redacted events cover model refresh, route selection, validation,
reference resolution and per-item recovery, audio extraction/cache, upload,
submission, polling transitions, cancellation, retry, output validation, every
finalization checkpoint, placement, persistence, and idempotency replay. Events
include a project-safe correlation ID, logical job ID, attempt, provider/model
and routing identity, stage, status, duration, stable error code, retryability,
checkpoint, placement policy/status, and duplicate-claim result. They exclude
credentials, authorization values, signed URLs, upload tokens, local URLs,
canonical project/media identifiers, and raw prompts unless diagnostic prompt
logging is explicitly enabled.

Required metrics are stage latency; provider/model/schema success rate;
provider retry, finalization retry, and placement retry success rate;
cancellation success and latency; reload-resumption success; reference/audio
preparation failure rate; local-save failure rate; finalization failure rate;
and duplicate provider-submit, output, media/version, shot-attempt, and
placement counts.

Errors use [Problems, Errors & Logging](./problems-errors-logging.md) with field-level validation, configuration, routing/schema, reference, audio, provider, transport, cancellation, download, finalization, placement, and persistence codes. Every category exposes at least one valid recovery action such as edit, refresh/revalidate, retry item, remove, deactivate, retry provider, retry finalization, retry placement, or cancel; a terminal error explicitly says why no retry is safe.

## 11. Required Tests and Eval

In addition to the job and finalization gates below, deterministic tests MUST
cover typed prompt tokens, character/media mention resolution, reference-role
capabilities, inactive invalid references, provider prompt rewriting, exact
schema field mapping, generated-image drafts, imported-image conversion,
dependency-cycle rejection, and version/provenance invariants. Browser
verification MUST cover the `@` menu, inline pills, derived cards, modal and
Shift-click sidebar navigation, Add Generated Image, and Regenerate. The fixed
provider eval includes multiple-reference image and video cases.

Deterministic tests MUST cover model normalization/cache scope, secret exclusion, schema mapping, reference order/deduplication, timed audio ranges, every row and illegal edge in the persisted disposition matrix, reload resumption, cancellation, retry history, ownership checks, idempotent finalization across repeated completion and multiple tabs, V2 rollback gating, new-asset finalization with no source media, and `blob:`/`local:` rejection at every durable job/output/provenance/project boundary. Named fixtures are `generation-job-dispositions.fixture.ts`, `generation-v2-rollback.fixture.ts`, `generation-finalization-new-asset-no-source.fixture.ts`, and `generation-local-url-boundaries.fixture.ts`.

Provider HTTP tests use mocked or recorded sanitized schemas and responses. A fixed provider eval covers prompt/reference adherence and the complete technical pipeline. Release requires 100% technical completion cases, zero duplicate artifacts, zero secret leakage, and at least 90% subjective adherence across the fixed prompt set.

Browser verification covers shot generation, new-asset generation, model
switching, per-item `Retry`/`Remove`/`Deactivate`, exact projection-only audio,
routing identity and schema drift, job reload, cancellation, provider retry,
local-save/finalization retry, output provenance, and all placement policies.
Evidence records sanitized logical/provider job IDs, routing identifiers,
reference origins/order/status, requested and actual audio ranges/hash, output
and media/version/shot/clip IDs, recovery errors/actions, and proves exactly one
provider submission per attempt, one finalized output, one shot attempt when
applicable, and at most one requested placement across reload and retry.

Paid provider work is a separate authorization gate. It MUST NOT run until the
user explicitly authorizes the credential/provider instance, exact model and
routing matrix, maximum spend, and evidence-retention location/period. Missing
authorization or an incomplete matrix blocks paid evidence without weakening
deterministic or browser requirements.
