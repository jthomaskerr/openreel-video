# Editor Shell and Shared UI Validation

## Deterministic gates

Run the focused shell regressions:

```bash
rtk pnpm --filter @openreel/web exec vitest run \
  src/components/editor/EditorInterface.initialization.test.tsx \
  src/components/editor/PanelResizeHandle.test.tsx \
  src/components/editor/InspectorPanel.tabs.test.tsx \
  src/components/editor/inspector/shell/InspectorTabs.test.tsx \
  src/components/editor/settings/SettingsDialog.test.tsx
```

Expected: startup failure/retry, all four keyboard resize directions/bounds, and all three tab sets pass with no skipped current-scope assertion.

Run unchanged onboarding coverage to prove deferred scope did not regress:

```bash
rtk pnpm --filter @openreel/web exec vitest run src/components/editor/tour/useTour.test.ts
```

Run type checking:

```bash
rtk pnpm --dir apps/web exec tsc --noEmit
```

Run whitespace and deferred-scope checks:

```bash
rtk git diff --check
rtk git diff --name-only -- apps/web/src/components/editor/tour
```

Expected: no whitespace errors and no tour production changes.

## Browser verification

Start the installed development stack, open the editor, and verify:

1. Inject or reproduce initialization failure. Confirm the animation stops, the error is announced, and Retry begins a new attempt without page reload.
2. Focus each workspace boundary. Confirm Arrow keys resize media, inspector, and chat by 10 pixels and timeline by 2 percentage points without crossing bounds.
3. Use Arrow, Home, and End keys in primary inspector, clip-edit, and settings tabs. Confirm focus, selection, and panel content stay synchronized.
4. Confirm pointer resizing, panel failure isolation, settings dialogs, and normal editor startup retain installed behavior.
5. Confirm the onboarding tour behaves exactly as before; no new tour behavior is expected.

## Evidence to record

- Exact RED failure for each correction before production changes.
- Focused pass count and duration.
- TypeScript exit status and file diagnostics.
- Browser before/after observations for startup, resizing, and tab navigation.
- Proof that no tour production file changed.
