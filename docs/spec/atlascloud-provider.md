# Atlascloud Provider Support — Operational Spec

**Status:** Implementation-ready (derived from [Atlascloud Support plan](../superpowers/plans/2026-07-03-atlascloud-support.md))

**Source:** [Atlascloud Support plan](../superpowers/plans/2026-07-03-atlascloud-support.md)

**Last updated:** 2026-07-04

---

## 1. Scope

This spec defines the integration of Atlascloud (atlascloud.ai) as a new AI generation provider alongside WaveSpeed and KieAI. Atlascloud provides a unified REST API for 600+ models covering video, image, and audio generation. This spec covers:

- Server-side orchestrator proxy for Atlascloud API calls
- Web client service layer for submission and polling
- Integration with existing `GenerationJobStore` and `useGenerationJobPoller`
- UI model picker and settings UI enhancements
- Provider-agnostic job lifecycle (queued → running → completed/failed)
- Unresolved API facts requiring external verification before full implementation

Atlascloud integration MUST follow the same orchestrator-proxy security pattern as WaveSpeed: API keys stay server-side, the web client talks to the orchestrator only.

---

## 2. Architecture

### 2.1 Orchestrator-Proxy Pattern

The orchestrator MUST proxy all Atlascloud API calls, keeping the API key server-side.

**Orchestrator endpoints:**

| Endpoint | Method | Purpose | Returns |
|---|---|---|---|
| `GET /api/generate/atlascloud/models` | GET | Fetch cached model list | `AtlascloudModel[]` |
| `POST /api/generate/atlascloud` | POST | Submit generation job | `{ jobId: string }` |
| `GET /api/generate/atlascloud/:jobId` | GET | Poll job status | `{ status, outputUrl?, error? }` |

**Request/response shape:**

- **Models endpoint:** Returns an array of model objects with `id`, `name`, `type`, `description`, `pricing`, `apiSchema`, `metadata`.
- **Submit endpoint:** Accepts `{ model: string, inputs: Record<string, unknown> }`. Returns `{ jobId: string }` (local UUID).
- **Poll endpoint:** Returns `{ status: "queued" | "running" | "completed" | "failed", outputUrl?: string, error?: string }`.

### 2.2 Web Client Communication

The web client MUST:

1. **Never hold API keys** — only send non-sensitive generation inputs.
2. **Route all Atlascloud requests through the orchestrator** — via `/api/generate/atlascloud` endpoints.
3. **Dispatch to the correct provider polling function** — based on `job.provider === "atlascloud"`.

**Web service layer:** `apps/web/src/services/atlascloud/`

```typescript
// Exports from atlascloud service:
export async function fetchModels(): Promise<AtlascloudModel[]>
export function fetchModelsCached(): CacheResult<AtlascloudModel[]>
export async function submitGeneration(model: string, inputs: Record<string, unknown>): Promise<string>
export async function pollJob(jobId: string): Promise<AtlascloudJobResult>
```

### 2.3 Job Lifecycle Integration

Atlascloud jobs flow through the **unified `GenerationJobStore`** and **single `useGenerationJobPoller`** hook, same as all other providers.

**Job state flow:**

```
enqueueJob(provider: "atlascloud", inputs) → status: "queued"
  ↓ (poller picks up)
pollJob(providerJobId) → status: "running"
  ↓ (poller receives result from Atlascloud)
status: "completed" (outputUrl set) OR status: "failed" (error set)
  ↓ (user action / polling stops)
status: "canceled" (optional)
```

**Poller dispatch:** In `useGenerationJobPoller`, when `job.provider === "atlascloud"`, call `pollAtlascloudJob(job.providerJobId)`.

---

## 3. Atlascloud API Contract

### 3.1 Known Endpoints

**Base URL:** `https://api.atlascloud.ai/api/v1`

**Authentication:** All requests MUST include `Authorization: Bearer <api-key>` header.

| Endpoint | Method | Purpose | Notes |
|---|---|---|---|
| `/models` | GET | Fetch available models | Existence/format TBD (see §7) |
| `/model/generateVideo` | POST (JSON) | Submit video generation | Inferred from plan; endpoint exact path TBD |
| `/model/generateImage` | POST (JSON) | Submit image generation | Inferred from plan; endpoint exact path TBD |
| `/model/uploadMedia` | POST (multipart) | Upload source media | Optional; for reference images |
| `/model/prediction/{prediction_id}` | GET | Poll job status | Returns `{ code, msg, data: { status, output?, error? } }` |

### 3.2 Generation Flow

