# Implementation Plan: Project Lifecycle and Persistence

**Branch**: `feature/time-machine-project-lifecycle` | **Date**: 2026-07-21 | **Spec**: `specs/001-project-lifecycle/spec.md`
**Input**: Feature specification from `specs/001-project-lifecycle/spec.md`

## Summary

Harden the existing browser-to-orchestrator project lifecycle without replacing it. Keep `BackendSaveService`, `executeSaveTransaction`, `ProjectStore`, and `GitStore` as the durable path. Correct only demonstrated minimal-operation defects: confirmed-receipt dirty state, complete awaited explicit saves, project-identified autosave completions, project-ID-keyed queued saves with captured base revisions, active-only persistence status, and dirty browser unload protection. Defer new portable/recovery validation contracts and dialog surfaces.

## Technical Context

**Language/Version**: TypeScript 5.9.3 on Node.js; React 18.3.1 in the browser  
**Primary Dependencies**: Zustand 4.5.7, Radix Dialog 1.1.15 through `@openreel/ui`, Express orchestrator, existing `@openreel/core` storage/serializer contracts  
**Storage**: Canonical per-project orchestrator worktrees and Git history; IndexedDB recovery slots and recent-file handles; plain `.oreel` JSON copies  
**Testing**: Vitest 1.6.1, Node test runner for orchestrator suites, Testing Library 16.3.0, Playwright 1.61.1  
**Target Platform**: Desktop evergreen browsers running the Vite editor with the local orchestrator  
**Project Type**: pnpm monorepo web application with shared core package and Node orchestrator  
**Performance Goals**: Preserve the existing 2-second recovery debounce and 30-second recovery interval; new percentile instrumentation is Future Scope  
**Constraints**: No new persistence framework or hosted service; no silent user-visible failure; no partial or stale overwrite; no cross-project application of queued results; Future Scope items remain excluded  
**Scale/Scope**: Existing supported projects; one active editor session per project, while stale durable state and pending work remain possible

## Constitution Check

The repository constitution is an unfilled template and adds no enforceable feature-specific gates. Repository operating standards still require deterministic regression tests, explicit error reporting, browser verification for UI behavior, and scoped commits. The design passes those gates because it:

- preserves the established typed browser/orchestrator boundary;
- adds no dependency or speculative worker architecture;
- retains the installed serializer behavior and defers stricter portable/recovery validation;
- tests every corrected failure mode before implementation;
- keeps the current durable transaction and Git history code unchanged unless a failing regression proves otherwise.

Post-design re-check: no constitution violations or unresolved clarifications remain.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-lifecycle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── lifecycle-contracts.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/src/services/
├── auto-save.ts                    # typed saved-event identity
├── backend-save.ts                 # project-keyed scheduling and active-only status
└── backend-save.test.ts

apps/web/src/stores/
├── persistence-status-store.ts     # confirmed-receipt dirty-state helper
├── persistence-status-store.test.ts
├── project-store.ts                # complete awaited explicit save and identity-aware binding
└── project-store.test.ts

apps/web/src/hooks/
├── useProjectUnloadGuard.ts
└── useProjectUnloadGuard.test.ts

apps/web/src/App.tsx                # mounts unload protection
```

**Structure Decision**: Keep persistence mechanics in existing services/stores and add one focused unload hook. No orchestrator source change is planned because its transaction, conflict, history, and historical-read contracts already satisfy current scope. The existing `"user"` save intent represents an explicit user save.

## Complexity Tracking

No justified complexity violations. The only new state structure is a per-project scheduled-save map required to prevent cross-project cancellation and base-revision loss.
