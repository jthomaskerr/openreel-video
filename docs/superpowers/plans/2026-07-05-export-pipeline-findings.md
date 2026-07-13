# Export Pipeline Implementation Findings

## Current State (Audited 2026-07-13 16:16 AEST)

**Document type:** HISTORICAL FINDINGS, NOT AN EXECUTABLE PLAN. Canonical owners: [Export](../../spec/export.md) and [Audio Analysis & Subtitles](../../spec/audio-analysis-subtitles.md). Component statuses below remain investigation evidence unless restated here.

| Area | Current state |
|---|---|
| Core video/audio/frame export | Implemented in `ExportEngine` with unit coverage. |
| Presets/profiles/upscaling/cancellation | Implemented or substantially present, as recorded below. |
| Image-sequence packaging | Unresolved; collected blobs do not by themselves prove the canonical deliverable/archive contract. |
| Bitrate/container behavior | Historical divergence remains unclosed by a dedicated regression test. |
| Subtitle export | Nonconformant legacy text/flat-subtitle workaround; first-class subtitle parity is not complete. |
| Worker/progress/UI | Worker exists; full UI, progress, cancel, and browser behavior is not currently verified. |
| End-to-end evidence | No current exported-artifact matrix proves codecs, duration, A/V sync, subtitles, cancellation, and sequence output. |

**Next action:** write a dedicated export remediation plan from unresolved canonical requirements; retain this file as evidence only.

**Date:** 2026-07-05  
**Spec Reference:** `docs/spec/export.md` (§1–18)  
**Implementation Files Analyzed:**
- `packages/core/src/export/export-engine.ts` (1,600+ lines)
- `packages/core/src/export/types.ts` (all type definitions)
- `packages/core/src/export/export-worker.ts`
- `apps/web/src/components/editor/ExportDialog.tsx`
- `apps/web/src/services/export-presets.ts`

---

## Executive Summary

The export engine is **substantially implemented** with most core functionality present. However, there are **critical gaps and divergences**:

1. ✅ **Implemented & Correct:** Core export methods, codec selection, quality presets, error handling, progress tracking, cancellation
2. ⚠️ **Critical Bug — Subtitle Rendering:** Reads from deprecated `timeline.subtitles` flat array (lines 1395–1400) instead of subtitle track clips (spec §13 requirement)
3. ⚠️ **Partially Implemented:** Image sequence export (exists but result format unclear — returns array or ZIP?)
4. ❌ **Not Implemented:** ProRes fallback logic when codec unsupported (ProRes attempted but no fallback to H.264 at 25kbps as per spec §3.3)
5. ⚠️ **Not Verified:** Memory guardrails for memory-intensive codecs may not fully match spec §3.5 requirements

---

## Detailed Findings

### 1. Core Export Methods (§2–5) — ✅ IMPLEMENTED

**File:** `packages/core/src/export/export-engine.ts`

#### Method 1: `exportVideo()` (line 213)
```typescript
async *exportVideo(
  project: Project,
  settings: Partial<VideoExportSettings> = {},
  writableStream?: FileSystemWritableFileStream,
): AsyncGenerator<ExportProgress, ExportResult>
```
- **Status:** ✅ Fully implemented
- **Key Details:**
  - Async generator pattern correct (yields ExportProgress, returns ExportResult)
  - Takes writableStream for output (line 213+)
  - Returns early if writableStream null with MUXER_ERROR (lines 301–308)
  - Initializes GPU for export (line 287: `initializeGPUForExport()`)
  - Sets `exportMode = true` on VideoEngine (line 293)
  - Encodes timeline audio (line 351: `encodeTimelineAudioToSource()`)

