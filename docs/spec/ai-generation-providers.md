# AI Generation & Providers — Operational Spec

**Status:** Operational (derived from user directives)
**Sources:**
- `docs/spec/OPERATIONAL-SPEC-UPDATE-SUMMARY.md` §13
- `docs/superpowers/plans/spec-update/openreel-spec-implications-report.json` (AI Generation / Providers category, 74 messages)
- `docs/superpowers/plans/2026-07-03-atlascloud-support.md` (provider integration pattern)
- `docs/superpowers/plans/2026-06-28-music-video-timeline-native.md` tasks 12–15 (job store, poller, reference images)

---

## 1. Scope

This spec defines the AI generation subsystem: the unified generate dialog, provider model management, generation job lifecycle, job polling, reference image selection, and the orchestrator-proxy security pattern. It covers all current and future AI generation providers.

---

## 2. Provider Architecture

### 2.1 Provider Proxy Pattern

The orchestrator MUST act as the sole proxy for all AI generation API calls. The web client MUST NOT hold or transmit provider API keys directly.

- The orchestrator MUST store each provider's API key in its server-side environment configuration.
- The orchestrator MUST expose three endpoints per provider:
  - `GET /api/generate/<provider>/models` — cached model list
  - `POST /api/generate/<provider>` — submit a generation job; returns a local `jobId`
  - `GET /api/generate/<provider>/:jobId` — poll job status
- The web client MUST route all generation requests through the orchestrator.
- The web client MUST NOT include provider API keys in any request body or header sent to the orchestrator.

**Rationale:** API keys are secrets. The orchestrator-proxy pattern (established for WaveSpeed, extended to Atlascloud in the atlascloud-support plan) keeps keys server-side and prevents client-side key leakage.

### 2.2 GenerationProvider Union

The `GenerationProvider` type MUST be a discriminated union covering all supported providers.

```typescript
// packages/music-video-domain/src/types.ts
export type GenerationProvider = "wavespeed" | "kie-ai" | "atlascloud" | string;
```

The web-side `GenerationProvider` union (used in `generation-job-store.ts`) MUST include at minimum:

```typescript
export type GenerationProvider = "kieai" | "wavespeed" | "atlascloud";
```

Adding a new provider MUST touch: the domain type, the web job-store type, the orchestrator route, the web service client, the model picker UI, and the job poller dispatch.

---

## 3. Unified Generate Dialog

### 3.1 Single Entry Point

The AI Generate dialog (`GenerateAssetDialog`) MUST be the single, unified interface for all generation providers. There MUST NOT be provider-specific generation dialogs or wizards.

- The dialog MUST present a unified model list sourced from all configured providers.
- Each model entry MUST display a provider badge (e.g., "KieAI", "WaveSpeed", "AtlasCloud") with a distinct color.
- The dialog MUST expose generation inputs (prompt, negative prompt, resolution, duration, reference images) in a provider-agnostic form. Character/reference `@token` mentions in the prompt field MUST render as inline pills per `inspector-shell.md` §3.8 (Character Pills in Prompt Fields), and selected reference images MUST link back to their source clip per §3.8.6 (Reference Images Pane).
- On submit, the dialog MUST dispatch to the correct provider's submission path based on the selected model's `provider` field.

### 3.2 Dialog Lifecycle

- Opening the dialog MUST NOT start any generation or polling.
- Submitting a generation MUST enqueue a persistent job (see §5) and close the dialog immediately.
- The dialog MUST NOT contain inline polling logic. All polling is handled by `useGenerationJobPoller` (see §6).

---

## 4. Model Management

### 4.1 Model List Caching

Provider model lists MUST be cached locally and refreshed in the background.

- The orchestrator MUST cache each provider's model list in memory with a configurable TTL (default: 60 minutes).
- On cache miss or TTL expiry, the orchestrator MUST fetch fresh models from the provider API.
- On fetch failure, the orchestrator MUST serve stale cached data when available; it MUST return a 502 only when no cache exists.
- The web client MUST use a stale-while-revalidate pattern (`staleWhileRevalidate`) for model list fetches, returning cached data immediately while refreshing in the background.

### 4.2 Model List Shape

