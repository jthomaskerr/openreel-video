# macOS Task 2 Report: Swift Backend Client and Coordinator

## Outcome

- Added a SwiftPM library for the macOS bridge with strict backend redemption/artifact/job-status models.
- Added a loopback-only actor client for one-use launch redemption and bounded terminal polling.
- Added an actor coordinator that rejects overlapping runs, creates exactly one bootstrap project, invokes the importer once, waits for the terminal job phase, and clears active state on every exit.
- The redeemed artifact capability URLs are not retained by either actor; the coordinator immediately extracts only the job UUID.

## Security and failure behavior

- Backend URLs are limited to HTTP loopback hosts (`localhost`, IPv4 `127/8`, and IPv6 `::1`) with no user info, query, fragment, or base path.
- DTOs reject unknown keys, non-canonical UUIDs, malformed backend timestamps, invalid project IDs/revisions, invalid hashes, negative lengths, and non-project artifact URLs.
- Response bodies, paths, launch tokens, and capability tokens are never included in public errors.
- URLSession requests have explicit deadlines and preserve caller cancellation. Terminal polling is bounded and drops its job-to-project lookup on every exit.

## TDD evidence

- Initial RED: SwiftPM reported the `OpenReelBridge` target was empty before production sources existed.
- Contract RED: traversal-shaped project IDs and non-SHA revisions were accepted before strict validation, then rejected after the model fix.
- First full run found IPv6 loopback formatted by Foundation as `[::1]`; normalization fixed the failure.
- GREEN: 12/12 Swift tests passed in 0.038 seconds.

## Verification command

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
CLANG_MODULE_CACHE_PATH=/tmp/openreel-swift-module-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/openreel-swift-module-cache \
swift test --disable-sandbox \
  --scratch-path /tmp/openreel-resolve-bridge-swift-build \
  --package-path apps/resolve-bridge
```

The installed Command Line Tools 26.2 pair a Swift 6.2.4 compiler with a Swift 6.2.3 SDK and contain neither XCTest nor the bundled Testing module. Tests therefore use the official test-only `swiftlang/swift-testing` 0.12.0 dependency under the matching macOS 15.4 SDK. Runtime targets remain dependency-free. SwiftPM's initial `.build/` directory was left untouched and uncommitted; verification uses the explicit `/tmp` scratch path.

- `rtk git diff --check` passed.