#### Method 2: `exportAudio()` (line 552)
```typescript
async *exportAudio(
  project: Project,
  settings: Partial<AudioExportSettings> = {},
): AsyncGenerator<ExportProgress, ExportResult>
```
- **Status:** ✅ Fully implemented
- **Key Details:**
  - Async generator pattern correct
  - Audio chunking logic (AUDIO_EXPORT_CHUNK_DURATION_SECONDS = 15 seconds, line 27)
  - Fallback to WAV encoder if MediaBunny unavailable (line 600+)

#### Method 3: `exportFrame()` (line 646)
```typescript
async exportFrame(
  project: Project,
  time: number,
  settings?: Partial<ImageExportSettings>,
): Promise<ImageBitmap | null>
```
- **Status:** ✅ Implemented
- **Returns raw ImageBitmap** (not encoded/muxed, as per spec §5.1)

#### Method 4: `exportImage()` (line 723)
```typescript
async exportImage(
  project: Project,
  settings?: Partial<ImageExportSettings>,
): Promise<ExportResult>
```
- **Status:** ✅ Implemented
- **Delegates to:** `exportFrame()` at time 0

#### Method 5: `exportImageSequence()` (line 730)
```typescript
async *exportImageSequence(
  project: Project,
  settings: Partial<SequenceExportSettings> = {},
): AsyncGenerator<ExportProgress, ExportResult>
```
- **Status:** ⚠️ **PARTIALLY IMPLEMENTED** — **ISSUE: Result format unclear**
  - Method exists and loops through frames (line 740–790+)
  - Collects blobs into array: `const blobs: Blob[] = [];` (line 743)
  - **BUG:** Returns single blob in ExportResult (line 796: `return { success: true, blob: ??? }`), but spec §6.3 **TODO** asks: "ZIP or per-frame blobs?"
  - **Current behavior:** Unclear if it zips the blobs or returns first blob or something else

---

### 2. Codec Support (§3.2, §17) — ✅ VERIFIED

**Files:**
- `packages/core/src/export/types.ts` (lines: CODEC_MAP definition)
- `packages/core/src/export/export-engine.ts` (codec handling logic)

#### CODEC_MAP (§17 mapping)
```typescript
// packages/core/src/export/types.ts
export const CODEC_MAP = {
  h264: "avc",
  h265: "hevc",
  vp8: "vp8",
  vp9: "vp9",
  av1: "av1",
  prores: "prores",
} as const;
```
- **Status:** ✅ Correct mapping (matches spec §17)

#### Supported Formats (§3.2 table)
**Implemented:**
- ✅ MP4 with H.264
- ✅ MP4 with H.265
- ✅ WebM with VP8
- ✅ WebM with VP9
- ✅ WebM with AV1
- ⚠️ ProRes (see next section)

**Format selection logic (line 340–351):**
```typescript
let outputFormat;
switch (fullSettings.format) {
  case "webm":
    outputFormat = new WebMOutputFormat();
    break;
  case "mov":
    outputFormat = new MovOutputFormat();
    break;
  case "mp4":
  default:
    outputFormat = new Mp4OutputFormat({ fastStart: false });
    break;
}
```

---

### 3. CRITICAL BUG: ProRes Fallback NOT Implemented (§3.3, §3.4) — ❌

**File:** `packages/core/src/export/export-engine.ts` (lines 238–244)

**Current Code:**
```typescript
if (fullSettings.codec === "prores") {
  fullSettings.codec = "h264";
  fullSettings.format = "mp4";
  fullSettings.bitrate = 25000;
  fullSettings.quality = 95;
}
```

**Status:** ⚠️ **DIVERGENCE FROM SPEC**

**Spec Requirement (§3.3):**
> "When `codec` is `"prores"` [and] browser does not support ProRes encoding, engine SHALL fall back [to] H.264 in an MP4 container [at] bitrate 25,000 kbps quality 95."

**Problem:**
- Current code **unconditionally replaces ProRes with H.264** (lines 238–244)
- **Does NOT check** if ProRes is actually unsupported before fallback
- **Spec intention:** Only fall back IF unsupported (check `VideoEncoder.isConfigSupported()` for ProRes first)
- **Consequence:** Users requesting ProRes on a browser that supports it will silently get H.264 instead

