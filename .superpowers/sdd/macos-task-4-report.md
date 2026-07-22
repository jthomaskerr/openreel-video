# macOS Task 4 Report: Native App, Bundle, and Installer

## Outcome

- Added strict canonical `openreel-resolve://import/{uuid}` parsing with no query, fragment, user info, alternate host/path, uppercase token, or extra data.
- Added a single-request actor gate with monotonic progress states, concurrent request rejection, and one safe retry opportunity after failure.
- Added an accessible AppKit status window and URL-handling application delegate.
- Added a SwiftPM executable, checked-in plist, deterministic verified app-bundle builder, and staged no-sudo per-user installer.
- Added bundle/build output ignores and operator documentation.

## Safety and failure behavior

- The status window is created synchronously at application launch and exposes stable accessible text for every state.
- Invalid or multiple URLs never reach the backend. Concurrent URLs never start a second import.
- Build publication validates the executable, plist, and exact URL scheme before replacing the generated bundle.
- Installation validates and stages both app and Python source before replacement, uses quoted paths, refuses unreadable inputs, emits actionable permission errors, and touches only the per-user app and Resolve Utility script destinations.
- The installer uses no `sudo` and was intentionally not executed in this task.

## TDD and verification evidence

- RED: native app tests failed only on absent URL/controller/status/progress production types.
- Focused native app suite: 5/5 passed.
- Full Swift suite: 24/24 passed in 0.043 seconds.
- Python importer suite: 9/9 passed in 0.005 seconds.
- Release app product compiled and bundle assertions passed for executable, plist lint, and `openreel-resolve` scheme.
- `bash -n` passed for both scripts. `shellcheck` is not installed.
- `rtk git diff --check` passed.

The release build uses the existing macOS 15.4 SDK, `/tmp` SwiftPM scratch path, and `/tmp` module cache required by the local Command Line Tools mismatch. Generated `.build`, `.artifacts`, and `.app` paths are ignored and not committed.
