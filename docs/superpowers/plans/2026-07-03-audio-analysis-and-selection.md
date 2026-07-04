# Audio Analysis and Manual Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an audio analysis pipeline (genre classification, beat grid, section-aligned sentiment series, mood, librosa energy features) with a Python/librosa sidecar service, and a UI for manually picking which analysis results to apply as timeline metadata (beat markers, energy segments, section sentiment curves, mood labels, genre tags).

**Architecture:** A Python FastAPI microservice (paralleling `infra/transcribe-gpu/`) accepts audio files and returns structured analysis JSON. The Express orchestrator proxies requests and caches results per media item. A new `AudioAnalysisBridge` (paralleling `BeatSyncBridge`) manages state on the frontend. A new `AudioAnalysisSection` renders in the clip inspector (`AudioTab`) and the asset inspector (`AssetInspectorWithTabs`). Users can "Apply" individual analysis results (beats → `timeline.beatMarkers`, energy → clip markers, genre → `MediaMetadata`, section sentiment series → confirmed section metadata, mood → clip tags). Section-aware sentiment depends on the section identification flow in `2026-07-03-section-identification-flow.md`; it must emit one or more sentiment frames per confirmed section rather than one media-level value.

**Tech Stack:** Python 3.11+ librosa, FastAPI, uvicorn; Express route proxy; `@openreel/core` types; React + Zustand + Vitest + Tailwind; `wavesurfer.js` (already present for waveform display).

---

## Execution contract

- One task = one atomic commit.
- Each task uses TDD: write the failing test, run it and record the expected failure, implement minimum code, run passing test, commit.
- Do not batch unrelated tasks into one commit.
- Do not modify `@openreel/music-video-domain` package unless explicitly listed.
- The Python service lives in `infra/audio-analysis/` mirroring `infra/transcribe-gpu/`.
- The bridge class follows the `BeatSyncBridge` singleton + subscribe pattern exactly.
- Analysis data flows: Python service → orchestrator proxy → frontend bridge → store → UI.

## Section-aware revision

- Sentiment analysis is a time series, not a single media-level label.
- Sentiment frames should roughly align with confirmed song sections (`Intro`, `Verse 1`, `Chorus 1`, etc.) from `2026-07-03-section-identification-flow.md`.
- The audio analysis service may compute raw sentiment windows, but the frontend/store contract persists them as `SectionSentimentFrame[]` keyed by section ID and bounded by section `startSeconds`/`endSeconds`.
- Overall mood can still be a summary label, but storyboard generation must use the per-section sentiment curve.


## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Extend `MediaMetadata` with genre, mood, energy, sentiment fields | none | false | `feat: add audio analysis fields to MediaMetadata` |
| 02 | Create `AudioAnalysisResult` types and timeline integration types | 01 | false | `feat: add AudioAnalysisResult types` |
| 03 | Build Python librosa analysis service in `infra/audio-analysis/` | none | true | `feat: add librosa audio analysis microservice` |
| 04 | Add orchestrator proxy route for audio analysis | 03 | false | `feat: add /api/analyze/audio route to orchestrator` |
| 05 | Build `AudioAnalysisBridge` frontend service (singleton + subscribe) | 02 | false | `feat: add AudioAnalysisBridge for frontend analysis state` |
| 06 | Add `analyzeAudio` action to project store | 05 | false | `feat: wire analyzeAudio into project store` |
| 07 | Build `AudioAnalysisSection` UI component for clip inspector | 02, 05 | true | `feat: add AudioAnalysisSection to clip inspector AudioTab` |
| 08 | Extend asset inspector `AudioTab` with analysis controls | 05, 07 | false | `feat: add analysis controls to asset inspector AudioTab` |
| 09 | Add timeline energy overlay component | 02 | true | `feat: add EnergyMarkerOverlay for timeline` |
| 10 | Add "Apply Analysis" wiring (beats→timeline, genre→metadata, etc.) | 07, 08, 09 | false | `feat: wire analysis apply to timeline and media metadata` |
| 11 | Run end-to-end integration test | 10 | false | `chore: verify audio analysis workflow` |

---

## Atomic task plans

### Task 01: Extend `MediaMetadata` with genre, mood, energy, and section sentiment fields

**Goal:** Add new optional fields to `MediaMetadata` for storing computed audio analysis results. Sentiment is stored as section-aligned frames, not as one scalar/string.

**Files:**
- Modify: `packages/core/src/types/project.ts:83-102`

**Reference files:**
- `packages/core/src/types/project.ts` — `MediaMetadata` (lines 83-102)

**TDD steps:**
- [ ] Write a type-level test that creates a `MediaMetadata` object with the new fields and asserts the shape is valid.
  - Test file: `packages/core/src/types/project.test.ts` (create if absent)
  - Test: assert `metadata.genre` is string | undefined, `metadata.mood` is string | undefined, `metadata.energy` is number | undefined, `metadata.energySegments` is `Array<{timeSeconds: number; value: number}> | undefined`, and `metadata.sectionSentiment` is `Array<{sectionId: string; startSeconds: number; endSeconds: number; sentiment: string; confidence: number}> | undefined`
