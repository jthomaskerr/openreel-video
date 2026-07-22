import Foundation
import Testing
@testable import OpenReelBridge

@Suite("Resolve Accessibility state machine", .serialized)
struct ResolveStateMachineTests {
    private let requestID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!

    @Test func projectManagerCreatesExactlyOneNamedProjectAndInvokesInstalledScript() async throws {
        let driver = FakeAXDriver()
        let timing = FakeBridgeTiming()
        let machine = ResolveStateMachine(driver: driver, timing: timing, operationTimeout: .seconds(2))

        try await machine.perform(requestID: requestID)

        #expect(await driver.permissionPrompts == [true])
        #expect(await driver.launchedBundleIdentifiers == [ResolveStateMachine.resolveBundleIdentifier])
        #expect(await driver.actions == [
            .press("new-project"),
            .setValue("OpenReel Import aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "project-name"),
            .press("create-project"),
            .press("workspace-menu"),
            .press("scripts-menu"),
            .press("openreel-script"),
        ])
    }

    @Test func deniedAccessibilityStopsBeforeLaunchingResolve() async {
        let driver = FakeAXDriver(accessibilityGranted: false)
        let machine = ResolveStateMachine(driver: driver, timing: FakeBridgeTiming())

        let error = await capturedError { try await machine.perform(requestID: requestID) }

        #expect(error as? BridgeError == .accessibilityDenied)
        #expect(await driver.launchedBundleIdentifiers.isEmpty)
        #expect(await driver.actions.isEmpty)
    }

    @Test func launchUsesBoundedQuarterSecondPollingAndTimesOut() async {
        let driver = FakeAXDriver(initialState: .neverActivates)
        let timing = FakeBridgeTiming()
        let machine = ResolveStateMachine(
            driver: driver,
            timing: timing,
            operationTimeout: .seconds(1)
        )

        let error = await capturedError { try await machine.ensureRunning() }

        #expect(error as? BridgeError == .resolveLaunchTimedOut)
        #expect(await driver.launchedBundleIdentifiers.count == 1)
        #expect(await timing.sleeps == [
            .milliseconds(250), .milliseconds(250), .milliseconds(250), .milliseconds(250),
        ])
    }

    @Test func ambiguousResolveScreenFailsClosedWithoutPressingAnything() async {
        let driver = FakeAXDriver(initialState: .ambiguous)
        let machine = ResolveStateMachine(driver: driver, timing: FakeBridgeTiming())

        let error = await capturedError { try await machine.ensureRunning() }

        #expect(error as? BridgeError == .unexpectedScreen)
        #expect(await driver.actions.isEmpty)
    }

    @Test func projectCreationFailureIsStableAndDoesNotInvokeScript() async {
        let driver = FakeAXDriver(failingElementID: "create-project")
        let machine = ResolveStateMachine(driver: driver, timing: FakeBridgeTiming())

        let error = await capturedError { try await machine.perform(requestID: requestID) }
        let actions = await driver.actions

        #expect(error as? BridgeError == .projectCreationFailed)
        #expect(actions.filter { $0 == .press("create-project") }.count == 1)
        #expect(!actions.contains(.press("openreel-script")))
    }

    @Test func missingScriptReportsStableErrorAfterOpeningWorkspaceScriptsOnce() async {
        let driver = FakeAXDriver(scriptInstalled: false)
        let timing = FakeBridgeTiming()
        let machine = ResolveStateMachine(
            driver: driver,
            timing: timing,
            operationTimeout: .seconds(1)
        )

        let error = await capturedError { try await machine.perform(requestID: requestID) }
        let actions = await driver.actions

        #expect(error as? BridgeError == .scriptMissing)
        #expect(actions.filter { $0 == .press("workspace-menu") }.count == 1)
        #expect(actions.filter { $0 == .press("scripts-menu") }.count == 1)
        #expect(!actions.contains(.press("openreel-script")))
    }

    @Test func duplicateMatchingControlsFailClosed() async {
        let driver = FakeAXDriver(duplicateNewProjectButton: true)
        let machine = ResolveStateMachine(driver: driver, timing: FakeBridgeTiming())

        let error = await capturedError { try await machine.perform(requestID: requestID) }

        #expect(error as? BridgeError == .unexpectedScreen)
        #expect(await driver.actions.isEmpty)
    }
}

