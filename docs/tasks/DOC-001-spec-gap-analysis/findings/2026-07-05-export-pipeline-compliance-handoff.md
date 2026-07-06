# Handoff: Export Pipeline Compliance Plan

**Task:** Write `docs/superpowers/plans/2026-07-05-export-pipeline-compliance.md`  
**Spec:** `docs/spec/export.md` (§1–18)  
**Status:** Ready for investigator — subagent failed at rate limit before completion

---

## Investigation Scope

### Spec Sections to Cover

Read the entire export spec in `docs/spec/export.md`. Key sections:

- **§2:** Export Engine Architecture (singleton, GPU initialization, capability detection, disposal)
- **§3:** Video Export (formats, codecs, ProRes fallback, bitrate table, memory guardrails, audio track selection, frame pipeline, muxing)
- **§4:** Audio-Only Export (formats, settings, chunk rendering, WAV fallback)
- **§5:** Image Export (single frame, still image, formats)
- **§6:** Image Sequence Export (TODO: not yet implemented)
- **§7:** Quality Presets (8 built-in presets table)
- **§8:** Custom Settings (bitrate, frame rate, codec, color depth, pixel format, keyframe interval)
- **§9:** Hardware Encoding via WebCodecs (codec selection, audio codec negotiation, fallback)
- **§10:** AI Upscaling via WebGPU Shaders (quality modes, trigger conditions, pipeline, texture pool)
- **§11:** Progress Tracking (phase lifecycle, yield frequency, async generator pattern)
- **§12:** Cancellation (abort mechanism, cancel checkpoints, cleanup)
- **§13:** Subtitle Rendering During Export (**CRITICAL BUG AREA** — see below)
- **§14:** Error Handling (error codes, recovery, result shape)
- **§15–17:** Export Worker, Download Helper, Codec Mapping

### Current Implementation Files

- **Main engine:** `packages/core/src/export/export-engine.ts` (~1,600 lines)
- **Type definitions:** `packages/core/src/export/types.ts` (all types defined)
- **Export worker:** `packages/core/src/export/export-worker.ts`
- **Tests:** `packages/core/src/export/export-engine.test.ts`
- **Web UI:** `apps/web/src/components/editor/ExportDialog.tsx` (export dialog)
- **Presets service:** `apps/web/src/services/export-presets.ts`

---

## Key Investigations Required

### 1. Codec Support Verification (§3.2, §9)

**Spec Requirement:** Support MP4 (H.264, H.265), WebM (VP8, VP9, AV1), MOV (ProRes variants)

**Investigation:**
```bash
# Search for codec definitions and validation
grep -n "codec" packages/core/src/export/export-engine.ts | head -20
grep -n "h264\|h265\|vp8\|vp9\|av1\|prores" packages/core/src/export/export-engine.ts

# Check CODEC_MAP constant
grep -A 10 "CODEC_MAP" packages/core/src/export/types.ts
```

**What to Verify:**
- [ ] All codec combinations in §3.2 table are supported (or documented as unsupported)
- [ ] CODEC_MAP (§17) correctly maps internal names to WebCodecs strings
- [ ] Codec validation throws errors for unsupported combinations

---

### 2. ProRes Fallback Logic (§3.3, §3.4, §3.5)

**Spec Requirement:** 
- ProRes encoding may not be supported; fall back to H.264 MP4 when unavailable
- ProRes bitrate table must be applied by profile and resolution
- Memory-intensive codecs (VP9, AV1, H.265) must respect resolution/frame rate guardrails

**Investigation:**
```bash
# Search for ProRes handling
grep -n "prores\|ProRes" packages/core/src/export/export-engine.ts
grep -n "PRORES_BITRATES" packages/core/src/export/types.ts

# Check memory guardrails for memory-intensive codecs
grep -n "memory\|vp9\|av1\|h265\|1920\|1080" packages/core/src/export/export-engine.ts | head -30
```

