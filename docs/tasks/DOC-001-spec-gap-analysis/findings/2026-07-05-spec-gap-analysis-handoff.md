# Spec Gap Analysis — Implementation Handoff

**Date:** 2026-07-05  
**Status:** Gap Analysis Complete — 8 Plan Documents Pending  
**Supervisor:** Claude Code (Batch 20260705T194806)

---

## Executive Summary

The DOC-001 task analyzed all 19 specs in `docs/spec/` against existing plans in `docs/superpowers/plans/`. The analysis identified **8 specs with no corresponding implementation plans**:

1. **export.md** — Export pipeline (video/audio/image formats, codecs, quality presets, upscaling, subtitle rendering)
2. **inspector-shell.md** — Right sidebar inspector panel (4-tab layout, clip-type-specific tabs, metadata/storyboard inspectors)
3. **media-import-timeline.md** — Media import flow (track types, metadata layout, scene/character/style import, missing-file handling)
4. **project-lifecycle.md** — Project creation/deletion/naming UX (picker, welcome screen, settings)
5. **asset-management-ux.md** — Asset browser (density modes, buckets, search/sort, drag-to-timeline, batch ops)
6. **problems-errors-logging.md** — Problems tab & Log pane (resolve actions, ProblemKind registry, immutability, persistence)
7. **thumbnails-fallbacks.md** — Thumbnail generation & fallback priority (reference image → gradient, video frame extraction)
8. **testing-expectations.md** — Cross-cutting testing mandate (TDD, regression tests, coverage thresholds)

---

## What Was Done in DOC-001

✅ **Step 1: Spec → Plan Coverage Map**
- Read all 19 specs + 11 existing plans
- Identified which specs are already partially/fully covered by existing plans
- Listed 8 gaps with no corresponding plan

✅ **Step 2: Preliminary Completeness Classification**
- Scanned existing plans for scope overlap
- Determined which gaps need NEW plan documents (not covered by existing plans)

✅ **Step 3: Initial Gap List**
- Generated `docs/superpowers/plans/2026-07-05-spec-gap-priorities.md` with:
  - All 12 existing plans ranked by priority (P0 foundations → P1 features → P2 polish)
  - 8 gap specs listed as "unplanned" with no implementation path yet

❌ **Step 4: Deep Implementation Plans (NOT COMPLETED)**
- **Required but pending:** Write full plan documents for each of the 8 gaps
- Each plan requires:
  - Reading the spec IN FULL
  - Investigating the ACTUAL current implementation in `apps/` and `packages/`
  - Classifying each spec requirement: Implemented & Correct / Implemented but Divergent / Partially Implemented / Not Implemented
  - Writing a plan matching the existing format (Goal, Architecture, Tech Stack, File map, numbered Tasks with checkboxes, verification commands, git commit steps, size/complexity estimate)

---

## Handoff: 8 Plans Awaiting Deep Analysis

### Plan 1: **2026-07-05-export-pipeline-compliance.md**

**Spec:** `docs/spec/export.md` (§1–18)  
**Key Sections:** Video/audio/image formats, codecs, quality presets, upscaling via WebGPU, subtitle rendering, error handling  
**Current Implementation:** `packages/core/src/export/export-engine.ts` (1,600+ lines)  
**Investigation Needed:**
- [ ] Verify all supported codec combinations (H.264, H.265, VP8, VP9, AV1, ProRes variants)
- [ ] Check ProRes fallback logic when unsupported
- [ ] Confirm quality presets match spec table (§7.1)
- [ ] Verify upscaling pipeline integration (§10) with WebGPU shaders
- [ ] **CRITICAL:** Check subtitle rendering — spec §13 says subtitles MUST be read from subtitle track clips, NOT `timeline.subtitles` flat array. Current implementation at line 1395–1400 uses flat array — this is a known workaround needing migration.
- [ ] Verify error codes and recovery logic (§14)
- [ ] Check memory-intensive codec guardrails (§3.5)
- [ ] Confirm progress reporting granularity and phase lifecycle (§11)

