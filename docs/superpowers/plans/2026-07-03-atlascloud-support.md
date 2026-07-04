# Atlascloud AI Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Atlascloud (atlascloud.ai) as a new AI generation provider alongside the existing WaveSpeed and KieAI providers, following the orchestrator-proxy pattern.

**Architecture:** Atlascloud API calls are proxied through the orchestrator (same pattern as WaveSpeed), keeping the API key server-side. The orchestrator exposes three endpoints — model list, submit generation, poll status. The web client talks to the orchestrator only. Jobs flow through the existing `GenerationJobStore` and get polled by the existing `useGenerationJobPoller`. A new provider branch is added to each integration seam: types, env/config, orchestrator route, web client, UI model list, job poller dispatch.

**Tech Stack:** Express route on orchestrator, `apps/web/src/services/atlascloud/` client module, Zustand `GenerationJobStore` (add provider to union type), modified `useGenerationJobPoller` dispatch, existing `GenerateAssetDialog` unified model list.

---

## Atlascloud API Contract

Atlascloud provides a unified REST API for 600+ models (video, image, audio generation) at `https://api.atlascloud.ai/api/v1`.

### Known endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/model/uploadMedia` | POST (multipart) | Upload source image/video |
| `/api/v1/model/generateVideo` | POST (JSON) | Submit video generation job |
| `/api/v1/model/generateImage` | POST (JSON) | Submit image generation job (inferred pattern) |
| `/api/v1/model/prediction/{prediction_id}` | GET | Poll job status |

### Auth
`Authorization: Bearer <api-key>` header on all requests.

### Generation flow
1. (Optional) Upload source media → returns `data.url`
2. Submit generation with `{ model, prompt, image_url?, ... }` → returns `{ code, msg, data: { id: "prediction_id" } }`
3. Poll `GET /api/v1/model/prediction/{prediction_id}` → `{ data: { status: "processing"|"succeeded"|"failed", output?: "...", error?: "..." } }`
4. On `succeeded`, `data.output` contains the result URL.

### Unknowns requiring external research before implementation
- `GET /api/v1/models` endpoint existence and response format (for model picker UI)
- Image generation endpoint exact path and request body shape
- Request schema for each specific model (the dynamic schema pattern used by WaveSpeed)
- Rate limits, retry semantics, and webhook support
- Whether output URL needs downloading (like WaveSpeed) or is a direct CDN URL (like KieAI)

Implementation of the Atlascloud route must pause before Task 3 until these API facts are confirmed; the plan keeps those decisions isolated to the API client and documents the exact checks to run.

---

## File map

### Orchestrator (create/modify)
| File | Action |
|---|---|
| `apps/orchestrator/src/env.ts` | **Modify** — add `atlascloudApiKey` |
| `apps/orchestrator/src/routes/atlascloud.ts` | **Create** — model list, submit, poll endpoints |
| `apps/orchestrator/src/routes/index.ts` | **Modify** — export `atlascloudRouter` |
| `apps/orchestrator/src/app.ts` | **Modify** — wire atlascloud route, health check |
| `apps/orchestrator/src/index.ts` | **Modify** — add atlascloud status log |

### Domain types (modify)
| File | Action |
|---|---|
| `packages/music-video-domain/src/types.ts` | **Modify** — add `"atlascloud"` to `GenerationProvider` type |

### Web (create/modify)
| File | Action |
|---|---|
| `apps/web/src/services/atlascloud/client.ts` | **Create** — fetch wrapper like KieAI client |
| `apps/web/src/services/atlascloud/index.ts` | **Create** — `fetchModels`, `submitGeneration`, `pollJob` functions |
| `apps/web/src/services/atlascloud/types.ts` | **Create** — Atlascloud-specific response types |
| `apps/web/src/stores/generation-job-store.ts` | **Modify** — add `"atlascloud"` to `GenerationProvider` |
| `apps/web/src/hooks/useGenerationJobPoller.ts` | **Modify** — add atlascloud branch in `pollProvider` |
| `apps/web/src/stores/settings-store.ts` | **Modify** — add atlascloud to `SERVICE_REGISTRY` / `AggregatorProvider` |
| `apps/web/src/config/api-endpoints.ts` | **Modify** — add atlascloud base URL |
| `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx` | **Modify** — add atlascloud unified models with provider badge |
| `apps/web/src/components/editor/settings/GeneralPanel.tsx` | **Modify** — add atlascloud to aggregator dropdown |