**What to Verify:**
- [ ] ProRes fallback to H.264 at 25,000 kbps, quality 95 when unsupported
- [ ] PRORES_BITRATES table matches §3.4 (6 profiles × 2 resolutions = 12 entries)
- [ ] Memory-intensive codec guardrails: max 1920×1080 for timelines > 120 seconds

---

### 3. Upscaling Integration (§10)

**Spec Requirement:** WebGPU-based AI upscaling with 3 quality modes (fast/balanced/quality)

**Investigation:**
```bash
# Check upscaling engine integration
grep -n "upscal\|Upscal" packages/core/src/export/export-engine.ts
grep -n "UpscalingEngine\|getUpscalingEngine" packages/core/src/export/export-engine.ts

# Search for frame upscaling call in rendering pipeline
grep -n "upscaleImageBitmap\|upscale" packages/core/src/export/export-engine.ts
```

**What to Verify:**
- [ ] UpscalingEngine initialized with GPU device in `initializeGPUForExport()`
- [ ] Upscaling applied only when `settings.upscaling.enabled === true`
- [ ] Upscaling applied only when target resolution > source resolution
- [ ] All 3 quality modes (fast/balanced/quality) are implemented
- [ ] Texture pool maintained (MAX_POOL_SIZE = 4)

---

### 4. CRITICAL BUG: Subtitle Rendering (§13)

**Spec Requirement:** Subtitles MUST be read from subtitle track clips, NOT from `timeline.subtitles` flat array

**Current Bug Location:**
- File: `packages/core/src/export/export-engine.ts`
- Lines: ~1395–1400
- Issue: Reads from `timeline.subtitles` (deprecated workaround)
- Should: Iterate `timeline.tracks` for type === "subtitle" clips

**Investigation:**
```bash
# Find subtitle handling in export
grep -n "subtitle" packages/core/src/export/export-engine.ts

# Search for renderSubtitleToCanvas or subtitle rendering call
grep -n "renderSubtitle\|Subtitle.*Canvas" packages/core/src/export/export-engine.ts

# Check if frame rendering calls subtitle rendering
grep -n "renderFrame\|render.*subtitle" packages/core/src/export/export-engine.ts
```

**What to Verify:**
- [ ] Current implementation reads from `timeline.subtitles` (confirm the bug exists)
- [ ] Plan MUST include a task to migrate to track-based reading
- [ ] Subtitle track clips have correct data structure (text, style, words, animationStyle per §13.4)
- [ ] Frame rendering pipeline calls subtitle canvas rendering

---

### 5. Progress Tracking (§11)

**Spec Requirement:** ExportProgress phases: preparing (0–5%) → rendering (5–90%) → encoding (90–95%) → muxing (95–99%) → complete (100%)

**Investigation:**
```bash
# Search for phase tracking
grep -n "phase.*preparing\|phase.*rendering\|phase.*encoding\|phase.*muxing" packages/core/src/export/export-engine.ts

# Check progress yield points
grep -n "yield.*progress\|ExportProgress" packages/core/src/export/export-engine.ts | head -20
```

**What to Verify:**
- [ ] All 5 phases are yielded in correct order
- [ ] Progress ranges match spec (preparing 0–5%, rendering 5–90%, etc.)
- [ ] `estimatedTimeRemaining` is calculated (not just 0)
- [ ] Progress is yielded after every frame during rendering

---

### 6. Error Handling & Recovery (§14)

**Spec Requirement:** 10 error codes, with `FRAME_ENCODE_FAILED` marked recoverable, others non-recoverable

**Investigation:**
```bash
# Find error handling
grep -n "ExportError\|error.*code\|ENCODER_INIT_FAILED\|FRAME_ENCODE_FAILED" packages/core/src/export/export-engine.ts | head -30

# Check error result shape
grep -n "success.*false\|error.*return" packages/core/src/export/export-engine.ts | head -20
```