- [ ] Run: `pnpm --filter @openreel/core test:run packages/core/src/types/project.test.ts` (or project test file)
- [ ] Expect initial red: TypeScript errors because fields don't exist yet.
- [ ] Implement:
  ```
  [project.ts#ADF9]
  SWAP 83.=102:
  +export interface MediaMetadata {
  +  readonly duration: number;
  +  readonly width: number;
  +  readonly height: number;
  +  readonly frameRate: number;
  +  readonly codec: string;
  +  readonly sampleRate: number;
  +  readonly channels: number;
  +  readonly fileSize: number;
  +  readonly bpm?: number;
  +  readonly key?: string;
  +  readonly scale?: string;
  +  readonly has_lyrics?: boolean;
  +  readonly audioTrackCount?: number;
  +  /** Genre classification result (e.g. "pop", "rock", "electronic") */
  +  readonly genre?: string;
  +  /** Mood/sentiment classification (e.g. "energetic", "melancholic", "calm", "tense") */
  +  readonly mood?: string;
  +  /** Overall energy level 0..1 (librosa RMS-based) */
  +  readonly energy?: number;
  +  /** Per-second energy curve for the full duration (librosa RMS per frame) */
  +  readonly energyCurve?: readonly { timeSeconds: number; value: number }[];
  +  /** Section-aligned sentiment frames; never store sentiment as a single whole-song value */
  +  readonly sectionSentiment?: readonly { sectionId: string; startSeconds: number; endSeconds: number; sentiment: "positive" | "negative" | "neutral" | "mixed" | "tense" | "uplifting" | "melancholic"; confidence: number }[];
  +  /** Confidence scores for each analysis dimension (0..1) */
  +  readonly analysisConfidence?: {
  +    readonly genre?: number;
  +    readonly mood?: number;
  +    readonly sentiment?: number;
  +    readonly energy?: number;
  +    readonly beat?: number;
  +  };
  +  /** Timestamp when audio analysis was last run */
  +  readonly audioAnalyzedAt?: number;
  +}
  ```
- [ ] Run the type test, expect green.

---

### Task 02: Create `AudioAnalysisResult` types and timeline integration types

**Goal:** Define the full result shape returned by the analysis service, plus timeline-level types for energy markers and genre/mood metadata. These types live in `packages/core/src/types/audio-analysis.ts` (new file).

**Files:**
- Create: `packages/core/src/types/audio-analysis.ts`
- Modify: `packages/core/src/types/timeline.ts` (append new interfaces)
- Modify: `packages/core/src/types/index.ts` (re-export)

**Reference files:**
- `packages/core/src/types/timeline.ts:5-27` — `TimelineBeatMarker`, `TimelineBeatAnalysis`
- `packages/core/src/types/project.ts:83-102` — `MediaMetadata`
- `packages/music-video-domain/src/types.ts:26-36` — `TimingMarker`, `EnergyPoint`

**TDD steps:**
- [ ] Create `packages/core/src/types/audio-analysis.ts`:
  ```typescript
  /**
   * @openreel/core — Audio analysis types for genre/beat/sentiment/energy pipeline.
   */

  /** Per-second energy data point from librosa RMS */
  export interface EnergyFrame {
    readonly timeSeconds: number;
    readonly value: number;  // 0..1 normalized
  }

  /** Sentiment/mood classification result */
  export interface SentimentResult {
    readonly label: string;          // e.g. "energetic", "melancholic", "calm"
    readonly confidence: number;     // 0..1
  }

  /** Genre classification result */
  export interface GenreResult {
    readonly label: string;          // e.g. "pop", "rock", "electronic", "hip-hop"
    readonly confidence: number;     // 0..1
  }

  /** Section boundary detected by structural analysis */
  export interface SongSectionBoundary {
    readonly timeSeconds: number;
    readonly label?: string;         // e.g. "intro", "verse", "chorus", "bridge", "outro"
    readonly confidence: number;     // 0..1
  }

  /** Complete analysis result from the Python service */
  export interface AudioAnalysisResult {
    readonly duration: number;
    readonly genre?: GenreResult;
    readonly mood?: SentimentResult;
    readonly sentiment?: SentimentResult;
    readonly energy: number;          // overall 0..1
    readonly energyCurve: EnergyFrame[];
    readonly bpm: number;             // from librosa beat tracker
    readonly beatConfidence: number;  // 0..1
    readonly beats: { time: number; strength: number; index: number; isDownbeat: boolean }[];
    readonly sections?: SongSectionBoundary[];
    readonly sourceMediaId?: string;
    readonly analyzedAt: number;
  }

  /** Timeline-level energy marker (displayed as overlay) */
  export interface TimelineEnergyMarker {
    readonly time: number;
    readonly value: number;      // 0..1
    readonly index: number;
  }

  /** Genre/mood metadata that can be applied to a clip */
  export interface AnalysisSelection {
    readonly genre?: string;
    readonly mood?: string;
    readonly sentiment?: string;
    readonly applyBeats: boolean;
    readonly applyEnergy: boolean;
    readonly applySections: boolean;
  }
  ```
- [ ] Write a test file `packages/core/src/types/audio-analysis.test.ts` asserting the shape of `AudioAnalysisResult` is structurally sound.
- [ ] Run: `pnpm --filter @openreel/core test:run packages/core/src/types/audio-analysis.test.ts`
- [ ] Expect green (pure type file; runtime test asserts construction).
- [ ] Add timeline-level integration types to `packages/core/src/types/timeline.ts` after line 26:
  ```
  [timeline.ts#8C41]
  INS.POST 26:
  +
  +/** Energy overlay data rendered on the timeline */
  +export interface TimelineEnergyData {
  +  readonly frames: TimelineEnergyMarker[];
  +  readonly overall: number;
  +  readonly sourceMediaId?: string;
  +  readonly analyzedAt: number;
  +}
  +
  +/** Section markers from structural analysis, rendered on the timeline ruler area */
  +export interface TimelineSectionMarker {
  +  readonly time: number;
  +  readonly label: string;
  +  readonly confidence: number;
  +}
  +
  +/** Complete analysis applied to the timeline (persisted in project JSON) */
  +export interface TimelineAudioAnalysis {
  +  readonly genre?: string;
  +  readonly mood?: string;
  +  readonly sentiment?: string;
  +  readonly energy: number;
  +  readonly energyData?: TimelineEnergyData;
  +  readonly sectionMarkers?: TimelineSectionMarker[];
  +  readonly sourceMediaId?: string;
  +  readonly analyzedAt: number;
  +}
  ```
