# Web Task 5: Resolve project picker browser acceptance

## Outcome

The Resolve project picker is covered by two deterministic Chromium scenarios:

1. The Vintage Tokyo workflow recovers from an initial project-list failure, displays the rich project preview, starts an export for the exact selected revision, and requests one validated `openreel-resolve://` launch.
2. The picker remains keyboard-operable at 200% zoom in a 1280 x 720 viewport, has no document-level horizontal overflow, and starts exactly one export and launch.

## Test design

- The tests use a local fake backend so project metadata, preview content, retry behavior, export revision selection, and POST counts are deterministic.
- The preview assertions cover project name, creation and last-edited dates, rendered output, video and audio preview controls, grouped clip types, and the mini timeline.
- Chromium custom-protocol navigation is observed through `Page.frameRequestedNavigation` and `Network.requestWillBeSent`. Headless Chromium therefore verifies the generated launch URL without invoking a native protocol handler.
- The tests assert exactly one export POST, preventing duplicate export jobs from repeated event handling.

## Verification

### Browser acceptance

Command:

```bash
rtk pnpm --filter @openreel/web exec playwright test e2e/resolve-project-picker.spec.ts
```

Result: 2 tests passed in 19.0 seconds.

### TypeScript

Command:

```bash
rtk pnpm --dir apps/web exec tsc --noEmit
```

Result: passed with no TypeScript errors.

### Editor diagnostics

Serena reported no diagnostics for `apps/web/e2e/resolve-project-picker.spec.ts`.

### Diff integrity

`rtk git diff --check` passed with no whitespace errors.

## Failure modes covered

- Project-list request fails before a successful retry.
- Preview response violates or omits expected user-visible content.
- Export uses a stale project revision or incorrect selection.
- Custom-protocol launch URL is missing or malformed.
- A single action creates duplicate export jobs.
- Menu, submenu, picker selection, or launch cannot be completed with the keyboard.
- The picker causes document-level horizontal overflow at 200% zoom.