**What to Verify:**
- [ ] All 10 error codes are used (or document which are not yet needed)
- [ ] FRAME_ENCODE_FAILED is marked `recoverable: true`
- [ ] All other errors marked `recoverable: false`
- [ ] Cleanup performed on any error (§12.5: abort stream, clear caches, set references to null)

---

### 7. Audio Codec Negotiation (§3.6, §9.4)

**Spec Requirement:** 
- Try requested bitrate, then fall back: [requested, 192000, 128000, 96000]
- Try codec preference: AAC → MP3 → Opus
- Validate via `AudioEncoder.isConfigSupported()`
- Default to AAC at 128 kbps if no codec found

**Investigation:**
```bash
# Find audio codec selection logic
grep -n "findSupportedAudioCodec\|getFirstEncodableAudioCodec" packages/core/src/export/export-engine.ts

# Check codec validation
grep -n "isAudioConfigSupported\|AudioEncoder" packages/core/src/export/export-engine.ts | head -20
```

**What to Verify:**
- [ ] Codec fallback chain matches spec (AAC → MP3 → Opus)
- [ ] Bitrate fallback chain implemented correctly
- [ ] Validation uses `AudioEncoder.isConfigSupported()` before committing to codec

---

### 8. Cancellation Checkpoints (§12.2–12.5)

**Spec Requirement:** Check abort signal:
- Before each frame in rendering loop
- Before each audio chunk in encoding
- On error, abort writable stream
- Cleanup: set abortController to null, clear caches, dispose decoders

**Investigation:**
```bash
# Search for abort checks
grep -n "abort\|AbortController" packages/core/src/export/export-engine.ts | head -30

# Look for throw CANCELLED or cancel handling
grep -n "CANCELLED\|aborted" packages/core/src/export/export-engine.ts
```

**What to Verify:**
- [ ] Abort signal checked before each frame loop iteration
- [ ] Abort signal checked before each audio chunk
- [ ] CANCELLED error thrown with correct result shape
- [ ] Cleanup performed after cancel (§12.5 checklist)

---

### 9. Image Sequence Export Status (§6)

**Spec Note:** §6.1 says "The `exportSequence` method is not yet implemented in the current `ExportEngine`. Implementation MUST follow the same async-generator pattern as `exportVideo`."

**Investigation:**
```bash
# Check for exportSequence or exportImageSequence
grep -n "exportSequence\|exportImageSequence" packages/core/src/export/export-engine.ts
grep -n "SequenceExportSettings" packages/core/src/export/types.ts
```

**What to Verify:**
- [ ] Is `exportSequence` / `exportImageSequence` implemented or still TODO?
- [ ] If implemented, does it follow async generator pattern?
- [ ] If not implemented, note as "Not Implemented" task in plan

---

## Plan Document Structure

Write `docs/superpowers/plans/2026-07-05-export-pipeline-compliance.md` with:

### 1. **Goal Statement**
Brief description of export engine scope and role in the system.

### 2. **Current State vs. Spec (Table)**

Create a table summarizing implementation status for each major section:

| Spec Section | Feature | Status | Notes |
|---|---|---|---|
| §2 | Engine singleton, initialization | ✅ Implemented | [file:line] |
| §3.1–3.2 | Video export methods, codec support | ? | Verify all codecs... |
| §3.3 | ProRes fallback | ? | Need to verify fallback logic... |
| §3.5 | Memory guardrails | ? | Check resolution caps... |
| §10 | Upscaling pipeline | ? | Verify UpscalingEngine integration... |
| §13 | Subtitle rendering | ❌ **BUG** | Reads `timeline.subtitles` instead of tracks (line 1395) |
| ... | ... | ... | ... |

### 3. **Architecture / Tech Stack**

Brief overview of how the export engine works (singleton pattern, WebCodecs, mediabunny, GPU compositor, etc.)

### 4. **File Map (Table)**

