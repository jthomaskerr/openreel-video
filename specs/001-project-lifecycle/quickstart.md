# Project Lifecycle Validation Quickstart

## Prerequisites

- Node.js and pnpm dependencies already installed.
- Local orchestrator storage configured for development.
- Two test projects with different names/settings.

## Deterministic gates

Run the installed core serializer regression:

```bash
rtk pnpm --filter @openreel/core exec vitest run src/storage/project-serializer.test.ts
```

Expected: existing envelope export, legacy normalization, media normalization, and round trips remain green. Strict future-format rejection is Future Scope.

Run web lifecycle regressions:

```bash
rtk pnpm --filter @openreel/web exec vitest run \
  src/services/backend-save.test.ts \
  src/stores/persistence-status-store.test.ts \
  src/stores/project-store.test.ts \
  src/hooks/useProjectUnloadGuard.test.ts
```

Expected: confirmed-receipt dirty state, complete awaited explicit saves, identity-aware autosave completions, independent project queues/base revisions, active-only status, and unload protection all pass.

Run the proven orchestrator persistence suite to detect regressions:

```bash
rtk pnpm --filter @openreel/orchestrator exec node --import tsx --test \
  src/projects/routes.test.ts \
  src/projects/save-transaction.test.ts \
  src/projects/git-store-migration.test.ts
```

Expected: atomic transaction, conflict rejection, semantic commits, history, and historical reads remain green.

Run type checking:

```bash
rtk pnpm --dir apps/web exec tsc --noEmit
```

## Browser verification

Start the orchestrator and editor with the repository development command, then open `http://localhost:5173`.

Verify these scenarios against the running backend:

1. Create a project, add representative content, invoke explicit Save, and verify saved status changes only after the backend responds.
2. Queue a save for project A, open or create project B, and verify A still reaches the backend with A's base revision while B's content and persistence status remain unchanged.
3. Make a project dirty and request refresh/close; verify the browser warns. Save successfully and verify the same request no longer warns.

## Success evidence

- All current-scope deterministic gates pass; unrelated legacy skips are reported explicitly.
- Browser scenarios show awaited explicit save, project-bound queued persistence, active-only status, and dirty unload protection.
- No Future Scope behavior appears: no transition/conflict dialogs, strict new portable/recovery decoder, worker, cross-session notification, semantic merge/diff resolver, packaged-media export, or named durable snapshot restoration.

## Verified results

- Spec Kit task bootstrap: PASS.
- Core serializer: 12 passed, 0 failed, 0 skipped.
- Focused web lifecycle: 116 passed, 0 failed, 4 pre-existing skipped subtitle tests.
- Web TypeScript compiler: exit 0.
- Orchestrator persistence: 37 passed, 0 failed, 0 skipped.
- Browser explicit Save: an injected 700 ms backend PUT delay produced an 888 ms awaited `forceSave()` result for `lifecycle-browser-check`.
- Browser project-bound queue: queued `lifecycle-browser-check` survived creation of `lifecycle-queue-target-two`, used the originating commit `11ae395e036b59d8c667eef098f45d94f5348682`, and left visible status on the new project.
- Browser unload/status: a newly confirmed project displayed `Persisted`; adding a track changed it to `Persisted persisting…` and made `beforeunload.defaultPrevented === true`; after persistence completed it displayed a recent persisted time and the same event was not prevented.