- [ ] Update `Timeline` interface (line 5-12) to reference the new data:
  ```
  [timeline.ts#8C41]
  SWAP 5.=12:
  +export interface Timeline {
  +  readonly tracks: Track[];
  +  readonly subtitles: Subtitle[];
  +  readonly duration: number;
  +  readonly markers: Marker[];
  +  readonly beatMarkers?: TimelineBeatMarker[];
  +  readonly beatAnalysis?: TimelineBeatAnalysis;
  +  /** Complete audio analysis applied to this timeline (genre, mood, energy, sections) */
  +  readonly audioAnalysis?: TimelineAudioAnalysis;
  +}
  ```
- [ ] Re-export from `packages/core/src/types/index.ts`:
  ```
  [types/index.ts#0F4B]
  INS.POST 1:
  +export * from "./audio-analysis";
  ```
- [ ] Update re-export of new timeline types from `packages/core/src/types/index.ts`:
  ```
  [types/index.ts#0F4B]
  SWAP 2.=2:
  +export * from "./timeline";
  ```
  (already exists, just verify import covers new exports)
- [ ] Run typecheck: `pnpm --filter @openreel/core typecheck`

---

### Task 03: Build Python librosa analysis service in `infra/audio-analysis/`

**Goal:** Create a FastAPI microservice that accepts audio uploads, runs librosa analysis (genre classifier via MFCC + simple ML, beat tracking, onset energy, spectral features for sentiment), and returns structured JSON.

**Files:**
- Create: `infra/audio-analysis/main.py`
- Create: `infra/audio-analysis/requirements.txt`
- Create: `infra/audio-analysis/Dockerfile`
- Create: `infra/audio-analysis/docker-compose.yml`
- Create: `infra/audio-analysis/setup.sh`

**Reference files:**
- `infra/transcribe-gpu/main.py` — full FastAPI pattern (job model, `/health`, `/jobs/{id}`, async processing)
- `infra/transcribe-gpu/requirements.txt` — dependency management pattern
- `infra/transcribe-gpu/Dockerfile` — containerization pattern

**Service contract:**
```
POST /analyze
  Body: multipart/form-data with field "audio" (file, .wav/.mp3/.m4a etc.)
  Returns: { "jobId": "...", "status": "processing" }

GET /jobs/{jobId}
  Returns: { "jobId": "...", "status": "processing" | "complete" | "failed", "result": AudioAnalysisResult | null, "error": string | null }

GET /health
  Returns: { "ok": true, "librosa_version": "x.y.z" }
```

**Python implementation (`infra/audio-analysis/main.py`):**

```python
"""
OpenReel Audio Analysis API — librosa-based genre, beat, energy, sentiment analysis.

Endpoints:
  POST /analyze   — submit audio file for analysis
  GET  /jobs/{id} — poll job result
  GET  /health    — health check
"""

import os
import time
import uuid
import json
import traceback
from dataclasses import dataclass, field, asdict
from typing import Optional

import numpy as np
import librosa
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="OpenReel Audio Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory job store (same pattern as transcribe-gpu) ──────────

@dataclass
class AnalysisJob:
    id: str
    status: str = "processing"  # processing | complete | failed
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)

jobs: dict[str, AnalysisJob] = {}

JOB_TTL_SECONDS = 600

def cleanup_expired_jobs():
    now = time.time()
    for jid in list(jobs.keys()):
        if now - jobs[jid].created_at > JOB_TTL_SECONDS:
            del jobs[jid]

# ── Audio analysis functions ──────────────────────────────────────

def analyze_audio(file_path: str) -> dict:
    """Run full librosa analysis pipeline on an audio file."""
    y, sr = librosa.load(file_path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    # 1. Beat tracking & BPM
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    # Compute onset strength for each beat
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    beat_strengths = []
    for i, t in enumerate(beat_times):
        idx = int(t * sr / 512)  # hop_length=512 default
        strength = float(onset_env[min(idx, len(onset_env) - 1)])
        beat_strengths.append(strength)
    max_s = max(beat_strengths) if beat_strengths else 1
    beats = []
    for i, (t, s) in enumerate(zip(beat_times, beat_strengths)):
        beats.append({
            "time": float(t),
            "strength": float(s / max_s) if max_s > 0 else 0,
            "index": i,
            "isDownbeat": i % 4 == 0,  # simple downbeat heuristic
        })

    # 2. Energy curve (RMS energy per frame)
    hop_length = 512
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms_frames = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    energy_curve = [
        {"timeSeconds": float(t), "value": float(min(v * 10, 1.0))}
        for t, v in zip(rms_frames, rms)
    ]
    overall_energy = float(min(float(np.mean(rms)) * 10, 1.0))

    # 3. Spectral features for sentiment/mood estimation
    spectral_centroids = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    spectral_rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)[0]
    spectral_bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
    zcr = librosa.feature.zero_crossing_rate(y)[0]

    mean_centroid = float(np.mean(spectral_centroids))
    mean_bandwidth = float(np.mean(spectral_bandwidth))
    mean_zcr = float(np.mean(zcr))
    mean_rolloff = float(np.mean(spectral_rolloff))

    # Heuristic mood/sentiment based on spectral features
    # High centroid + high ZCR + high bandwidth → "energetic"
    # Low centroid + low ZCR + low bandwidth → "calm"
    # Mid-range centroid + moderate ZCR → "neutral"
    centroid_norm = min(mean_centroid / 4000, 1.0)
    zcr_norm = min(mean_zcr * 10, 1.0)
    bandwidth_norm = min(mean_bandwidth / 3000, 1.0)

    energy_score = (centroid_norm + zcr_norm + bandwidth_norm) / 3
    if energy_score > 0.6:
        mood = "energetic"
    elif energy_score > 0.35:
        mood = "neutral"
    else:
        mood = "calm"

    # 4. Basic genre classification using MFCC + simple centroid clustering
    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    mfcc_mean = np.mean(mfccs, axis=1)

    # Simple heuristic genre classification based on spectral shape
    # This maps MFCC + spectral features to broad genre categories
    mfcc_centroid = float(np.mean(mfccs[1:5]))  # spectral shape
    mfcc_spread = float(np.std(mfccs[1:5]))      # spectral variation

    if tempo > 140 and mfcc_spread > 50:
        genre_label = "electronic"
    elif tempo > 120 and mfcc_spread > 30:
        genre_label = "pop"
    elif tempo < 80 and mfcc_spread < 40:
        genre_label = "hip-hop"
    elif tempo > 100 and centroid_norm > 0.5:
        genre_label = "rock"
    else:
        genre_label = "other"

    # 5. Sentiment heuristic from spectral contrast + tempo + mood
    # Fast tempo + energetic → positive, Slow + calm → neutral/melancholic
    if tempo > 120 and mood == "energetic":
        sentiment = "positive"
    elif tempo < 90 and mood == "calm":
        sentiment = "neutral"
    elif mood == "calm" and mfcc_spread < 20:
        sentiment = "melancholic"
    else:
        sentiment = "neutral"

    # Section boundaries via spectral novelty
    novelty = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop_length, units="time")
    sections = []
    for i, t in enumerate(novelty):
        sections.append({
            "timeSeconds": float(t),
            "label": f"section_{i + 1}",
            "confidence": 0.5,
        })

    return {
        "duration": duration,
        "bpm": float(tempo),
        "beatConfidence": 0.8,  # librosa beat tracker is generally reliable
        "beats": beats,
        "energy": overall_energy,
        "energyCurve": energy_curve,
        "genre": {"label": genre_label, "confidence": 0.6},
        "mood": {"label": mood, "confidence": 0.7},
        "sentiment": {"label": sentiment, "confidence": 0.6},
        "sections": sections,
        "analyzedAt": time.time(),
    }

# ── Routes ────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(audio: UploadFile = File(...)):
    job_id = uuid.uuid4().hex[:12]
    file_ext = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    temp_path = f"/tmp/audio-analysis-{job_id}{file_ext}"

    content = await audio.read()
    with open(temp_path, "wb") as f:
        f.write(content)

    jobs[job_id] = AnalysisJob(id=job_id, status="processing")

    # Run synchronously for simplicity (can be moved to background task)
    try:
        result = analyze_audio(temp_path)
        jobs[job_id].status = "complete"
        jobs[job_id].result = result
    except Exception as e:
        jobs[job_id].status = "failed"
        jobs[job_id].error = str(e)
        traceback.print_exc()
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)

    cleanup_expired_jobs()
    return {"jobId": job_id, "status": jobs[job_id].status}

@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    resp = {"jobId": job.id, "status": job.status}
    if job.result is not None:
        resp["result"] = job.result
    if job.error is not None:
        resp["error"] = job.error
    return resp

@app.get("/health")
async def health():
    return {"ok": True, "librosa_version": librosa.__version__}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

**Requirements file (`infra/audio-analysis/requirements.txt`):**
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
python-multipart==0.0.9
librosa==0.10.2
numpy<2.0,>=1.23
soundfile>=0.12.1
audioread>=3.0.0
```

