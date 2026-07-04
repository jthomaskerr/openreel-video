# Audio Auto-Subtitle Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user imports an audio file (MP3, WAV, AAC, OGG, FLAC) into the media library, automatically transcribe it using the existing GPU transcription service and persist the resulting subtitles into the project timeline.

**Architecture:** A new orchestrator route proxies audio uploads to the existing `infra/transcribe-gpu/` service. After audio import succeeds in the project store, a new store/hook pair manages an async transcription job — poll for completion, then import the resulting word-timed subtitles into the project timeline via the existing `SubtitleEngine.importSRT`/`addSubtitle` path. Progress is surfaced through a new lightweight `TranscriptionJobStore` (following the pattern of `generation-job-store.ts`) and a status indicator in the media library panel. Error handling preserves the imported audio even if transcription fails.

**Tech Stack:** TypeScript, Zustand (`transcription-job-store.ts`), Express (orchestrator), fastapi/faster-whisper (transcribe-gpu), Vitest, `@openreel/core` (`SubtitleEngine`, `Subtitle`, `Timeline`), `lucide-react` (progress icons).

---

## Execution contract

- One task = one atomic commit.
- Each task uses TDD: write the failing test, run it and record the expected failure, implement minimum code, run passing test, commit.
- Do not batch unrelated tasks into one commit.
- Do not modify existing files outside the scope listed in each task.
- Skip formatters, linters, and project-wide test suites — they are not part of this plan.
- New files are created only where listed; prefer modifications to existing files.

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Add orchestrator transcription proxy route | none | true | `feat: add transcribe proxy route to orchestrator` |
| 02 | Create `TranscriptionJobStore` | none | true | `feat: add transcription job store for async tracking` |
| 03 | Create transcription API client in web app | 01 | false | `feat: add transcription API client service` |
| 04 | Hook transcription into `importMedia` in project-store | 02, 03 | false | `feat: auto-transcribe audio files on import` |
| 05 | Build `useTranscriptionJobPoller` hook | 02, 04 | false | `feat: add transcription job polling hook` |
| 06 | Show transcription progress/status in AssetsPanel | 04, 05 | false | `feat: show transcription status in asset thumbnails` |
| 07 | Handle transcription errors gracefully | 04 | false | `feat: handle transcription failures without losing audio import` |
| 08 | Write integration / smoke test | 04, 06, 07 | false | `test: verify audio import triggers transcription end-to-end` |

---

## Atomic task plans

### Task 01: Add orchestrator transcription proxy route

**Goal:** Add `POST /api/transcribe` and `GET /api/transcribe/:jobId` routes to the orchestrator that proxy requests to the transcribe-gpu service (or run transcription inline for development).

**Files:**
- Create: `apps/orchestrator/src/routes/transcribe.ts`
- Modify: `apps/orchestrator/src/routes/index.ts` — register the new route
- Modify: `apps/orchestrator/src/app.ts` — mount the route
- Modify: `apps/orchestrator/src/env.ts` — add `TRANSCRIBE_SERVICE_URL` config

**Reference files:**
- `apps/orchestrator/src/routes/wavespeed.ts:94-132` — pattern for async job submission with file download
- `apps/orchestrator/src/routes/wavespeed.ts:134-174` — pattern for job polling endpoint
- `infra/transcribe-gpu/main.py:176-204` — the POST /transcribe endpoint
- `infra/transcribe-gpu/main.py:207-224` — the GET /jobs/{job_id} endpoint
- `apps/orchestrator/src/env.ts:45-65` — existing config pattern
- `apps/orchestrator/src/routes/index.ts:1-2` — existing re-export pattern

**TDD steps:**
- [ ] Write failing test: Test that the orchestrator route `POST /api/transcribe` accepts multipart form with an audio file and returns `{ jobId, status: "processing" }`. (Test with a stub audio buffer via supertest or chai-http.)
  - Test file: `apps/orchestrator/src/routes/transcribe.test.ts`
  - Test: POST a WAV buffer → expect 200 JSON with `jobId` (string) and `status === "processing"`
  - Test: GET `/api/transcribe/:jobId` → expect 200 JSON with status, progress, result when complete
