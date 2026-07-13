# AI Generation & Providers — Implementation Plan

> **Audit status (2026-07-13): INCOMPLETE DECOMPOSITION, NOT EXECUTABLE.** Canonical owner: `docs/spec/generation.md`; the referenced `docs/spec/ai-generation-providers.md` is now a redirect. A normalized generation-job store, WaveSpeed pieces, and server repository exist, but this document does not define a complete implementation sequence or prove provider-boundary, finalization, recovery, observability, and browser requirements.

**Date:** 2026-07-05  
**Spec:** `docs/spec/ai-generation-providers.md`  
**Status:** Decomposition phase — identifying gaps between spec and codebase  

---

## Executive Summary

The **AI Generation & Providers** spec (`docs/spec/ai-generation-providers.md`) defines a comprehensive system for managing generation jobs across multiple providers (WaveSpeed, KieAI, Atlascloud). The codebase is **~65% complete** with solid foundational work already in place:

✅ **Implemented:**
- `GenerationJobStore` (Zustand persistent store) for all providers
- `useGenerationJobPoller` hook (polling dispatch for KieAI and WaveSpeed)
- `GenerateAssetDialog` UI component with unified model list
- WaveSpeed and KieAI service clients and orchestrator routes
- Basic job lifecycle (queued → running → completed/failed)
- Retry support with history preservation

❌ **Major Gaps:**
1. **Atlascloud integration** incomplete (type union added, routes stubbed, but needs web client wiring)
2. **Provider settings/registry** missing from web UI (GeneralPanel aggregator dropdown)
3. **Job management panel** missing (job history, cancel/retry actions, status badges)
4. **Reference image picker** partially implemented (component exists but integration incomplete)
5. **Multi-instance provider support** unclear (spec §9.1 requires multiple API key instances per provider)
6. **Default model selection** logic (spec §4.4) not found in codebase
7. **Model schema validation** (spec §4.3) only partially implemented for WaveSpeed
8. **Character/reference pill rendering** in prompt fields (spec §3.1) missing
9. **Job result placement on timeline** (spec §6.1 poller) incomplete
10. **Export and media asset versioning** integration gaps

---

## Current State Analysis

### Codebase Snapshot

| Component | Status | File | Notes |
|-----------|--------|------|-------|
| **Job Store** | ✅ Implemented | `apps/web/src/stores/generation-job-store.ts` | Full lifecycle with retry history; persists to localStorage |
| **Job Poller** | ⚠️ Partial | `apps/web/src/hooks/useGenerationJobPoller.ts` | Works for KieAI/WaveSpeed; Atlascloud stub only |
| **Generate Dialog** | ⚠️ Partial | `apps/web/src/components/editor/generate/GenerateAssetDialog.tsx` | Unified list, KieAI & WaveSpeed forms; Atlascloud not wired |
| **WaveSpeed Routes** | ✅ Implemented | `apps/orchestrator/src/routes/wavespeed.ts` | Full proxy pattern with caching |
| **WaveSpeed Client** | ✅ Implemented | `apps/web/src/services/wavespeed/` | Model fetch, submit, poll |
| **KieAI Dialog** | ✅ Implemented | `apps/web/src/components/editor/kieai/KieAIImageDialog.tsx` | Separate dialog (pre-unification attempt) |
| **KieAI Poller** | ✅ Implemented | `apps/web/src/hooks/useKieAIPoller.ts` | Task polling with state machine |
| **KieAI Store** | ✅ Implemented | `apps/web/src/stores/kieai-store.ts` | Legacy task tracking (not using unified job store) |
| **Atlascloud Routes** | ❌ Missing | — | Spec exists, implementation deferred to Atlascloud plan |
| **Job Management Panel** | ❌ Missing | — | No job history/cancel/retry UI |
| **Settings/Registry** | ❌ Missing | — | No provider aggregator dropdown |
| **Default Model Selection** | ❌ Missing | — | Not in settings store |

### Type System Status

**Domain types** (`packages/music-video-domain/src/types.ts`):
```typescript
export type GenerationProvider = "wavespeed" | "kie-ai" | "atlascloud" | "veo" | "kling" | "runway" | string;
```
✅ Already includes `atlascloud`; includes future providers as fallback.

**Web types** (`apps/web/src/stores/generation-job-store.ts`):
```typescript
export type GenerationProvider = "kieai" | "wavespeed"; // Missing "atlascloud"
```
⚠️ **Discrepancy:** Domain says `"kie-ai"`, web uses `"kieai"`. Spec says `"kieai"` (§5.1 table).

---

