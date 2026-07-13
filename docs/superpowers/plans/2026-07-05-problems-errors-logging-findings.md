# Problems, Errors & Logging Implementation Findings

## Current State (Audited 2026-07-13 16:16 AEST)

**Document type:** HISTORICAL FINDINGS, NOT AN EXECUTABLE PLAN. Canonical owner: [Problems, Errors & Logging](../../spec/problems-errors-logging.md). The prior audit incorrectly reported that `problemBus` was absent; it exists as a constant in `problem-store.ts`.

| Area | Current state |
|---|---|
| Problem model/store/bus | Implemented with report, resolve, resolve-by-kind, subscribe, and selectors. |
| Problems panel | Implemented with action dispatch. |
| Log panel | Implemented with filtering/presentation. |
| Recovery actions | Partial; link-file and retry-generation handlers exist. |
| Retry lifecycle defect | Open and nonconformant: `retry_generation` calls `problemBus.resolve(problem.id)` immediately after enqueueing retry instead of waiting for successful completion. |
| Regression coverage | No focused test proves retry failure keeps the problem active and retry success resolves it. |
| Browser/observability evidence | No current end-to-end problem lifecycle and log-correlation run is recorded. |

**Next action:** write/fix the retry lifecycle regression first, then verify deduplication, action outcomes, and log correlation.

**Date:** 2026-07-05  
**Spec Reference:** `docs/spec/problems-errors-logging.md` (§1–5)  
**Critical Finding:** AUTO-RESOLVE BUG in retry_generation action

---

## CRITICAL BUG DISCOVERED

**File:** `apps/web/src/components/editor/inspector/ProblemsPanel.tsx` (line TBD)

**Bug:** `retry_generation` action **immediately calls `problemBus.resolve(problem.id)`**, contradicting spec §4.2

**Spec Requirement (§4.2):**
> "The retry_generation action does NOT auto-resolve — the problem resolves only when the retry succeeds."

**Current Behavior:**
- User clicks retry
- `retry_generation` is called
- Problem is **immediately marked as resolved** (status changes to "resolved")
- Retry operation may fail asynchronously later
- User sees "resolved" status even though retry hasn't completed or failed

**Spec Intended Behavior:**
- User clicks retry
- Retry operation begins (async)
- Problem remains in "pending" or "retrying" status
- On **success:** problem automatically resolves
- On **failure:** problem remains in "pending" state (user can retry again)

**Impact:**
- Users cannot see if their retry actually succeeded
- UX is broken: problem shows resolved but may actually still be failing
- No way to track retry status

**Fix Required:**
- Remove premature `problemBus.resolve()` call
- Resolve only after successful retry completion
- Add error handling: if retry fails, keep problem in pending state or change to new "retry_failed" status

---

## Implementation Status Summary

| Component | Status | Evidence |
|---|---|---|
| **ProblemKind registry** | ⚠️ Partial | System exists, all kinds defined? |
| **Resolve actions** | ⚠️ **BUGGY** | `retry_generation` auto-resolves (WRONG) |
| **Problem persistence** | ⚠️ Unknown | Cross-session storage? |
| **Log immutability** | ⚠️ Unknown | Append-only enforcement? |
| **Problems UI panel** | ✅ Exists | ProblemsPanel.tsx |
| **Log UI panel** | ✅ Exists | LogPanel.tsx |

---

## Key Files

- `apps/web/src/components/editor/inspector/ProblemsPanel.tsx` — Main problems tab UI
- `apps/web/src/components/editor/inspector/LogPanel.tsx` — Log display
- Problems store (find location) — Problem state management
- `problemBus` (find location) — Problem bus event system

---

## Tasks for Plan

1. **BLOCKER: Fix retry_generation auto-resolve bug**
   - Remove premature resolve() call
   - Add retry completion handler
   - Track retry status or error state
   - Test: retry success, retry failure, retry UI updates

2. **Verify ProblemKind registry completeness**
   - List all problem kinds defined
   - Verify all kinds from spec are present
   - Add any missing kinds

3. **Verify resolve action execution**
   - Other actions besides retry_generation
   - All resolve actions working correctly
   - No other premature resolutions

4. **Verify problem persistence**
   - Does problem state survive page reload?
   - Storage location (localStorage, IndexedDB, backend)?
   - Cross-session behavior

5. **Verify log immutability**
   - Is log append-only?
   - Can entries be deleted/modified?
   - Size limits enforced?

---

**Handoff Status:** Ready for plan writing. Critical bug must be fixed.