private actor FakeBridgeTiming: BridgeTiming {
    private(set) var elapsed: Duration = .zero
    private(set) var sleeps: [Duration] = []

    func now() -> Duration { elapsed }

    func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
        sleeps.append(duration)
        elapsed += duration
    }
}

private actor FakeAXDriver: ResolveAXDriving {
    enum State { case projectManager, newProjectDialog, workspace, workspaceMenu, scriptsMenu, ambiguous, neverActivates }
    enum RecordedAction: Equatable { case press(String), setValue(String, String) }

    private(set) var permissionPrompts: [Bool] = []
    private(set) var launchedBundleIdentifiers: [String] = []
    private(set) var actions: [RecordedAction] = []
    private var state: State
    private let accessibilityGranted: Bool
    private let scriptInstalled: Bool
    private let duplicateNewProjectButton: Bool
    private let failingElementID: String?

    init(
        accessibilityGranted: Bool = true,
        initialState: State = .projectManager,
        scriptInstalled: Bool = true,
        duplicateNewProjectButton: Bool = false,
        failingElementID: String? = nil
    ) {
        self.accessibilityGranted = accessibilityGranted
        state = initialState
        self.scriptInstalled = scriptInstalled
        self.duplicateNewProjectButton = duplicateNewProjectButton
        self.failingElementID = failingElementID
    }

    func requireAccessibility(prompt: Bool) async throws {
        permissionPrompts.append(prompt)
        if !accessibilityGranted { throw BridgeError.accessibilityDenied }
    }

    func launchApplication(bundleIdentifier: String) async throws {
        launchedBundleIdentifiers.append(bundleIdentifier)
    }

    func snapshot() async throws -> ResolveAXSnapshot {
        let activeBundle = state == .neverActivates ? "com.openreel.bridge" : ResolveStateMachine.resolveBundleIdentifier
        switch state {
        case .projectManager:
            var nodes = [
                node("project-manager", role: .window, title: "Project Manager"),
                node("new-project", role: .button, title: "New Project"),
            ]
            if duplicateNewProjectButton {
                nodes.append(node("new-project-copy", role: .button, title: "New Project"))
            }
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: nodes)
        case .newProjectDialog:
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: [
                node("new-project-dialog", role: .sheet, identifier: "NewProjectDialog"),
                node("project-name", role: .textField, identifier: "ProjectName"),
                node("create-project", role: .button, title: "Create"),
            ])
        case .workspace:
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: [
                node("resolve-main", role: .window, identifier: "ResolveMainWindow", title: "DaVinci Resolve"),
                node("workspace-menu", role: .menuBarItem, title: "Workspace"),
            ])
        case .workspaceMenu:
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: [
                node("resolve-main", role: .window, identifier: "ResolveMainWindow", title: "DaVinci Resolve"),
                node("scripts-menu", role: .menuItem, title: "Scripts"),
            ])
        case .scriptsMenu:
            var nodes = [node("resolve-main", role: .window, identifier: "ResolveMainWindow", title: "DaVinci Resolve")]
            if scriptInstalled { nodes.append(node("openreel-script", role: .menuItem, title: "OpenReel Bridge")) }
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: nodes)
        case .ambiguous:
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: [
                node("project-manager", role: .window, title: "Project Manager"),
                node("resolve-main", role: .window, identifier: "ResolveMainWindow", title: "DaVinci Resolve"),
            ])
        case .neverActivates:
            return .init(activeBundleIdentifier: activeBundle, resolveRunning: true, nodes: [])
        }
    }

    func perform(_ action: ResolveAXAction, on elementID: String) async throws {
        switch action {
        case .press: actions.append(.press(elementID))
        case let .setValue(value): actions.append(.setValue(value, elementID))
        }
        if failingElementID == elementID { throw FakeDriverError.actionFailed }
        switch (elementID, action) {
        case ("new-project", .press): state = .newProjectDialog
        case ("create-project", .press): state = .workspace
        case ("workspace-menu", .press): state = .workspaceMenu
        case ("scripts-menu", .press): state = .scriptsMenu
        default: break
        }
    }

    private func node(
        _ id: String,
        role: ResolveAXRole,
        identifier: String? = nil,
        title: String? = nil
    ) -> ResolveAXNode {
        .init(id: id, role: role, title: title, identifier: identifier, enabled: true)
    }

    private enum FakeDriverError: Error { case actionFailed }
}
