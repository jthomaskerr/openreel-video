# Resolve macOS Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch Resolve from OpenReel, create one new project from Project Manager, invoke the internal importer, and return verified import evidence to the backend.

**Architecture:** A Swift executable packaged as a per-user macOS app handles the custom URL, backend redemption, Accessibility, Resolve launch, and status UI. A thin installed Python Utility script performs in-process Resolve API calls against the current project. Both consume the backend contract and share fixtures.

**Tech Stack:** Swift 6/AppKit/ApplicationServices/Foundation, Swift Package Manager, Python 3 standard library/unittest, DaVinci Resolve 21 scripting API, shell installer.

## Global Constraints

- Target macOS and DaVinci Resolve 21.0.3 build 21.0.30007 first.
- Never overwrite, rename, populate, or delete a pre-existing Resolve project.
- Create exactly one new Resolve project per accepted request and populate that same project.
- Accessibility automation is limited to launching/focusing Resolve, creating the project, and invoking the internal script.
- Python contains no OpenReel project parsing or FCPXML generation logic.
- Python reports exact `referencedMediaIds`; media remains in the canonical backend project store and is never copied into the bridge app.
- Do not commit app bundles, generated binaries, credentials, tokens, or import artifacts.

---

### Task 1: Shared fixture and Python request adapter

**Files:**
- Create: `apps/resolve-bridge/fixtures/ready-job.json`
- Create: `apps/resolve-bridge/resolve/OpenReelBridge.py`
- Create: `apps/resolve-bridge/resolve/tests/test_openreel_bridge.py`

**Interfaces:**
- Consumes a redeemed backend job containing request ID, desired name, FCPXML artifact URL/hash, media root, expected counts, result URL, and one-use callback token.
- Produces `run_import(resolve, request, backend) -> dict` and posts one `ResolveImportResult`.

- [ ] **Step 1: Write failing Python adapter tests**

```py
def test_imports_into_current_project_and_renames_same_project(self):
    resolve = FakeResolve(current_project="OpenReel Import 123")
    result = run_import(resolve, READY_REQUEST, FakeBackend())
    self.assertEqual(resolve.created_projects, [])
    self.assertEqual(resolve.renames, [("OpenReel Import 123", "Vintage Tokyo")])
    self.assertEqual(result["offlineMediaIds"], [])
    self.assertEqual(result["referencedMediaIds"], ["media-1", "media-2"])
    self.assertTrue(result["saved"])
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk /usr/bin/python3 -m unittest discover -s apps/resolve-bridge/resolve/tests -v`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the thin adapter**

```py
def run_import(resolve, request, backend):
    project_manager = require(resolve.GetProjectManager(), "PROJECT_MANAGER_UNAVAILABLE")
    project = require(project_manager.GetCurrentProject(), "CURRENT_PROJECT_UNAVAILABLE")
    verify_sha256(request["fcpxmlPath"], request["artifactSha256"])
    timeline = require(project.GetMediaPool().ImportTimelineFromFile(
        request["fcpxmlPath"],
        {"timelineName": request["timelineName"], "importSourceClips": True,
         "sourceClipsPath": request["mediaPath"]},
    ), "FCPXML_REJECTED")
    final_name = collision_safe_name(project_manager.GetProjectListInCurrentFolder(), request["projectName"])
    require(project_manager.RenameProject(project.GetName(), final_name), "RENAME_FAILED")
    result = inspect_and_save(project_manager, project, timeline, request)
    backend.post_result(request["resultUrl"], request["callbackToken"], result)
    return result
```

Use the installed `DaVinciResolveScript` module or Resolve-provided globals. Redact callback tokens and raw paths from diagnostics.

- [ ] **Step 4: Run tests**

Run: `rtk /usr/bin/python3 -m unittest discover -s apps/resolve-bridge/resolve/tests -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/resolve-bridge/fixtures apps/resolve-bridge/resolve
rtk git commit -m "feat(resolve-bridge): add internal Resolve adapter"
```

### Task 2: Swift backend client and request coordinator