1. **(Optional) Upload reference media:** `POST /model/uploadMedia` (multipart) → returns `{ data: { url: "..." } }`
2. **Submit generation:** `POST /model/generateVideo` (or `generateImage`) with `{ model, prompt, image_url?, ... }` → returns `{ code: 200, msg: "...", data: { id: "prediction_id" } }`
3. **Poll status:** `GET /model/prediction/{prediction_id}` → returns `{ data: { status: "processing" | "succeeded" | "failed", output?: "...", error?: "..." } }`
4. **On success:** `data.output` contains the result URL (may be CDN or require download; TBD in §7)

### 3.3 Request Payload Shape

**Submission payload (minimal, provider-agnostic):**

```typescript
{
  model: string;              // Atlascloud model ID
  prompt: string;             // Generation prompt
  image_url?: string;         // Optional reference image URL (from upload or external)
  negative_prompt?: string;   // Optional negative prompt (if supported by model)
  num_images?: number;        // Optional image count (if applicable)
  // Additional fields per model schema (TBD)
}
```

**Orchestrator payload transformation:** The orchestrator MAY route to different Atlascloud endpoints based on the model type:

- If `inputs._type === "video"` or model name includes "video" → `/model/generateVideo`
- Otherwise → `/model/generateImage`

### 3.4 Response Shape

**Poll response (from Atlascloud):**

```typescript
{
  code: number;                   // HTTP-like code (200 = success)
  msg: string;                    // Human-readable message
  data: {
    status: "processing" | "succeeded" | "failed";
    output?: string;              // Result URL (on success)
    error?: string;               // Error message (on failure)
  }
}
```

**Orchestrator translates to local status:**

- Atlascloud `status: "processing"` → local `status: "running"`
- Atlascloud `status: "succeeded"` → local `status: "completed"` (with `outputUrl`)
- Atlascloud `status: "failed"` → local `status: "failed"` (with `error`)

---

## 4. Orchestrator Implementation

### 4.1 Environment Configuration

**File:** `apps/orchestrator/src/env.ts`

Add:
```typescript
atlascloudApiKey: env("ATLASCLOUD_API_KEY"),
```

**Environment variable:** `.env` or deployment secrets MUST define `ATLASCLOUD_API_KEY`.

### 4.2 Orchestrator Route

**File:** `apps/orchestrator/src/routes/atlascloud.ts`

**Responsibilities:**

1. **Model caching:**
   - Fetch models from Atlascloud `/models` endpoint (or fallback if unavailable; see §7)
   - Cache with 60-minute TTL
   - On cache miss/expiry, fetch fresh; on API failure, serve stale cache or return 502
   - Expose via `GET /api/generate/atlascloud/models`

2. **Submission:**
   - Accept `{ model, inputs }` from web client
   - Dispatch to `/model/generateVideo` or `/model/generateImage` based on inputs or model type
   - Create local job ID (UUID)
   - Store job metadata (prediction ID, model, status) in memory
   - Return local `jobId` to web client
   - Expose via `POST /api/generate/atlascloud`

3. **Polling:**
   - Fetch job status from Atlascloud `/model/prediction/{prediction_id}`
   - Translate Atlascloud status to local status
   - On completion, download result to local cache (same pattern as WaveSpeed; see §4.3)
   - Update job metadata
   - Return status and output URL to web client
   - Expose via `GET /api/generate/atlascloud/:jobId`

### 4.3 Asset Caching & Download

**When job completes (status: "succeeded"):**

1. Download the result from `data.output` URL
2. Extract file extension from URL path (or use `.mp4` default)
3. Create cache directory: `{generatedAssetsDir}/atlascloud/{prediction_id}/`
4. Save file as `result{ext}` in the cache directory
5. Serve from local URL: `http://localhost:{port}/assets/atlascloud/{prediction_id}/result{ext}`

**Rationale:** Same as WaveSpeed. Local caching prevents remote URL dependency, ensures availability if Atlascloud removes the file later, and reduces latency on repeated accesses.

**TODO:** If Atlascloud output URLs are confirmed as CDN-direct (like KieAI), skip download step and serve the remote URL directly (see §7).

### 4.4 Error Handling

- **No API key:** Return 503 "AtlasCloud API key not configured"
- **Submission failure:** Return 502 "Submission failed: {detail}"
- **Poll failure:** Return 502 "Poll failed: {detail}"
- **Job not found:** Return 404 "Job not found"
- **Invalid request:** Return 400 "model and inputs are required"

### 4.5 In-Memory Job Store

The orchestrator MUST maintain a `Map<jobId, Job>` of in-flight jobs.

**Job shape:**

