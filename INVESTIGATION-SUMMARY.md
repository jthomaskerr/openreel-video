# AI Generation & Providers Spec — Investigation Summary

**Date:** 2026-07-05  
**Scope:** First spec only (ai-generation-providers.md)  
**Status:** ✅ Investigation & Decomposition Complete

---

## Overview

I've analyzed the **AI Generation & Providers** operational spec (`docs/spec/ai-generation-providers.md`) against the current codebase and created a comprehensive implementation plan. The system is **~65% complete** with solid foundational work already in place.

---

## Key Findings

### ✅ What's Already Built

1. **Persistent Job Store** (`generation-job-store.ts`)
   - Zustand store with localStorage persistence
   - Full lifecycle: queued → running → completed/failed/canceled
   - Retry support with history preservation
   - Works for KieAI and WaveSpeed

2. **Generation Job Poller** (`useGenerationJobPoller.ts`)
   - React hook that polls active jobs on 5-second interval
   - Dispatch logic for KieAI and WaveSpeed providers
   - Handles completion, failure, and asset versioning

3. **Unified Generate Dialog** (`GenerateAssetDialog.tsx`)
   - Single entry point for all providers (as spec requires)
   - Unified model list with provider badges
   - KieAI and WaveSpeed forms implemented
   - Model search and filtering

4. **WaveSpeed Integration** (Complete)
   - Orchestrator proxy route (`routes/wavespeed.ts`)
   - Web service client (`services/wavespeed/`)
   - Model list caching (60-minute TTL)
   - Job submission and polling

5. **KieAI Integration** (Complete)
   - Service client with task polling
   - Separate dialog (pre-unification)
   - Image generation with schema-based forms

### ❌ Major Gaps

| Gap | Severity | Effort | Phase |
|-----|----------|--------|-------|
| Type system inconsistency (`kieai` vs `kie-ai`) | High | 1h | 1 |
| Atlascloud web client wiring | High | 4–6h | 2 |
| Settings panel / provider registry | High | 2–3h | 3 |
| Job management panel (history, cancel, retry UI) | High | 4–5h | 4 |
| Model schema validation & per-provider forms | Medium | 5–6h | 5 |
| Reference image picker integration | Medium | 4–5h | 6 |
| Timeline asset placement on completion | Medium | 3–4h | 7 |
| Character/reference pills in prompts | Medium | 2–3h | 8 |
| Multi-instance provider support | Medium | 2–3h | 9 |

---

## Implementation Plan

A detailed 9-phase implementation plan has been created at:

**📄 `docs/superpowers/plans/2026-07-05-ai-generation-providers-implementation.md`**

This document includes:
- **Phase breakdown** (each with file list, tasks, complexity)
- **Dependency map** (shows what blocks what)
- **Estimated effort:** 32–42 hours (1–2 weeks for 1 person)
- **External API research checklist** (Atlascloud unknowns to verify)
- **Risk assessment** (type migration, idempotency, API blockers)
- **Spec alignment issues** (naming inconsistencies, missing defaults)

### Quick Phase Summary

```
Phase 1: Type system alignment              (1–2h)
Phase 2: Atlascloud integration (use plan)  (4–6h)
Phase 3: Settings panel & registry          (2–3h)
Phase 4: Job management panel               (4–5h)
Phase 5: Model schema validation            (5–6h)
Phase 6: Reference image picker             (4–5h)
Phase 7: Timeline asset placement           (3–4h)
Phase 8: Character pills in prompts         (2–3h)
Phase 9: Multi-instance provider config     (2–3h)
```

---

## Existing Related Work

### Atlascloud Support Plan

A detailed **Atlascloud integration plan** already exists at:

**📄 `docs/superpowers/plans/2026-07-03-atlascloud-support.md`**

This covers Phase 2 with 9 explicit tasks:
1. Domain type updates
2. Orchestrator env config
3. Orchestrator atlascloud route (with full code)
4. Web atlascloud service client
5. Job store + poller wiring
6. UI model picker integration
7. Settings registry
8. Tests
9. Verification checklist

**Action:** Execute this plan as Phase 2. The implementation plan references it as a dependency.

---

## Critical Spec/Code Misalignments

### 1. Provider Type Naming

**Spec (§5.1):** `"kieai"` (lowercase, no separator)  
**Domain code:** `"kie-ai"` (kebab-case)  
**Web code:** `"kieai"` (lowercase)

**Fix:** Standardize to `"kieai"` | `"wavespeed"` | `"atlascloud"` everywhere.
**Impact:** Breaking change in localStorage; plan migration on load.

### 2. Missing Default Model Selection (§4.4)

Spec requires:
- Configurable default video and image generator models
- Pre-select in dialog on open
- Fallback to first available if default unavailable
- Persist across sessions

**Current code:** No evidence of this in UI or settings store.