**Files:**
- Create: `apps/resolve-bridge/Package.swift`
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/BridgeModels.swift`
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/BackendClient.swift`
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/ImportCoordinator.swift`
- Create: `apps/resolve-bridge/Tests/OpenReelBridgeTests/BackendClientTests.swift`
- Create: `apps/resolve-bridge/Tests/OpenReelBridgeTests/ImportCoordinatorTests.swift`

**Interfaces:**
- Produces: `BackendClient.redeem(launchToken:)`, `ImportCoordinator.run(launchToken:)`, and protocol abstractions `ResolveAutomating` and `BackendServing`.

- [ ] **Step 1: Write failing Swift request tests**

```swift
func testRejectsNonLoopbackBackend() async throws {
    let client = BackendClient(baseURL: URL(string: "https://example.com")!, session: .shared)
    await XCTAssertThrowsErrorAsync(try await client.redeem(launchToken: UUID()))
}

func testCoordinatorCreatesExactlyOneProjectThenInvokesScript() async throws {
    let ax = FakeResolveAutomation()
    try await ImportCoordinator(backend: FakeBackend(), resolve: ax).run(launchToken: fixtureID)
    XCTAssertEqual(ax.createdProjects.count, 1)
    XCTAssertEqual(ax.scriptInvocations, 1)
}
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk swift test --package-path apps/resolve-bridge`

Expected: FAIL because the package and types are absent.

- [ ] **Step 3: Implement models, loopback validation, and coordinator**

```swift
protocol ResolveAutomating {
    func ensureRunning() async throws
    func createProject(named: String) async throws
    func invokeBridgeScript() async throws
}

actor ImportCoordinator {
    func run(launchToken: UUID) async throws {
        let request = try await backend.redeem(launchToken: launchToken)
        try await resolve.ensureRunning()
        try await resolve.createProject(named: "OpenReel Import \(request.requestID.uuidString)")
        try await resolve.invokeBridgeScript()
        try await backend.waitForTerminalResult(jobID: request.jobID, timeout: .seconds(180))
    }
}
```

Decode the shared JSON fixture with strict date and UUID handling. Persist no callback token after the request terminates.

- [ ] **Step 4: Run Swift tests**

Run: `rtk swift test --package-path apps/resolve-bridge`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/resolve-bridge/Package.swift apps/resolve-bridge/Sources apps/resolve-bridge/Tests
rtk git commit -m "feat(resolve-bridge): coordinate backend import requests"
```

### Task 3: Accessibility driver and Resolve state machine

**Files:**
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/AccessibilityPermission.swift`
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/ResolveAXDriver.swift`
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/ResolveStateMachine.swift`
- Create: `apps/resolve-bridge/Tests/OpenReelBridgeTests/ResolveStateMachineTests.swift`

**Interfaces:**
- Implements `ResolveAutomating` using `AXUIElement` roles/actions.
- Produces stable `BridgeError` cases for denied permission, launch timeout, unexpected screen, project creation failure, and missing script.

- [ ] **Step 1: Write failing deterministic state-machine tests**

```swift
func testProjectManagerCreatesProjectAndInvokesScript() async throws {
    let ui = FakeAXTree.projectManager(scriptInstalled: true)
    try await ResolveStateMachine(driver: ui).perform(requestID: fixtureID)
    XCTAssertEqual(ui.actions, [
        .press("New Project"), .setValue("OpenReel Import \(fixtureID)"),
        .press("Create"), .openMenu("Workspace"), .openMenu("Scripts"),
        .press("OpenReel Bridge"),
    ])
}
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk swift test --package-path apps/resolve-bridge --filter ResolveStateMachineTests`

Expected: FAIL because the driver is absent.

- [ ] **Step 3: Implement bounded AX operations**

Request trust with `AXIsProcessTrustedWithOptions`, launch Resolve through `NSWorkspace`, poll by role/title with a 250 ms interval and explicit deadline, and prefer stable AX roles/identifiers over coordinates. Refuse to continue when the active application or screen state is ambiguous.

```swift
func requireAccessibility() throws {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else { throw BridgeError.accessibilityDenied }
}
```

- [ ] **Step 4: Run state-machine and full Swift tests**

Run: `rtk swift test --package-path apps/resolve-bridge`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/resolve-bridge/Sources/OpenReelBridge apps/resolve-bridge/Tests/OpenReelBridgeTests
rtk git commit -m "feat(resolve-bridge): automate Resolve project bootstrap"
```

### Task 4: Native status app, URL scheme, build, and installer