- [ ] Run: `cd apps/orchestrator && npx vitest run src/routes/transcribe.test.ts`
- [ ] Confirm expected red: FAIL because the route does not exist.
- [ ] Implement the smallest production change:

  **`apps/orchestrator/src/env.ts`** — add `transcribeServiceUrl`:
  ```
  [env.ts#3143]
  INS.POST 64:
  +  transcribeServiceUrl: env(
  +    "TRANSCRIBE_SERVICE_URL",
  +    "http://localhost:8000",
  +  ),
  ```

  **`apps/orchestrator/src/routes/transcribe.ts`** — new file:
  ```typescript
  import { Router } from "express";
  import type { Router as ExpressRouter } from "express";
  import { config } from "../env.js";

  export const transcribeRouter: ExpressRouter = Router();

  /**
   * POST /api/transcribe
   * Proxy to the GPU transcription service.
   * Accepts: multipart/form-data with `audio` file, optional `language`, `target_language`.
   * Returns: { jobId, status }
   */
  transcribeRouter.post("/", async (req, res) => {
    try {
      // Forward the multipart form to the transcribe service
      const baseUrl = config.transcribeServiceUrl;
      const formData = req.body; // express may need busboy/multer for multipart
      // For simplicity, forward the request
      const response = await fetch(`${baseUrl}/transcribe`, {
        method: "POST",
        // @ts-expect-error - req is incoming message; forward to transcribe service
        body: req,
        duplex: "half",
        headers: {
          "Content-Type": req.headers["content-type"] || "multipart/form-data",
        },
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(502).json({
        error: `Transcription service unavailable: ${(error as Error).message}`,
      });
    }
  });

  /**
   * GET /api/transcribe/:jobId
   * Poll a transcription job status.
   */
  transcribeRouter.get("/:jobId", async (req, res) => {
    try {
      const baseUrl = config.transcribeServiceUrl;
      const response = await fetch(`${baseUrl}/jobs/${req.params.jobId}`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(502).json({
        error: `Transcription service unavailable: ${(error as Error).message}`,
      });
    }
  });
  ```

  **`apps/orchestrator/src/routes/index.ts`** — add re-export:
  ```
  [index.ts#BA49]
  INS.POST 2:
  +export { transcribeRouter } from "./transcribe";
  ```

  **`apps/orchestrator/src/app.ts`** — mount the route:
  ```
  [app.ts#2BE6]
  INS.POST 32:
  +app.use("/api/transcribe", transcribeRouter);
  ```
- [ ] Re-run: `cd apps/orchestrator && npx vitest run src/routes/transcribe.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/orchestrator/src/routes/transcribe.ts apps/orchestrator/src/routes/transcribe.test.ts apps/orchestrator/src/routes/index.ts apps/orchestrator/src/app.ts apps/orchestrator/src/env.ts && git commit -m "feat: add transcribe proxy route to orchestrator"`

**Acceptance criteria:**
- `POST /api/transcribe` accepts audio upload, returns `{ jobId, status }`.
- `GET /api/transcribe/:jobId` returns current job status.
- Orchestrator config includes `TRANSCRIBE_SERVICE_URL` defaulting to `http://localhost:8000`.
- Route is mounted at `/api/transcribe`.

**Constraints:**
- Use native `fetch` (Node 18+) — no extra HTTP client dependency.
- Handle service-down gracefully (502 response).
- Do not store any state in the orchestrator — it is a pure proxy.

---

### Task 02: Create `TranscriptionJobStore`

**Goal:** Create a Zustand store that tracks transcription jobs per media item. Follows the existing `generation-job-store.ts` pattern.

**Files:**
- Create: `apps/web/src/stores/transcription-job-store.ts`
- Create: `apps/web/src/stores/transcription-job-store.test.ts`

**Reference files:**
- `apps/web/src/stores/generation-job-store.ts` — job state pattern: `queued → running → completed/failed`, progress, result storage
- `apps/web/src/stores/generation-job-store.test.ts` — test patterns for job stores
- `packages/core/src/types/timeline.ts:207-230` — `SubtitleWord`, `Subtitle` interfaces for result types