### Tests (create)
| File | Action |
|---|---|
| `apps/orchestrator/src/routes/atlascloud.test.ts` | **Create** — orchestrator route tests |
| `apps/web/src/services/atlascloud/client.test.ts` | **Create** — API client tests |
| `apps/web/src/stores/generation-job-store.test.ts` | **Modify** — add atlascloud test cases |

### Config
| File | Action |
|---|---|
| `.env.example` (orchestrator-level) | **Add** — `ATLASCLOUD_API_KEY=` |

---

## Task 1: Add atlascloud to domain types

**Files:**
- Modify: `packages/music-video-domain/src/types.ts`

**Steps:**

- [ ] **Step 1: Change `GenerationProvider` union**

```typescript
// packages/music-video-domain/src/types.ts
// Before:
export type GenerationProvider = "wavespeed" | "kie-ai" | "veo" | "kling" | "runway" | string;
// After:
export type GenerationProvider = "wavespeed" | "kie-ai" | "atlascloud" | "veo" | "kling" | "runway" | string;
```

- [ ] **Step 2: Run typecheck to verify**

```bash
cd packages/music-video-domain && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/music-video-domain/src/types.ts
git commit -m "feat(domain): add atlascloud to GenerationProvider union type"
```

---

## Task 2: Orchestrator env config

**Files:**
- Modify: `apps/orchestrator/src/env.ts`

**Steps:**

- [ ] **Step 1: Add `atlascloudApiKey` to the config object**

In `apps/orchestrator/src/env.ts`, add after the existing `kieAiApiKey` line:
```typescript
atlascloudApiKey: env("ATLASCLOUD_API_KEY"),
```

- [ ] **Step 2: Verify compilation**

```bash
cd apps/orchestrator && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/env.ts
git commit -m "feat(orchestrator): add ATLASCLOUD_API_KEY env config"
```

---

## Task 3: Orchestrator atlascloud route

**Files:**
- Create: `apps/orchestrator/src/routes/atlascloud.ts`
- Modify: `apps/orchestrator/src/routes/index.ts`
- Modify: `apps/orchestrator/src/app.ts`
- Modify: `apps/orchestrator/src/index.ts`

**Steps:**

- [ ] **Step 1: Create `apps/orchestrator/src/routes/atlascloud.ts`**

```typescript
/**
 * AtlasCloud orchestrator proxy.
 *
 * Proxies generation requests to api.atlascloud.ai so the API key stays
 * server-side (same pattern as /routes/wavespeed.ts).
 *
 * Endpoints:
 *   GET  /models                — cached model list
 *   POST /                      — submit generation, returns local jobId
 *   GET  /:jobId                — poll job status
 */

import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { mkdirSync, createWriteStream } from "node:fs";
import { join, extname } from "node:path";
import { get as httpsGet } from "node:https";
import { randomUUID } from "node:crypto";
import config from "../env.js";

export const atlascloudRouter: ExpressRouter = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────────

const ATLASCLOUD_BASE = "https://api.atlascloud.ai/api/v1";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.atlascloudApiKey}` };
}