```typescript
interface Job {
  atlascloudPredictionId: string;  // Atlascloud-assigned prediction ID
  model: string;                    // Model identifier
  status: "pending" | "processing" | "completed" | "failed";
  outputUrl?: string;               // Local URL when completed
  error?: string;                   // Error message when failed
}
```

**Note:** This is ephemeral, in-memory storage. For persistent job tracking across orchestrator restarts, implement a persistent store (e.g., database) in a follow-up; see §7.

---

## 5. Web Client Implementation

### 5.1 Service Layer

**File:** `apps/web/src/services/atlascloud/`

**Exports:**

```typescript
// types.ts
export interface AtlascloudModel {
  id: string;
  name: string;
  type: "video" | "image" | "audio";
  description?: string;
  pricing?: Record<string, unknown>;
  apiSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type AtlascloudJobStatus = "pending" | "processing" | "completed" | "failed";

export interface AtlascloudJobResult {
  status: AtlascloudJobStatus;
  outputUrl?: string;
  error?: string;
}

// client.ts / index.ts
export async function fetchModels(): Promise<AtlascloudModel[]>
export function fetchModelsCached(): CacheResult<AtlascloudModel[]>
export async function submitGeneration(model: string, inputs: Record<string, unknown>): Promise<string>
export async function pollJob(jobId: string): Promise<AtlascloudJobResult>
```

**Implementation patterns:**

- **fetchModels:** Fetch from `GET /api/generate/atlascloud/models` (orchestrator endpoint)
- **fetchModelsCached:** Wrap in stale-while-revalidate with 5-minute client-side cache
- **submitGeneration:** `POST /api/generate/atlascloud` with `{ model, inputs }` → return `jobId`
- **pollJob:** `GET /api/generate/atlascloud/:jobId` → return result shape

**Error handling:** Throw on non-OK HTTP response; let `useGenerationJobPoller` catch and retry.

### 5.2 Type Union Update

**File:** `apps/web/src/stores/generation-job-store.ts`

Add `"atlascloud"` to the `GenerationProvider` union:

```typescript
export type GenerationProvider = "kieai" | "wavespeed" | "atlascloud";
```

### 5.3 Job Poller Integration

**File:** `apps/web/src/hooks/useGenerationJobPoller.ts`

**Changes:**

1. Import `pollJob as pollAtlascloudJob` from `../services/atlascloud/index`
2. Add optional `pollAtlascloudJob` field to `ProcessGenerationJobDeps`
3. In the `pollProvider` function, add a branch for `job.provider === "atlascloud"`:

```typescript
if (job.provider === "atlascloud" && pollAtlascloudJob) {
  const result = await pollAtlascloudJob(job.providerJobId);
  if (result.status === "completed" && result.outputUrl) {
    return { status: "completed", outputUrl: result.outputUrl };
  }
  if (result.status === "failed") {
    return { status: "failed", error: result.error };
  }
  return { status: "running" };
}
```

4. Pass `pollAtlascloudJob: pollJob` when creating the `ProcessGenerationJobDeps` object

**Behavior:** When a job with `provider: "atlascloud"` is polled, the hook calls the Atlascloud poll function and translates the result into the local status shape.

### 5.4 Model Picker UI Integration

**File:** `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`

**Changes:**

1. Fetch Atlascloud models alongside KieAI and WaveSpeed models
2. Merge all models into a unified list with a `provider` field
3. Add provider badge next to each model name (e.g., "Atlascloud", "WaveSpeed", "KieAI")
4. On model selection, dispatch to the correct provider's submission function based on `model.provider`

**Model list format (unified):**

```typescript
interface UnifiedModel {
  id: string;                          // "atlascloud:model-id"
  provider: GenerationProvider;        // "atlascloud"
  name: string;
  description?: string;
  genType: "text-to-video" | "text-to-image";
  apiSchema?: Record<string, unknown>; // Provider-specific constraints
}
```

### 5.5 Settings UI Integration

**File:** `apps/web/src/components/editor/settings/GeneralPanel.tsx`

**Changes:**

1. Add "Atlascloud" to the provider aggregator dropdown
2. Allow users to enable/disable Atlascloud
3. When enabled, expose fields for:
   - **API Key** (optional; when absent, Atlascloud is treated as unconfigured)
   - **Base URL** (optional; defaults to `https://api.atlascloud.ai/api/v1`)

**Settings shape:**

```typescript
interface ProviderSettings {
  id: string;                      // Unique instance ID
  provider: "atlascloud";
  label: string;                   // User-facing label (e.g., "Atlascloud (Personal)")
  apiKey?: string;                 // Sent to orchestrator during submission
  baseUrl?: string;                // Custom API base URL override
  enabled: boolean;
}
```