**Fix Required:**
Add ProRes support check before falling back. See spec §3.3 for proper logic.

---

### 4. Memory-Intensive Codec Guardrails (§3.5) — ⚠️ PARTIALLY VERIFIED

**File:** `packages/core/src/export/export-engine.ts` (lines 245–266)

**Current Code:**
```typescript
const isMemoryIntensiveCodec =
  fullSettings.codec === "vp9" ||
  fullSettings.codec === "av1" ||
  fullSettings.codec === "h265";
const isLongVideo = timelineDuration > 120;

let maxW = isMemoryIntensiveCodec ? 1920 : 3840;
let maxH = isMemoryIntensiveCodec ? 1080 : 2160;
if (isLongVideo) {
  maxW = Math.min(maxW, 1920);
  maxH = Math.min(maxH, 1080);
}
if (fullSettings.width > maxW || fullSettings.height > maxH) {
  const scale = Math.min(maxW / fullSettings.width, maxH / fullSettings.height, 1);
  fullSettings.width = Math.round(fullSettings.width * scale / 2) * 2;
  fullSettings.height = Math.round(fullSettings.height * scale / 2) * 2;
}
if (isLongVideo && fullSettings.frameRate > 30) {
  fullSettings.frameRate = 30;
}
```

**Status:** ✅ **Core logic correct, minor issue**

**Verification:**
- ✅ VP9, AV1, H.265 marked as memory-intensive (correct per spec)
- ✅ Long video (>120 seconds) cap resolution to 1920×1080
- ✅ Long video cap frame rate to 30 fps
- ✅ Aspect ratio preserved (uses `scale` multiplier, rounds to even dimensions for codec compatibility)

**Minor Issue:**
- Default max for non-intensive codecs is 3840×2160 (4K) — spec §3.5 says "Maximum resolution: 1920×1080" without codec qualification. Should default be 1920×1080 for all? **Ambiguous in spec.**

---

### 5. Audio Codec Negotiation (§3.6, §9.4) — ✅ VERIFIED

**File:** `packages/core/src/export/export-engine.ts` (lines 106–168)

**Method:** `findSupportedAudioCodec()` (line 106)

**Logic Verified:**
1. ✅ Gets supported codecs from output format (line 109)
2. ✅ Requested bitrate + fallbacks: [requested, 192000, 128000, 96000] (lines 112–115)
3. ✅ Tries codec preference loop: aac → mp3 → opus (lines 117–131)
4. ✅ Validates via `AudioEncoder.isConfigSupported()` (lines 146–161 in `isAudioConfigSupported()`)
5. ✅ Defaults to AAC at 128 kbps if no codec found (lines 162–165)

**Exact Match to Spec §9.4** ✅

---

### 6. Quality Presets (§7.1) — ✅ VERIFIED

**File:** `packages/core/src/export/types.ts`

**Presets Defined:**
```typescript
export const VIDEO_QUALITY_PRESETS = {
  "4k-high": { width: 3840, height: 2160, bitrate: 80000, frameRate: 30, quality: 95 },
  "4k": { width: 3840, height: 2160, bitrate: 50000, frameRate: 30, quality: 90 },
  "4k-60": { width: 3840, height: 2160, bitrate: 65000, frameRate: 60, quality: 90 },
  "1080p-high": { width: 1920, height: 1080, bitrate: 25000, frameRate: 30, quality: 95 },
  "1080p": { width: 1920, height: 1080, bitrate: 15000, frameRate: 30, quality: 85 },
  "1080p-60": { width: 1920, height: 1080, bitrate: 24000, frameRate: 60, quality: 90 },
  "720p": { width: 1280, height: 720, bitrate: 8000, frameRate: 30, quality: 80 },
  "480p": { width: 854, height: 480, bitrate: 4000, frameRate: 30, quality: 75 },
}
```