## Dependency Map

```
┌─────────────────────────────────────────────────────────────────┐
│ FOUNDATION (must exist first)                                   │
├─────────────────────────────────────────────────────────────────┤
│ ✅ GenerationJobStore (Zustand)                                  │
│ ✅ useGenerationJobPoller (React hook)                          │
│ ✅ Domain types (GenerationProvider, GenerationJob)             │
│ ✅ Orchestrator WaveSpeed routes                                │
└──────────────────┬──────────────────────────────────────────────┘
                   │
         ┌─────────┴──────────┬────────────────┬────────────────┐
         │                    │                │                │
┌────────▼────────┐ ┌────────▼────────┐ ┌────▼─────────────┐  │
│ Atlascloud      │ │ Settings Panel  │ │ Job Management  │  │
│ Integration     │ │ (Registry)      │ │ Panel           │  │
├────────────────┤ ├────────────────┤ ├─────────────────┤  │
│ • Web client   │ │ • Provider      │ │ • Job list UI  │  │
│ • Routes       │ │   registry      │ │ • Actions      │  │
│ • Job poller   │ │ • Default model │ │ • Retry/Cancel │  │
│   dispatch     │ │   selection     │ │ • Status badge │  │
└────────────────┘ └────────────────┘ └─────────────────┘  │
         │                 │                    │            │
         └─────────────────┴────────────────────┴────────────┘
                           │
         ┌─────────────────▼──────────────────┐
         │ FEATURE COMPLETIONS                │
         ├────────────────────────────────────┤
         │ • Model schema validation          │
         │ • Reference image picker (full)    │
         │ • Timeline asset placement         │
         │ • Character pill rendering         │
         │ • Multi-instance key routing       │
         │ • Export integration               │
         └────────────────────────────────────┘
```

---

## Phase Breakdown

### Phase 1: Core Type System Alignment (Small, 1–2 hours)

**Deliverable:** Consistent type unions across domain and web packages.

| Task | File | Change | Complexity |
|------|------|--------|-----------|
| Align provider names | domain types | `kie-ai` → `kieai` or vice versa (pick one consistently) | Trivial |
| Add `atlascloud` to web store | `generation-job-store.ts` | Extend `GenerationProvider` union | Trivial |
| Verify types compile | all packages | Run `tsc --noEmit` | Check |

**Spec Sections:** §2.2 (GenerationProvider union)

**Blocking Issues:** None — foundation exists.

---

### Phase 2: Atlascloud Integration (Medium, 4–6 hours)

**Deliverable:** Full Atlascloud provider support (existing plan exists; needs execution).

**Note:** The Atlascloud support plan exists at `docs/superpowers/plans/2026-07-03-atlascloud-support.md`. Execution of that plan will close this gap.

| Task | File | Status | Complexity |
|------|------|--------|-----------|
| Orchestrator env config | `apps/orchestrator/src/env.ts` | In plan (Task 2) | Trivial |
| Orchestrator route | `apps/orchestrator/src/routes/atlascloud.ts` | In plan (Task 3) | Medium |
| Web service client | `apps/web/src/services/atlascloud/` | In plan (Task 4) | Medium |
| Job store wiring | `generation-job-store.ts` | In plan (Task 5) | Small |
| Job poller dispatch | `useGenerationJobPoller.ts` | In plan (Task 5) | Small |
| Model picker UI | `GenerateAssetDialog.tsx` | In plan (Task 6) | Small |
| Settings registry | `settings-store.ts` | In plan (Task 7) | Small |
| Tests | Various | In plan (Task 8) | Medium |

**Spec Sections:** §2, §5, §6, §10.3 (Atlascloud contract)

**Blocking Issues:** 
- Atlascloud `/models` endpoint existence TBD (spec §11)
- Image generation endpoint path TBD (spec §11)
- Output URL type (CDN vs. download) TBD (spec §11)

**Note:** Research these before implementing Tasks 3 & 6 per Atlascloud plan.

---

### Phase 3: Settings Panel & Provider Registry (Small, 2–3 hours)

**Deliverable:** User can configure and select default providers.

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| Add `AggregatorProvider` type | `settings-store.ts` | Type definition + SERVICE_REGISTRY entries | Small |
| Add aggregator dropdown UI | `GeneralPanel.tsx` (settings) | Dropdown component + event handlers | Small |
| Default model selection logic | `settings-store.ts` (or new) | Store getters for default models per `genType` | Small |
| Pre-select default in dialog | `GenerateAssetDialog.tsx` | `useEffect` to select default model on mount | Small |
| Tests | `settings-store.test.ts` | Default model fallback tests | Small |