**TDD steps:**
- [ ] Write failing test: Test the transcription job store:
  - Can create a job for a media item with `status: "queued"`.
  - Can transition job through `startJob` → `updateProgress` → `completeJob`.
  - Can mark a job as `failed` with an error message.
  - `getJob(mediaId)` returns the correct job or `undefined`.
  - `getJobsByStatus("running")` returns only running jobs.
  - `clearCompleted` removes only completed jobs.
  - Store persists via zustand `persist` middleware (same as generation-job-store).
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/transcription-job-store.test.ts`
- [ ] Confirm expected red: FAIL because the store does not exist.
- [ ] Implement production change:

  **`apps/web/src/stores/transcription-job-store.ts`**:
  ```typescript
  import { create } from "zustand";
  import { persist } from "zustand/middleware";

  export type TranscriptionJobStatus =
    | "queued"
    | "transcribing"
    | "completed"
    | "failed";

  export interface TranscriptionJob {
    readonly mediaId: string;
    readonly jobId: string;
    status: TranscriptionJobStatus;
    progress: number;
    error?: string;
    result?: {
      text: string;
      words: Array<{ word: string; start: number; end: number }>;
      language: string;
      duration: number;
    };
  }

  interface TranscriptionJobState {
    jobs: Record<string, TranscriptionJob>;

    createJob: (mediaId: string, jobId: string) => void;
    startJob: (mediaId: string) => void;
    updateProgress: (mediaId: string, progress: number) => void;
    completeJob: (
      mediaId: string,
      result: TranscriptionJob["result"],
    ) => void;
    failJob: (mediaId: string, error: string) => void;
    getJob: (mediaId: string) => TranscriptionJob | undefined;
    getJobsByStatus: (status: TranscriptionJobStatus) => TranscriptionJob[];
    clearCompleted: () => void;
  }

  export const useTranscriptionJobStore = create<TranscriptionJobState>()(
    persist(
      (set, get) => ({
        jobs: {},

        createJob: (mediaId, jobId) =>
          set((state) => ({
            jobs: {
              ...state.jobs,
              [mediaId]: {
                mediaId,
                jobId,
                status: "queued",
                progress: 0,
              },
            },
          })),

        startJob: (mediaId) =>
          set((state) => ({
            jobs: {
              ...state.jobs,
              [mediaId]: { ...state.jobs[mediaId], status: "transcribing", progress: 10 },
            },
          })),

        updateProgress: (mediaId, progress) =>
          set((state) => ({
            jobs: {
              ...state.jobs,
              [mediaId]: { ...state.jobs[mediaId], progress },
            },
          })),

        completeJob: (mediaId, result) =>
          set((state) => ({
            jobs: {
              ...state.jobs,
              [mediaId]: {
                ...state.jobs[mediaId],
                status: "completed",
                progress: 100,
                result,
              },
            },
          })),

        failJob: (mediaId, error) =>
          set((state) => ({
            jobs: {
              ...state.jobs,
              [mediaId]: { ...state.jobs[mediaId], status: "failed", error },
            },
          })),

        getJob: (mediaId) => get().jobs[mediaId],

        getJobsByStatus: (status) =>
          Object.values(get().jobs).filter((j) => j.status === status),

        clearCompleted: () =>
          set((state) => {
            const remaining = Object.fromEntries(
              Object.entries(state.jobs).filter(
                ([_, j]) => j.status !== "completed",
              ),
            );
            return { jobs: remaining };
          }),
      }),
      {
        name: "transcription-jobs",
        partialize: (state) => ({
          // Only persist completed results; volatile state is rebuilt on app start
          jobs: Object.fromEntries(
            Object.entries(state.jobs).filter(
              ([_, j]) => j.status === "completed",
            ),
          ),
        }),
      },
    ),
  );
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/transcription-job-store.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/stores/transcription-job-store.ts apps/web/src/stores/transcription-job-store.test.ts && git commit -m "feat: add transcription job store for async tracking"`

**Acceptance criteria:**
- `createJob(mediaId, jobId)` creates a job in `"queued"` state.
- `startJob(mediaId)` transitions to `"transcribing"`.
- `completeJob(mediaId, result)` transitions to `"completed"` with result payload.
- `failJob(mediaId, error)` transitions to `"failed"` with error message.
- `getJob(mediaId)` returns the job or `undefined`.
- `clearCompleted()` removes only "completed" jobs.
- Only completed jobs survive page reload (persistence partialize).

**Constraints:**
- Idempotent — calling `createJob` twice for the same `mediaId` overwrites the old entry (only one transcription job per media item).
- Do NOT auto-start jobs in this store — the caller (project-store) calls `startJob`.

---

### Task 03: Create transcription API client in web app

**Goal:** A service module that handles communicating with the orchestrator's transcription endpoint — upload audio, poll job status.

**Files:**
- Create: `apps/web/src/services/transcription-client.ts`
- Create: `apps/web/src/services/transcription-client.test.ts`

**Reference files:**
- `apps/web/src/services/wavespeed/index.ts` — pattern for an async API client wrapping an external service
- `apps/web/src/services/api-proxy.ts` — existing fetch wrapper with base URL handling
- `apps/web/src/hooks/useGenerationJobPoller.ts:141-160` — polling pattern

**TDD steps:**
- [ ] Write failing test: Test the transcription client:
  - `submitAudio(blob, fileName)` POSTs a multipart form to `/api/transcribe` and returns `{ jobId, status }`.
  - `pollJob(jobId)` GETs `/api/transcribe/:jobId` and returns job status.
  - Returns completed result when job is done.
  - Throws or returns error shape when the service is unavailable.
  - Accepts optional `language` and `targetLanguage` params.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/services/transcription-client.test.ts`
- [ ] Confirm expected red: FAIL because the client does not exist.
- [ ] Implement production change:

  **`apps/web/src/services/transcription-client.ts`**:
  ```typescript
  const API_BASE = "/api/transcribe";

  export interface SubmitAudioResult {
    jobId: string;
    status: string;
  }

  export interface PollJobResult {
    jobId: string;
    status: string;
    progress?: number;
    result?: {
      text: string;
      words: Array<{ word: string; start: number; end: number }>;
      language: string;
      duration: number;
    };
    error?: string;
  }

  export async function submitAudio(
    blob: Blob,
    fileName: string,
    language?: string,
    targetLanguage?: string,
  ): Promise<SubmitAudioResult> {
    const formData = new FormData();
    formData.append("audio", blob, fileName);

    if (language) formData.append("language", language);
    if (targetLanguage) formData.append("target_language", targetLanguage);

    const response = await fetch(API_BASE, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.error || `Transcription request failed (${response.status})`,
      );
    }

    return response.json();
  }

  export async function pollJob(
    jobId: string,
  ): Promise<PollJobResult> {
    const response = await fetch(`${API_BASE}/${jobId}`);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.error || `Transcription poll failed (${response.status})`,
      );
    }

    return response.json();
  }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/services/transcription-client.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/services/transcription-client.ts apps/web/src/services/transcription-client.test.ts && git commit -m "feat: add transcription API client service"`

**Acceptance criteria:**
- `submitAudio(blob, fileName)` sends multipart POST to orchestrator, returns `{ jobId, status }`.
- `pollJob(jobId)` returns current job status from orchestrator.
- Both functions throw on non-OK responses with the server error message.
- Both functions accept optional language parameters.

