# AI Generation and Providers — Operational Spec

**Status:** Canonical operational specification
**Owner:** Generation subsystem
**Supersedes:** [AI Generation & Providers](./ai-generation-providers.md), [Atlascloud Provider Support](./atlascloud-provider.md), and [WaveSpeed Image and Video Generation](./wavespeed-generation.md)

## Scope

This specification owns provider discovery, unified generation controls, provider-neutral submission, persistent jobs, polling, cancellation, retry, reference resolution, output finalization, provenance, and provider adapters.

[Storyboard](./storyboard.md) owns creative shots. [Media Assets](./media-assets.md) owns created assets and versions. [Timeline](./timeline.md) owns placement mutations. [Inspector Shell](./inspector-shell.md) owns where generation controls appear.

## 1. Architecture and Security Boundary

The orchestrator is the sole component that authenticates to generation providers. The browser MUST NOT read, persist, transmit, or log provider API keys.

- Credentials live in server-side secure configuration.
- Browser settings contain provider instance ID, label, availability, and non-secret capabilities only.
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

## 3. Unified Generation UI

Generation uses one controller and one provider-agnostic form. There are no independent provider dialogs with separate job logic.

The primary editor surface is **Edit → Generate** for a selected compatible shot or clip. An expanded picker MAY be used for generation without an existing target, but it uses the same controller, schemas, job store, and finalizer.

The form presents:

- mode and compatible model;
- prompt with character/reference pills defined by [Inspector Shell](./inspector-shell.md);
- negative prompt only when supported;
- schema-derived settings such as duration, dimensions, resolution, seed, and quality;
- resolved references with origin labels;
- timed audio when required and supported;
- validation, availability, cost/limit information when known;
- submission status and recovery action.

Unsupported fields are hidden or disabled with an explanation. Unresolved prompt tokens, unavailable required references, invalid duration, or missing provider configuration block submission.

## 4. Effective Generation Context

Generation context is explicit and immutable for an attempt:

```ts
interface GenerationContext {
  projectId: string;
  target?: { kind: "shot" | "clip" | "new-asset"; id?: string };
  mode: GenerationModel["modes"][number];
  startTime?: number;
  endTime?: number;
  destinationTrackId?: string;
  placementPolicy: "library-only" | "insert" | "replace-clip-media";
  prompt: string;
  negativePrompt?: string;
  referenceAssetVersionIds: string[];
  audioAssetId?: string;
  audioRange?: { startTime: number; endTime: number };
}
```

For a storyboard shot, [Storyboard](./storyboard.md) is authoritative for prompt, timing, characters, and explicit references. A selected clip supplies placement context but does not override creative truth unless the user explicitly edits the generation form.

## 5. Reference Resolution

References are resolved in stable order:

1. required source or first-frame image;
2. characters in first-mention order from prompt pills;
3. shot references in stored order;
4. user-added references in selection order.

Duplicates are removed by canonical asset-version ID while preserving the first occurrence and all origin labels. Resolution records media ID, version ID, origin, and provider-reachable representation.

The orchestrator uploads or proxies local references as required. Signed upload URLs and provider temporary handles are operational state and MUST NOT be persisted in project data.

## 6. Timed Audio

When a model supports or requires audio, the controller extracts the target's effective time range from the project audio source. Extraction is bounded, cancellable, cached by source hash and range, and produces a provider-supported format.

If the selected model does not accept audio, the UI states this and omits extraction. Audio extraction failure blocks only jobs that require audio and provides a retryable typed error.

## 7. Persistent Job Contract

```ts
interface GenerationJob {
  id: string;
  projectId: string;
  provider: GenerationProvider;
  providerInstanceId: string;
  modelId: string;
  providerJobId?: string;
  status: "queued" | "submitting" | "running" | "completed" | "finalizing" | "succeeded" | "failed" | "canceled";
  attempt: number;
  context: GenerationContext;
  outputUrls?: string[];
  outputMediaIds?: string[];
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
}
```

Jobs survive reload. Polling is centralized outside dialogs and processes only active jobs for the current authenticated project context. Poll frequency uses provider guidance or bounded exponential backoff with jitter.

- Cancellation stops local polling and calls provider cancellation when supported.
- Retry preserves logical job history, increments `attempt`, and receives a new provider job ID.
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

Provider completion followed by local failure retries finalization without submitting another provider job.

## 9. Provider Adapters

### 9.1 KieAI

The adapter normalizes model discovery, submission, polling, output URLs, and known reference fields. Unknown fields are not populated speculatively.

### 9.2 WaveSpeed

WaveSpeed model schemas control dynamic form fields and reference mapping. Image and audio fields are identified through explicit schema metadata or maintained model adapters, never by treating every URI as media.

WaveSpeed supports shot-scoped image/video generation, timed audio for compatible models, automatic character references, cancellation when exposed by the provider, and server-side output download.

Scene generation resolves creative data from the authoritative `StoryboardShot` and
timing only from an explicitly selected, valid projection clip. Include Audio on an
unplaced scene is disabled with an instruction to place and select a projection. If a
scene has multiple projections, callers MUST supply the chosen `clipId`; the adapter
never guesses by array order. There is no user-editable or persisted scene audio range.
The request carries `shotId`, selected `clipId`, exact projection timing, model/schema,
and ordered references. Reference precedence is source media, prompt-mentioned
characters, scene/shot references, then user references. Generation completion MUST
NOT mutate projection placement, duration, or trim.

### 9.3 Atlascloud

Atlascloud uses the same normalized store, poller, UI, secret boundary, and finalizer. Provider endpoint paths, request schemas, output shape, rate limits, retry headers, cancellation, and webhook support remain unavailable until verified from authoritative provider documentation. Unknown facts MUST remain marked unsupported rather than implemented from assumptions.

## 10. Observability and Problems

Structured events cover model refresh, validation, reference resolution, audio extraction, submission, polling transitions, cancellation, retry, output validation, finalization, placement, and persistence. Metrics include stage latency, provider/model success, retry success, finalization failure, and duplicate-prevention claims.

Errors use [Problems, Errors & Logging](./problems-errors-logging.md) with field-level validation, configuration, provider, transport, download, finalization, placement, and persistence codes.

## 11. Required Tests and Eval

Deterministic tests MUST cover model normalization/cache scope, secret exclusion, schema mapping, reference order/deduplication, timed audio ranges, job transitions, reload resumption, cancellation, retry history, ownership checks, and idempotent finalization across repeated completion and multiple tabs.

Provider HTTP tests use mocked or recorded sanitized schemas and responses. A fixed provider eval covers prompt/reference adherence and the complete technical pipeline. Release requires 100% technical completion cases, zero duplicate artifacts, zero secret leakage, and at least 90% subjective adherence across the fixed prompt set.

Browser verification covers shot generation, new-asset generation, model switching, reference recovery, job reload, cancel/retry, output version creation, and timeline placement.