async function atlasFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${ATLASCLOUD_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AtlasCloud HTTP ${res.status}: ${body}`);
  }
  const json = await res.json() as { code: number; msg: string; data: T };
  if (json.code !== 200) {
    throw new Error(`AtlasCloud API error ${json.code}: ${json.msg}`);
  }
  return json.data;
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? httpsGet : httpGet;
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(destPath);
      res.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
    }).on("error", reject);
  });
}

// ── Model cache ─────────────────────────────────────────────────────────────────

interface AtlascloudModel {
  id: string;
  name: string;
  type: "video" | "image" | "audio";
  description?: string;
  pricing?: Record<string, unknown>;
  apiSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

let modelCache: AtlascloudModel[] = [];
let modelCacheAt = 0;
const MODEL_TTL_MS = 60 * 60 * 1000;

async function fetchModels(): Promise<AtlascloudModel[]> {
  const data = await atlasFetch<unknown>("/models");
  if (!Array.isArray(data)) {
    throw new Error("Atlascloud /models must return an array before model picker implementation can continue");
  }
  return data as AtlascloudModel[];
}

// ── Job tracking (in-memory, same pattern as wavespeed.ts) ──────────────────────

interface Job {
  atlascloudPredictionId: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed";
  outputUrl?: string;
  error?: string;
}

const jobs = new Map<string, Job>();

// ── Routes ──────────────────────────────────────────────────────────────────────

/** GET /api/generate/atlascloud/models — cached model list */
atlascloudRouter.get("/models", async (_req, res) => {
  if (!config.atlascloudApiKey) {
    res.status(503).json({ error: "AtlasCloud API key not configured" });
    return;
  }
  const now = Date.now();
  if (modelCache.length > 0 && now - modelCacheAt < MODEL_TTL_MS) {
    res.json(modelCache);
    return;
  }
  try {
    modelCache = await fetchModels();
    modelCacheAt = now;
    res.json(modelCache);
  } catch (e) {
    // Fall back to stale cache if fetch fails
    if (modelCache.length > 0) {
      res.json(modelCache);
    } else {
      res.status(502).json({ error: `Failed to fetch models: ${(e as Error).message}` });
    }
  }
});

/** POST /api/generate/atlascloud — submit generation, returns local jobId */
atlascloudRouter.post("/", async (req, res) => {
  if (!config.atlascloudApiKey) {
    res.status(503).json({ error: "AtlasCloud API key not configured" });
    return;
  }
  const { model, inputs } = req.body as { model: string; inputs: Record<string, unknown> };
  if (!model || !inputs) {
    res.status(400).json({ error: "model and inputs are required" });
    return;
  }
  try {
    // Route dispatch is isolated here so the exact Atlascloud endpoint names can be corrected after API-doc verification.
    const isVideo = inputs._type === "video" || model.includes("video");
    const endpoint = isVideo ? "/model/generateVideo" : "/model/generateImage";

    // Keep the v1 payload to the shared parameters already supported by the existing generation UI.
    const atlasPayload: Record<string, unknown> = {
      model,
      prompt: inputs.prompt,
    };
    if (inputs.image_url) atlasPayload.image_url = inputs.image_url;
    if (inputs.negative_prompt) atlasPayload.negative_prompt = inputs.negative_prompt;
    if (inputs.num_images) atlasPayload.num_images = inputs.num_images;

    const data = await atlasFetch<{ id: string }>(endpoint, {
      method: "POST",
      body: JSON.stringify(atlasPayload),
    });

    const jobId = randomUUID();
    jobs.set(jobId, { atlascloudPredictionId: data.id, model, status: "pending" });
    res.json({ jobId });
  } catch (e) {
    res.status(502).json({ error: `Submission failed: ${(e as Error).message}` });
  }
});

/** GET /api/generate/atlascloud/:jobId — poll job status */
atlascloudRouter.get("/:jobId", async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "completed" || job.status === "failed") {
    res.json({ status: job.status, outputUrl: job.outputUrl, error: job.error });
    return;
  }
  try {
    const result = await atlasFetch<{
      status: string;
      output?: string;
      error?: string;
    }>(`/model/prediction/${job.atlascloudPredictionId}`, { method: "GET" });

    if (result.status === "succeeded" && result.output) {
      // Download the result to local cache (same pattern as WaveSpeed)
      const remoteUrl = result.output;
      const ext = extname(new URL(remoteUrl).pathname) || ".mp4";
      const cacheDir = join(config.generatedAssetsDir, "atlascloud", job.atlascloudPredictionId);
      mkdirSync(cacheDir, { recursive: true });
      const localFile = join(cacheDir, `result${ext}`);
      await downloadFile(remoteUrl, localFile);
      const rel = localFile.slice(config.generatedAssetsDir.length);
      job.status = "completed";
      job.outputUrl = `http://localhost:${config.port}/assets${rel}`;
      res.json({ status: "completed", outputUrl: job.outputUrl });
    } else if (result.status === "failed") {
      job.status = "failed";
      job.error = result.error || "Generation failed";
      res.json({ status: "failed", error: job.error });
    } else {
      job.status = "processing";
      res.json({ status: "processing" });
    }
  } catch (e) {
    res.status(502).json({ error: `Poll failed: ${(e as Error).message}` });
  }
});
```

- [ ] **Step 2: Export atlascloudRouter from routes index**

In `apps/orchestrator/src/routes/index.ts`, add:
```typescript
export { atlascloudRouter } from "./atlascloud";
```

- [ ] **Step 3: Wire the route in app.ts**

In `apps/orchestrator/src/app.ts`:
- Add `atlascloudRouter` to the imports (line 6)
- Add before the project router (around line 34):
```typescript
app.use("/api/generate/atlascloud", atlascloudRouter);
```
- Add to the health check (line 24-31):
```typescript
atlascloud: !!config.atlascloudApiKey,
```

- [ ] **Step 4: Add status log in index.ts**

In `apps/orchestrator/src/index.ts` (around line 10):
```typescript
console.log(`  AtlasCloud: ${config.atlascloudApiKey ? "✓" : "○"}`);
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/orchestrator && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/routes/atlascloud.ts \
      apps/orchestrator/src/routes/index.ts \
      apps/orchestrator/src/app.ts \
      apps/orchestrator/src/index.ts \
      apps/orchestrator/src/env.ts