**Open Questions from Spec:**
- Which browsers support ProRes encoding? Should UI hide/warn?
- Image sequence: ZIP blob or per-frame blobs?
- Should `hardwareAcceleration` be user-configurable?
- Export queue support (currently single export only)?
- Custom presets persistence location?

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-export-pipeline-compliance.md` with full file map, tasks, and git commit steps

---

### Plan 2: **2026-07-05-inspector-shell-completion.md**

**Spec:** `docs/spec/inspector-shell.md`  
**Key Sections:** 4-tab layout (Inspector, Edit, Problems, Log), clip-type-specific sub-tabs, metadata/storyboard/asset inspectors  
**Current Implementation:** `apps/web/src/` inspector components (search for `InspectorPanel`, tab components)  
**Investigation Needed:**
- [ ] Verify 4-tab layout exists and matches spec
- [ ] Check clip-type-specific sub-tab system (character pill system §3.8 mentioned as "not implemented")
- [ ] Verify metadata inspector for all clip types (Video, Audio, Text, Image, Shape, Storyboard, etc.)
- [ ] Check storyboard clip inspector for scene/panel/dialogue metadata
- [ ] Verify asset inspector for media/font/effect assets
- [ ] Check Problems tab tab integration
- [ ] Check Log pane tab integration
- [ ] Verify all inspector update triggers (selection change, clip edit, property change)

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-inspector-shell-completion.md` with file map and tasks

---

### Plan 3: **2026-07-05-media-import-timeline.md**

**Spec:** `docs/spec/media-import-timeline.md`  
**Related Plan:** `2026-06-28-music-video-timeline-native.md` (covers music-video-specific import; this plan covers GENERAL import flow)  
**Key Sections:** Track types, metadata track layout, scene/character/style import, generated asset placement, missing-file handling  
**Current Implementation:** `apps/web/src/` import handlers, drag-drop, file pickers (use grep/code_find)  
**Investigation Needed:**
- [ ] Read the music-video-timeline-native plan to see what it already covers for import
- [ ] Identify gaps NOT covered there
- [ ] Verify track type detection (video, audio, subtitle, metadata, generated)
- [ ] Check metadata track layout (timecode, markers, cue points)
- [ ] Verify scene/character/style import for non-music-video projects
- [ ] Check generated asset (storyboard, upscaled frame) placement logic
- [ ] Verify missing-file recovery/retry flow

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-media-import-timeline.md` with file map and tasks (scope limited to gaps not in music-video-timeline-native)

---

### Plan 4: **2026-07-05-project-lifecycle-ux.md**

**Spec:** `docs/spec/project-lifecycle.md`  
**Related Plan:** `2026-07-01-backend-autosave-git-lfs.md` (covers backend persistence; this plan covers FRONTEND UX only)  
**Key Sections:** Project creation, deletion, naming, picker/welcome screen, settings  
**Current Implementation:** `apps/web/src/` project creation/deletion/naming/picker UI  
**Investigation Needed:**
- [ ] Read backend-autosave-git-lfs plan to see what backend scope it covers
- [ ] Identify FRONTEND gaps not covered there
- [ ] Verify project creation wizard/flow
- [ ] Check project deletion confirmation and cleanup
- [ ] Verify project renaming UI
- [ ] Check project picker/list view
- [ ] Verify welcome screen for new users
- [ ] Check project settings panel (if any)
- [ ] Verify recent projects list persistence

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-project-lifecycle-ux.md` with file map and tasks (frontend-only scope)

---

### Plan 5: **2026-07-05-asset-management-ux.md**

