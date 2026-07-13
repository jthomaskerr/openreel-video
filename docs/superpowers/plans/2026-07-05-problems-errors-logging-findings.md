# Problems, Errors & Logging Implementation Findings

> **Audit status (2026-07-13): FINDINGS ONLY, NOT COMPLETE.** Canonical owner: `docs/spec/problems-errors-logging.md`. Problems and log panels exist, but no `ProblemBus` symbol was found and this document records a retry-resolution defect rather than a completed fix with regression coverage. It is not an executable implementation plan.

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
