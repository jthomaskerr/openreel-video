# Web Task 4 implementation report

## Outcome

The Resolve handoff now opens the backend project picker, creates an export from the exact preview revision and selection, follows backend job state, launches only the validated opaque bridge URL, and preserves iMovie on the existing browser handoff path.

## Implementation

- Added `useResolveExportJob` with backend-derived phases, monotonic non-terminal progress, terminal-state precedence, one in-flight abortable poll, bounded backoff, a five-minute polling timeout, and cleanup on reset/unmount/new start.
- Launch is attempted exactly once for a ready job through `launchResolveBridge`. A rejected custom-scheme launch leaves the ready job intact and exposes `retryLaunch` without creating another export.
- Cancellation is exposed only for the backend-supported `ready` phase. Operation generations and abort signals prevent stale start/poll/cancel responses from reviving superseded state.
- Known stale-revision, missing-media, compatibility, and missing-project errors map to actionable messages without rendering backend paths or source content.
- `ResolveProjectPicker` sends the preview revision, preview `modifiedAt`, and exact full-preview range to the backend client.
- Mounted rendered-output playback, mini timeline, and expandable clip groups in the selected-project detail view.
- `HandoffExportDialog` routes Resolve to the backend picker and retains the existing iMovie `onStart` flow.
- Progress is announced through `aria-live="polite"`; async controls have disabled/loading states and 44px minimum targets.

## Deterministic evidence

- RED: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/useResolveExportJob.test.tsx` failed because `./useResolveExportJob` did not exist.
- GREEN: focused/integration command passed 4 files and 29 tests:
  - `useResolveExportJob.test.tsx`: 6
  - `preview-components.test.tsx`: 8
  - `HandoffExportDialog.test.tsx`: 9
  - `ResolveProjectPicker.test.tsx`: 6
- `rtk pnpm --dir apps/web exec tsc --noEmit`: passed.
- Serena diagnostics for the hook, picker, metadata detail, and handoff dialog: no errors or warnings.
- `rtk git diff --check`: passed.

## Failure modes and handling

- Backend start/status errors preserve safe UI state and never expose raw backend error messages.
- A missing or rejected URL never falls back to an unvalidated navigation mechanism.
- Poll requests never overlap; timeout stops local polling without claiming the backend job failed.
- Close, selection change, unmount, and new start abort timers and requests.
- A launch rejection is recoverable from the same ready job; a backend terminal phase remains authoritative.

## Remaining verification

Browser verification is intentionally left to the controller after this atomic commit, as required by the task dispatch.
