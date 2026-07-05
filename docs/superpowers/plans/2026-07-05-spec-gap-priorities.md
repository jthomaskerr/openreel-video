# Spec Gap — Prioritized Plan List

**Date:** 2026-07-05
**Task:** DOC-001 (Step 4)
**Scope:** Every plan relevant to closing spec gaps — both the new plans written
in Step 3 and the existing plans found in Step 1 — ordered by priority.

---

## Priority Scheme

| Priority | Criteria |
|----------|----------|
| **P0** | Foundation: other specs/plans depend on it; blocks user workflows |
| **P1** | Major capability: user-facing feature with significant impact; can proceed without P0 complete |
| **P2** | Polish / hardening: improves UX, fixes edge cases; lowest dependency count |

Completion status is determined by the plan's own checkpoint markers and
codebase spot-checks performed during Step 2 analysis.

---

## The List

### 1. `2026-07-01-backend-autosave-git-lfs.md` — P0

**One-line summary:** Per-project git-LFS persistence for auto-save, project
recovery, media versioning, and backend-first restore.

**Covers specs:** `backend-persistence-versioning.md`, `project-lifecycle.md`

**Completion status:** ✅ **Ready for execution** — 10 tasks fully documented
(per-project dirs, GitStore, orchestrator routes, multer, web service client,
store wiring, recovery hook, smoke test). 0/10 tasks executed.

**Priority justification:**
- **Foundational.** Backend persistence underpins *every* project save, reload,
  and recovery path. Without it, all project state lives only in IndexedDB
  (volatile) and localStorage (tiny). Every other plan that creates or modifies
  project state implicitly depends on this being in place — if no durable
  backend exists, generated assets, auto-subtitles, and storyboard edits vanish
  on page refresh.
- **Cited by `alignment.md` as heavily-cited foundation.**
- **High user-facing impact:** users lose work today on page reload if IDB
  recovery fails (known bug, tracked in music-video-timeline-native plan Task 16).

**Blast radius:** 6 packages (core, orchestrator, web, 3 infra directories).

---

### 2. `2026-06-28-music-video-timeline-native.md` — P0

**One-line summary:** Build the timeline-native Music Video workflow —
audio import, metadata clips, centralized job polling, inspector-driven UI,
and end-to-end flow. 17 tasks covering the full pipeline.

**Covers specs:** `music-video-timeline-native/` (spec directory),
`music-video-workflow.md`, `media-import-timeline.md` (partial §3–4)

**Completion status:** 🔲 **Not started** — 0/17 tasks executed (all use
`- [ ]` notation).

**Priority justification:**
- **Highest user-facing impact.** The Music Video workflow is the signature
  feature of the app — the reason users come to OpenReel. It enables audio
  import → section identification → storyboard generation → AI asset generation
  → timeline placement in a single integrated flow.
- **Blocks 6 other plans:** Storyboard UI, Generate/ Alter tools, Section
  Identification, Track Grouping, and Atlascloud integration all plug into
  the timeline-native Music Video workflow.
- **17 tasks with clear dependencies** enable progressive delivery (e.g., Tasks
  1–4 are foundational for the rest).

**Blast radius:** 3 packages (web, core, music-video-domain).

---

### 3. `2026-07-05-ai-generation-providers-implementation.md` — P0

**One-line summary:** Close all gaps between the AI Generation & Providers spec
and the current codebase (estimated ~65% complete). 8 phases from type-system
alignment through multi-instance provider config.

**Covers spec:** `ai-generation-providers.md`

**Completion status:** 🔲 **Not started** — new plan (written in Step 3 of
DOC-001).

**Priority justification:**
- **Core monetizable feature.** AI generation (WaveSpeed, KieAI, Atlascloud) is
  the primary value proposition.
- **Blocks Atlascloud full integration.** Phase 2 of this plan executes the
  existing Atlascloud plan; the two plans must be sequenced together.
- **~35% gap (8 phases, 32–42 hours)** but Phase 1 (type system, 1–2h) is a
  trivial quick-win that unblocks everything else.
- **User-facing:** without this plan, Atlascloud never works, job management UI
  never exists, generated assets never appear on the timeline.

**Blast radius:** 5 packages (web, orchestrator, core, music-video-domain, ui).

---

### 4. `2026-07-03-atlascloud-support.md` — P0 (dependency of plan #3)

**One-line summary:** Full Atlascloud provider integration — orchestrator proxy,
web client, job store wiring, model picker UI, settings registry, tests (9 tasks).