**Dockerfile (`infra/audio-analysis/Dockerfile`):**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

**docker-compose.yml (`infra/audio-analysis/docker-compose.yml`):**
```yaml
services:
  audio-analysis:
    build: .
    ports:
      - "8001:8001"
    volumes:
      - ./main.py:/app/main.py
    restart: unless-stopped
```

**TDD steps:**
- [ ] Write `infra/audio-analysis/analyze.test.py` — a pytest test that creates a synthetic audio file (1 second sine wave), posts it to the service, and asserts the response shape contains `bpm`, `genre`, `mood`, `energy`, `beats`, `energyCurve`.
- [ ] Install deps: `pip install -r infra/audio-analysis/requirements.txt pytest httpx`
- [ ] Run: `pytest infra/audio-analysis/analyze.test.py -v`
- [ ] Expect initial red: service not started.
- [ ] Start: `uvicorn infra/audio-analysis.main:app --port 8001 &`
- [ ] Re-run tests: expect green.
- [ ] Verify `GET /health` returns `{ "ok": true }`.

---

### Task 04: Add orchestrator proxy route for audio analysis

**Goal:** Add a route to the Express orchestrator that accepts audio file uploads, forwards to the Python analysis service, and returns the result (with local caching).

**Files:**
- Create: `apps/orchestrator/src/routes/audio-analysis.ts`
- Modify: `apps/orchestrator/src/app.ts` (register the router)

**Reference files:**
- `apps/orchestrator/src/routes/neuralframes.ts` — external service proxy, file download, caching pattern
- `apps/orchestrator/src/routes/wavespeed.ts` — job tracking pattern with `Map<string, Job>`
- `apps/orchestrator/src/app.ts:33-35` — route registration pattern

**Implementation (`apps/orchestrator/src/routes/audio-analysis.ts`):**
```typescript
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { config } from "../env";

export const audioAnalysisRouter: ExpressRouter = Router();

const ANALYSIS_SERVICE_URL = process.env.AUDIO_ANALYSIS_URL ?? "http://localhost:8001";
const CACHE_DIR = join(config.generatedAssetsDir, "audio-analysis");

// ── Cache helpers ─────────────────────────────────────────────────

function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function cachePath(hash: string): string {
  return join(CACHE_DIR, `${hash}.json`);
}

// ── Routes ─────────────────────────────────────────────────────────

/**
 * POST /api/analyze/audio
 * Body: multipart/form-data with "audio" file field.
 * Returns: AudioAnalysisResult JSON (or proxies the job polling URL if async)
 */
audioAnalysisRouter.post("/", async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const hash = fileHash(file.path);
    const cached = cachePath(hash);

    // Return cached result if available
    if (existsSync(cached)) {
      const data = JSON.parse(readFileSync(cached, "utf8"));
      res.json({ cached: true, ...data });
      return;
    }

    // Forward to Python service
    const FormData = await import("form-data");
    const form = new FormData.default();
    form.append("audio", readFileSync(file.path), {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    const response = await fetch(`${ANALYSIS_SERVICE_URL}/analyze`, {
      method: "POST",
      body: form as unknown as BodyInit,
    });
    const result = await response.json();

    // If job was created, poll for result
    if (result.jobId && result.status === "processing") {
      // Poll until complete (max 30s)
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const poll = await fetch(`${ANALYSIS_SERVICE_URL}/jobs/${result.jobId}`);
        const pollResult = await poll.json();
        if (pollResult.status === "complete") {
          // Cache and return
          writeFileSync(cached, JSON.stringify(pollResult.result));
          res.json(pollResult.result);
          return;
        }
        if (pollResult.status === "failed") {
          res.status(500).json({ error: pollResult.error ?? "Analysis failed" });
          return;
        }
      }
      res.status(504).json({ error: "Analysis timed out" });
      return;
    }

    // Synchronous result (depends on service config)
    writeFileSync(cached, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Analysis service error: ${msg}` });
  }
});