git commit -m "feat(orchestrator): atlascloud proxy route — models, submit, poll, download"
```

---

## Task 4: Web atlascloud service client

**Files:**
- Create: `apps/web/src/services/atlascloud/client.ts`
- Create: `apps/web/src/services/atlascloud/types.ts`
- Create: `apps/web/src/services/atlascloud/index.ts`
- Modify: `apps/web/src/config/api-endpoints.ts`

**Steps:**

- [ ] **Step 1: Create `apps/web/src/services/atlascloud/types.ts`**

```typescript
/**
 * AtlasCloud API response types.
 * Used by both the orchestrator client and the model picker UI.
 */

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
```

- [ ] **Step 2: Create `apps/web/src/services/atlascloud/client.ts`**

```typescript
/**
 * AtlasCloud orchestrator client.
 *
 * All API calls go to the local orchestrator (key stays server-side),
 * same pattern as services/wavespeed/index.ts.
 */

import { ORCHESTRATOR_URL } from "../../stores/music-video-store";

export const ATLASCLOUD_BASE = `${ORCHESTRATOR_URL}/api/generate/atlascloud`;

async function atlasFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ATLASCLOUD_BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Orchestrator error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 3: Create `apps/web/src/services/atlascloud/index.ts`**

```typescript
/**
 * AtlasCloud browser client — talks to the orchestrator (key stays server-side).
 */

import { atlasFetch } from "./client";
import type { AtlascloudModel, AtlascloudJobResult } from "./types";
import { CACHE_KEYS, staleWhileRevalidate } from "../cache";
import type { CacheResult } from "../cache";

export async function fetchModels(): Promise<AtlascloudModel[]> {
  return atlasFetch<AtlascloudModel[]>("/models");
}

export function fetchModelsCached(): CacheResult<AtlascloudModel[]> {
  return staleWhileRevalidate(CACHE_KEYS.ATLASCLOUD_MODELS, fetchModels, 5 * 60 * 1000);
}

export async function submitGeneration(
  model: string,
  inputs: Record<string, unknown>,
): Promise<string> {
  const result = await atlasFetch<{ jobId: string }>("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, inputs }),
  });
  return result.jobId;
}

export async function pollJob(jobId: string): Promise<AtlascloudJobResult> {
  return atlasFetch<AtlascloudJobResult>(`/${jobId}`);
}
```