Each model entry in the unified list MUST carry:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Composite key: `"<provider>:<modelId>"` |
| `provider` | `GenerationProvider` | Originating provider |
| `name` | `string` | Human-readable model name |
| `description` | `string` | Model description (may be empty) |
| `genType` | `GenType` | `"text-to-video"` or `"text-to-image"` |
| `apiSchema` | `Record<string, unknown>` (optional) | Provider-specific parameter schema for validation |

### 4.3 Per-Model Parameter Validation

Model selection MUST validate generation parameters against the selected model's capabilities.

- When a model is selected, the dialog MUST inspect the model's `apiSchema` (or provider-known constraints) to determine which inputs are valid.
- Inputs unsupported by the selected model MUST be disabled or hidden.
- Required inputs for the selected model MUST be marked as required in the form.
- Validation MUST occur client-side before submission; the orchestrator MAY perform additional server-side validation.

### 4.4 Default Models

There MUST be a configurable default video generator model and a configurable default image generator model.

- Defaults MUST be stored in user settings, keyed by `genType` (`"text-to-video"`, `"text-to-image"`).
- When the generate dialog opens, the default model for the requested generation type MUST be pre-selected.
- If the default model is unavailable (provider not configured, model removed from list), the dialog MUST fall back to the first available model of the requested type.
- Changing the default MUST persist across sessions.

---

## 5. Persistent Generation Job Store

### 5.1 Job Store (`GenerationJobStore`)

A single Zustand store (`generation-job-store.ts`) MUST track all generation jobs across all providers (KieAI, WaveSpeed, Atlascloud).

**Persistence:** The store MUST use Zustand `persist` middleware so jobs survive page reloads and tab closures.

**Job shape:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Local job UUID |
| `provider` | `GenerationProvider` | `"kieai"`, `"wavespeed"`, or `"atlascloud"` |
| `providerJobId` | `string` | Provider-assigned job/prediction ID |
| `model` | `string` | Model identifier |
| `prompt` | `string` | Generation prompt |
| `inputs` | `Record<string, unknown>` | Full generation inputs |
| `status` | `JobStatus` | `"queued"` \| `"running"` \| `"completed"` \| `"failed"` \| `"canceled"` |
| `outputUrl` | `string \| null` | Result URL when completed |
| `error` | `string \| null` | Error message when failed |
| `projectId` | `string` | Owning project |
| `linkedMediaIds` | `string[]` | Reference media IDs used as inputs |
| `createdAt` | `number` | Unix timestamp |
| `updatedAt` | `number` | Unix timestamp |

**Actions:**

| Action | Description |
|---|---|
| `enqueueJob(job)` | Add a new job with status `"queued"` |
| `updateJobStatus(id, status, outputUrl?, error?)` | Transition job status |
| `retryJob(id)` | Create a new provider job ID for the same logical job; preserve history |
| `cancelJob(id)` | Mark job `"canceled"`; stop local polling |
| `getJobsByProject(projectId)` | Filter jobs by project |
| `getActiveJobCount()` | Count of `queued` + `running` jobs |

**Constraints:**
- One store covers all providers. There MUST NOT be per-provider job stores.
- Job status transitions MUST be explicit: `queued` → `running` → `completed` | `failed` | `canceled`.
- Retry MUST create a new `providerJobId` while preserving the original job's logical identity and history.

### 5.2 Job Lifecycle

```
enqueueJob  →  status: "queued"
    ↓ (poller picks up)
status: "running"
    ↓ (poller receives result)
status: "completed" (with outputUrl)  |  status: "failed" (with error)
    ↓ (user action)
status: "canceled"  (only from "queued" or "running")
```

---

## 6. Generation Job Polling

### 6.1 `useGenerationJobPoller`

A single React hook (`useGenerationJobPoller`) MUST handle all polling for all providers. Polling MUST NOT live inside the generate dialog or any other UI component.

**Behavior:**
- The hook MUST scan the job store for jobs with status `"queued"` or `"running"`.
- For each active job, the hook MUST dispatch to the correct provider's poll function based on `job.provider`:
  - `"kieai"` → `pollKieaiTask(providerJobId)`
  - `"wavespeed"` → `pollWavespeedJob(providerJobId)`
  - `"atlascloud"` → `pollAtlascloudJob(providerJobId)`
