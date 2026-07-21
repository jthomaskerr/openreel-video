# Implementation Plan: Editor Shell and Shared UI

**Branch**: `feature/time-machine-editor-shell` | **Date**: 2026-07-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/002-editor-shell/spec.md`

## Summary

Preserve the installed editor shell and correct only two demonstrated classes of failure: an editor initialization error currently leaves an indefinite loading presentation with no recovery action, and custom workspace resize/tab interactions are pointer-only or omit expected keyboard navigation. Reuse the existing engine initialization operation, stores, panel bounds, error boundaries, tab state, and shared controls. Add deterministic regressions first, make the smallest production changes that satisfy them, and leave all tour changes in Future Scope.

## Technical Context

**Language/Version**: TypeScript 5.4, React 18  
**Primary Dependencies**: Zustand 4.5, existing `@openreel/ui`/Radix primitives, Tailwind CSS 3.4  
**Storage**: Existing in-memory UI state and installed local preference persistence; no new storage  
**Testing**: Vitest 1.6, Testing Library 16, jsdom 24, existing Playwright/browser workflow  
**Target Platform**: Desktop-class modern web browsers  
**Project Type**: Monorepo web application with a shared UI package  
**Performance Goals**: Keyboard interactions update within one rendered frame; startup failure replaces progress within one state update  
**Constraints**: Preserve installed layout, panel bounds, settings, tour, shortcuts, and shared-control exports; no new service or persistence framework; no silent user-visible failure  
**Scale/Scope**: One active editor shell with four adjustable boundaries and three installed custom tab sets; only critical error recovery and concrete usability corrections

## Constitution Check

The repository constitution remains an unfilled template and adds no enforceable feature gates. Repository operating standards still require:

- implementation-first analysis and preservation of working behavior;
- a measurable user-visible outcome before implementation;
- deterministic regression-first tests for every correction;
- browser verification for user-interface behavior;
- actionable error presentation with diagnostic logging;
- no speculative architecture, hosted model/API work, or unrelated tour/UI redesign.

**Pre-design gate**: PASS. The plan changes existing web components only, uses installed dependencies, and has no unresolved clarification.

**Post-design gate**: PASS. Research, interaction contracts, data model, and validation guide keep tour work deferred and cover every current-scope requirement.

## Project Structure

### Documentation (this feature)

```text
specs/002-editor-shell/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── editor-shell-contracts.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/src/components/editor/
├── EditorInterface.tsx                  # startup states and installed workspace composition
├── EditorInterface.initialization.test.tsx
├── PanelResizeHandle.tsx                # editor-local semantic keyboard/pointer boundary
├── PanelResizeHandle.test.tsx
├── InspectorPanel.tsx                   # primary inspector tab keyboard navigation
├── InspectorPanel.tabs.test.tsx
├── inspector/shell/
│   ├── InspectorTabs.tsx                # clip-edit tab keyboard navigation
│   └── InspectorTabs.test.tsx
└── settings/
    ├── SettingsDialog.tsx               # settings tab keyboard navigation
    └── SettingsDialog.test.tsx

apps/web/src/stores/
└── engine-store.ts                      # existing retryable initialize operation, unchanged unless regression proves otherwise
```

**Structure Decision**: Keep startup orchestration and layout composition in the existing editor interface. Add one local resize-handle component because the same semantic behavior applies to four existing boundaries. Add keyboard navigation directly to the three custom tab sets rather than replacing them or changing the shared UI package. Do not modify tour files.

## Design Sequence

1. Add a failing startup regression proving that a terminal initialization error stops progress presentation, is announced, and offers Retry.
2. Expose a stable retry operation from the installed initialization hook, clear attempt-local error/bridge readiness, and re-run the same initialization sequence without reloading.
3. Add failing resize-handle regressions for semantics, directional 10-pixel/2-percentage-point steps, and min/max clamping.
4. Implement the editor-local resize handle and replace the four mouse-only boundary elements without changing pointer geometry.
5. Add failing keyboard-navigation regressions to the installed inspector, clip-edit, and settings tab tests.
6. Add automatic Arrow/Home/End selection and focus using the existing tab order/state setters.
7. Run focused deterministic gates, TypeScript, diagnostics, and exact browser scenarios. Confirm no tour production file changed.

## Complexity Tracking

No constitution violations or new architecture require justification.