**Constraints:**
- Use the orchestrator's `/api/transcribe` path (proxied by the Cloudflare worker or Vite dev proxy).
- No state management in the client — it is a pure I/O module.

---

### Task 04: Hook transcription into `importMedia` in project-store

**Goal:** After `importMedia` successfully adds an audio `MediaItem` to the project, automatically kick off an async transcription job. Results are polled later, but the job is created and tracked here.

**Files:**
- Modify: `apps/web/src/stores/project-store.ts` — add transcription trigger after import
- Modify: `apps/web/src/stores/project-store.test.ts` — add test for auto-transcription trigger

**Reference files:**
- `apps/web/src/stores/project-store.ts:1708-1912` — the `importMedia` implementation, specifically around lines 1780-1796 where `mediaType` is determined as `"audio"`
- `apps/web/src/stores/project-store.ts:1847-1895` — pattern for fire-and-forget background work after import (thumbnail generation via `setTimeout`)
- `apps/web/src/stores/project-store.ts:1812-1845` — where the `MediaItem` is created and added to the project
- `apps/web/src/stores/transcription-job-store.ts` — the new store to create jobs in
- `apps/web/src/services/transcription-client.ts` — the API client `submitAudio`

**Integration point:** The `importMedia` method at line 1786 checks `processedMedia.metadata.hasAudio` to determine `mediaType = "audio"`. After the `MediaItem` is created and added to the store (line 1845), we fire an async transcription job. This mirrors the existing `setTimeout` pattern for background thumbnail generation (line 1858).