List all files to create/modify:

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/export/export-engine.ts` | Modify | [specific tasks] |
| `packages/core/src/export/types.ts` | Modify | [if needed] |
| `apps/web/src/components/editor/ExportDialog.tsx` | Modify | [if UI changes needed] |
| ... | ... | ... |

### 5. **Numbered Tasks**

For each gap found, create a task with:

```markdown
## Task N: [Task Title]

**Files:**
- Modify: `packages/core/src/export/export-engine.ts`
- Verify: `apps/web/src/components/editor/ExportDialog.tsx`

**Steps:**

- [ ] **Step 1: [Specific action]**

```typescript
// Before:
...
// After:
...
```

- [ ] **Step 2: [Next action]**

... (more steps)

- [ ] **Verification:** Run typecheck + tests
```bash
pnpm --filter @openreel/core typecheck
pnpm --filter @openreel/core test:run
```

- [ ] **Commit:**
```bash
git add packages/core/src/export/
git commit -m "feat(export): [description]"
```
```

### 6. **Size/Complexity Estimate**

XL (very large) — export engine is complex; many codec combinations and edge cases.

---

## Critical Bug to Document

### Subtitle Rendering Migration Task

This task MUST be included in the plan:

```markdown
## Task X: Migrate Subtitle Rendering to Track-Based Clips

**Bug Summary:** Current implementation reads subtitles from `timeline.subtitles` flat array (workaround). Spec §13 requires reading from subtitle track clips only.

**Current Code (Line 1395–1400):**
[Show current code that reads from timeline.subtitles]

**Required Change:**
Iterate `timeline.tracks`, filter type === "subtitle", extract clips, read subtitle data from clips.

**Files:**
- `packages/core/src/export/export-engine.ts` (§13.2–13.3)
- Related: `packages/music-video-domain/src/types.ts` (subtitle track/clip structure)

**Steps:**
- [ ] Read Subtitle Track/Clip Type plan (2026-07-03-subtitle-track-clip-type.md) to understand track structure
- [ ] Update duration calculation to include subtitle tracks (§13.2)
- [ ] Update frame rendering to pass subtitle clips to canvas rendering (§13.3)
- [ ] Verify subtitle data structure matches spec §13.4
- [ ] Test export with subtitle timeline
```

---

## Open Questions (From Spec §18)

Document these as discussion points in the plan (do NOT implement, just note):

1. ProRes browser support — which browsers support ProRes via WebCodecs?
2. Image sequence result format — ZIP or per-frame blobs?
3. Hardware acceleration preference — should `hardwareAcceleration` be user-configurable?
4. Export queue — currently single export only; should queue multiple?
5. Custom presets persistence — where are they stored?
6. Audio-only export with video timeline — include audio from video clips or audio tracks only?
7. GIF export — mentioned in README as "In Progress"; requirements?
8. Progress granularity — throttle for very long exports?

---

## Completion Checklist

- [ ] Spec §1–18 read in full
- [ ] All 9 investigations above completed
- [ ] Current State vs. Spec table filled in
- [ ] All gaps classified (Implemented/Divergent/Partial/Not)
- [ ] File map created
- [ ] All numbered tasks written with:
  - [ ] Files subsection
  - [ ] Steps subsection (checkboxes)
  - [ ] Code examples where helpful
  - [ ] Verification commands
  - [ ] Git commit step
- [ ] Size/complexity estimate provided
- [ ] Critical subtitle rendering bug task included
- [ ] Open questions documented
- [ ] Document matches tone/structure of existing plans (e.g., 2026-07-03-atlascloud-support.md)
- [ ] No application source files modified
- [ ] Plan file written to `docs/superpowers/plans/2026-07-05-export-pipeline-compliance.md`

---

**Handoff created:** 2026-07-05T19:48:06Z  
**Ready for investigator:** Yes  
**Predecessor:** Doc-001 task completion  
**Next:** Submit plan document; supervisor will verify completeness