- [ ] **Step 4: Add `ATLASCLOUD_MODELS` cache key**

In `apps/web/src/services/cache.ts`, add `ATLASCLOUD_MODELS: "atlascloud-models"` to the `CACHE_KEYS` object.

- [ ] **Step 5: Add atlascloud to api-endpoints (optional, for future direct use)**

In `apps/web/src/config/api-endpoints.ts`, add after the existing entries:
```typescript
export const ATLASCLOUD_API_URL = "https://api.atlascloud.ai/api/v1";
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/services/atlascloud/ \
      apps/web/src/config/api-endpoints.ts
git commit -m "feat(web): atlascloud service client — models, submit, poll"
```

---

## Task 5: Wire atlascloud into generation job lifecycle

**Files:**
- Modify: `apps/web/src/stores/generation-job-store.ts`
- Modify: `apps/web/src/hooks/useGenerationJobPoller.ts`

**Steps:**

- [ ] **Step 1: Add `"atlascloud"` to `GenerationProvider` union**

In `apps/web/src/stores/generation-job-store.ts`:
```typescript
export type GenerationProvider = "kieai" | "wavespeed" | "atlascloud";
```

- [ ] **Step 2: Add atlascloud polling branch in `pollProvider`**

In `apps/web/src/hooks/useGenerationJobPoller.ts`:

Change the `pollProvider` function to add an atlascloud branch. Import `pollJob` from the atlascloud service:

```typescript
import { pollJob as pollAtlascloudJob } from "../services/atlascloud/index";
```

Change `ProcessGenerationJobDeps` to accept an optional `pollAtlascloudJob`:

```typescript
export interface ProcessGenerationJobDeps {
  // ... existing fields ...
  pollAtlascloudJob?: (providerJobId: string) => Promise<{ status: string; outputUrl?: string; error?: string }>;
}
```

Modify `pollProvider` to handle `"atlascloud"`:
```typescript
if (job.provider === "atlascloud" && pollAtlascloudJob) {
  const result = await pollAtlascloudJob(job.providerJobId);
  if (result.status === "completed" && result.outputUrl) {
    return { status: "completed", outputUrl: result.outputUrl };
  }
  if (result.status === "failed") return { status: "failed", error: result.error };
  return { status: "running" };
}
```

In the `useGenerationJobPoller` hook, pass `pollAtlascloudJob: pollJob` (from altascloud service) alongside the existing `pollWavespeedJob` and `pollKieaiTask`:

```typescript
pollAtlascloudJob: pollJob, // from ./services/atlascloud/index
```

- [ ] **Step 3: Run existing generation-job-store tests**

```bash
cd apps/web && npx vitest run src/stores/generation-job-store.test.ts
```
Expected: existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/generation-job-store.ts \
      apps/web/src/hooks/useGenerationJobPoller.ts