**Spec Sections:** §4.4 (Default Models), §9 (Provider Settings)

**Blocking Issues:** None — straightforward feature addition.

---

### Phase 4: Job Management Panel (Medium, 4–5 hours)

**Deliverable:** Users can view, retry, and cancel generation jobs.

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| Job history component | `JobManagementPanel.tsx` (new) | Status-grouped job list with UI | Medium |
| Actions (retry/cancel/use-as-ref) | Job store + UI | Store actions + button handlers | Small |
| Active job badge | `AIGenTab.tsx` or toolbar | Count badge on AI Tools tab | Small |
| Status transitions | `generation-job-store.ts` | Verify all transitions (`queued` → `running` → terminal) | Trivial |
| Tests | `generation-job-store.test.ts` | Job lifecycle test cases | Small |
| Integration with existing UI | `GenerateAssetDialog.tsx` | Wire "Use as reference" action | Small |

**Spec Sections:** §8 (Job Management Panel), §5.2 (Job Lifecycle)

**Blocking Issues:** None — stores and poller already support everything needed.

---

### Phase 5: Model Schema Validation & Input Forms (Medium, 5–6 hours)

**Deliverable:** Per-provider dynamic input forms with schema-aware validation.

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| Extract model schema | WaveSpeed, KieAI, Atlascloud clients | Query `apiSchema` from each provider | Small |
| Input form component library | `SchemaForm.tsx`, provider-specific forms | Reusable form builder + per-model subcomponents | Medium |
| Validation logic | Per-provider service or shared | Client-side validation before submit | Small |
| Disabled/required field logic | `GenerateAssetDialog.tsx` | Hide unsupported inputs per schema | Small |
| Tests | Various | Schema-based validation tests | Medium |

**Spec Sections:** §4.3 (Per-Model Parameter Validation), §4.2 (Model List Shape)

**Blocking Issues:** 
- Atlascloud schema pattern unknown (spec §11)
- Which providers support dynamic schemas vs. static forms?

**Note:** WaveSpeed already has `SchemaForm.tsx` in use; reuse and extend.

---

### Phase 6: Reference Image Picker & Provider Mapping (Medium, 4–5 hours)

**Deliverable:** Users can select reference images; they map to provider-specific fields.

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| Reference picker component | `ReferenceImagePicker.tsx` (exists) | Expand to support upload + media library selection | Medium |
| Image upload handler | Web service | Save uploaded images as MediaItem before use | Small |
| Provider field mapping | Per-provider input mapping | KieAI, WaveSpeed, Atlascloud specific field names | Small |
| UI integration | `GenerateAssetDialog.tsx` | Show picker; collect selection into `inputs` | Small |
| Tests | Reference picker tests | Upload, selection, provider mapping | Medium |

**Spec Sections:** §7 (Reference Image Selection)

**Blocking Issues:** 
- KieAI reference field names (spec §10.2)
- WaveSpeed reference field names (spec §10.1)
- Atlascloud upload/reference pattern (spec §10.3)

**Note:** Upload must go through orchestrator (not direct to provider) per §7.2.

---

### Phase 7: Timeline Asset Placement (Medium, 3–4 hours)

**Deliverable:** Completed generation jobs automatically place outputs on timeline when shot context exists.

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| Extract shot context from inputs | `useGenerationJobPoller.ts` | `inputs.shotId`, `inputs.startTime`, `inputs.duration` | Trivial |
| Timeline placement helper | New or existing `placeGeneratedAssetOnTimeline` | Create clip on correct track at correct timing | Medium |
| Poller integration | `useGenerationJobPoller.ts` | Call placement helper on completion | Small |
| Fallback when shot is missing | Job completion handler | Save as media item without clip if no shot context | Small |
| Tests | Integration tests | Poller + placement flow | Medium |

**Spec Sections:** §6.1 (useGenerationJobPoller) — "Place the generated asset on the appropriate timeline track at shot timing when shot context exists"

**Blocking Issues:** None — shot context pattern already in use.

---

### Phase 8: Character Pills & Prompt Rendering (Small, 2–3 hours)

**Deliverable:** Prompts render with inline character/reference mention pills (not plain text).

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| Prompt pill component | `PromptPillRenderer.tsx` (new or existing) | Detect `@token` mentions; render as styled pills | Medium |
| Integration in dialog | `GenerateAssetDialog.tsx` | Show pills in prompt preview; truncation preserves pills | Small |
| Integration in job panel | `JobManagementPanel.tsx` | Show pills in job history | Small |
| Tests | Pill rendering tests | Parsing, truncation, styling | Small |

