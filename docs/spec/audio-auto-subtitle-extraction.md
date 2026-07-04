# Audio Auto-Subtitle Extraction Operational Specification

**Version:** 1.0  
**Date:** 2026-07-04  
**Status:** Active

---

## Overview

The Audio Auto-Subtitle Extraction system automatically transcribes audio media (MP3, WAV, AAC, OGG, FLAC) upon import using a GPU-accelerated transcription service. Transcription is asynchronous and fire-and-forget; the audio import always succeeds regardless of transcription outcome. Completed transcriptions are automatically imported as `SubtitleClip` instances on the project's subtitle track, providing immediate subtitle editing and export capabilities.

---

## Scope

This specification covers:

- Audio file detection and automatic transcription triggering on import
- Orchestrator proxy API routes for transcription job submission and polling
- Async transcription job lifecycle management and state persistence
- Real-time progress reporting and status badges in the Assets Panel
- Graceful error handling without data loss
- Automatic subtitle generation and integration with the subtitle track system

**Out of scope:**
- Manual transcription triggering (future enhancement)
- Language detection or translation (baseline uses detected language)
- Custom word grouping heuristics (deferred to user edit after import)
- SRT file format changes (see [subtitle-track-clip-type](#cross-references) spec)

---

## Architecture

### High-level Flow

```
Audio Import
    ↓
[Audio MediaItem created in project]
    ↓
[Background: submitAudio to orchestrator]
    ↓
[TranscriptionJobStore: queued → transcribing]
    ↓
[useTranscriptionJobPoller: polls orchestrator every 3s]
    ↓
[Transcription completes with word-timed Whisper results]
    ↓
[AutoGroupWordSegments: cluster words into subtitle segments]
    ↓
[addSubtitle called for each segment → SubtitleClip on timeline]
    ↓
[AssetsPanel badge changes: spinner → check icon]
```

### Key Components

| Component | Location | Role |
|-----------|----------|------|
| **Orchestrator Routes** | `apps/orchestrator/src/routes/transcribe.ts` | Proxy `POST /api/transcribe` and `GET /api/transcribe/:jobId` to GPU service |
| **TranscriptionJobStore** | `apps/web/src/stores/transcription-job-store.ts` | Zustand store tracking job states (queued → transcribing → completed/failed) |
| **transcription-client** | `apps/web/src/services/transcription-client.ts` | HTTP client; exposes `submitAudio()` and `pollJob()` |
| **useTranscriptionJobPoller** | `apps/web/src/hooks/useTranscriptionJobPoller.ts` | App-level React hook; polls active jobs, converts results to SubtitleClip data |
| **TranscriptionBadge** | `apps/web/src/components/editor/TranscriptionBadge.tsx` | UI overlay on audio thumbnails showing transcription status |
| **project-store** | `apps/web/src/stores/project-store.ts` | Triggers transcription on audio import; calls subtitle helpers on completion |

---

## Data Model

### TranscriptionJob

```typescript
interface TranscriptionJob {
  readonly mediaId: string;           // ID of the audio MediaItem
  readonly jobId: string;              // Backend job identifier from transcribe service
  status: TranscriptionJobStatus;      // "queued" | "transcribing" | "completed" | "failed"
  progress: number;                    // 0–100, updated during transcription
  error?: string;                      // Error message if status === "failed"
  result?: {
    text: string;                      // Full transcribed text
    words: Array<{
      word: string;
      start: number;                   // Start time (seconds)
      end: number;                     // End time (seconds)
    }>;
    language: string;                  // Detected or specified language (ISO 639-1)
    duration: number;                  // Total audio duration (seconds)
  };
}
```

### SubtitleSegment (derived from word grouping)

After transcription completes, the `useTranscriptionJobPoller` groups contiguous words into segments using the heuristic:
- **Gap threshold:** Gap > 0.5 seconds between words starts a new segment
- **Word limit:** Segments capped at 20 words (prevents overly long single subtitles)

Each segment becomes a `SubtitleClip` with:
- `text`: concatenated words (space-separated)
- `startTime`: first word's `start` time
- `endTime`: last word's `end` time
- `words`: word-timed array for animated captions (karaoke, typewriter, etc.)

---

## API Contracts

### Orchestrator Routes

#### POST `/api/transcribe`

**Purpose:** Submit audio for transcription.

**Request:**
```
POST /api/transcribe HTTP/1.1
Content-Type: multipart/form-data

---boundary
Content-Disposition: form-data; name="audio"; filename="track.mp3"
Content-Type: audio/mpeg

[binary audio data]
---boundary
Content-Disposition: form-data; name="language"

en
---boundary--
```

**Optional fields:**
- `language`: ISO 639-1 code (e.g., "en", "es", "fr"). Helps Whisper; defaults to auto-detect.
- `target_language`: ISO 639-1 code. If provided, translates transcript to target language (GPU service feature).

**Response (200 OK):**
```json
{
  "jobId": "job-abc123def456",
  "status": "processing"
}
```

**Error responses:**
- `400 Bad Request`: Missing or invalid audio.
- `502 Bad Gateway`: Transcription service unavailable.

---

#### GET `/api/transcribe/:jobId`

**Purpose:** Poll a transcription job's status and retrieve results.

**Response (200 OK):**

*While transcribing:*
```json
{
  "jobId": "job-abc123def456",
  "status": "processing",
  "progress": 45
}
```

*Completed:*
```json
{
  "jobId": "job-abc123def456",
  "status": "completed",
  "progress": 100,
  "result": {
    "text": "Hello world. This is a test.",
    "words": [
      { "word": "Hello", "start": 0.1, "end": 0.5 },
      { "word": "world", "start": 0.6, "end": 1.0 },
      { "word": "This", "start": 1.2, "end": 1.5 },
      { "word": "is", "start": 1.6, "end": 1.8 },
      { "word": "a", "start": 1.9, "end": 2.0 },
      { "word": "test", "start": 2.1, "end": 2.5 }
    ],
    "language": "en",
    "duration": 2.5
  }
}
```

*Failed:*
```json
{
  "jobId": "job-abc123def456",
  "status": "failed",
  "error": "Audio format not supported"
}
```

---

## Lifecycle

### TranscriptionJob State Machine

```
┌──────────┐
│  queued  │  [Created when audio import begins]
└────┬─────┘
     │ [submitAudio succeeds]
     ▼
┌──────────────┐
│ transcribing │  [Job queued at GPU service; polling begins]
└────┬─────────┘
     │
     ├─ [progress updates 10–90%]
     │
     ├─ [status: "completed", result received]
     │  ▼
     │ ┌───────────┐
     │ │ completed │  [Word grouping → subtitle segments created]
     │ └───────────┘
     │
     └─ [status: "failed" or network error]
        ▼
     ┌────────┐
     │ failed │  [Retry action available; audio remains in library]
     └────────┘
```

### Retry Behavior

When a job fails (or polling times out):

1. User clicks the "Failed" badge in AssetsPanel
2. `useTranscriptionJobStore.retryJob(mediaId)` resets the job to `"queued"`, clears error
3. `submitAudio` is called again with the same audio blob
4. New `jobId` is assigned; polling resumes

**Invariant:** The audio `MediaItem` is **never removed** during transcription failure.

---

## Job Store (Zustand)

**File:** `apps/web/src/stores/transcription-job-store.ts`

**State:**
```typescript
interface TranscriptionJobState {
  jobs: Record<string, TranscriptionJob>;  // Keyed by mediaId

  // Actions
  createJob(mediaId: string, jobId: string): void;
  startJob(mediaId: string): void;
  updateProgress(mediaId: string, progress: number): void;
  completeJob(mediaId: string, result: TranscriptionJob["result"]): void;
  failJob(mediaId: string, error: string): void;
  retryJob(mediaId: string): void;
  getJob(mediaId: string): TranscriptionJob | undefined;
  getJobsByStatus(status: TranscriptionJobStatus): TranscriptionJob[];
  clearCompleted(): void;
}
```

**Persistence:**
- Zustand `persist` middleware stores jobs in localStorage.
- **Partialize:** Only `"completed"` and `"failed"` jobs persist; `"queued"` and `"transcribing"` are transient and rebuilt on app load.
- **Storage key:** `"transcription-jobs"`

**Rationale:** Users may close the app during transcription; completed results are preserved for reference, but active polling resumes from scratch on reload.

---

## Client Service

**File:** `apps/web/src/services/transcription-client.ts`

**Public API:**
```typescript
async function submitAudio(
  blob: Blob,
  fileName: string,
  language?: string,
  targetLanguage?: string,
): Promise<{ jobId: string; status: string }>;

async function pollJob(jobId: string): Promise<{
  jobId: string;
  status: string;
  progress?: number;
  result?: TranscriptionJob["result"];
  error?: string;
}>;
```

**Constraints:**
- Stateless; no side effects
- Uses native `fetch` (Node 18+)
- Handles HTTP errors by throwing with descriptive messages
- No retry logic in the client; retries handled at the hook level

---

## Polling Hook

**File:** `apps/web/src/hooks/useTranscriptionJobPoller.ts`

**Behavior:**
1. Mounts at app root (alongside `useGenerationJobPoller`)
2. Every 3 seconds (configurable via `intervalMs` param), queries `getJobsByStatus("transcribing")`
3. For each active job, calls `pollJob(jobId)`
4. **On completion:** Calls `completeJob()` with result; **triggers subtitle import** (see below)
5. **On failure:** Calls `failJob()` with error message
6. **On transient network error:** Logs warning; keeps polling (non-fatal)

**Word Grouping Logic:**
When a job completes, the poller calls `autoGroupWordSegments()` which:
- Iterates through words in order
- Groups words into segments when:
  - Gap between consecutive words exceeds 0.5 seconds, OR
  - Segment would contain > 20 words
- Returns array of `{ text, words, startTime, endTime }` segments ready for `addSubtitle()`

**Subtitle Auto-Import:**
After grouping, the poller calls `useProjectStore.getState().addSubtitle()` for each segment:
```typescript
addSubtitle({
  text: segment.text,
  startTime: segment.startTime,
  endTime: segment.endTime,
  words: segment.words,  // Preserves word timing for animations
  style: DEFAULT_SUBTITLE_STYLE,
});
```

This creates `SubtitleClip` instances on the project's `"subtitle"` track (see [subtitle-track-clip-type](#cross-references) spec).

---

## Project Store Integration

**File:** `apps/web/src/stores/project-store.ts`

### importMedia Trigger

When `importMedia()` completes for an audio file:

1. Check `mediaType === "audio"`
2. Extract blob: `const blob = newMediaItem.blob ?? file`
3. Fire background job (no await) via `setTimeout(..., 0)`:
   ```typescript
   setTimeout(async () => {
     try {
       const { jobId } = await submitAudio(blob, newMediaItem.name);
       useTranscriptionJobStore.getState().createJob(newMediaItem.id, jobId);
       useTranscriptionJobStore.getState().startJob(newMediaItem.id);
     } catch (error) {
       useTranscriptionJobStore
         .getState()
         .failJob(newMediaItem.id, error.message);
     }
   }, 0);
   ```

**Invariant:** Import completes and returns successfully **before** `submitAudio` is called. If transcription submission fails, the audio remains in the library.

---

## UI: AssetsPanel Status Badge

**File:** `apps/web/src/components/editor/TranscriptionBadge.tsx`

**Behavior:**
- Rendered as an overlay on audio media items
- **No job or "queued":** No badge shown
- **"transcribing":** Spinner + progress percentage (blue)
- **"completed":** Check icon + "SRT" label (green); tooltip "Subtitles ready"
- **"failed":** Error icon + "Failed" label (red); tooltip shows error message; clickable to retry
- **Non-audio items:** No badge

**Styling:**
- Positioned absolute bottom-left of thumbnail
- Icons from `lucide-react` (Loader2, CheckCircle2, AlertCircle)
- Smooth transitions on status change

**Retry Interaction:**
On click of failed badge:
1. `stopPropagation()` prevents media item selection
2. `retryJob(mediaId)` resets job state
3. `submitAudio` re-submitted inline (not via project-store, to preserve isolated retry logic)
4. New `jobId` assigned; badge updates to spinner

---

## Error Handling

### Transcription Submission Failure

**Scenario:** `submitAudio()` throws (network down, malformed audio, etc.)

**Behavior:**
- Job transitions to `"failed"` with error message
- Audio `MediaItem` remains in library
- User sees red badge with retry button
- Retry is triggered by clicking badge

### Polling Failures

**Scenario:** `pollJob()` throws (transient network error, service hiccup)

**Behavior:**
- Warning logged to console
- Job **remains** in `"transcribing"` state
- Polling continues on next interval
- No user-visible error (non-fatal; expected to recover)

### Service Unavailable

**Scenario:** Transcription service (GPU instance) is offline

**Behavior:**
- Initial `submitAudio` returns `502 Bad Gateway` from orchestrator
- Job fails immediately
- User sees error badge; can retry once service is up

### Incomplete Results

**Scenario:** Job completes but `result` field is null or `words` array is empty

**Behavior:**
- `completeJob()` is still called (status transitions to completed)
- Subtitle auto-import is **skipped** (no words to group)
- Badge shows check mark, but no subtitles are added to timeline
- User can manually re-trigger via UI (future enhancement)

---

## Constraints and Assumptions

### Audio Detection

- Audio files are identified by `processedMedia.metadata.hasAudio === true`
- Supported formats: MP3, WAV, AAC, OGG, FLAC (as per `infra/transcribe-gpu` capabilities)
- Transcription is triggered **only** if `mediaType === "audio"` (not for video with audio track)

### Blob Availability

- For freshly imported audio: `newMediaItem.blob` is set from the upload
- For existing projects loaded from disk: `MediaItem.blob` may be null (blobs are not persisted)
- The code uses `newMediaItem.blob ?? file` which is safe for fresh imports; retry on persisted projects is a future enhancement

### Whisper Output Format

- Whisper returns word-level timestamps (`start`, `end` in seconds)
- Language is auto-detected or specified via request
- Translation (if requested) yields target-language text but original word timings

### Subtitle Track Assumption

- Project MUST have or create a `"subtitle"` track to accept auto-imported subtitles
- The `addSubtitle()` method in project-store creates this track if missing (existing behavior)
- See [subtitle-track-clip-type](#cross-references) for track/clip semantics

---

## Configuration

**Environment Variables:**

| Variable | Scope | Default | Purpose |
|----------|-------|---------|---------|
| `TRANSCRIBE_SERVICE_URL` | Orchestrator | `http://localhost:8000` | GPU transcription service base URL |

**Hard-coded Constants:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `POLL_INTERVAL_MS` | 3000 | Polling interval (3 seconds) |
| `SEGMENT_GAP_THRESHOLD` | 0.5 | Gap (seconds) to split segments |
| `MAX_WORDS_PER_SEGMENT` | 20 | Max words per subtitle segment |

---

## Testing Strategy

### Unit Tests

- **transcription-job-store.test.ts:** State transitions, persistence, idempotency
- **transcription-client.test.ts:** HTTP mocking, error handling, multipart form encoding
- **useTranscriptionJobPoller.test.ts:** Polling loop, job completion handling, word grouping
- **TranscriptionBadge.test.tsx:** Badge rendering, retry button interaction

### Integration Tests

- **project-store.test.ts:** Audio import triggers transcription; non-audio files do not
- **App.tsx:** Poller hook is mounted and active
- **End-to-end scenario:** Import audio → job polls → completion → subtitles appear on timeline (manual; requires transcribe service running)

---

## Future Enhancements

- **Manual transcription trigger:** Button in AssetsPanel to transcribe existing audio without re-importing
- **Language selection:** Dropdown to specify language before import (currently auto-detected)
- **Translation:** UI to request target-language transcription
- **Custom word grouping:** Inspector panel with manual segment editor after auto-grouping
- **Whisper model selection:** Switch between base/small/medium/large models (performance vs. accuracy)
- **Batch transcription:** Queue multiple audio files for concurrent processing
- **Webhook callbacks:** Real-time updates via WebSocket instead of polling

---

## Cross-References

- **[subtitle-track-clip-type](./subtitle-track-clip-type.md):** First-class `SubtitleClip` type, subtitle track rendering, and inspector panel. This spec's auto-imported subtitles create `SubtitleClip` instances per the contracts in that spec.
- **[2026-07-03-audio-auto-subtitle-extraction.md](../superpowers/plans/2026-07-03-audio-auto-subtitle-extraction.md):** Implementation plan with 8 atomic tasks, TDD steps, and code snippets.
- **[2026-07-03-subtitle-track-clip-type.md](../superpowers/plans/2026-07-03-subtitle-track-clip-type.md):** Domain model for subtitles, track/clip architecture, and timeline rendering.
- **Core types:** `packages/core/src/types/timeline.ts` (`Subtitle`, `SubtitleWord`, `SubtitleStyle`, `Track`, `Clip`)
- **GPU service:** `infra/transcribe-gpu/main.py` — Whisper-based transcription with word-level timing

---

## Glossary

- **Transcription job:** Async task in the GPU service; identified by unique `jobId`
- **Word grouping:** Heuristic to cluster Whisper word-level output into user-facing subtitle segments
- **SubtitleClip:** First-class clip type on subtitle tracks (new; see subtitle-track-clip-type spec)
- **Fire-and-forget:** Background work that does not block the main operation (audio import)
- **Polling:** Periodic HTTP GET to check job status (3-second interval)
- **Partialize:** Zustand middleware feature to selectively persist state fields

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-04 | Spec Writer | Initial operational spec from plan documents |

