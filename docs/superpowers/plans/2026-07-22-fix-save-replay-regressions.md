# Save and Replay Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false same-session project conflicts and make preview playback restart reliably after completion.

**Architecture:** Keep the existing serialized save queue and add a project-scoped cache of the latest confirmed base revision. Resolve a queued save's base when its serialized execution begins, not only when it was scheduled. For playback, make completion explicit in the effect lifecycle so cleanup preserves the zero-position reset while pause cleanup still captures the current clock position.

**Tech Stack:** TypeScript, Zustand, React, Vitest, browser acceptance verification.

## Global Constraints

- Preserve genuine stale-writer conflict rejection.
- Preserve project-bound queued saves when the active editor switches projects.
- Write and observe each regression test failing before production changes.
- Surface unavailable-media and persistence errors; do not add silent catches.

---

### Task 1: Rebase Serialized Local Saves

**Files:**
- Modify: `apps/web/src/services/backend-save.ts`
- Test: `apps/web/src/services/backend-save.test.ts`

**Interfaces:**
- Consumes: `ProjectSaveRequest["baseRevision"]`, validated `ProjectSaveReceipt` values.
- Produces: project-scoped latest confirmed base lookup used when a scheduled save begins.

- [ ] **Step 1: Write the failing test**

Add a test that holds the first PUT response open, schedules a second modified snapshot, resolves the first PUT with a new revision, and asserts the second PUT uses that new revision.

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/backend-save.test.ts -t "rebases a queued local save"`

Expected: FAIL because the second request still contains the pre-first-save base revision.

- [ ] **Step 3: Write minimal implementation**

Track the latest confirmed base per project, update it from validated committed or deferred receipts, seed it from the active project's confirmed status, clear it during a full reset, and resolve the scheduled base inside the serialized callback immediately before `save()`.

- [ ] **Step 4: Run focused and file tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/backend-save.test.ts`

Expected: PASS with the real-conflict tests unchanged.

### Task 2: Preserve Completion Reset Through Playback Cleanup

**Files:**
- Create: `apps/web/src/components/editor/preview/playback-lifecycle.ts`
- Create: `apps/web/src/components/editor/preview/playback-lifecycle.test.ts`
- Modify: `apps/web/src/components/editor/Preview.tsx`

**Interfaces:**
- Consumes: whether the current run completed, the current start position, master-clock activity, and master-clock position.
- Produces: `resolvePlaybackCleanupPosition(...)` returning the authoritative next-play start.

- [ ] **Step 1: Write the failing test**

Define expected behavior: a completed run preserves the explicit zero reset even when the stopped clock still reports the timeline end; a paused run captures the clock position.

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/playback-lifecycle.test.ts`

Expected: FAIL because the lifecycle resolver does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement the pure resolver. In the preview playback effect, track completion for the current effect instance, route every natural-end path through one completion callback, and use the resolver during cleanup.

- [ ] **Step 4: Run focused and affected tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/playback-lifecycle.test.ts src/components/editor/preview-audio-playback.test.ts src/components/editor/preview/native-playback-selection.test.ts`

Expected: PASS.

### Task 3: Verify Integrated Behavior

**Files:**
- Verify all files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: compiled web application and local orchestrator.
- Produces: deterministic test and browser evidence for both regressions.

- [ ] **Step 1: Run affected tests and typecheck**

Run affected test discovery for all changed source files, execute the recommended suite, and run the web typecheck.

- [ ] **Step 2: Verify exact browser workflows**

Start the development services, add media, move it while saving, wait for durable saved state, reopen the project, play to the end twice, and confirm no conflict or frozen second run.

- [ ] **Step 3: Commit and push**

Stage only the plan, source, and regression-test files. Commit with a conventional `fix:` message and push without bypassing hooks.