**Fix:** Add `defaultModels: Record<GenType, string>` to settings store with UI picker.

### 3. Job Idempotency Risk (§6.1)

Current poller processes the same job multiple times if page re-renders before `complete()` is called. Could create duplicate media items.

**Fix:** Add `isProcessing` flag to prevent concurrent processing of same job.

---

## Next Steps for User

### Option A: Execute Phase by Phase (Recommended)

1. **This week:** Execute Phases 1–3 (types, Atlascloud, settings) = 7–11 hours
2. **Next week:** Execute Phases 4–6 (UI components) = 13–16 hours
3. **Following week:** Execute Phases 7–9 (timeline, pills, multi-instance) = 7–9 hours

Assign to 1 person (27 person-days) or 2 people (parallel = 1.5 weeks).

### Option B: Parallel Fast Track

Deploy multiple engineers to handle:
- **Track A:** Phase 2 (Atlascloud plan) — 1 engineer, 1 week
- **Track B:** Phases 3, 4 (Settings + Job panel) — 1 engineer, 1 week
- **Track C:** Phases 5, 6 (Schema + Reference picker) — 1 engineer, 1 week

Merge and test together in week 2.

### Option C: MVP Fast Path

Ship minimum viable for spec compliance:
1. Phase 1 (types) ✅
2. Phase 2 (Atlascloud) ✅
3. Phase 4 (job panel) ✅
4. Phase 7 (timeline placement) ✅

= **~17 hours** (enough to cover "job lifecycle" + "multiple providers")  
Defer Phases 3, 5, 6, 8, 9 to follow-up PR.

---

## What Was Analyzed

### Codebase Review
- ✅ Scanned `apps/web/src/` for generation-related components
- ✅ Reviewed `apps/orchestrator/src/routes/` for provider integrations
- ✅ Analyzed `packages/music-video-domain/src/types.ts` for domain types
- ✅ Inspected `apps/web/src/stores/` for job store and settings
- ✅ Checked existing test files for coverage patterns

### Spec Deep Dive
- ✅ Read entire spec (`docs/spec/ai-generation-providers.md`)
- ✅ Cross-referenced 12 sections (Scope → References)
- ✅ Identified all open questions (§11) that block implementation
- ✅ Verified spec against similar sibling specs (asset-management-ux.md, etc.)

### Related Documentation
- ✅ Read Atlascloud support plan
- ✅ Reviewed music-video-timeline-native plan (tasks 12–15 overlap)
- ✅ Checked operational spec summary
- ✅ Reviewed CONTRIBUTING.md conventions

---

## Deliverables Created

1. **📄 Implementation Plan**  
   `docs/superpowers/plans/2026-07-05-ai-generation-providers-implementation.md`
   - 400+ lines of phased breakdown
   - Dependency map
   - Risk assessment
   - Success criteria

2. **📋 This Summary**  
   Quick reference for exec decisions

---

## Questions for Product/Engineering

1. **Type naming:** Should we standardize to `kieai` (lowercase) globally? Willing to migrate localStorage?

2. **Atlascloud API:** Has anyone verified the unknowns in spec §11?
   - Does `GET /api/v1/models` exist?
   - What's the image generation endpoint path?
   - Is the output a direct CDN URL or needs server download?

3. **Priority:** Atlascloud only, or full 9 phases? (Affects timeline estimate)

4. **Multi-instance:** Is the requirement real (multiple API keys per provider) or can we defer to phase 9?

5. **Browser testing:** User-facing features (job panel, reference picker, default model) require browser verification before shipping. Budget for manual QA.

---

## Files to Review

To get started immediately:

1. **`docs/superpowers/plans/2026-07-05-ai-generation-providers-implementation.md`** — Full plan
2. **`docs/superpowers/plans/2026-07-03-atlascloud-support.md`** — Existing Atlascloud plan (9 tasks)
3. **`docs/spec/ai-generation-providers.md`** — The spec itself (sections 1–12)
4. **`apps/web/src/components/editor/generate/GenerateAssetDialog.tsx`** — Main unified dialog (830+ lines)
5. **`apps/web/src/stores/generation-job-store.ts`** — Job persistence (150 lines, well-commented)
6. **`apps/web/src/hooks/useGenerationJobPoller.ts`** — Polling logic (230 lines, clear structure)

---

## Summary

The **AI Generation & Providers** spec is **well-scoped and achievable**. The codebase has strong foundations (job store, poller, unified dialog). Closing the gaps (Atlascloud wiring, settings panel, job management UI, schema validation) is straightforward implementation work—no architectural risks.

**Time to "spec compliant":** 32–42 hours (1–2 weeks, 1–2 people)  
**Time to "MVP (job lifecycle + multi-provider)":** 17 hours (1 week, 1 person)

The implementation plan is ready. Pick a phase and start shipping. 🚀

---

_Generated by orchestrator investigation phase. Ready for decompose/launch._