**Files:**
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/AppDelegate.swift`
- Create: `apps/resolve-bridge/Sources/OpenReelBridge/StatusWindowController.swift`
- Create: `apps/resolve-bridge/Resources/Info.plist`
- Create: `apps/resolve-bridge/scripts/build-app.sh`
- Create: `apps/resolve-bridge/scripts/install.sh`
- Create: `apps/resolve-bridge/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Registers `openreel-resolve://import/{launch-token}`.
- Installs the app under `~/Applications/OpenReel Bridge.app` and Python under Resolve's user Utility scripts directory.

- [ ] **Step 1: Write shell verification for generated bundle**

```sh
test -x "$bundle/Contents/MacOS/OpenReelBridge"
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$bundle/Contents/Info.plist" | grep -qx openreel-resolve
```

- [ ] **Step 2: Implement status UI and URL validation**

Create an AppKit status window that appears within 300 ms and shows `Connecting`, `Opening Resolve`, `Creating project`, `Running importer`, `Validating`, or a stable failure with retry. Reject URLs with query strings, fragments, non-UUID tokens, or paths other than `/import/{launch-token}`.

```swift
func application(_ application: NSApplication, open urls: [URL]) {
    guard urls.count == 1, let launchToken = BridgeURL.parse(urls[0]) else {
        status.show(error: .invalidLaunchURL); return
    }
    Task { await coordinator.runAndPresent(launchToken: launchToken, status: status) }
}
```

- [ ] **Step 3: Implement deterministic app bundle construction and installation**

`build-app.sh` runs `swift build -c release`, creates a temporary app bundle, copies the executable and checked-in plist, and performs the bundle assertions. `install.sh` copies the verified bundle to `~/Applications` and the Python script to Resolve's per-user `Fusion/Scripts/Utility` directory. Add `.build/` and generated `.app` paths to `.gitignore`.

- [ ] **Step 4: Run build and installation verification**

Run: `rtk ./apps/resolve-bridge/scripts/build-app.sh`

Expected: generated bundle passes executable and URL-scheme checks.

Run: `rtk swift test --package-path apps/resolve-bridge && rtk /usr/bin/python3 -m unittest discover -s apps/resolve-bridge/resolve/tests -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/resolve-bridge .gitignore
rtk git commit -m "feat(resolve-bridge): package and install macOS bridge"
```

### Task 5: Live Resolve 21.0.3 acceptance and compatibility evidence

**Files:**
- Create: `apps/resolve-bridge/scripts/live-acceptance.py`
- Modify: `docs/export-compatibility.md`
- Modify: `specs/006-resolve-imovie-export/tasks.md`

**Interfaces:**
- Consumes backend job/result APIs and produces a sanitized acceptance JSON report under `/tmp/openreel-resolve-acceptance/`.

- [ ] **Step 1: Add acceptance assertions**

```py
assert result["resolveVersion"] == "21.0.3"
assert result["resolveBuild"] == "21.0.30007"
assert result["projectName"].startswith("Vintage Tokyo")
assert sum(result["clipCounts"].values()) == 38
assert result["offlineMediaIds"] == []
assert result["saved"] is True
```

- [ ] **Step 2: Run from Project Manager with no project open**

Run the OpenReel web flow, select Vintage Tokyo, and choose **Open in Resolve**. Grant Accessibility when macOS prompts.

Expected: Resolve opens one new project and runs the installed bridge script without manual project creation.

- [ ] **Step 3: Run the evidence verifier**

Run: `rtk /usr/bin/python3 apps/resolve-bridge/scripts/live-acceptance.py --latest --output /tmp/openreel-resolve-acceptance/result.json`

Expected: exit 0 and every assertion passes.

- [ ] **Step 4: Repeat for collision safety**

Run the same OpenReel export again.

Expected: a second uniquely named Resolve project is created; the first project's name, timeline, media, and save timestamp remain unchanged.

- [ ] **Step 5: Record exact compatibility evidence and commit**

Update the compatibility document with the exact app/build, project fixture revision, job IDs, artifact hashes, counts, and offline result. Check only tasks proven by the live run.

```bash
rtk git add apps/resolve-bridge/scripts/live-acceptance.py docs/export-compatibility.md specs/006-resolve-imovie-export/tasks.md
rtk git commit -m "test(resolve): verify live OpenReel bridge import"
```