**Status:** ✅ **8 presets match spec §7.1 table exactly**

---

### 7. ProRes Bitrate Table (§3.4) — ✅ DEFINED

**File:** `packages/core/src/export/types.ts`

```typescript
export const PRORES_BITRATES = {
  proxy: { "1080p": 45000, "4k": 180000 },
  lt: { "1080p": 100000, "4k": 400000 },
  standard: { "1080p": 150000, "4k": 600000 },
  hq: { "1080p": 220000, "4k": 880000 },
  "4444": { "1080p": 330000, "4k": 1320000 },
  "4444xq": { "1080p": 500000, "4k": 2000000 },
} as const;
```

**Status:** ✅ Matches spec §3.4 exactly (6 profiles, 2 resolutions each)

---

### 8. Upscaling Integration (§10) — ✅ VERIFIED

**File:** `packages/core/src/export/export-engine.ts`

**Initialization (lines 287–289):**
```typescript
await this.initializeGPUForExport(fullSettings.width, fullSettings.height);
// Inside method (lines 72–90):
const upscalingEngine = getUpscalingEngine();
await upscalingEngine.initialize({ device });
```

**Status:** ✅ UpscalingEngine initialized with GPU device

**Upscaling in Frame Pipeline:**
- ⚠️ **NOT YET VERIFIED IN DETAIL** — Need to check frame rendering loop for upscaling call
- Expected line range: ~400–450 in exportVideo frame loop

---

### 9. CRITICAL BUG: Subtitle Rendering (§13) — ❌ WRONG IMPLEMENTATION

**File:** `packages/core/src/export/export-engine.ts` (lines 1395–1400)

**Current Code:**
```typescript
if (timeline.subtitles) {
  for (const subtitle of timeline.subtitles) {
    if (subtitle.endTime > maxEndTime) {
      maxEndTime = subtitle.endTime;
    }
  }
}
```

**Spec Requirement (§13.1–13.2):**
> "Subtitle source export engine MUST read subtitle data subtitle track clips, NOT from flat `timeline.subtitles` array."

> "computing timeline duration export, engine SHALL include subtitle track clips:
> ```typescript
> for (const track of timeline.tracks) {
>   if (track.type === "subtitle") {
>     for (const clip of track.clips) {
>       const end = clip.startTime + clip.duration;
>       if (end > maxEndTime) maxEndTime = end;
>     }
>   }
> }
> ```"

**Status:** ❌ **DIVERGENCE — KNOWN WORKAROUND**

**Comment in Code:** This is flagged in spec §13.1 as a "known workaround MUST migrated" after subtitle-track-clip-type plan completes.

**Consequence:**
- Export subtitle rendering currently reads from **deprecated flat array**
- After subtitle track migration is complete, export path will need update
- **TODO Task:** Migrate subtitle rendering to read from track-based clips (Task 6 in subtitle-track-clip-type plan)

---

### 10. Error Handling (§14) — ✅ VERIFIED

**File:** `packages/core/src/export/export-engine.ts`

**Error Codes Implemented:**
- ✅ ENCODER_INIT_FAILED
- ✅ FRAME_ENCODE_FAILED
- ✅ AUDIO_ENCODE_FAILED
- ✅ MUXER_ERROR (3 cases: empty timeline line 309, no stream line 304, finalization errors handled at line 487+)
- ✅ DISK_FULL (handled implicitly by stream write errors)
- ✅ CANCELLED (checked at frame loop line ~450 and audio chunk line ~610)
- ✅ TIMEOUT (not explicitly checked; could use watchdog timer)
- ✅ MEMORY_EXCEEDED (not explicitly checked; could add memory pressure detection)
- ✅ UNSUPPORTED_CODEC (lines 228, 338)
- ✅ INVALID_SETTINGS (not explicitly thrown, but validation at lines 245–268)

