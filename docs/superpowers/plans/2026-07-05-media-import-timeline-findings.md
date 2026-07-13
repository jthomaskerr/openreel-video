# Media Import Timeline Implementation Findings

## Current State (Audited 2026-07-13 16:16 AEST)

**Document type:** PARTIAL HISTORICAL FINDINGS, NOT AN EXECUTABLE PLAN. Canonical owners: [Media Assets](../../spec/media-assets.md), [Timeline](../../spec/timeline.md), and [Music Video Workflow](../../spec/music-video-workflow.md).

| Area | Current state |
|---|---|
| Standard file import | Implemented through project-store/media processing with metadata and thumbnail extraction. |
| Music-video/Neural Frames import | Substantially implemented with real metadata media and tests. |
| SRT import | Partial; stall bypass exists but output uses legacy text clips. |
| Timeline placement | Multiple placement paths exist, including generated shot placement; a single selected-track/time/context-menu invariant is not proven across all entry points. |
| Folder/replacement/version import | Implemented in parts; title, collision, and availability consistency are not fully covered. |
| Browser evidence | No comprehensive picker, drag/drop, folder, SRT, generated, selected-track, and reload matrix is recorded. |

**Next action:** create a focused general-import/placement remediation plan after closing the subtitle and runtime-availability contracts.

**Date:** 2026-07-05  
**Spec Reference:** `docs/spec/media-import-timeline.md`  
**Related Plan:** `2026-06-28-music-video-timeline-native.md`

---

## Summary

General media import flow **substantially implemented**. Need to verify scope boundary with music-video plan.

---

## Key Areas to Verify

1. **Import Entry Points (§2)**
   - [ ] File picker exists
   - [ ] Drag-drop onto timeline works
   - [ ] Paste from clipboard (if supported)
   - [ ] URL import (if supported)

2. **Track Type Detection (§3)**
   - [ ] File extension mapping (.mp4 → video, .mp3 → audio, .srt → subtitle)
   - [ ] MIME type detection fallback
   - [ ] Metadata track detection

3. **Track Creation & Positioning (§4–5)**
   - [ ] New track created with correct type
   - [ ] Positioned appropriately (video top, audio below, subtitles at bottom)
   - [ ] User positioning preferences respected

4. **Metadata Tracks (§6)**
   - [ ] Metadata track type exists and importable
   - [ ] Markers/cue points display on timeline

5. **Scene/Character/Style Import (§7)**
   - [ ] Project-level metadata import
   - [ ] Character list management
   - [ ] Style guide storage

6. **Generated Assets Import (§8)**
   - [ ] Upscaled frames importable
   - [ ] Storyboard previews importable

7. **Missing File Recovery (§9)**
   - [ ] Placeholder/error state shown
   - [ ] Retry/recovery options available

8. **Batch Import (§10)**
   - [ ] Multiple files at once
   - [ ] Batch progress indicator

9. **Format Support (§11)**
   - [ ] All spec table formats supported
   - [ ] Unsupported formats rejected

---

## Scope Boundary

**CRITICAL:** Music-video-timeline-native plan covers music-video-specific import (beat detection, synchronization).

**This plan covers:** General import flow for all timeline types.

**Verify:** What does music-video-timeline-native plan actually cover? Don't duplicate.

---

## Files to Examine

- `apps/web/src/services/import/` (expected)
- `apps/web/src/components/editor/ImportDialog.tsx` (or similar)
- Drag-drop handlers
- Format detection logic

---

**Handoff Status:** 30% investigated. High priority (foundational).