git commit -m "feat(web): wire atlascloud into generation job store and poller"
```

---

## Task 6: UI — model picker and provider badge

**Files:**
- Modify: `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`

**Steps:**

- [ ] **Step 1: Add atlascloud to the unified model list**

In `GenerateAssetDialog.tsx`:
- Add `"atlascloud"` to the `ModelProvider` union:
```typescript
type ModelProvider = "kieai" | "wavespeed" | "atlascloud";
```

- Add atlascloud models to the unified list in the `useMemo` that builds `unifiedModels`. After the WaveSpeed or KieAI block, add:

```typescript
// ── AtlasCloud models ──────────────────────────────────────────────
if (atlascloudModels.length > 0) {
  for (const m of atlascloudModels) {
    const genType: GenType = m.type === "video" ? "text-to-video" : "text-to-image";
    unified.push({
      id: `atlascloud:${m.id}`,
      provider: "atlascloud",
      name: m.name,
      description: m.description ?? "",
      genType,
    });
  }
}
```

- Add the atlascloud provider badge color:
```typescript
const providerColors: Record<ModelProvider, string> = {
  kieai: "bg-violet-500/20 text-violet-300",
  wavespeed: "bg-emerald-500/20 text-emerald-300",
  atlascloud: "bg-amber-500/20 text-amber-300",
};
```

- Add the atlascloud display label in the badge rendering:
```typescript
{m.provider === "kieai" ? "KieAI" : m.provider === "wavespeed" ? "WaveSpeed" : "AtlasCloud"}
```
(Update both badge render locations — one in the list mode, one in the selected detail view.)

- Add the atlascloud submit branch alongside the existing `if (model.provider === "kieai" ...)` / `else if (model.provider === "wavespeed" ...)` branches:

```typescript
} else if (model.provider === "atlascloud") {
  // Collect inputs from the form (reuse the existing wsInputs-like state)
  const jobId = await submitGeneration(model.id, wsInputs);
  const previewUrl = asset?.thumbnailUrl ?? shot?.thumbnailUrl ?? sourceFile ?? null;
  addGeneratedMedia({
    name: `AtlasCloud — ${model.name}`,
    thumbnailUrl: previewUrl ?? null,
    waveformData: null,
    isPlaceholder: true,
    isPending: true,
    generationMeta: {
      provider: "atlascloud",
      model: model.id,
      prompt: String(wsInputs.prompt ?? ""),
      inputs: wsInputs,
      jobId,
      status: "pending",
    },
  });
  enqueueJob({
    provider: "atlascloud",
    providerJobId: jobId,
    model: model.id,
    prompt: String(wsInputs.prompt ?? ""),
    inputs: wsInputs,
    projectId: project.id,
    linkedMediaIds: refIds,
  });
  handleClose();
}
```

- Import the atlascloud functions:
```typescript
import { fetchModels as fetchAtlascloudModels, submitGeneration } from "../../../services/atlascloud/index";
```

- Load atlascloud models on mount alongside the others (add to the `useEffect` that fetches models).

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/editor/generate/GenerateAssetDialog.tsx
git commit -m "feat(ui): add atlascloud to GenerateAssetDialog model picker"
```

---

## Task 7: Settings — service registry and default provider

**Files:**
- Modify: `apps/web/src/stores/settings-store.ts`
- Modify: `apps/web/src/components/editor/settings/GeneralPanel.tsx`

**Steps:**

- [ ] **Step 1: Add atlascloud to `AggregatorProvider` type and `SERVICE_REGISTRY`**

In `apps/web/src/stores/settings-store.ts`:

Change the `AggregatorProvider` type:
```typescript
export type AggregatorProvider = "kie-ai" | "freepik" | "atlascloud";
```

Add to `SERVICE_REGISTRY`:
```typescript
{
  id: "atlascloud",
  label: "AtlasCloud",
  description: "AI aggregator for video/image generation — 600+ models",
  docsUrl: "https://atlascloud.ai/docs",
},
```

- [ ] **Step 2: Add atlascloud to the GeneralPanel aggregator dropdown options**

In `apps/web/src/components/editor/settings/GeneralPanel.tsx`, find the `aggregatorProviders` array and add:
```typescript
{ id: "atlascloud", label: "AtlasCloud" },
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/settings-store.ts \
      apps/web/src/components/editor/settings/GeneralPanel.tsx
git commit -m "feat(settings): add atlascloud to service registry and aggregator picker"
```

---

## Task 8: Tests

**Files:**
- Create: `apps/orchestrator/src/routes/atlascloud.test.ts`
- Create: `apps/web/src/services/atlascloud/client.test.ts`
- Modify: `apps/web/src/stores/generation-job-store.test.ts`

**Steps:**

- [ ] **Step 1: Orchestrator route tests**

Create `apps/orchestrator/src/routes/atlascloud.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../app";
import type { Express } from "express";
import http from "node:http";

// Mock the env config
vi.mock("../env", () => ({
  default: {
    atlascloudApiKey: "test-key-123",
    port: 0,
    generatedAssetsDir: "/tmp/test-atlascloud-assets",
  },
}));

describe("POST /api/generate/atlascloud", () => {
  let app: Express;
  let server: http.Server;

  beforeEach(() => {
    app = createApp();
    server = http.createServer(app);
  });

  afterEach(() => {
    server.close();
  });

  it("returns 400 when model is missing", async () => {
    const res = await fetch("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when api key is not configured", async () => {
    // Reset mock for this test only
    // ... test ...
  });
});
```