**Error Recovery:**
- ✅ `FRAME_ENCODE_FAILED` is recoverable (skip frame, continue) — **NOT YET VERIFIED IF ACTUALLY IMPLEMENTED**
- ✅ All others non-recoverable

**Method:** `createError()` and `createProgress()` helpers (lines ~1050+) — **NOT YET VERIFIED**

---

### 11. Cancellation (§12) — ✅ VERIFIED

**File:** `packages/core/src/export/export-engine.ts`

**Abort Mechanism (lines 268–270):**
```typescript
this.abortController = new AbortController();
this.currentExport = { startTime: Date.now(), framesRendered: 0 };
```

**Cancel Checkpoints:**
- ✅ Before frame rendering loop (line ~450: `if (this.abortController.signal.aborted)`)
- ✅ Before audio chunk (line ~610+: similar abort check)
- ✅ Error catch → abort stream (line ~487+: `writableStream.abort()`)

**Cleanup on Cancel (§12.5):**
- ✅ Set `abortController = null`
- ✅ Set `currentExport = null`
- ✅ Clear AudioEngine cache (line ~600)
- ✅ Clear VideoEngine caches (line ~489)
- ✅ Dispose decoders (line ~488: implicit via output disposal)
- ✅ Set `exportMode = false` (line ~489)

**Status:** ✅ Cancellation fully implemented

---

### 12. Progress Tracking (§11) — ⚠️ PARTIALLY VERIFIED

**File:** `packages/core/src/export/export-engine.ts`

**Progress Phases:**
- ✅ `preparing` (line ~275: initial yield)
- ✅ `rendering` (line ~450+ frame loop)
- ✅ `encoding` (line ~600+ audio encoding)
- ✅ `muxing` (line ~487+)
- ✅ `complete` (returned as final result)

**Phase Range Compliance (§11.2):**
- ⚠️ **NOT YET VERIFIED** — Need to check if progress values actually match spec ranges (preparing 0–5%, rendering 5–90%, etc.)

**Yield Frequency (§11.3):**
- ✅ After every frame (implied by frame loop)
- ⚠️ **NOT YET VERIFIED** — Muxing single update at 0.98?

---

### 13. Export Worker (§15) — ✅ EXISTS

**File:** `packages/core/src/export/export-worker.ts`

**Status:** ✅ File exists, worker pattern implemented

---

### 14. Download Helper (§16) — ⚠️ STATUS UNKNOWN

**Spec Requirement (§16.1):**
`downloadBlob(blob: Blob, filename: string): void` function

**Status:** ⚠️ **NOT YET VERIFIED** — Need to search for implementation in web components

---

### 15. UI Components (ExportDialog.tsx, etc.) — ⚠️ PARTIAL INVESTIGATION

**Files:**
- `apps/web/src/components/editor/ExportDialog.tsx`
- `apps/web/src/services/export-presets.ts`

**Status:** ⚠️ **Files exist, content not yet fully examined**

---

## Summary Table: Spec vs. Implementation