/**
 * GET /api/analyze/audio/health — check if analysis service is reachable
 */
audioAnalysisRouter.get("/health", async (_req, res) => {
  try {
    const response = await fetch(`${ANALYSIS_SERVICE_URL}/health`);
    const data = await response.json();
    res.json(data);
  } catch {
    res.status(503).json({ ok: false, error: "Analysis service unreachable" });
  }
});
```

Note: needs `form-data` and `multer` added to orchestrator dependencies.

**Register in `apps/orchestrator/src/app.ts`:**
```
[app.ts#2BE6]
INS.POST 34:
+app.use("/api/analyze/audio", audioAnalysisRouter);
```

And add import:
```
[app.ts#2BE6]
SWAP 6.=6:
+import { audioAnalysisRouter } from "./routes/audio-analysis";
```

**Env config update (`apps/orchestrator/src/env.ts`):**
```
[env.ts#3143]
INS.POST 64:
+  audioAnalysisUrl: env("AUDIO_ANALYSIS_URL", "http://localhost:8001"),
```

**TDD steps:**
- [ ] Write `apps/orchestrator/src/routes/audio-analysis.test.ts` that:
  - Creates a small WAV file programmatically
  - Mocks the Python service (or starts it)
  - POSTs the file to `/api/analyze/audio`
  - Asserts response has expected shape
- [ ] Run: `pnpm --filter @openreel/orchestrator test:run apps/orchestrator/src/routes/audio-analysis.test.ts`
- [ ] Implement, run, expect green.
- [ ] Verify health: `curl http://localhost:4041/api/analyze/audio/health`

---

### Task 05: Build `AudioAnalysisBridge` frontend service

**Goal:** Create a frontend bridge class (singleton, subscribable) that manages audio analysis state — mirrors `BeatSyncBridge` exactly for consistency.

**Files:**
- Create: `apps/web/src/bridges/audio-analysis-bridge.ts`

**Reference files:**
- `apps/web/src/bridges/beat-sync-bridge.ts` — full pattern (state interface, options, subscribe, analyzeAudioFromBlob/Url/Buffer, notifyListeners)

**Implementation highlights:**
```typescript
// AudioAnalysisBridge follows the exact same pattern as BeatSyncBridge:
// - Private state (AudioAnalysisBridgeState) with isAnalyzing, progress, error, result
// - subscribe(listener) → unsubscribe function
// - analyzeAudio(blob, mediaId?) → AudioAnalysisResult
// - clearAnalysis()
// - applyGenre(mediaId, genre) → updates MediaMetadata
// - applyBeats(mediaId, beats) → sets timeline.beatMarkers
// - applyEnergy(mediaId, energyCurve) → sets timeline.audioAnalysis.energyData

export interface AudioAnalysisBridgeState {
  isAnalyzing: boolean;
  progress: number;
  error: string | null;
  result: AudioAnalysisResult | null;
}

class AudioAnalysisBridge {
  private state: AudioAnalysisBridgeState = { ... };
  private listeners = new Set<...>();

  async analyzeAudio(blob: Blob, mediaId?: string): Promise<AudioAnalysisResult> { ... }
  clearAnalysis(): void { ... }
  // ... apply methods
}
```

The actual implementation sends the blob to the orchestrator:
```
POST /api/analyze/audio
```

**TDD steps:**
- [ ] Write `apps/web/src/bridges/audio-analysis-bridge.test.ts`:
  - Test singleton pattern (getAudioAnalysisBridge returns same instance)
  - Test subscribe/unsubscribe
  - Test analyzeAudio with a mock fetch
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/bridges/audio-analysis-bridge.test.ts`
- [ ] Implement, expect green.

---

### Task 06: Add `analyzeAudio` action to project store

**Goal:** Add `analyzeAudio(mediaId)` and `applyAudioAnalysis(mediaId, selection)` actions to the `ProjectState` Zustand store so the UI can trigger analysis and persist selected results.

**Files:**
- Modify: `apps/web/src/stores/project/types.ts` (add method signatures)
- Modify: `apps/web/src/stores/project-store.ts` (add implementations)

**Reference files:**
- `apps/web/src/stores/project/types.ts:94-394` — `ProjectState` interface
- `apps/web/src/stores/project-store.ts:1708-1853` — `importMedia` implementation pattern

**Method signatures to add to `ProjectState`:**
```typescript
analyzeAudio: (mediaId: string) => Promise<ActionResult>;
applyAudioAnalysis: (mediaId: string, selection: AnalysisSelection) => Promise<ActionResult>;
```

**Implementation approach:**
```typescript
analyzeAudio: async (mediaId: string) => {
  const { project } = get();
  const media = project.mediaLibrary.items.find(m => m.id === mediaId);
  if (!media || !media.blob) return { success: false, error: { code: "MEDIA_NOT_FOUND", message: "Media not available" } };

  const bridge = getAudioAnalysisBridge();
  const result = await bridge.analyzeAudio(media.blob, mediaId);

  // Store result on media metadata (not yet applied — user must apply)
  const updatedMedia = {
    ...media,
    metadata: {
      ...media.metadata,
      genre: result.genre?.label,
      mood: result.mood?.label,
      sentiment: result.sentiment?.label,
      energy: result.energy,
      energyCurve: result.energyCurve,
      analysisConfidence: {
        genre: result.genre?.confidence,
        mood: result.mood?.confidence,
        sentiment: result.sentiment?.confidence,
        energy: result.energy,
        beat: result.beatConfidence,
      },
      audioAnalyzedAt: result.analyzedAt,
    },
  };

  // Update in store...
  return { success: true };
}
```

**TDD steps:**
- [ ] Write tests in `apps/web/src/stores/project-store.test.ts` for:
  - `analyzeAudio` calls bridge and updates media metadata
  - `applyAudioAnalysis` merges selection into timeline state
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts -- -t "audio analysis"`
- [ ] Implement, expect green.

---

### Task 07: Build `AudioAnalysisSection` UI component for clip inspector

**Goal:** Create a collapsible inspector section (`InspectorSection`) that shows analysis results for the selected clip's media item and provides "Apply" buttons for each dimension.

**Files:**
- Create: `apps/web/src/components/editor/inspector/AudioAnalysisSection.tsx`
- Modify: `apps/web/src/components/editor/inspector/tabs/AudioTab.tsx` (add the section)
- Modify: `apps/web/src/components/editor/inspector/index.ts` (export)

**Reference files:**
- `apps/web/src/components/editor/inspector/AudioTextSyncPanel.tsx` — reference inspector section component
- `apps/web/src/components/editor/inspector/shell/InspectorSection.tsx` — collapsible section wrapper
- `apps/web/src/components/editor/inspector/tabs/AudioTab.tsx:19-73` — tab structure
- `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx:351-371` — existing AudioTab with BPM/Key/Scale display

**Component design:**

```
<InspectorSection title="Audio Analysis" sectionId="audio-analysis">
  Status: Not analyzed / Analyzing... / Complete
  [Analyze Audio] button (when not analyzed)

  When complete, show:
  ┌─────────────────────────────────┐
  │ Genre: pop [confidence: 0.6]    │  [Apply to Clip] [Apply to Media]
  │ Mood: energetic [conf: 0.7]     │  [Apply to Clip] [Apply to Media]
  │ Sentiment: positive [conf: 0.6] │  [Apply to Clip] [Apply to Media]
  │ Energy: 0.72                     │  [Apply Beat Markers]  [Apply Energy Overlay]
  │ BPM: 128                         │
  │ Beats: 347 markers               │
  │ Sections: intro, verse, chorus...│
  └─────────────────────────────────┘
```

"Apply to Clip" copies the analysis value into the clip's `ClipMetadata` for individual clip overrides. "Apply to Timeline" sets it on the timeline-level `TimelineAudioAnalysis`.

**TDD steps:**
- [ ] Write `apps/web/src/components/editor/inspector/AudioAnalysisSection.test.tsx`:
  - Renders "Not analyzed" state when no analysis exists
  - Renders "Analyze" button when no analysis
  - Renders genre/mood/energy after analysis result is provided
  - Click "Apply Beat Markers" dispatches the store action
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/AudioAnalysisSection.test.tsx`
- [ ] Implement, expect green.
- [ ] Tab integration: Add `<AudioAnalysisSection>` to `AudioTab.tsx` between Beat Sync and Noise Reduction sections:
  ```
  [AudioTab.tsx#9855]
  INS.POST 37:
  +      <InspectorSection title="Audio Analysis" sectionId="audio-analysis" defaultOpen={true}>
  +        <AudioAnalysisSection clipId={clipId} />
  +      </InspectorSection>
  ```
- [ ] Add import to `AudioTab.tsx` and to inspector `index.ts`.

---

### Task 08: Extend asset inspector `AudioTab` with analysis controls

**Goal:** Add analysis-trigger and results display to the asset-level audio tab (`AssetInspectorWithTabs.AudioTab`), which currently only shows static BPM/Key/Scale.

**Files:**
- Modify: `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx` (extend `AudioTab` function)

**Reference:**
- `AssetInspectorWithTabs.tsx:351-371` — current `AudioTab` function

**Changes:**
Replace the existing static display with a richer panel that includes an "[Analyze]" button, progress indicator, and the full analysis results with "Apply to Timeline" buttons.

```
[AssetInspectorWithTabs.tsx#B09F]
SWAP.BLK 351:
+function AudioTab({ item }: { item: MediaItem }) {
+  const [analysisState, setAnalysisState] = useState<...>(null);
+  const bridge = getAudioAnalysisBridge();
+
+  // Subscribe to bridge state
+  useEffect(() => { ... }, []);
+
+  const handleAnalyze = async () => { ... };
+
+  return (
+    <div className="space-y-3 px-4 pt-3 pb-4">
+      {/* Analysis trigger */}
+      <TypeSection title="Audio Analysis" ...>
+        {!item.metadata.audioAnalyzedAt && !analysisState?.isAnalyzing && (
+          <button onClick={handleAnalyze}>Analyze Audio</button>
+        )}
+        {analysisState?.isAnalyzing && <progress ... />}
+        {analysisState?.result && (
+          <>
+            <TypeDetailRow label="Genre" value={...} />
+            <TypeDetailRow label="Mood" value={...} />
+            <TypeDetailRow label="Sentiment" value={...} />
+            <TypeDetailRow label="Energy" value={...} />
+            <TypeDetailRow label="BPM" value={...} />
+            [Apply to Timeline]
+          </>
+        )}
+      </TypeSection>
+
+      {/* Existing audio info */}
+      <TypeSection title="Audio" ...>
+        <TypeDetailRow label="Sample Rate" ... />
+        ...
+      </TypeSection>
+    </div>
+  );
+}
```

**TDD steps:**
- [ ] Extend `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.audio.test.tsx` (existing test file at 2.8KB) with tests for:
  - Analyze button renders when no analysis exists
  - Progress shown during analysis
  - Results displayed after analysis complete
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/inspector/AssetInspectorWithTabs.audio.test.tsx`
- [ ] Implement, expect green.

---

### Task 09: Add timeline energy overlay component

**Goal:** Create an `EnergyMarkerOverlay` component (sibling to `BeatMarkerOverlay`) that renders the energy curve as a colored bar at the top of the timeline track area, plus a vertical section marker overlay.

**Files:**
- Create: `apps/web/src/components/editor/timeline/EnergyMarkerOverlay.tsx`
- Modify: `apps/web/src/components/editor/timeline/index.ts` (export)

**Reference files:**
- `apps/web/src/components/editor/timeline/BeatMarkerOverlay.tsx:1-80` — full pattern (subscribe to bridge, viewport culling, rendering)
- `packages/core/src/types/timeline.ts` — `TimelineEnergyData`, `TimelineSectionMarker`

**Component design:**
```typescript
// EnergyMarkerOverlay follows BeatMarkerOverlay exactly:
// - Reads energy data from project store timeline.audioAnalysis.energyData
// - Renders a thin gradient bar at the top of the track area
// - Color gradient: blue (low) → yellow (mid) → red (high)
// - Section markers render as labeled vertical lines in the ruler area

// Alternative: render as a thin heatmap bar above the timeline tracks
// similar to how BeatMarkerOverlay renders beat lines.
```

**TDD steps:**
- [ ] Write `apps/web/src/components/editor/timeline/EnergyMarkerOverlay.test.tsx`:
  - Renders nothing when no energy data
  - Renders gradient divs when energy data is provided
  - Section markers appear at correct positions
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/EnergyMarkerOverlay.test.tsx`
- [ ] Implement, expect green.

---

### Task 10: Add "Apply Analysis" wiring (beats → timeline, genre → metadata, etc.)

**Goal:** Wire all the "Apply" buttons from tasks 07/08 to actually mutate project state — calling the store methods that set `timeline.beatMarkers`, `timeline.audioAnalysis`, and `MediaMetadata`.

**Files:**
- Modify: `apps/web/src/bridges/audio-analysis-bridge.ts` (add `applyToTimeline` methods)
- Modify: `apps/web/src/stores/project-store.ts` (complete `applyAudioAnalysis` implementation)

**Reference:**
- `apps/web/src/bridges/beat-sync-bridge.ts:237-266` — `generateManualBeatMarkers` and `setBeatMarkers` pattern
- Timeline mutation in project store via `set({ project: updatedProject })`

**Implementation for store `applyAudioAnalysis`:**
```typescript
applyAudioAnalysis: (mediaId: string, selection: AnalysisSelection) => {
  const { project } = get();
  const media = project.mediaLibrary.items.find(m => m.id === mediaId);
  if (!media?.metadata.audioAnalyzedAt) return { success: false, error: ... };

  const bridge = getAudioAnalysisBridge();
  const result = bridge.getState().result;
  if (!result) return { success: false, error: ... };

  let timeline = { ...project.timeline };

  // Apply beat markers to timeline
  if (selection.applyBeats && result.beats.length > 0) {
    timeline = {
      ...timeline,
      beatMarkers: result.beats.map(b => ({
        time: b.time,
        strength: b.strength,
        index: b.index,
        isDownbeat: b.isDownbeat,
      })),
      beatAnalysis: {
        bpm: result.bpm,
        confidence: result.beatConfidence,
        sourceClipId: mediaId,
        analyzedAt: result.analyzedAt,
      },
    };
  }

  // Apply energy overlay
  if (selection.applyEnergy && result.energyCurve.length > 0) {
    timeline = {
      ...timeline,
      audioAnalysis: {
        ...timeline.audioAnalysis,
        genre: selection.genre ?? media.metadata.genre,
        mood: selection.mood ?? media.metadata.mood,
        sentiment: selection.sentiment ?? media.metadata.sentiment,
        energy: result.energy,
        energyData: {
          frames: result.energyCurve.map((e, i) => ({
            time: e.timeSeconds,
            value: e.value,
            index: i,
          })),
          overall: result.energy,
          sourceMediaId: mediaId,
          analyzedAt: result.analyzedAt,
        },
        ...(selection.applySections && result.sections ? {
          sectionMarkers: result.sections.map(s => ({
            time: s.timeSeconds,
            label: s.label,
            confidence: s.confidence,
          })),
        } : {}),
        sourceMediaId: mediaId,
        analyzedAt: result.analyzedAt,
      },
    };
  }

  // Update media metadata with genre/mood/sentiment
  const updatedMedia = media; // ...merge analysis selections

  set({ project: { ...project, timeline, mediaLibrary: { ... } } });
  return { success: true };
}
```

**TDD steps:**
- [ ] Write unit tests in `apps/web/src/stores/project-store.test.ts`:
  - applyAudioAnalysis with applyBeats=true sets timeline.beatMarkers
  - applyAudioAnalysis with applyEnergy=true sets timeline.audioAnalysis.energyData
  - applyAudioAnalysis with genre sets MediaMetadata.genre
  - Calling with empty selection does nothing
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/project-store.test.ts -- -t "applyAudioAnalysis"`
- [ ] Implement, expect green.

---

### Task 11: Run end-to-end integration test

**Goal:** Verify the full pipeline: Python service + orchestrator proxy + frontend bridge + store mutation + UI rendering.

**Steps:**
- [ ] Start the audio analysis service: `uvicorn infra/audio-analysis.main:app --port 8001`
- [ ] Start the orchestrator: `pnpm --filter @openreel/orchestrator dev`
- [ ] Start the web app: `pnpm --filter @openreel/web dev`
- [ ] Manual E2E test:
  1. Import an audio file
  2. Open Audio Analysis section in clip inspector
  3. Click "Analyze Audio"
  4. Verify progress indicator
  5. Verify results appear (genre, mood, energy, BPM, beats)
  6. Click "Apply Beat Markers"
  7. Verify beat markers appear on timeline (check `BeatMarkerOverlay` renders them)
  8. Click "Apply Energy Overlay"
  9. Verify energy bar appears above tracks
  10. Verify genre/mood/sentiment are persisted in media metadata (visible in asset inspector Audio tab)
- [ ] Automated E2E test (optional):
  - Write `apps/web/test/e2e/audio-analysis.spec.ts` using the project's test setup
  - Use a pre-generated WAV test fixture stored in `apps/web/test/fixtures/`
  - Verify the full state transition via store integration

---

## Key files summary

| Area | File | Action |
| --- | --- | --- |
| **Types** | `packages/core/src/types/project.ts` | Add genre, mood, sentiment, energy, analysisConfidence, audioAnalyzedAt to `MediaMetadata` |
| **Types** | `packages/core/src/types/audio-analysis.ts` | **NEW** — `AudioAnalysisResult`, `EnergyFrame`, `GenreResult`, `SentimentResult`, `SongSectionBoundary`, `AnalysisSelection` |
| **Types** | `packages/core/src/types/timeline.ts` | Add `TimelineEnergyData`, `TimelineSectionMarker`, `TimelineAudioAnalysis` + `audioAnalysis` to `Timeline` |
| **Python** | `infra/audio-analysis/main.py` | **NEW** — FastAPI service with librosa analysis pipeline |
| **Python** | `infra/audio-analysis/requirements.txt` | **NEW** |
| **Python** | `infra/audio-analysis/Dockerfile` | **NEW** |
| **Python** | `infra/audio-analysis/docker-compose.yml` | **NEW** |
| **Orchestrator** | `apps/orchestrator/src/routes/audio-analysis.ts` | **NEW** — proxy route |
| **Orchestrator** | `apps/orchestrator/src/app.ts` | Register router |
| **Orchestrator** | `apps/orchestrator/src/env.ts` | Add `audioAnalysisUrl` config |
| **Frontend bridge** | `apps/web/src/bridges/audio-analysis-bridge.ts` | **NEW** — singleton bridge (parallels `BeatSyncBridge`) |
| **Store** | `apps/web/src/stores/project/types.ts` | Add `analyzeAudio`, `applyAudioAnalysis` method signatures |
| **Store** | `apps/web/src/stores/project-store.ts` | Implement `analyzeAudio` and `applyAudioAnalysis` |
| **UI: clip inspector** | `apps/web/src/components/editor/inspector/AudioAnalysisSection.tsx` | **NEW** — analysis display + apply controls |
| **UI: clip inspector** | `apps/web/src/components/editor/inspector/tabs/AudioTab.tsx` | Add `AudioAnalysisSection` |
| **UI: asset inspector** | `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx` | Expand `AudioTab` with analysis + apply |
| **UI: timeline** | `apps/web/src/components/editor/timeline/EnergyMarkerOverlay.tsx` | **NEW** — energy curve + section markers |
| **UI: timeline** | `apps/web/src/components/editor/timeline/index.ts` | Export new overlay |

## Test files to create

| Test file | Covers |
| --- | --- |
| `packages/core/src/types/project.test.ts` | `MediaMetadata` shape with new fields |
| `packages/core/src/types/audio-analysis.test.ts` | `AudioAnalysisResult` construction |
| `infra/audio-analysis/analyze.test.py` | Python service endpoint + result shape |
| `apps/orchestrator/src/routes/audio-analysis.test.ts` | Orchestrator proxy route |
| `apps/web/src/bridges/audio-analysis-bridge.test.ts` | Bridge singleton, subscribe, analyze |
| `apps/web/src/stores/project-store.test.ts` | `analyzeAudio` + `applyAudioAnalysis` |
| `apps/web/src/components/editor/inspector/AudioAnalysisSection.test.tsx` | Analysis section rendering + apply |
| `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.audio.test.tsx` | Extension to existing test |
| `apps/web/src/components/editor/timeline/EnergyMarkerOverlay.test.tsx` | Energy overlay rendering |

## Risks and unresolved decisions

1. **Python service warm start:** librosa loads models on first import (~1-2s). The service can preload on startup (the `/health` endpoint will serve as a readiness check). Consider using `lifespan` event handler in FastAPI.

2. **Genre classifier quality:** The initial implementation uses simple heuristics (MFCC centroid + tempo thresholds) rather than a trained model. This is acceptable for a v1. A future improvement could swap in a lightweight ONNX model (e.g., `musiCNN` or `VGGish`). The type system is designed to accommodate confidence scores.

3. **Sentiment/mood accuracy:** Spectral-feature heuristics for mood are rough proxies. Document that these are "energy-based mood estimates." Users can override them manually via the selection UI.

4. **File format handling:** The Python service uses `librosa.load()` which supports WAV, MP3, M4A, FLAC, OGG. Large files should be limited via orchestrator (e.g., reject files > 200MB or > 30min duration).

5. **Orchestrator dependency:** Needs `form-data` and `multer` npm packages (check if already present). If `multer` is already used by `projects/routes.ts`, reuse that instance.

6. **Beat marker merge semantics:** If the timeline already has `beatMarkers` (e.g., from WASM beat detection), "Apply Beat Markers" should either replace or merge with a prompt for the user. For v1, replace entirely.

7. **Energy overlay rendering approach:** Two options:
   - **Option A (recommended):** Gradient bar above tracks (like a thin waveform) — lower visual noise
   - **Option B:** Per-frame colored vertical lines (like BeatMarkerOverlay but colored by energy)
   The plan follows Option A for simplicity; Option B can be added later.

8. **User input needed:** What port should the Python service default to? This plan uses `8001` (Whisper uses `8000`). The orchestrator env var `AUDIO_ANALYSIS_URL` can override it. Also validate the `form-data` npm package name — the orchestrator may already have it via `@openreel/music-video-domain`.
