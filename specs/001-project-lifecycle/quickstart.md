# Project Lifecycle Validation Quickstart

## Prerequisites

- Node.js and pnpm dependencies already installed.
- Local orchestrator storage configured for development.
- Two test projects with different names/settings.

## Deterministic gates

Run core file-format validation:

```bash
rtk pnpm --filter @openreel/core exec vitest run src/storage/project-file.test.ts src/storage/project-serializer.test.ts
```

Expected: current and legacy files import; corrupt, incomplete, mismatched, and future files fail without returning a project.

Run web lifecycle regressions:

```bash
rtk pnpm --filter @openreel/web exec vitest run \
  src/services/backend-save.test.ts \
  src/services/auto-save.test.ts \
  src/services/project-manager.test.ts \
  src/stores/persistence-status-store.test.ts \
  src/stores/project-store.test.ts \
  src/hooks/useProjectRecovery.test.ts \
  src/components/editor/ProjectManagerDialog.test.tsx \
  src/components/editor/ProjectTransitionDialog.test.tsx \
  src/components/editor/PersistenceConflictDialog.test.tsx
```

Expected: save/discard/cancel switching, project-bound pending work, complete explicit save, recovery validation, visible errors, and conflict actions all pass.

Run the proven orchestrator persistence suite to detect regressions:

```bash
rtk node --import tsx --test \
  apps/orchestrator/src/projects/routes.test.ts \
  apps/orchestrator/src/projects/save-transaction.test.ts \
  apps/orchestrator/src/projects/git-store-migration.test.ts
```

Expected: atomic transaction, conflict rejection, semantic commits, history, and historical reads remain green.

Run type checking:

```bash
rtk pnpm --dir apps/web exec tsc --noEmit
```

## Browser verification

Start the orchestrator and editor with the repository development command, then open `http://localhost:5173`.

Verify these scenarios against the running backend:

1. Create a project, add timeline/media content, explicitly save, reload the page, and confirm content plus saved status.
2. Modify project A and open project B. Verify Save waits for confirmation, Discard switches without saving A, and Cancel leaves A active.
3. Queue a save for A, switch to B, and verify the completion does not change B or its status.
4. Trigger a stale base revision. Verify the newer server state remains intact and the dialog can export local data or reload the server state.
5. Create a newer recovery copy, reload, restore it, and verify it is active and visibly unsaved until explicit save.
6. Attempt corrupt, mismatched, incomplete, and future-version recovery/import files. Verify an actionable error and unchanged active project.
7. Make project listing or recovery storage fail. Verify the chooser/recovery UI names the failed source and offers retry.

Run the focused browser regression after manual reproduction:

```bash
rtk pnpm --filter @openreel/web exec playwright test e2e/project-lifecycle.spec.ts --project=chromium
```

## Success evidence

- All deterministic gates pass without skipped lifecycle assertions.
- Browser scenarios show the exact Save / Discard / Cancel and conflict/recovery behavior.
- No Future Scope behavior appears: no worker, cross-session notification, semantic merge/diff resolver, packaged-media export, or named durable snapshot restoration.