**Spec:** `docs/spec/asset-management-ux.md`  
**Key Sections:** Asset browser (density modes, buckets, search/sort, drag-to-timeline, batch operations, inline rename)  
**Current Implementation:** `apps/web/src/` asset browser/panel components  
**Investigation Needed:**
- [ ] Verify asset browser panel exists
- [ ] Check density modes (compact, normal, expanded)
- [ ] Verify bucket organization (by type, by source, by tag)
- [ ] Check search and sort functionality
- [ ] Verify drag-to-timeline placement
- [ ] Check batch operations (select multiple, delete, tag, move)
- [ ] Verify inline rename for assets
- [ ] Check asset preview/thumbnail generation
- [ ] Verify asset metadata display (resolution, duration, file size)

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-asset-management-ux.md` with file map and tasks

---

### Plan 6: **2026-07-05-problems-errors-logging-compliance.md**

**Spec:** `docs/spec/problems-errors-logging.md`  
**Key Sections:** Resolve actions, ProblemKind registry, log immutability, cross-session persistence  
**Current Implementation:** `apps/web/src/` Problems panel and Log pane (search for `problemBus`, `ProblemKind`, log store)  
**Critical Finding from Initial Scan:**
- The `retry_generation` action **immediately resolves the problem**, contradicting spec §4.2 which requires "does NOT auto-resolve — the problem resolves only when the retry succeeds."

**Investigation Needed:**
- [ ] Read spec §3–5 (ProblemKind registry, resolve actions, recovery patterns)
- [ ] Verify all ProblemKind types are defined in codebase
- [ ] **CRITICAL:** Fix retry_generation auto-resolve bug
- [ ] Check log immutability (append-only, no modification)
- [ ] Verify cross-session log persistence
- [ ] Check log size/retention limits
- [ ] Verify resolve action execution and result handling
- [ ] Check test coverage for Problems subsystem

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-problems-errors-logging-compliance.md` with file map and tasks
- **Bug fix task** for auto-resolve issue

---

### Plan 7: **2026-07-05-thumbnails-fallbacks-compliance.md**