---

## 6. Type Definitions

### 6.1 Domain Types

**File:** `packages/music-video-domain/src/types.ts`

```typescript
export type GenerationProvider = "wavespeed" | "kie-ai" | "atlascloud" | "veo" | "kling" | "runway" | string;
```

### 6.2 Web Job Store Types

**File:** `apps/web/src/stores/generation-job-store.ts`

```typescript
export type GenerationProvider = "kieai" | "wavespeed" | "atlascloud";

export interface GenerationJob {
  id: string;                          // Local UUID
  provider: GenerationProvider;        // "atlascloud"
  providerJobId: string;               // Atlascloud prediction ID
  model: string;
  prompt: string;
  inputs: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  outputUrl: string | null;
  error: string | null;
  projectId: string;
  linkedMediaIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

---

## 7. Unresolved API Facts

The following Atlascloud API details MUST be verified against `https://atlascloud.ai/docs` or direct API testing before full implementation:

### 7.1 Model List Endpoint

**Open Question:** Does Atlascloud expose a `GET /api/v1/models` endpoint? What is the response format?

**Current assumption:** An array of model objects with at least `id`, `name`, `type` (one of "video", "image", "audio"), and optional `description`, `pricing`, `apiSchema`, `metadata`.

**TODO:** Confirm the exact endpoint path and response schema. If no public list endpoint exists, the model picker MUST hardcode a known model list or fetch from a private API endpoint.

**Impact:** The orchestrator's `/models` endpoint cannot be implemented until this is confirmed.

### 7.2 Image Generation Endpoint

**Open Question:** Is the image generation endpoint exactly `POST /api/v1/model/generateImage`? Does it accept the same payload shape as video generation?

**Current assumption:** Yes, same pattern as video; endpoint is `/model/generateImage` and accepts `{ model, prompt, image_url?, negative_prompt?, num_images? }`.

**TODO:** Verify the exact endpoint path and required/optional request fields.

**Impact:** If the endpoint differs, the orchestrator's submission route (line ~308) MUST be updated.

### 7.3 Per-Model Request Schema

**Open Question:** How does Atlascloud expose per-model constraints (e.g., supported input fields, parameter types, defaults)?

**Current assumption:** Via an `apiSchema` field in the model object (inferred from the plan).

**TODO:** Verify the schema format (JSON Schema, OpenAPI, or custom). If Atlascloud doesn't expose schemas, the UI MUST rely on hardcoded knowledge or submit a generic payload and catch validation errors.

**Impact:** The model picker UI's parameter validation logic depends on this.

### 7.4 Output URL Type

**Open Question:** Are Atlascloud output URLs direct CDN URLs (permanent) or ephemeral download URLs (need immediate caching)?

**Current assumption:** Ephemeral; require orchestrator download to local cache (same as WaveSpeed).

**TODO:** Verify by submitting a test job and checking the output URL's behavior (e.g., how long it remains valid, whether it's rate-limited, whether it's a signed or public URL).

**Impact:** If output URLs are direct CDN (like KieAI), the orchestrator's download logic (§4.3) can be skipped, reducing latency and server load. If they are ephemeral, caching is essential.

### 7.5 Rate Limits & Retry Semantics

**Open Question:** Does Atlascloud enforce rate limits? What are the limits (requests/minute, concurrent jobs)? What retry semantics are expected?

**Current assumption:** Unknown; standard exponential backoff for transient failures.

**TODO:** Verify rate limit headers (e.g., `X-RateLimit-Remaining`, `Retry-After`). Test with high-frequency polling to determine safe polling intervals.

**Impact:** May require client-side backoff or server-side queueing.

### 7.6 Webhook Support

**Open Question:** Does Atlascloud support webhooks for job completion notifications?

**Current assumption:** No; polling is the only way to track job status.

**TODO:** Check the API docs. If webhooks are supported, future versions may optimize away polling.

**Impact:** None for the current implementation; polling is sufficient.

### 7.7 Server-Side Job Cancellation

**Open Question:** Can the orchestrator cancel an in-flight Atlascloud job?

**Current assumption:** Unknown; assume no support for now.

**TODO:** Verify if there's a `DELETE /model/prediction/{id}` or similar endpoint.

**Impact:** If supported, the job panel's "Cancel" action can actually stop the provider job, not just the local tracking.

---

## 8. Migration & Rollout

### 8.1 No Breaking Changes

Adding Atlascloud MUST NOT break existing WaveSpeed or KieAI workflows. The changes are purely additive:

- New provider branch in the job poller
- New service layer for Atlascloud API calls
- New provider option in the settings UI
- New provider badge in the model picker

### 8.2 Phased Implementation

1. **Phase 1:** Domain types, orchestrator env config, orchestrator route (all three endpoints)
2. **Phase 2:** Web service client, job store type, poller integration
3. **Phase 3:** UI integration (model picker, settings panel)
4. **Phase 4 (after API verification):** Model list implementation (when `/models` endpoint is confirmed)

**Pause points:**

- Before Phase 3, verify Atlascloud model list endpoint exists and can be queried
- Before Phase 4 (production), verify output URL behavior and rate limits

### 8.3 Backwards Compatibility

- Existing jobs in `GenerationJobStore` MUST NOT be affected
- WaveSpeed and KieAI routes remain unchanged
- Settings storage MUST support optional Atlascloud config (default: unconfigured)

---

## 9. Testing Strategy

### 9.1 Orchestrator Tests

**File:** `apps/orchestrator/src/routes/atlascloud.test.ts`

**Test cases:**

- [ ] `GET /models` returns cached model list
- [ ] `GET /models` returns stale cache on API failure
- [ ] `GET /models` returns 502 when no cache and API failure
- [ ] `POST /` accepts submission, returns `jobId`, stores job
- [ ] `POST /` rejects submission without `model` and `inputs`
- [ ] `POST /` returns 503 when API key not configured
- [ ] `GET /:jobId` polls status, returns correct shape
- [ ] `GET /:jobId` downloads result on completion
- [ ] `GET /:jobId` returns error on failure
- [ ] `GET /:jobId` returns 404 for unknown job

### 9.2 Web Client Tests

**File:** `apps/web/src/services/atlascloud/client.test.ts`

**Test cases:**

- [ ] `fetchModels()` calls orchestrator and returns parsed response
- [ ] `fetchModelsCached()` returns cached data on second call
- [ ] `submitGeneration()` sends `{ model, inputs }` and returns `jobId`
- [ ] `pollJob()` fetches status and returns translated result
- [ ] All functions throw on HTTP error responses

### 9.3 Job Store Tests

**File:** `apps/web/src/stores/generation-job-store.test.ts`

**Test cases:**

- [ ] `enqueueJob(provider: "atlascloud", ...)` adds job with status `"queued"`
- [ ] `updateJobStatus(id, "completed", outputUrl)` transitions status
- [ ] Job persists across `persist` hydration

### 9.4 Poller Tests

**File:** `apps/web/src/hooks/useGenerationJobPoller.test.ts` (may expand existing file)

**Test cases:**

- [ ] Poller dispatches to `pollAtlascloudJob` for `provider: "atlascloud"`
- [ ] Poller transitions status correctly based on poll result
- [ ] Poller idempotency: no duplicate media items on repeated completions

### 9.5 End-to-End Test

**Manual test workflow (before production):**

1. Start orchestrator with `ATLASCLOUD_API_KEY` set
2. Load web app, open GenerateAssetDialog
3. Select an Atlascloud model from the unified list
4. Submit a generation job
5. Observe job in the Job Management Panel
6. Poll and verify status transitions: queued → running → completed
7. Verify generated asset appears in the timeline/media library

---

## 10. References

- [Atlascloud Support plan](../superpowers/plans/2026-07-03-atlascloud-support.md) — Full implementation plan with Task 1–7 checklists
- [AI Generation & Providers spec](./ai-generation-providers.md) — Unified AI generation subsystem spec (covering all providers)
- `https://atlascloud.ai/docs` — Atlascloud API documentation (external)
- [Music Video Timeline Native plan](../superpowers/plans/2026-06-28-music-video-timeline-native.md) — Job store and poller context

---

## 11. Checklist

**Implementation tasks from the plan:**

- [ ] **Task 1:** Add `"atlascloud"` to `GenerationProvider` union in domain types
- [ ] **Task 2:** Add `ATLASCLOUD_API_KEY` env config to orchestrator
- [ ] **Task 3:** Implement orchestrator route (`/models`, `/`, `/:jobId`)
- [ ] **Task 4:** Implement web service client (`fetchModels`, `submitGeneration`, `pollJob`)
- [ ] **Task 5:** Wire Atlascloud into job store and poller
- [ ] **Task 6:** Integrate model picker UI with provider badge
- [ ] **Task 7:** Add Atlascloud to settings UI
- [ ] **Verification:** Manually test the full generation workflow with Atlascloud

---

**Status:** Spec ready for implementation. Awaiting external API verification from `https://atlascloud.ai/docs` (see §7) before feature-complete.
