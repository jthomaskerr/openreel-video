# Implementation Plan: Project Lifecycle and Persistence

**Branch**: `feature/time-machine-project-lifecycle` | **Date**: 2026-07-21 | **Spec**: `specs/001-project-lifecycle/spec.md`
**Input**: Feature specification from `specs/001-project-lifecycle/spec.md`

## Summary

Harden the existing browser-to-orchestrator project lifecycle without replacing it. The work keeps `BackendSaveService`, `executeSaveTransaction`, `ProjectStore`, and `GitStore` as the durable path, reuses the existing core project serializer for portable files, and corrects only demonstrated safety defects in project switching, explicit save completion, recovery/import validation, conflict recovery, project-bound scheduling, and error visibility.

## Technical Context

**Language/Version**: TypeScript 5.9.3 on Node.js; React 18.3.1 in the browser  
**Primary Dependencies**: Zustand 4.5.7, Radix Dialog 1.1.15 through `@openreel/ui`, Express orchestrator, existing `@openreel/core` storage/serializer contracts  
**Storage**: Canonical per-project orchestrator worktrees and Git history; IndexedDB recovery slots and recent-file handles; plain `.oreel` JSON copies  
**Testing**: Vitest 1.6.1, Node test runner for orchestrator suites, Testing Library 16.3.0, Playwright 1.61.1  
**Target Platform**: Desktop evergreen browsers running the Vite editor with the local orchestrator  
**Project Type**: pnpm monorepo web application with shared core package and Node orchestrator  
**Performance Goals**: Preserve the existing 2-second recovery debounce, 30-second recovery interval, and actionable open/save result within 3 seconds for supported project sizes  
**Constraints**: No new persistence framework or hosted service; no silent user-visible failure; no partial or stale overwrite; no cross-project application of queued results; Future Scope items remain excluded  
**Scale/Scope**: Existing projects with at least 100 representative elements; one active editor session per project, while stale durable state and pending work remain possible

## Constitution Check

The repository constitution is an unfilled template and adds no enforceable feature-specific gates. Repository operating standards still require deterministic regression tests, explicit error reporting, browser verification for UI behavior, and scoped commits. The design passes those gates because it:

- preserves the established typed browser/orchestrator boundary;
- adds no dependency or speculative worker architecture;
- defines deterministic validation and migration behavior in `@openreel/core`;
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
packages/core/src/storage/
├── project-file.ts                 # typed versioned portable/recovery file decoder
├── project-file.test.ts            # version, shape, migration, identity regressions
├── project-serializer.ts           # delegates envelope validation/migration
└── project-serializer.test.ts

apps/web/src/services/
├── auto-save.ts                    # typed recovery events and fail-closed recovery
├── auto-save.test.ts
├── backend-save.ts                 # project-bound scheduling and awaited explicit saves
├── backend-save.test.ts
├── project-manager.ts              # versioned portable import/export
└── project-manager.test.ts

apps/web/src/stores/
├── persistence-status-store.ts     # authoritative dirty/conflict state helpers
├── persistence-status-store.test.ts
├── project-store.ts                # complete explicit save and unsaved recovery install
└── project-store.test.ts

apps/web/src/components/editor/
├── ProjectManagerDialog.tsx        # guarded project replacement and visible source failures
├── ProjectManagerDialog.test.tsx
├── ProjectTransitionDialog.tsx     # Save / Discard / Cancel choice
├── ProjectTransitionDialog.test.tsx
├── PersistenceConflictDialog.tsx   # preserve/export local or reload newer durable state
└── PersistenceConflictDialog.test.tsx

apps/web/e2e/
└── project-lifecycle.spec.ts        # real browser lifecycle verification
```

**Structure Decision**: Keep domain validation in the existing shared core storage area, persistence mechanics in existing web services/stores, and user decisions in focused editor dialogs. No orchestrator source change is planned because its transaction, conflict, history, and historical-read contracts already satisfy the current specification. The existing `"user"` save intent represents an explicit user save.

## Complexity Tracking

No justified complexity violations. The only new shared abstraction is a pure project-file decoder so portable import and recovery cannot drift into separate unchecked parsers.