**Spec:** `docs/spec/thumbnails-fallbacks.md`  
**Key Sections:** Missing-file fallback priority (reference image → gradient), non-video thumbnail fill, video frame extraction  
**Current Implementation:** `apps/web/src/` thumbnail utilities (search for `thumbnail-utils.ts`, related components)  
**Investigation Needed:**
- [ ] Verify fallback chain: actual file → reference image → color gradient
- [ ] Check non-video clip thumbnail fill (shapes, text, audio)
- [ ] Verify video frame extraction for thumbnails (filmstrip, preview)
- [ ] Check `effectiveThumbnailUrl` logic
- [ ] Verify thumbnail caching strategy
- [ ] Check lazy-load thumbnail rendering

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-thumbnails-fallbacks-compliance.md` with file map and tasks

---

### Plan 8: **2026-07-05-testing-expectations-compliance.md**

**Spec:** `docs/spec/testing-expectations.md`  
**Type:** Cross-cutting PROCESS mandate (not a feature)  
**Key Sections:** TDD requirements, regression test expectations, coverage thresholds, CI gates  
**Current Implementation:** Per-package test scripts (check `package.json` in each area)  
**Investigation Needed:**
- [ ] Audit test scripts per package:
  - `apps/web` — test:run exists?
  - `apps/orchestrator` — test:run exists?
  - `apps/image` — test:run exists?
  - `packages/core` — test:run exists?
  - `packages/image-core` — test:run exists?
  - `packages/music-video-domain` — test:run exists?
  - `packages/ui` — test:run exists?
- [ ] Check coverage tooling and thresholds
- [ ] Verify CI pipeline gates (if any)
- [ ] Check test naming/organization conventions
- [ ] Identify packages missing test infrastructure

**Deliverables:**
- `docs/superpowers/plans/2026-07-05-testing-expectations-compliance.md` (process/checklist format, not feature-based)
- Per-package remediation tasks (add test:run scripts, configure coverage, etc.)

---

## Next Steps: Execution Plan

To complete all 8 plans, each investigator should:

1. **Read the spec IN FULL** (available in `docs/spec/`)
2. **Investigate actual implementation** using:
   - `code_find` / `code_graph` / `grep` for codebase search
   - `code_inspect` / `code_orientation` for precise symbol understanding
   - Manual file reading for large source files
3. **Classify every requirement** in the spec:
   - ✅ Implemented & Correct (cite file:line)
   - ⚠️ Implemented but Divergent (describe divergence, cite file:line)
   - 🟡 Partially Implemented (describe what's missing, cite file:line)
   - ❌ Not Implemented (describe requirement, suggest approach)
4. **Read 2–3 existing plans** in `docs/superpowers/plans/` to match structure:
   - Goal statement
   - Architecture / Tech Stack overview
   - File map (table of files to create/modify)
   - Numbered Tasks (1, 2, 3, ...) each with:
     - **Files** subsection (list affected files)
     - **Steps** subsection (checklist format `- [ ]`)
     - Concrete code snippets or diff examples where helpful
     - Verification commands (typecheck, lint, test, etc.)
     - Git commit step at the end
   - Rough size/complexity estimate (S/M/L/XL)
5. **Write the plan document** to `docs/superpowers/plans/2026-07-05-<plan-name>.md`
6. **Do NOT modify application source code** — this is a docs-only task

---

## Prioritization

Based on the priority list in `docs/superpowers/plans/2026-07-05-spec-gap-priorities.md`:

**Tier 1 (P0 - Foundation):** None currently in gaps (all P0 plans exist)

**Tier 2 (P1 - Major User-Facing Features):**
1. **export-pipeline-compliance** — blocks media output workflows
2. **asset-management-ux** — core project workflow
3. **media-import-timeline** — foundational for all content
4. **project-lifecycle-ux** — required for new users

**Tier 3 (P1/P2 - Secondary Features & Polish):**
5. **inspector-shell-completion** — metadata editing workflows
6. **problems-errors-logging-compliance** — user support/debugging
7. **thumbnails-fallbacks-compliance** — UX polish
8. **testing-expectations-compliance** — process/quality gate

---

## Files Reference

**Existing Plans (for format/tone reference):**
- `docs/superpowers/plans/2026-07-03-atlascloud-support.md` (detailed feature plan)
- `docs/superpowers/plans/2026-07-03-storyboard-ui.md` (UI-focused plan)
- `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md` (backend/persistence plan)
- `docs/superpowers/plans/2026-06-28-music-video-timeline-native.md` (large architectural plan)

**Specs (read in full for each plan):**
- All files in `docs/spec/` directory

**Alignment/Context:**
- `docs/superpowers/plans/alignment.md` — pre-existing analysis (cross-reference, don't repeat)

---

## Completion Criteria

All 8 plans are complete when:

- [ ] `docs/superpowers/plans/2026-07-05-export-pipeline-compliance.md` exists and is thorough
- [ ] `docs/superpowers/plans/2026-07-05-inspector-shell-completion.md` exists
- [ ] `docs/superpowers/plans/2026-07-05-media-import-timeline.md` exists (gaps-only, not duplicating music-video-timeline-native scope)
- [ ] `docs/superpowers/plans/2026-07-05-project-lifecycle-ux.md` exists (frontend-only, not duplicating backend-autosave-git-lfs scope)
- [ ] `docs/superpowers/plans/2026-07-05-asset-management-ux.md` exists
- [ ] `docs/superpowers/plans/2026-07-05-problems-errors-logging-compliance.md` exists (with critical bug fix task)
- [ ] `docs/superpowers/plans/2026-07-05-thumbnails-fallbacks-compliance.md` exists
- [ ] `docs/superpowers/plans/2026-07-05-testing-expectations-compliance.md` exists (process format)
- [ ] Each plan includes file map, numbered tasks with checkboxes, verification commands, and git commit steps
- [ ] Each plan matches tone/depth of existing plan examples
- [ ] No application source files were modified
- [ ] All plans are cross-referenced from `docs/superpowers/plans/2026-07-05-spec-gap-priorities.md` (update priority list to remove "Gap:" rows and add new plans with P-level and justification)

---

## Known Issues to Watch

1. **Subtitle rendering in export** (Plan 1): Current implementation reads from `timeline.subtitles` flat array; spec requires reading from subtitle track clips. This is a migration blocker after subtitle-track-clip-type plan completes.

2. **Problems auto-resolve bug** (Plan 6): `retry_generation` action auto-resolves immediately; should only resolve on success. This is a blocking bug fix.

3. **Music-video import scope overlap** (Plan 3): Don't duplicate the music-video-timeline-native plan's scope. Focus on general import flow gaps.

4. **Backend vs. frontend split** (Plan 4): backend-autosave-git-lfs handles persistence; project-lifecycle-ux handles only UX/UI.

5. **Pre-existing Python errors** (not a plan): `infra/transcribe-gpu/main.py` has unresolved imports (fastapi, faster_whisper, uvicorn, deep_translator). These are NOT caused by any plan and should not be investigated.

---

**Handoff created:** 2026-07-05T19:48:06Z  
**Next batch:** Run 8 independent plan-writing tasks (sequential to avoid rate limits)  
**Batch supervisor:** Claude Code  
**Approval:** Awaiting operator directive to proceed with plan implementation