- On `"completed"` with an `outputUrl`, the poller MUST:
  - Download the result via the orchestrator (if not a direct CDN URL).
  - Save the result as a new `MediaItem` version (see §5.2 of the music-video-timeline-native plan).
  - Place the generated asset on the appropriate timeline track at shot timing when shot context exists.
- On `"failed"`, the poller MUST update the job status and error.
- The poller MUST be idempotent across re-renders; it MUST NOT create duplicate media items or clips for the same completed job.

**Polling interval:** The poller SHOULD use a configurable interval (default: 5 seconds) with exponential backoff on consecutive failures.

**Constraints:**
- No fire-and-forget polling inside `GenerateAssetDialog` or any other dialog.
- The poller MUST stop polling for `"canceled"` jobs.
- The poller MUST NOT poll for jobs whose `providerJobId` is missing or invalid.

---

## 7. Reference Image Selection

### 7.1 ReferenceImagePicker

A `ReferenceImagePicker` component MUST allow users to select reference images for generation from two sources:

1. **Media library:** Existing image media items in the current project.
2. **Upload:** A new image file uploaded through a file picker.

**Behavior:**
- The picker MUST only expose image media (not video, audio, or metadata items).
- Uploaded images MUST be imported and saved as real `MediaItem` blobs before being used as references.
- Selected references MUST be displayed as thumbnails with a remove action.
- The picker MUST support multiple reference images.

### 7.2 Provider Input Mapping

Selected reference images MUST be mapped into provider-specific generation inputs:

- **KieAI:** Reference images MUST be included in the request payload for models that support image-to-image or reference-guided generation. Only known KieAI reference fields MUST be populated.
- **WaveSpeed:** Reference images MUST populate the WaveSpeed schema's `image_url` or equivalent URI fields when the selected model's schema declares them.
- **Atlascloud:** Reference images MUST be uploaded via the orchestrator's media-upload endpoint (or included as `image_url` in the generation payload) per the Atlascloud API contract.

**Constraints:**
- Do NOT guess provider field names. Map only known, documented fields.
- Reference images MUST be uploaded through the orchestrator, not directly to the provider.

---

## 8. Job Management Panel

### 8.1 JobManagementPanel

A `JobManagementPanel` component MUST expose all generation jobs with management actions.

**Layout:**
- Jobs MUST be grouped by status: Running, Completed, Failed, Canceled.
- Each job entry MUST display: provider badge, model name, prompt (truncated), status, elapsed time, and a thumbnail preview when available. The truncated prompt MUST render with inline character/reference pills per `inspector-shell.md` §3.8 (Character Pills in Prompt Fields) — truncation MUST NOT fall back to plain text.

**Actions per job:**

| Action | Availability | Behavior |
|---|---|---|
| **View result** | `"completed"` jobs | Select or preview the generated media item |
| **Use as reference** | `"completed"` jobs | Set the generated output as a reference image for a new generation |
| **Retry** | `"failed"` jobs | Re-enqueue the job with the same parameters; creates a new `providerJobId` |
| **Cancel** | `"queued"` or `"running"` jobs | Mark job `"canceled"`; stop local polling |

### 8.2 Entry Point

- The AI Tools tab (`AIGenTab`) MUST show an active job count badge when one or more jobs are `"queued"` or `"running"`.
- Clicking the badge or a "Jobs" action MUST open the `JobManagementPanel`.

**Constraints:**
- The panel is a tool for job management, NOT part of the Music Video workflow.
- Cancel marks the local job `"canceled"`; provider-side cancellation is attempted only when the provider API supports it.
- Use-as-reference selects a completed media item as a reference input for the generate dialog.

---

## 9. Provider Settings

### 9.1 Multi-Instance Settings

All provider settings MUST support multiple instances. Each instance MUST have:

- **API key** (optional): The provider API key. When absent, the provider is treated as unconfigured and its models are excluded from the unified list.
- **Base URL** (optional): A custom API base URL, overriding the default. When absent, the provider's documented default base URL is used.

### 9.2 Settings Storage

Provider settings MUST be stored in the web settings store (`settings-store.ts`) under a `SERVICE_REGISTRY` or equivalent structure. Each provider entry MUST include:

```typescript
interface ProviderSettings {
  id: string;           // unique instance id
  provider: GenerationProvider;
  label: string;        // user-facing label
  apiKey?: string;      // sent to orchestrator, never stored client-side in plaintext for long
  baseUrl?: string;     // custom endpoint override
  enabled: boolean;
}
```