- [ ] **Step 2: Web client tests**

Create `apps/web/src/services/atlascloud/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitGeneration, pollJob } from "./index";

describe("AtlasCloud client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submitGeneration returns jobId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ jobId: "test-job-1" }), { status: 200 }),
    );
    const jobId = await submitGeneration("test-model", { prompt: "hello" });
    expect(jobId).toBe("test-job-1");
  });

  it("pollJob returns status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "processing" }), { status: 200 }),
    );
    const result = await pollJob("test-job-1");
    expect(result.status).toBe("processing");
  });
});
```

- [ ] **Step 3: Extend generation-job-store tests**

In `apps/web/src/stores/generation-job-store.test.ts`:

Add a test case that creates a job with `provider: "atlascloud"` and verifies it flows through the lifecycle correctly:
```typescript
it("handles atlascloud job lifecycle", () => {
  const store = useGenerationJobStore.getState();
  store.enqueue({
    provider: "atlascloud",
    providerJobId: "ac-job",
    model: "some-model",
    prompt: "test",
    inputs: {},
    projectId: "p1",
    linkedMediaIds: [],
  });
  const job = useGenerationJobStore.getState().jobs[0];
  expect(job.provider).toBe("atlascloud");
  expect(job.status).toBe("queued");
});
```

- [ ] **Step 4: Run all tests**

```bash
cd apps/web && npx vitest run src/services/atlascloud/ src/stores/generation-job-store.test.ts
cd apps/orchestrator && npx vitest run src/routes/atlascloud.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/routes/atlascloud.test.ts \
      apps/web/src/services/atlascloud/client.test.ts \
      apps/web/src/stores/generation-job-store.test.ts
git commit -m "test: add atlascloud provider tests — orchestrator route, web client, job store"
```

---

## Task 9: Verification checklist

Run these verification steps in order:

- [ ] **Step 1: TypeScript compilation — whole project**

```bash
cd apps/orchestrator && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd packages/music-video-domain && npx tsc --noEmit
```
Expected: no errors in any package.

- [ ] **Step 2: Unit tests**

```bash
cd apps/web && npx vitest run --reporter=verbose
cd apps/orchestrator && npx vitest run --reporter=verbose
```
Expected: all tests pass (existing + new atlascloud tests).

- [ ] **Step 3: Manual smoke test — orchestrator starts with atlascloud config**

```bash
ATLASCLOUD_API_KEY=sk-test atlascloud npx tsx apps/orchestrator/src/index.ts
```
Expected: logs show `AtlasCloud: ✓`.

- [ ] **Step 4: Manual smoke test — health endpoint**

```bash
curl http://localhost:4041/api/health
```
Expected: response includes `"atlascloud": true`.

- [ ] **Step 5: Manual smoke test — models endpoint**

```bash
curl http://localhost:4041/api/generate/atlascloud/models
```
Expected: returns JSON array of models (or error if API key is fake).

---

## External API unknowns

The following facts about the AtlasCloud API were not verified during planning and must be resolved at the listed task boundaries:

| Unknown | Impact | When to resolve |
|---|---|---|
| `GET /api/v1/models` response format | Determines model picker UI data structure | Before Task 3 implementation |
| Image generation endpoint path and request shape | Affects submit route dispatch logic | Before Task 3 implementation |
| Per-model request schemas | Dynamic form generation similar to WaveSpeed's `api_schema` | Before Task 6 (model-specific input forms) |
| Whether output URLs are CDN-accessible or need downloading | Determines if route downloads to local cache or returns URL directly | Before Task 3 (poller download logic) |
| Rate limits and retry semantics | Error handling robustness | Before production deployment |

**Recommended approach:** Create a test AtlasCloud account, read their API docs at `https://atlascloud.ai/docs`, and run a manual curl against each endpoint before implementing the task named in the table above.
