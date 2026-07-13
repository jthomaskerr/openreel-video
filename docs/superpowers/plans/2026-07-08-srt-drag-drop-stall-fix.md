# SRT Drag/Drop Stall Fix

## Current State (Audited 2026-07-13 16:16 AEST)

**Overall:** STALL PATH PARTIALLY FIXED; OUTPUT MODEL NONCONFORMANT. Canonical owner: [Audio Analysis & Subtitles](../../spec/audio-analysis-subtitles.md).

| Step | State | Current evidence and remaining work |
|---|---|---|
| 1 SRT import bypass | Implemented | SRT is recognized without media decoding and has import regression coverage. |
| 2 route to subtitle track | Implemented | `addClipToNewTrack` selects `trackType = "subtitle"` for SRT media. |
| 3 parse cues | Partial/nonconformant | SRT parsing works, but generated cues are text clips rather than first-class subtitle clips. |
| 4 internal asset-panel drop | Partial | Store/timeline routing exists; exact internal drag/drop integration lacks a dedicated current test. |
| 5 browser verification | Not verified | No timestamped drag/drop browser run or large-file stall measurement exists. |

**Additional canonical gaps:** VTT, bounded/off-main-render parsing, explicit partial-failure policy, and first-class subtitle migration. **Next action:** complete the subtitle model plan, then rerun SRT/VTT browser and performance scenarios.

**Status:** Partial implementation; nonconformant with the canonical first-class subtitle model.
**Inbox:** #4  
**Date:** 2026-07-08

## Problem

Dragging an `.srt` subtitle file onto the timeline stalls — the file silently fails to import and no subtitle track is created.

## Root Cause

Two blocking gaps prevent the flow from completing:

**Gap 1 — `importMedia` cannot import SRT files.**  
The import pipeline delegates to MediaBunny's `createInput(file, { formats: ALL_FORMATS })`. SRT is not in MediaBunny's `ALL_FORMATS` (mediabunny supports only `webvtt` for subtitles), so `validateFormat` → `getFormat()` returns `null`, and `importMedia` returns `{ success: false }`. The SRT never becomes a `MediaItem`.

**Gap 2 — `addClipToNewTrack` never routes SRT to a subtitle track.**  
Even if an SRT `MediaItem` existed, the track-type dispatch only handles `video | audio | image`, defaulting to `"video"`. No `"subtitle"` track is ever created.

## Plan

### Step 1 — SRT bypass in `importMedia`

**File:** `apps/web/src/stores/project-store.ts`  
Add a short-circuit before the MediaBunny import call for `.srt` files:

- Detect SRT by extension (`.srt`) or MIME type (`text/srt`, `application/x-subrip`)
- Read file text via `file.text()`
- Parse first/last timestamp to derive duration
- Create `MediaItem` with `type: "srt"`, `blob: file`, and `metadata.duration`
- Add to media library and persist blob — bypass MediaBunny entirely

### Step 2 — Route SRT → subtitle track in `addClipToNewTrack`

**File:** `apps/web/src/stores/project-store.ts`  
Add `mediaItem.type === "srt"` → `trackType = "subtitle"` to the track-type mapping.

### Step 3 — Parse SRT content into subtitle clips

After creating the subtitle track, read the SRT text from the `MediaItem` blob, parse it into subtitle segments using existing `parseSRT` helper, and add subtitle clips to the track.

### Step 4 — Internal asset-panel SRT drop

**File:** `apps/web/src/components/editor/Timeline.tsx`  
Detect `mediaItem.type === "srt"` in the internal drag path and route to subtitle track creation.

### Step 5 — Browser verification

Start dev server, drag `.srt` files onto timeline, confirm subtitle track + clips appear.

## Files Affected

| File | Change |
|------|--------|
| `apps/web/src/stores/project-store.ts` | SRT bypass in `importMedia`, routing in `addClipToNewTrack`, SRT parsing into subtitle clips |
| `apps/web/src/components/editor/Timeline.tsx` | Internal SRT drop detection |
| `apps/web/src/stores/project/subtitle-helpers.ts` | Use existing `parseSRT` (no changes needed) |
