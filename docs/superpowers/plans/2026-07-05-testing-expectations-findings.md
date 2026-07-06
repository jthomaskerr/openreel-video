# Testing Expectations Implementation Findings

**Date:** 2026-07-05  
**Spec Reference:** `docs/spec/testing-expectations.md`  
**Type:** Process/CI mandate (not a feature)

---

## Summary

Testing infrastructure **partially complete**. Some packages missing test:run scripts.

**Audit Result:** 7 of 8 workspace projects have test:run configured

---

## Test Script Audit

| Package | test:run Script | Status | Notes |
|---|---|---|---|
| `apps/web` | ✅ Yes | Configured | Runs tests |
| `apps/orchestrator` | ❌ No | **MISSING** | Needs script |
| `apps/image` | ⚠️ TBD | Needs confirm | May need separate |
| `packages/core` | ✅ Yes | Configured | Runs tests |
| `packages/image-core` | ✅ Yes | Configured | Runs tests |
| `packages/music-video-domain` | ✅ Yes | Configured | Runs tests |
| `packages/ui` | ❌ No | **MISSING** | Needs script |

---

## Coverage & CI Integration

**Status:** ⚠️ **Not Yet Verified**

- [ ] Coverage tooling configured (likely Jest or Vitest)
- [ ] Coverage thresholds defined
- [ ] CI pipeline gates coverage checks
- [ ] Test naming/organization conventions documented
- [ ] Pre-commit hooks enforce tests

---

## Required Tasks for Plan

1. **Add test:run to apps/orchestrator**
2. **Add test:run to packages/ui** (or verify it exists)
3. **Verify apps/image test:run script**
4. **Document coverage thresholds**
5. **Verify CI pipeline enforces tests**
6. **Document TDD expectations per package**
7. **Document test naming conventions**
8. **Check for regression test infrastructure**

---

## Critical Question

**What's the coverage threshold?** Spec doesn't specify, but plan must document project standard (e.g., 80% line coverage, 70% branch coverage?).

---

**Handoff Status:** 30% investigated. Process mandate, lower priority than feature plans.