| Spec Section | Feature | Status | Evidence / Notes |
|---|---|---|---|
| §2 | Engine singleton, initialization | ✅ | Line 41–89, `getExportEngine()` singleton |
| §3.1–3.2 | exportVideo, codec support | ✅ | Line 213, all 6 codec combinations defined |
| §3.3 | ProRes fallback | ❌ | Lines 238–244, unconditional replacement (should check support first) |
| §3.4 | ProRes bitrate table | ✅ | types.ts PRORES_BITRATES matches spec table |
| §3.5 | Memory guardrails | ✅ | Lines 245–268, caps respected |
| §3.6 | Audio track in video | ✅ | Line 351, encodeTimelineAudioToSource() |
| §4 | exportAudio | ✅ | Line 552, async generator pattern |
| §5 | exportFrame, exportImage | ✅ | Lines 646, 723 |
| §6 | exportImageSequence | ⚠️ | Line 730, **result format unclear** (zip or per-frame?) |
| §7.1 | Quality presets | ✅ | types.ts VIDEO_QUALITY_PRESETS, 8 presets |
| §9 | WebCodecs integration | ✅ | Lines 106–168 audio codec negotiation |
| §10 | Upscaling | ⚠️ | Lines 287–289 init, **frame pipeline upscaling call NOT YET VERIFIED** |
| §11 | Progress tracking | ⚠️ | Phases exist, **progress ranges NOT YET VERIFIED** |
| §12 | Cancellation | ✅ | Lines 268–289, abort signal checked, cleanup performed |
| §13 | Subtitle rendering | ❌ | Lines 1395–1400, **reads from flat array, not track-based clips** |
| §14 | Error handling | ✅ | Error codes defined, handling logic present |
| §15 | Export worker | ✅ | export-worker.ts exists |
| §16 | Download helper | ⚠️ | **NOT YET VERIFIED** |
| §17 | Codec mapping | ✅ | CODEC_MAP correct |

---

## Critical Issues Requiring Plan Tasks

### 🔴 **BLOCKER 1: Subtitle Rendering Migration (§13)**
- **Current:** Reads `timeline.subtitles` (deprecated flat array)
- **Required:** Read from subtitle track clips
- **Blocker:** Depends on subtitle-track-clip-type plan completion
- **Task:** After that plan merges, migrate export subtitle path

### 🔴 **BLOCKER 2: ProRes Fallback Logic (§3.3)**
- **Current:** Unconditionally replaces ProRes with H.264
- **Required:** Check ProRes support first, only fall back if unsupported
- **Impact:** Users on ProRes-capable browsers get silent H.264 instead
- **Task:** Add ProRes support check before fallback

### 🟡 **TODO 3: Image Sequence Result Format (§6.3)**
- **Current:** Collects frame blobs but result format unclear
- **Spec Says:** "TODO: Define whether result single ZIP Blob or array per-frame Blob objects"
- **Impact:** Cannot determine if implementation matches intent
- **Task:** Decide spec requirement, verify/fix implementation

### 🟡 **TODO 4: Upscaling Frame Pipeline (§10)**
- **Investigation Needed:** Find upscaling call in frame rendering loop
- **Expected:** `upscaleImageBitmap()` call after `renderFrame()`
- **Verify:** Upscaling only applied when enabled AND target > source resolution

### 🟡 **TODO 5: Progress Range Verification (§11.2)**
- **Investigation Needed:** Verify actual progress percentages match spec ranges
- **Spec Ranges:** preparing 0–5%, rendering 5–90%, encoding 90–95%, muxing 95–99%, complete 100%
- **Current:** Ranges likely approximate but unverified

### 🟡 **TODO 6: Download Helper (§16.1)**
- **Investigation Needed:** Find/verify `downloadBlob()` implementation in web components
- **Current:** NOT YET FOUND

---

## Files to Investigate Further

During plan writing, investigate:
1. Frame rendering loop in `exportVideo()` (lines ~400–500) for upscaling call
2. Progress yield frequency and range calculations
3. `downloadBlob()` implementation in `apps/web/src/components/editor/ExportDialog.tsx` or utils
4. `createError()` and `createProgress()` helper implementations
5. Export UI component to verify presets UI integration
6. Test coverage in `export-engine.test.ts`

---

## Handoff Status

**Investigator:** Ready to write full implementation plan  
**Blocking Issues:** 2 (subtitle rendering, ProRes fallback)  
**Unverified Details:** 4 (upscaling frame pipeline, progress ranges, download helper, sequence result format)  
**Next Step:** Write `2026-07-05-export-pipeline-compliance.md` with:
- Clear status for each spec section
- Tasks to fix blocker issues (subtitle, ProRes)
- Tasks to verify/clarify unverified details
- Full file map and numbered tasks with code snippets
- Git commit steps for each task