**Spec Sections:** §3.1 (Character Pills in Prompt Fields), §8.1 (Job panel prompt display)

**Blocking Issues:** None — inspector spec (§3.8) defines pill format.

---

### Phase 9: Multi-Instance Provider Configuration (Small, 2–3 hours)

**Deliverable:** Support multiple API key instances per provider with instance-to-key routing.

| Task | File | Missing | Complexity |
|------|------|---------|-----------|
| ProviderInstance type | `settings-store.ts` | `{ id, provider, label, apiKey?, baseUrl?, enabled }` | Trivial |
| Instance registry | `settings-store.ts` | Array of instances per provider | Small |
| Orchestrator instance routing | Env/routes design | Which instance's API key is used for a request? | Design decision |
| Web instance selection | Dialog or settings | Let user pick which instance to submit to? | Small |
| Tests | Settings and routing tests | Instance creation, selection, key routing | Small |

**Spec Sections:** §9.1 (Multi-Instance Settings), §9.2 (Settings Storage), §11 (Multi-instance key routing TBD)

**Blocking Issues:** 
- Instance-to-key routing design in orchestrator (spec §11)
- Does UI let users pick instance per generation, or use a global default?

---

## Spec Alignment Issues

### Type Naming Inconsistency

**Problem:** Spec §5.1 and dialog code use `"kieai"` (lowercase), but domain types use `"kie-ai"` (kebab-case).

**Current Code:**
- Domain: `"kie-ai"` | `"veo"` | `"kling"` | `"runway"`
- Web store: `"kieai"` | `"wavespeed"`

**Recommendation:** Standardize to **lowercase no-separators** (`kieai`, `wavespeed`, `atlascloud`) for consistency with spec examples and storage keys.

**Impact:** Breaking change in persisted job store (localStorage); migrate on load.

---

### Default Model Selection Behavior

**Spec §4.4 Missing in Codebase:**

The spec requires:
1. Configurable default video generator model + image generator model
2. Pre-select default when dialog opens
3. Fall back to first available if default unavailable
4. Persist across sessions

**Current Code:** No evidence of (1) or (2) in `GenerateAssetDialog.tsx` or settings store.

**Deliverable:** Add `defaultModels: Record<GenType, string>` to settings store with getters and UI fallback logic.

---

### Atlascloud Model List Caching

**Spec §4.1 vs. Code:**

Spec requires:
- Orchestrator caches with 60-minute TTL
- Web uses `staleWhileRevalidate` pattern
- Serves stale on fetch failure (no 502 when cache exists)

**Current WaveSpeed Route:** Uses in-memory cache with TTL; code exists.

**Atlascloud Route:** (Deferred to separate plan; structure in place per stub.)

---

### Job Idempotency in Poller

**Spec §6.1:**
> The poller MUST be idempotent across re-renders; it MUST NOT create duplicate media items or clips for the same completed job.

**Current Code** (`useGenerationJobPoller.ts`):
```typescript
// processGenerationJobOnce is called per job per interval tick
// Relies on storing outputUrl in the store to skip re-processing
```

⚠️ **Risk:** If the same job is processed twice before `complete()` is called, two version items could be created. The code checks `getMediaItem()` to find source, but the versioning side-effect is not atomic.

**Recommendation:** Add a flag like `isProcessing` to prevent concurrent processing of the same job.

---

## Implementation Sequence

**Recommended order to maximize parallelism:**

```
Week 1:
├─ Phase 1: Type system alignment (1–2 hours, 1 person)
├─ Phase 2: Atlascloud (execute existing plan, 4–6 hours, 1 person)
└─ Phase 3: Settings panel (parallel, 2–3 hours, 1 person)

Week 2:
├─ Phase 4: Job management panel (4–5 hours, 1 person)
├─ Phase 5: Model schema validation (5–6 hours, 1 person)
└─ Phase 6: Reference image picker (parallel, 4–5 hours, 1 person)

Week 3:
├─ Phase 7: Timeline asset placement (3–4 hours, 1 person)
├─ Phase 8: Character pills (2–3 hours, 1 person)
└─ Phase 9: Multi-instance provider config (2–3 hours, 1 person)

Testing & Integration: (ongoing, 2–3 hours for full suite)
```

**Total Estimate:** 32–42 hours (1–2 weeks for 1 person; parallelizable to 1 week with 2 people)

---

## External API Research Required

Before implementing the following tasks, verify against live APIs:

| API | Unknown | Task | Impact |
|-----|---------|------|--------|
| **Atlascloud** | `/models` endpoint exists & response shape | Phase 2, Task 3 | Model picker UI data structure |
| **Atlascloud** | Image generation endpoint path | Phase 2, Task 3 | Submit route dispatch |
| **Atlascloud** | Per-model request schemas | Phase 5 | Dynamic input forms |
| **Atlascloud** | Output URL type (CDN or download) | Phase 2, Task 3 | Poller download logic |
| **Atlascloud** | Rate limits, retry semantics | Phase 2 & beyond | Error handling |
| **WaveSpeed** | Reference field names | Phase 6 | Provider field mapping |
| **KieAI** | Reference field names | Phase 6 | Provider field mapping |

---

## Files to Create / Modify

### Create (New)

```
apps/web/src/components/editor/generate/JobManagementPanel.tsx
apps/web/src/components/editor/generate/ReferenceImagePicker.tsx (expand)
apps/web/src/components/shared/PromptPillRenderer.tsx
apps/orchestrator/src/routes/atlascloud.ts (per plan)
apps/orchestrator/src/routes/atlascloud.test.ts (per plan)
apps/web/src/services/atlascloud/index.ts (per plan)
apps/web/src/services/atlascloud/types.ts (per plan)
apps/web/src/services/atlascloud/client.ts (per plan)
```

### Modify (Existing)

```
packages/music-video-domain/src/types.ts
apps/web/src/stores/generation-job-store.ts
apps/web/src/stores/settings-store.ts
apps/web/src/hooks/useGenerationJobPoller.ts
apps/web/src/components/editor/generate/GenerateAssetDialog.tsx
apps/web/src/components/editor/settings/GeneralPanel.tsx
apps/orchestrator/src/env.ts
apps/orchestrator/src/routes/index.ts
apps/orchestrator/src/app.ts
apps/orchestrator/src/index.ts
.env.example
```

---

## Success Criteria

By the end of all phases:

- [ ] All provider types unified (`kieai`, `wavespeed`, `atlascloud`)
- [ ] Atlascloud fully integrated (per its plan)
- [ ] User can select default models and have them pre-selected in dialog
- [ ] Job management panel shows all jobs with status, actions, elapsed time
- [ ] User can retry failed jobs, cancel running jobs, use completed outputs as reference
- [ ] Model-specific input forms validate against provider schemas
- [ ] Reference images can be selected from library or uploaded
- [ ] Generated assets automatically place on timeline when shot context exists
- [ ] Prompts render with character/reference pills (not plain text)
- [ ] Multi-instance provider configuration supported (infrastructure)
- [ ] All tests pass (existing + new)
- [ ] TypeScript compilation succeeds for all packages
- [ ] Spec §1–§10 fully implemented; §11 unknowns resolved per Atlascloud plan

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Atlascloud API unknowns block Phase 2 | Medium | High | Research before task 3; adjust plan if needed |
| Type system change (kieai vs kie-ai) breaks migrations | High if applied | Medium | Plan localStorage migration; test thoroughly |
| Idempotency bug in job poller causes duplicates | Medium | High | Add `isProcessing` flag; write integration test |
| Multi-instance routing design incomplete | Medium | Medium | Design in Phase 1 before Phase 9 implementation |
| Reference image upload fails to integrate | Low | Low | Use existing upload pattern from project import |

---

## Acceptance Checklist

- [ ] All 9 phases complete
- [ ] Spec §1–§10 requirements met (§11 research items documented)
- [ ] Jobs persist across page reloads
- [ ] Job poller idempotent (no duplicate media items)
- [ ] Atlascloud fully functional (or marked "pending API docs")
- [ ] All new tests pass
- [ ] No TypeScript errors
- [ ] Code reviewed by at least one other engineer
- [ ] Browser tested: create job, see in panel, retry, cancel, use reference
- [ ] CI/CD passes (if applicable)

---

## Notes & Context

- **Existing Atlascloud Plan:** `docs/superpowers/plans/2026-07-03-atlascloud-support.md` covers Phases 2 in detail with 9 tasks and verification checklist.
- **KieAI Legacy:** `useKieAIPoller.ts` and `kieai-store.ts` predate the unified job store. Consider deprecating after full migration to unified store.
- **WaveSpeed Maturity:** Well-integrated; use as reference for Atlascloud.
- **Spec Scope:** §1–§10 are implementation targets; §11 documents unknowns for external research.

---

_This plan was generated by analysis of `docs/spec/ai-generation-providers.md` and the current codebase. Execute phases in order or in parallel as resources allow._