### 9.3 Settings UI

The General settings panel (`GeneralPanel.tsx`) MUST include an aggregator/provider dropdown that lists all configured provider instances. Users MUST be able to add, edit, and remove provider instances.

---

## 10. Provider-Specific Contracts

### 10.1 WaveSpeed

- **API:** WaveSpeed SDK, proxied through orchestrator.
- **Auth:** API key in orchestrator env (`WAVESPEED_API_KEY`).
- **Model list:** Fetched from WaveSpeed API, cached by orchestrator.
- **Submission:** `POST /api/generate/wavespeed` → returns local `jobId`.
- **Polling:** `GET /api/generate/wavespeed/:jobId` → status + output URL.
- **Result:** Downloaded by orchestrator, served from local assets directory.

### 10.2 KieAI

- **API:** KieAI REST endpoints, proxied through orchestrator.
- **Auth:** API key in orchestrator env (`KIEAI_API_KEY`).
- **Model list:** Fetched from KieAI API, cached by orchestrator.
- **Submission:** `POST /api/generate/kieai` → returns local `jobId`.
- **Polling:** `GET /api/generate/kieai/:jobId` → status + output URL.
- **Result:** May be a direct CDN URL (no download needed) or require orchestrator download.

### 10.3 Atlascloud

- **API:** `https://api.atlascloud.ai/api/v1` (REST), proxied through orchestrator.
- **Auth:** `Authorization: Bearer <api-key>` header; key in orchestrator env (`ATLASCLOUD_API_KEY`).
- **Model list:** `GET /api/v1/models` (endpoint existence TBD — see §11). Cached by orchestrator with 60-minute TTL.
- **Submission:** `POST /api/v1/model/generateVideo` or `POST /api/v1/model/generateImage` → returns `{ data: { id: "prediction_id" } }`.
- **Polling:** `GET /api/v1/model/prediction/{prediction_id}` → `{ data: { status, output?, error? } }`.
- **Result:** Downloaded by orchestrator to local cache, served from assets directory (same pattern as WaveSpeed).
- **Reference images:** Optional `image_url` field in generation payload; may require prior upload via `POST /api/v1/model/uploadMedia`.

**Source:** `docs/superpowers/plans/2026-07-03-atlascloud-support.md`

---

## 11. Open Questions

- **Atlascloud `/models` endpoint:** The existence and response format of `GET /api/v1/models` is unconfirmed. Implementation of the Atlascloud model list MUST pause until this endpoint is verified against the live API. TODO: Verify against `https://atlascloud.ai/docs`.
- **Atlascloud image generation endpoint:** The exact path and request body shape for image generation is inferred. TODO: Confirm against Atlascloud API docs.
- **Atlascloud rate limits and webhooks:** Rate limiting, retry semantics, and webhook support are unknown. TODO: Research before production deployment.
- **Atlascloud output URL type:** Whether the output URL is a direct CDN URL (like KieAI) or requires download (like WaveSpeed) is unknown. TODO: Verify; the orchestrator route currently assumes download-required.
- **Provider-side cancellation:** Which providers support server-side job cancellation is unknown. TODO: Research per-provider; the job panel currently only cancels locally.
- **Model schema discovery:** The dynamic schema pattern used by WaveSpeed may not apply to Atlascloud. TODO: Determine how Atlascloud exposes per-model parameter constraints.
- **Multi-instance API key routing:** When multiple instances of the same provider are configured, how the orchestrator routes to the correct API key is TBD. TODO: Design instance-to-key mapping in orchestrator config.

---

## 12. References

- `docs/superpowers/plans/2026-07-03-atlascloud-support.md` — Atlascloud provider integration plan (orchestrator route, web client, job store wiring, UI)
- `docs/superpowers/plans/2026-06-28-music-video-timeline-native.md` tasks 12–15 — Generation job store, poller, job management panel, reference image picker
- `docs/spec/OPERATIONAL-SPEC-UPDATE-SUMMARY.md` §13 — Category mapping and placeholder bullets
- `docs/superpowers/plans/spec-update/openreel-spec-implications-report.json` — AI Generation / Providers category (74 user messages)