**TDD steps:**
- [ ] Write failing test: Test that importing an audio file creates a transcription job:
  - Mock `transcription-client.submitAudio` to return a fake `{ jobId: "test-job", status: "processing" }`.
  - Call `importMedia` with an audio File.
  - Verify `useTranscriptionJobStore.getState().getJob(mediaId)` exists with `status: "queued"`.
  - Verify `submitAudio` was called with the audio blob and filename.
  - Test that importing a video file does NOT create a transcription job.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts`
- [ ] Confirm expected red: FAIL because no transcription trigger exists in `importMedia`.
- [ ] Implement production change:

  **`apps/web/src/stores/project-store.ts`** — add import:
  ```
  [project-store.ts#9853]
  INS.POST 58:
  +import {
  +  submitAudio,
  +} from "../services/transcription-client";
  +import { useTranscriptionJobStore } from "./transcription-job-store";
  ```

  **`apps/web/src/stores/project-store.ts`** — add trigger after `importMedia` success (after the thumbnail background setTimeout block at line 1895, before the return):
  ```
  [project-store.ts#9853]
  INS.POST 1896:
  +          // Auto-transcribe audio files
  +          if (mediaType === "audio") {
  +            const blob = newMediaItem.blob ?? file;
  +            const fileName = newMediaItem.name;
  +
  +            setTimeout(async () => {
  +              try {
  +                const { jobId } = await submitAudio(blob, fileName);
  +                useTranscriptionJobStore
  +                  .getState()
  +                  .createJob(newMediaItem.id, jobId);
  +                useTranscriptionJobStore
  +                  .getState()
  +                  .startJob(newMediaItem.id);
  +              } catch (error) {
  +                useTranscriptionJobStore
  +                  .getState()
  +                  .failJob(
  +                    newMediaItem.id,
  +                    error instanceof Error
  +                      ? error.message
  +                      : "Transcription submission failed",
  +                  );
  +              }
  +            }, 0);
  +          }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/stores/project-store.ts apps/web/src/stores/project-store.test.ts && git commit -m "feat: auto-transcribe audio files on import"`

**Acceptance criteria:**
- Importing an audio file creates a transcription job in the store.
- `submitAudio` is called with the correct blob and filename.
- The job transitions to `"queued"` then `"transcribing"` in the store.
- A failed submission transitions the job to `"failed"`.
- Importing a video file does NOT trigger transcription.
- The audio import itself completes successfully regardless of transcription outcome.

**Constraints:**
- The transcription trigger is fire-and-forget (same `setTimeout` pattern as background thumbnail generation).
- The audio import result does NOT await the transcription — the import always succeeds first.
- Only fire for `mediaType === "audio"`, not for `"video"` or `"image"`.

---

### Task 05: Build `useTranscriptionJobPoller` hook

**Goal:** A React hook that polls all active (transcribing) transcription jobs and updates the store with progress/completion. App-level hook (pairs with `useGenerationJobPoller` in `App.tsx`).

**Files:**
- Create: `apps/web/src/hooks/useTranscriptionJobPoller.ts`
- Create: `apps/web/src/hooks/useTranscriptionJobPoller.test.ts`
- Modify: `apps/web/src/App.tsx` — invoke the new hook alongside `useGenerationJobPoller`

**Reference files:**
- `apps/web/src/hooks/useGenerationJobPoller.ts` — the pattern for polling async jobs
- `apps/web/src/hooks/useGenerationJobPoller.ts:141-160` — the `pollProvider` function pattern
- `apps/web/src/App.tsx:53-54` — where existing pollers are mounted:
  ```
  useKieAIPoller();
  useGenerationJobPoller();
  ```

**TDD steps:**
- [ ] Write failing test: Test the transcription poller:
  - On mount, it queries `getJobsByStatus("transcribing")` and polls each.
  - When poll returns `status: "completed"`, it calls `completeJob` on the store.
  - When poll returns `status: "failed"`, it calls `failJob`.
  - When poll returns `status: "processing"` with progress, it calls `updateProgress`.
  - Uses `vi.useFakeTimers` to verify polling interval.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useTranscriptionJobPoller.test.ts`
- [ ] Confirm expected red: FAIL because the hook does not exist.
- [ ] Implement production change:

  **`apps/web/src/hooks/useTranscriptionJobPoller.ts`**:
  ```typescript
  import { useEffect, useRef } from "react";
  import {
    useTranscriptionJobStore,
  } from "../stores/transcription-job-store";
  import { pollJob } from "../services/transcription-client";

  const POLL_INTERVAL_MS = 3000;

  /**
   * Polls all active (transcribing) transcription jobs at a fixed interval.
   * Mount this once at the app root, like useGenerationJobPoller.
   */
  export function useTranscriptionJobPoller(
    intervalMs = POLL_INTERVAL_MS,
  ): void {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
      const pollActiveJobs = async () => {
        const { getJobsByStatus, completeJob, failJob, updateProgress } =
          useTranscriptionJobStore.getState();

        const activeJobs = getJobsByStatus("transcribing");

        for (const job of activeJobs) {
          try {
            const result = await pollJob(job.jobId);

            if (result.status === "completed" && result.result) {
              // Convert Whisper word-timed results to SubtitleWord format
              const words = (result.result.words || []).map((w) => ({
                word: w.word,
                startTime: w.start,
                endTime: w.end,
              }));

              completeJob(job.mediaId, {
                text: result.result.text,
                words: words,
                language: result.result.language,
                duration: result.result.duration,
              });
            } else if (result.status === "failed") {
              failJob(
                job.mediaId,
                result.error || "Transcription failed",
              );
            } else if (result.progress !== undefined) {
              updateProgress(job.mediaId, result.progress);
            }
          } catch (error) {
            // Network error — keep polling, don't fail the job
            console.warn(
              `[TranscriptionPoller] Failed to poll job ${job.jobId}:`,
              error,
            );
          }
        }
      };

      // Poll immediately on mount, then at interval
      pollActiveJobs();
      intervalRef.current = setInterval(pollActiveJobs, intervalMs);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }, [intervalMs]);
  }
  ```

  **`apps/web/src/App.tsx`** — mount the poller:
  ```
  [App.tsx#3E01]
  INS.POST 13:
  +import { useTranscriptionJobPoller } from "./hooks/useTranscriptionJobPoller";
  ```
  ```
  [App.tsx#3E01]
  INS.POST 54:
  +useTranscriptionJobPoller();
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useTranscriptionJobPoller.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/hooks/useTranscriptionJobPoller.ts apps/web/src/hooks/useTranscriptionJobPoller.test.ts apps/web/src/App.tsx && git commit -m "feat: add transcription job polling hook"`

**Acceptance criteria:**
- Hook polls all jobs with `status === "transcribing"` every 3 seconds.
- Completed jobs update the store with the full result (text, word-timed segments, language).
- Failed jobs update the store with the error.
- Transient network errors log a warning but do NOT transition the job to failed — polling continues.
- Hook is mounted in `App.tsx` alongside `useGenerationJobPoller`.

**Constraints:**
- Network errors are non-fatal — the job stays `"transcribing"` and will be polled again.
- Word timestamps from Whisper are converted to `SubtitleWord` format (`{ word, startTime, endTime }`).

---

### Task 06: Show transcription progress/status in AssetsPanel

**Goal:** When an audio media item has a transcription job, show a small status indicator (spinner during transcribing, check icon when completed, error icon when failed). When completed, allow user to view or import subtitles to the timeline.

**Files:**
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx` — add transcription status badge to audio media items
- Modify or create: `apps/web/src/components/editor/AssetsPanel.test.tsx` — test for transcription badge

**Reference files:**
- `apps/web/src/components/editor/AssetsPanel.tsx` — the media library panel where media items are rendered as thumbnails with metadata. Look for the media item rendering section (likely around the `renderMediaItem` or grid section).
- `apps/web/src/stores/transcription-job-store.ts` — `useTranscriptionJobStore` to read job status per mediaId
- `apps/web/src/components/editor/InspectorPanel.tsx` — see how subtitle data is used elsewhere

**TDD steps:**
- [ ] Write failing test: Test that audio items show transcription status badge:
  - Render AssetsPanel with an audio media item that has no transcription job — no badge shown.
  - Render with a transcription job in `"transcribing"` state — shows a spinner/loading indicator.
  - Render with a `"completed"` job — shows a check icon with "Subtitles ready" tooltip.
  - Render with a `"failed"` job — shows an error icon with "Transcription failed" tooltip.
  - Video items never show transcription badges.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/AssetsPanel.test.tsx`
- [ ] Confirm expected red: FAIL because the badge does not exist.
- [ ] Implement minimal UI change. In the media item rendering area of `AssetsPanel.tsx`, add a status badge overlay:

  ```
  [AssetsPanel.tsx#FA47]
  INS.HEAD:
  +import {
  +  useTranscriptionJobStore,
  +  type TranscriptionJobStatus,
  +} from "../../stores/transcription-job-store";
  ```

  Find the section where each media item thumbnail is rendered (search for the `map` loop over `mediaLibrary.items`). Add after the existing thumbnail/img element:

  ```
  [AssetsPanel.tsx#FA47]
  INS.POST <line after thumbnail render>:
  +          {/* Transcription status badge for audio items */}
  +          <TranscriptionBadge mediaItem={item} />
  ```

  Create a small inline component or import from a new file. Add a new file for cleanliness:

  **Create `apps/web/src/components/editor/TranscriptionBadge.tsx`**:
  ```tsx
  import { useTranscriptionJobStore } from "../../stores/transcription-job-store";
  import type { MediaItem } from "@openreel/core";
  import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

  interface TranscriptionBadgeProps {
    mediaItem: MediaItem;
  }

  export function TranscriptionBadge({ mediaItem }: TranscriptionBadgeProps) {
    if (mediaItem.type !== "audio") return null;

    const job = useTranscriptionJobStore((s) => s.jobs[mediaItem.id]);
    if (!job || job.status === "queued") return null;

    const iconMap: Record<string, React.ReactNode> = {
      transcribing: (
        <div className="flex items-center gap-1 text-xs text-blue-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{job.progress}%</span>
        </div>
      ),
      completed: (
        <div className="flex items-center gap-1 text-xs text-green-500" title="Subtitles ready — click to import">
          <CheckCircle2 className="w-3 h-3" />
          <span>SRT</span>
        </div>
      ),
      failed: (
        <div className="flex items-center gap-1 text-xs text-red-500" title={job.error || "Transcription failed"}>
          <AlertCircle className="w-3 h-3" />
          <span>Failed</span>
        </div>
      ),
    };

    return (
      <div className="absolute bottom-1 left-1 right-1 flex justify-center">
        {iconMap[job.status]}
      </div>
    );
  }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/AssetsPanel.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/TranscriptionBadge.tsx apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/components/editor/AssetsPanel.test.tsx && git commit -m "feat: show transcription status in asset thumbnails"`

**Acceptance criteria:**
- Audio items with an active transcription show a spinning loader + percentage.
- Audio items with completed transcription show a green check + "SRT" label.
- Audio items with failed transcription show a red error icon + "Failed" label.
- Video and image items never show transcription badges.
- No badge is shown for audio items without a transcription job.

**Constraints:**
- Badge is read-only status display (subtitles are auto-imported — see Task 08 integration; clicking to import is a future enhancement).
- Must not break existing media item rendering (layers cleanly as a positioned overlay on the thumbnail).

---

### Task 07: Handle transcription errors gracefully

**Goal:** When a transcription job fails, the audio file remains in the library. Provide a "Retry" action in the UI and ensure no orphan state remains.

**Files:**
- Modify: `apps/web/src/stores/transcription-job-store.ts` — add `retryJob` action
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx` or `TranscriptionBadge.tsx` — add retry button on failed state

**Reference files:**
- `apps/web/src/stores/transcription-job-store.ts` — existing store actions
- `apps/web/src/stores/project-store.ts:1858-1895` — fire-and-forget pattern for re-triggering background work
- `apps/web/src/services/transcription-client.ts:submitAudio` — the function to re-submit

**TDD steps:**
- [ ] Write failing test: Test error handling:
  - A failed job can be retried via `retryJob(mediaId)` — resets to `"queued"`, clears error, creates a new backend job.
  - A failed job's `error` is displayed in the badge tooltip.
  - When a job fails, the `MediaItem` is NOT removed from the library.
  - Calling `retryJob` on a completed job is a no-op.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/transcription-job-store.test.ts`
- [ ] Confirm expected red: FAIL because `retryJob` does not exist.
- [ ] Implement production changes:

  **`apps/web/src/stores/transcription-job-store.ts`** — add action:
  ```
  [transcription-job-store.ts]
  INS.POST 36:
  +  retryJob: (mediaId: string) => Promise<void>;
  ```

  Add implementation alongside other actions:
  ```
  [transcription-job-store.ts]
  INS.POST 114:
  +        retryJob: async (mediaId) => {
  +          const job = get().jobs[mediaId];
  +          if (!job || job.status === "completed") return;
  +
  +          // Reset to queued — caller triggers the actual API submission
  +          set((state) => ({
  +            jobs: {
  +              ...state.jobs,
  +              [mediaId]: {
  +                ...job,
  +                status: "queued",
  +                progress: 0,
  +                error: undefined,
  +                jobId: "", // cleared; new jobId assigned on resubmit
  +              },
  +            },
  +          }));
  +        },
  ```

  **Modify `TranscriptionBadge.tsx`** — make the failed badge clickable:
  ```
  [TranscriptionBadge.tsx]
  SWAP.BLK 31:
  +    <button
  +      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400"
  +      title={job.error || "Transcription failed — click to retry"}
  +      onClick={(e) => {
  +        e.stopPropagation();
  +        // Re-submit transcription via project-store's internal method
  +        useTranscriptionJobStore.getState().retryJob(mediaItem.id);
  +        if (mediaItem.blob) {
  +          import("../../services/transcription-client").then(
  +            async ({ submitAudio }) => {
  +              try {
  +                const { jobId } = await submitAudio(
  +                  mediaItem.blob!,
  +                  mediaItem.name,
  +                );
  +                useTranscriptionJobStore
  +                  .getState()
  +                  .createJob(mediaItem.id, jobId);
  +                useTranscriptionJobStore
  +                  .getState()
  +                  .startJob(mediaItem.id);
  +              } catch (error) {
  +                useTranscriptionJobStore
  +                  .getState()
  +                  .failJob(
  +                    mediaItem.id,
  +                    error instanceof Error
  +                      ? error.message
  +                      : "Retry failed",
  +                  );
  +              }
  +            },
  +          );
  +        }
  +      }}
  +    >
  ```
- [ ] Re-run tests and confirm PASS.
- [ ] Commit: `git add apps/web/src/stores/transcription-job-store.ts apps/web/src/components/editor/TranscriptionBadge.tsx && git commit -m "feat: handle transcription failures without losing audio import"`

**Acceptance criteria:**
- Failed transcription does NOT remove the audio from the media library.
- Failed badge shows error message in tooltip.
- Clicking a failed badge triggers a retry — resets job to queued, re-submits audio, creates new backend job.
- Retrying a completed or non-existent job is a no-op.

**Constraints:**
- Retry uses the same `submitAudio` client — no new API surface.
- Must preserve `e.stopPropagation()` so clicking retry doesn't also select the media item.

---

### Task 08: Integrate completed transcription into project subtitles

**Goal:** When a transcription job completes, automatically import the generated word-timed subtitles into the project's timeline as `Subtitle` entries. This makes subtitles immediately usable on a subtitle track without manual SRT import.

**Files:**
- Modify: `apps/web/src/hooks/useTranscriptionJobPoller.ts` — add subtitle import on completion
- Modify: `apps/web/src/hooks/useTranscriptionJobPoller.test.ts` — verify subtitle creation on completion

**Reference files:**
- `packages/core/src/types/timeline.ts:207-230` — `Subtitle`, `SubtitleWord` interfaces. Note that `Subtitle.text` is the full segment text, and `Subtitle.words` is an array of word-timed `SubtitleWord` objects.
- `apps/web/src/stores/project-store.ts:4883-4931` — `addSubtitle` method (creates a text clip on a "Captions" subtitle track)
- `apps/web/src/services/transcription-client.ts:22-30` — the `PollJobResult.result` shape: `{ text, words: [{ word, start, end }], language, duration }`
- `apps/web/src/hooks/useTranscriptionJobPoller.ts` — where jobs transition to completed

**Key design decision:** Whisper returns word-by-word timestamps. We need to group contiguous words into subtitle segments. A simple strategy: group words into segments of at most N words OR when a gap of >0.5s exists between words. This is a heuristic that works well for most content; the user can adjust in the subtitle editor later.

**TDD steps:**
- [ ] Write failing test: Test that on transcription completion, subtitles are added to the project:
  - Mock `useProjectStore.getState().addSubtitle`.
  - Simulate a completed transcription job with words.
  - Verify `addSubtitle` is called for each generated segment with correct `text`, `startTime`, `endTime`.
  - Verify `addSubtitle` is NOT called when the transcription has no words.
  - Verify that words within 0.5s of each other are grouped into the same segment.
  - Test that a job is only processed once (idempotent — if already completed, skip).
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useTranscriptionJobPoller.test.ts`
- [ ] Confirm expected red: FAIL because subtitle import logic is not implemented.
- [ ] Implement production change:

  **`apps/web/src/hooks/useTranscriptionJobPoller.ts`** — add word-grouping and subtitle creation logic. Create a helper function and wire it into the completion handler:

  ```typescript
  // Add import at top
  import { useProjectStore } from "../stores/project-store";
  import { v4 as uuidv4 } from "uuid";
  import type { SubtitleWord } from "@openreel/core";

  const SEGMENT_GAP_THRESHOLD = 0.5; // seconds
  const MAX_WORDS_PER_SEGMENT = 20;

  /**
   * Groups Whisper word-timed results into subtitle segments.
   * A new segment is started when either:
   * - The gap between consecutive words exceeds SEGMENT_GAP_THRESHOLD
   * - The segment would exceed MAX_WORDS_PER_SEGMENT
   */
  function groupWordsIntoSegments(
    words: Array<{ word: string; start: number; end: number }>,
  ): Array<{
    text: string;
    startTime: number;
    endTime: number;
    words: SubtitleWord[];
  }> {
    if (words.length === 0) return [];

    const segments: Array<{
      text: string;
      startTime: number;
      endTime: number;
      words: SubtitleWord[];
    }> = [];

    let currentWords: Array<{ word: string; start: number; end: number }> = [];

    for (const w of words) {
      if (currentWords.length > 0) {
        const lastWord = currentWords[currentWords.length - 1];
        const gap = w.start - lastWord.end;

        if (
          gap > SEGMENT_GAP_THRESHOLD ||
          currentWords.length >= MAX_WORDS_PER_SEGMENT
        ) {
          // Flush current segment
          segments.push({
            text: currentWords.map((cw) => cw.word).join(" "),
            startTime: currentWords[0].start,
            endTime: currentWords[currentWords.length - 1].end,
            words: currentWords.map((cw) => ({
              word: cw.word,
              startTime: cw.start,
              endTime: cw.end,
            })),
          });
          currentWords = [];
        }
      }

      currentWords.push(w);
    }

    // Flush last segment
    if (currentWords.length > 0) {
      segments.push({
        text: currentWords.map((cw) => cw.word).join(" "),
        startTime: currentWords[0].start,
        endTime: currentWords[currentWords.length - 1].end,
        words: currentWords.map((cw) => ({
          word: cw.word,
          startTime: cw.start,
          endTime: cw.end,
        })),
      });
    }

    return segments;
  }
  ```

  Wire it into the completion handler (replace the `completeJob` call block):

  ```
  [useTranscriptionJobPoller.ts]
  SWAP.BLK 47: // Replace the `if (result.status === "completed")` block
  +            if (result.status === "completed" && result.result) {
  +              const words = (result.result.words || []).map((w) => ({
  +                word: w.word,
  +                start: w.start,
  +                end: w.end,
  +              }));
  +
  +              // Store the raw result
  +              completeJob(job.mediaId, {
  +                text: result.result.text,
  +                words: words,
  +                language: result.result.language,
  +                duration: result.result.duration,
  +              });
  +
  +              // Import word-timed segments as project subtitles
  +              if (words.length > 0) {
  +                const segments = groupWordsIntoSegments(words);
  +                const { addSubtitle } = useProjectStore.getState();
  +                for (const seg of segments) {
  +                  await addSubtitle({
  +                    id: uuidv4(),
  +                    text: seg.text,
  +                    startTime: seg.startTime,
  +                    endTime: seg.endTime,
  +                    words: seg.words,
  +                    animationStyle: "word-highlight",
  +                  });
  +                }
  +              }
  +            }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/hooks/useTranscriptionJobPoller.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/hooks/useTranscriptionJobPoller.ts apps/web/src/hooks/useTranscriptionJobPoller.test.ts && git commit -m "feat: auto-import word-timed subtitles from transcription"`

**Acceptance criteria:**
- When a transcription completes, word-timed segments are added to the project as `Subtitle` entries.
- Words within 0.5s or fewer than 20 words are grouped into the same subtitle segment.
- Each subtitle has `words[]` populated for highlighting support.
- Subtitles use `animationStyle: "word-highlight"` for karaoke-style highlighting.
- Transcription with no words does NOT create subtitles.
- A job is only processed once (subsequent polls of the same completed job are idempotent).

**Constraints:**
- Uses the existing `addSubtitle` method on project-store, which creates text clips on a "Captions" subtitle track.
- The grouping heuristic (0.5s gap, 20 word max) should be adjustable via constants.
- No changes to the core `Subtitle` type.

---

## Integration / smoke test

After all tasks are implemented, run a manual E2E smoke test:

```bash
# 1. Start the transcribe service (requires Docker with GPU or CPU fallback)
cd infra/transcribe-gpu
docker compose -f docker-compose.cpu.yml up -d  # CPU mode for testing

# 2. Start the orchestrator
cd apps/orchestrator
TRANSCRIBE_SERVICE_URL=http://localhost:8000 pnpm dev

# 3. Start the web app
cd apps/web
pnpm dev

# 4. In the browser, open the editor → Assets panel → import test-tone.wav or any audio file.
# 5. Verify:
#    - Audio appears in media library
#    - Transcription badge shows spinning loader
#    - Within a few seconds, badge shows green check
#    - A "Captions" track appears with word-timed subtitle clips
#    - Playback shows word-highlighting on the preview
```

Run all project-store transcription tests:
```bash
pnpm --filter @openreel/web test:run --reporter=verbose apps/web/src/stores/transcription-job-store.test.ts apps/web/src/services/transcription-client.test.ts apps/web/src/hooks/useTranscriptionJobPoller.test.ts
```

---

## Risks and unresolved decisions

1. **Transcribe service availability:** The GPU transcribe service (`infra/transcribe-gpu/`) requires Docker and a GPU for reasonable performance. The CPU Dockerfile exists but is slow. For production, either ensure the service runs on the same host as the orchestrator or make the orchestrator itself run faster-whisper directly (bypassing the proxy). This plan chose the proxy approach to keep concerns separated.
2. **Word grouping heuristic:** The 0.5s gap / 20 word max segment heuristic works for typical speech but may produce excessively long or short segments for fast/slow speech. This can be tuned after user feedback.
3. **Duplicate subtitles on retry:** If a user retries a failed job after it already created some subtitles (unlikely but possible), those subtitles would be duplicated. The plan assumes retry always starts fresh because `retryJob` resets to `"queued"` and the poller won't process the job until it's `"transcribing"` again.
4. **Browser memory:** The transcription client uploads the full audio blob to the orchestrator. For very long audio files (>1 hour), this could be a large upload. Consider chunked upload or streaming as a future optimization.
5. **MediaItem blob availability:** The `MediaItem.blob` field may be null for project media loaded from disk (not freshly imported). The plan accesses `newMediaItem.blob ?? file` in the import path, which is safe for fresh imports. For persisted projects with existing audio, transcription would need to be triggered differently (future work).
