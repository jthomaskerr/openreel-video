# macOS Task 3 Report: Resolve Accessibility State Machine

## Outcome

- Added a deterministic `ResolveStateMachine` implementing `ResolveAutomating`.
- Added a production `ResolveAXDriver` using AppKit, ApplicationServices, exact Resolve bundle launch, and AX role/title/identifier attributes only. It performs no coordinate-based actions.
- Added Accessibility trust prompting through `AXIsProcessTrustedWithOptions`.
- Added exact Project Manager flow: one New Project action, one exact bootstrap name, one Create action, then Workspace > Scripts > OpenReel Bridge.
- Added package-local `.build/` to `.gitignore`; build products remain untracked.

## Correctness and failure modes

- AX snapshots are bounded to 5,000 nodes and depth 12, and actions use handles from the most recent snapshot.
- Every action verifies Resolve is the frontmost application. Multiple matching windows or controls fail closed.
- Polling uses a monotonic clock, exact 250 ms intervals, explicit deadlines, and cooperative cancellation.
- Accessibility denial, launch failure/timeout, unexpected screen, project creation failure, and missing script produce stable sanitized `BridgeError` values.
- The state machine does not retry clicks, create a second project, or invoke a second script.

## TDD and verification evidence

- RED: the corrected test target failed only because the Task 3 production protocols, models, state machine, and errors were absent.
- First compile found one continuation result-type inference error in the AppKit launch wrapper; an explicit `NSRunningApplication` continuation fixed it.
- Filtered: `ResolveStateMachineTests` passed 7/7 in 0.002 seconds.
- Full suite after refactor: 19/19 tests passed in 0.045 seconds.
- Production AppKit/ApplicationServices sources compiled under the matching macOS 15.4 SDK.
- `rtk git diff --check` passed.

Verification used the existing explicit `/tmp/openreel-resolve-bridge-swift-build` scratch path and `/tmp` module cache because the installed Command Line Tools 26.2 compiler and SDK patch versions are mismatched. The checked-in runtime target has no added dependency.