**Covers spec:** `atlascloud-provider.md`, `ai-generation-providers.md` (Phase 2)

**Completion status:** 🔲 **Not started** — plan is execution-ready (9 tasks,
all documented). 0/9 tasks executed. Estimated 4–6 hours.

**Priority justification:**
- Atlascloud is required by the AI Generation plan (Phase 2) and the spec
  mandates three providers (WaveSpeed, KieAI, Atlascloud).
- **Blocks Phase 2 of plan #3** — without Atlascloud, the generation providers
  spec is only 2/3 implemented.
- Pre-existing plan from 2026-07-03; well-structured with clear task isolation.

**Blast radius:** 3 packages (orchestrator, web, music-video-domain).

---

### 5. `2026-07-03-audio-analysis-and-selection.md` — P1

**One-line summary:** Python/librosa audio analysis pipeline (genre, beat grid,
energy, section-aligned sentiment) with per-section apply-to-timeline UI.
11 tasks from types through integration test.

**Covers spec:** `audio-analysis-subtitles.md` (§2 – Audio Analysis Pipeline)

**Completion status:** 🔲 **Not started** — 0/11 tasks executed.

**Priority justification:**
- **Blocks section identification** (plan #7), which needs energy boundaries
  and beat grid to infer song sections.
- **Blocks storyboard generation quality** — section-aware sentiment curves
  feed the creative brief used by the LLM.
- **Moderate user-facing impact:** without it, storyboard generation works
  but without audio-informed section boundaries or sentiment data.
- 11 tasks; Python microservice adds some dev-ops overhead.

**Blast radius:** 4 packages (orchestrator, infra/audio-analysis/, web, core).

---

### 6. `2026-07-03-section-identification-flow.md` — P1

**One-line summary:** Detect, display, confirm, and edit song sections using
lyrics, song-form heuristics, energy boundaries, and optional lyrics files.
9 tasks from types through integration test.

**Covers spec:** `sections-identification.md`

**Completion status:** 🔲 **Not started** — 0/9 tasks executed.

**Priority justification:**
- **Directly blocks storyboard generation** (plan #8) — the storyboard LLM
  requires confirmed section boundaries as hard structural input.
- **Blocks storyboard alteration** (plan #9) — same requirement.
- Mid-level user-facing impact: storyboard works without sections but quality
  is degraded (shots don't align to song structure).

**Blast radius:** 3 packages (music-video-domain, web, orchestrator).

---

### 7. `2026-07-03-generate-storyboard-tool.md` — P1

**One-line summary:** Backend storyboard generation via Anthropic LLM with
specialized prompt combining creative brief, confirmed sections, timing
analysis, and optional lyrics. 4 major tasks + frontend UI + tests.

**Covers spec:** `storyboard.md` (partial — creation path)

**Completion status:** 🔲 **Not started** — plan documented but no execution
checkpoints visible.

**Priority justification:**
- **Directly user-facing.** Storyboard generation is the core creative
  workflow step between "import audio" and "generate assets."
- **Blocks the "Generate" half of storyboard tooling.** Without it, users
  manually create shots.
- Requires confirmed sections (plan #6) and audio analysis (plan #5) for best
  results, but can prototype with hardcoded defaults.

**Blast radius:** 3 packages (orchestrator, web, music-video-domain).

---

### 8. `2026-07-03-alter-storyboard-tool.md` — P1

**One-line summary:** LLM-driven diff/patch storyboard tool that accepts "what
to change" and applies changes only after user acceptance. 9 tasks.

**Covers spec:** `storyboard.md` (partial — alteration path)

**Completion status:** 🔲 **Not started** — plan documented; 0/9 tasks executed.

**Priority justification:**
- **Complements plan #7.** Users generate → preview → alter iteratively.
- Same dependencies as plan #7 (confirmed sections, creative brief).
- Slightly lower priority than #7 because generation comes first; alteration
  is a refinement step.

**Blast radius:** 3 packages (orchestrator, web, music-video-domain).

---

### 9. `2026-07-03-storyboard-ui.md` — P1

**One-line summary:** Visual storyboard panel with shot cards, bidirectional
timeline linkage, inline editing, and drag-to-reorder. 9 tasks.

**Covers spec:** `storyboard.md` (partial — UI presentation)

**Completion status:** 🔲 **Not started** — 0/9 tasks executed.

**Priority justification:**
- **Visual layer for plans #7 and #8.** Without the panel, there's no place to
  display generated/edited storyboard shots.
- Directly user-facing — the storyboard panel is the primary UI for shot
  management.
- Depends on track grouping (plan #11) for the expanded shot metadata meta-track.

**Blast radius:** 2 packages (web, music-video-domain).

---

### 10. `2026-07-03-track-grouping-expansion.md` — P1

**One-line summary:** Expandable timeline track groups, collapsed/expanded
shot metadata meta-track, and storyboard-specialized video clip metadata. 9 tasks.

**Covers specs:** `track-grouping.md`, `storyboard.md` (partial — track layer)

**Completion status:** 🔲 **Not started** — 0/9 tasks executed.

**Priority justification:**
- **Timeline infrastructure for storyboard.** Without grouping, the timeline
  doesn't organize storyboard, character, section, and audio tracks into
  logical groups.
- Depends on storyboard clip metadata types from plan #9 for the metadata
  meta-track.

**Blast radius:** 2 packages (web, music-video-domain).

---

### 11. `2026-07-03-subtitle-track-clip-type.md` — P1

**One-line summary:** Replace flat `Timeline.subtitles` array with first-class
`SubtitleClip` on `"subtitle"` tracks, with dedicated rendering and editing.
6 major tasks.

**Covers specs:** `subtitle-track-clip-type.md`, `audio-analysis-subtitles.md`
(§3 – Subtitles as track/clip type)

**Completion status:** 🔲 **Not started** — 0/6 tasks executed.

**Priority justification:**
- **Quality-of-life improvement for subtitle handling.** Currently subtitles
  exist in two divergent data sources (flat array + hijacked text clips) with
  known skipped tests.
- **Blocks correct subtitle export.** Task 6 of this plan fixes export subtitle
  rendering (currently reads flat array which diverges from timeline state).
- Moderate user-facing impact: subtitles work today but with known data
  integrity issues.

**Blast radius:** 3 packages (core, web, orchestrator).

---

### 12. `2026-07-03-audio-auto-subtitle-extraction.md` — P2

**One-line summary:** Auto-transcribe imported audio files using the GPU
transcription service and persist subtitles to the timeline. 8 tasks.

**Covers spec:** `audio-auto-subtitle-extraction.md`, `audio-analysis-subtitles.md`
(§3 – Automatic extraction)

**Completion status:** 🔲 **Not started** — 0/8 tasks executed.

**Priority justification:**
- **Complements plan #11.** First-class subtitle tracks without auto-transcription
  means users must manually create subtitles.
- Lower priority because subtitle creation by import (SRT files) already works.
- Depends on backend persistence (plan #1) for durable subtitle storage and
  the subtitle track/clip type (plan #11) for proper rendering.

**Blast radius:** 3 packages (orchestrator, web, infra).

---

### Spec Gaps Without Plans (Require New Plans — See Below)

The following spec domains were identified in Step 2 as having **no covering
plan**. They are listed here in priority order so new plans can be created.

| Priority | Spec | Gap Description | Estimated Effort |
|----------|------|----------------|------------------|
| **P1** | `export.md` | Full export pipeline (codecs, quality presets, upscaling, progress, error handling, subtitle rendering) is documented but no implementation plan exists. Export engine exists in `packages/core/src/export/` but spec compliance is untested. | 4–6 weeks |
| **P1** | `inspector-shell.md` | Right-sidebar shell spec defines 4-tab layout (Inspector, Edit, Problems, Log) with clip-type-specific sub-tabs. Existing `InspectorPanel.tsx` is partial; metadata, storyboard, and asset inspectors are incomplete. | 2–4 weeks |
| **P1** | `media-import-timeline.md` | Comprehensive import spec (track types, metadata track layout, scene/character/style import, generated asset placement, missing-file handling). Partially covered by music-video-timeline-native plan but general import flow needs standalone plan. | 3–4 weeks |
| **P1** | `project-lifecycle.md` | Project creation, deletion, naming, picker UX. Partially covered by backend-autosave-git-lfs plan (backend persistence). Frontend lifecycle UX (picker, settings, welcome screen) needs its own plan. | 2–3 weeks |
| **P1** | `asset-management-ux.md` | Asset browser with 3 density modes, buckets, search, sort, drag-to-timeline, batch operations, inline rename. Existing UI is basic; spec describes significantly richer experience. | 3–4 weeks |
| **P1** | `problems-errors-logging.md` | Two-tier error surface (Problems tab + Log pane). Problems-panel UI exists but spec compliance (resolve actions, ProblemKind registry, log immutability, cross-session persistence) is untested. | 1–2 weeks |
| **P2** | `thumbnails-fallbacks.md` | Missing-file fallback priority (reference → gradient), non-video thumbnail fill, video frame extraction. Some support exists in `thumbnail-utils.ts` but spec compliance is unverified. | 1–2 weeks |
| **P2** | `testing-expectations.md` | Testing mandate (TDD, regression tests, coverage requirements). Cross-cutting — not a feature implementation plan but a process standard to follow during execution of other plans. | N/A (process document) |

---

## Summary Table

| # | Plan | Priority | Status | Specs Covered | Effort |
|---|------|----------|--------|---------------|--------|
| 1 | `2026-07-01-backend-autosave-git-lfs` | **P0** | 🔲 Not started | backend-persistence-versioning, project-lifecycle | ~20–30h |
| 2 | `2026-06-28-music-video-timeline-native` | **P0** | 🔲 Not started | music-video-timeline-native, music-video-workflow, media-import-timeline (partial) | ~40–60h |
| 3 | `2026-07-05-ai-generation-providers-implementation` | **P0** | 🔲 Not started | ai-generation-providers | 32–42h |
| 4 | `2026-07-03-atlascloud-support` | **P0** | 🔲 Not started | atlascloud-provider, ai-generation-providers (Phase 2) | 4–6h |
| 5 | `2026-07-03-audio-analysis-and-selection` | **P1** | 🔲 Not started | audio-analysis-subtitles (§2) | ~20–30h |
| 6 | `2026-07-03-section-identification-flow` | **P1** | 🔲 Not started | sections-identification | ~15–25h |
| 7 | `2026-07-03-generate-storyboard-tool` | **P1** | 🔲 Not started | storyboard (creation) | ~15–25h |
| 8 | `2026-07-03-alter-storyboard-tool` | **P1** | 🔲 Not started | storyboard (alteration) | ~15–25h |
| 9 | `2026-07-03-storyboard-ui` | **P1** | 🔲 Not started | storyboard (UI) | ~15–20h |
| 10 | `2026-07-03-track-grouping-expansion` | **P1** | 🔲 Not started | track-grouping, storyboard (track layer) | ~15–20h |
| 11 | `2026-07-03-subtitle-track-clip-type` | **P1** | 🔲 Not started | subtitle-track-clip-type, audio-analysis-subtitles (§3) | ~15–25h |
| 12 | `2026-07-03-audio-auto-subtitle-extraction` | **P2** | 🔲 Not started | audio-auto-subtitle-extraction, audio-analysis-subtitles (§3) | ~15–20h |
| — | _Gap: export_ | **P1** | 🔲 No plan | export | 4–6 wks |
| — | _Gap: inspector-shell_ | **P1** | 🔲 No plan | inspector-shell | 2–4 wks |
| — | _Gap: media-import-timeline_ | **P1** | 🔲 No plan | media-import-timeline | 3–4 wks |
| — | _Gap: project-lifecycle_ | **P1** | 🔲 No plan | project-lifecycle | 2–3 wks |
| — | _Gap: asset-management-ux_ | **P1** | 🔲 No plan | asset-management-ux | 3–4 wks |
| — | _Gap: problems-errors-logging_ | **P1** | 🔲 No plan | problems-errors-logging | 1–2 wks |
| — | _Gap: thumbnails-fallbacks_ | **P2** | 🔲 No plan | thumbnails-fallbacks | 1–2 wks |
| — | _Gap: testing-expectations_ | **P2** | 🔲 No plan | testing-expectations | N/A (process) |

---

## Execution Order Recommendation

1.  **Wave 1 — Foundations (P0):** Backend autosave + git LFS → AI Generation
    type alignment (Phase 1) → Atlascloud route stubs → Music Video timeline
    Tasks 1–4.
2.  **Wave 2 — Core Integration (P0→P1):** Full AI Generation (Phases 2–4) →
    Music Video Tasks 5–9 (inspector, storyboard, job panel).
3.  **Wave 3 — Storyboard Chain (P1):** Audio analysis → Section identification
    → Generate/ Alter storyboard → Storyboard UI → Track grouping.
4.  **Wave 4 — Harden & Surface (P1→P2):** Export compliance → Inspector shell
    → Asset management UX → Problems/Log → Subtitles → Auto-subtitle →
    Thumbnails → Testing expectations.
5.  **Wave 5 — Gap Plans (P1→P2):** Create new plans for the 8 gaps listed
    above, starting with the highest-P1 gaps (export, inspector-shell,
    media-import-timeline, project-lifecycle) and deferring P2 gaps
    (thumbnails, testing-expectations) until all P0/P1 plans reach execution.