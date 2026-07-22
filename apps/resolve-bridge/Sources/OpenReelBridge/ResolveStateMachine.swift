import Foundation

public enum BridgeError: Error, Equatable, CustomStringConvertible, Sendable {
    case accessibilityDenied
    case resolveLaunchFailed
    case resolveLaunchTimedOut
    case unexpectedScreen
    case projectCreationFailed
    case scriptMissing

    public var description: String {
        switch self {
        case .accessibilityDenied: "Accessibility permission is required to control DaVinci Resolve."
        case .resolveLaunchFailed: "DaVinci Resolve could not be opened."
        case .resolveLaunchTimedOut: "DaVinci Resolve did not reach Project Manager before the deadline."
        case .unexpectedScreen: "DaVinci Resolve is not showing the expected screen."
        case .projectCreationFailed: "DaVinci Resolve could not create the import project."
        case .scriptMissing: "The OpenReel Bridge script is not installed in DaVinci Resolve."
        }
    }
}

public enum ResolveAXRole: String, Equatable, Sendable {
    case window = "AXWindow"
    case sheet = "AXSheet"
    case button = "AXButton"
    case textField = "AXTextField"
    case menuBarItem = "AXMenuBarItem"
    case menuItem = "AXMenuItem"
}

public struct ResolveAXNode: Equatable, Sendable {
    public let id: String
    public let role: ResolveAXRole
    public let title: String?
    public let identifier: String?
    public let enabled: Bool

    public init(id: String, role: ResolveAXRole, title: String?, identifier: String?, enabled: Bool) {
        self.id = id
        self.role = role
        self.title = title
        self.identifier = identifier
        self.enabled = enabled
    }
}

public struct ResolveAXSnapshot: Equatable, Sendable {
    public let activeBundleIdentifier: String?
    public let resolveRunning: Bool
    public let nodes: [ResolveAXNode]

    public init(activeBundleIdentifier: String?, resolveRunning: Bool, nodes: [ResolveAXNode]) {
        self.activeBundleIdentifier = activeBundleIdentifier
        self.resolveRunning = resolveRunning
        self.nodes = nodes
    }
}

public enum ResolveAXAction: Equatable, Sendable {
    case press
    case setValue(String)
}

public protocol ResolveAXDriving: Sendable {
    func requireAccessibility(prompt: Bool) async throws
    func launchApplication(bundleIdentifier: String) async throws
    func snapshot() async throws -> ResolveAXSnapshot
    func perform(_ action: ResolveAXAction, on elementID: String) async throws
}

public protocol BridgeTiming: Sendable {
    func now() async -> Duration
    func sleep(for duration: Duration) async throws
}

public struct SystemBridgeTiming: BridgeTiming {
    private let clock = ContinuousClock()
    private let origin: ContinuousClock.Instant

    public init() { origin = clock.now }
    public func now() async -> Duration { origin.duration(to: clock.now) }
    public func sleep(for duration: Duration) async throws { try await clock.sleep(for: duration) }
}

public actor ResolveStateMachine: ResolveAutomating {
    public static let resolveBundleIdentifier = "com.blackmagic-design.DaVinciResolve"
    public static let pollingInterval: Duration = .milliseconds(250)

    private let driver: any ResolveAXDriving
    private let timing: any BridgeTiming
    private let operationTimeout: Duration

    public init(
        driver: any ResolveAXDriving,
        timing: any BridgeTiming = SystemBridgeTiming(),
        operationTimeout: Duration = .seconds(30)
    ) {
        self.driver = driver
        self.timing = timing
        self.operationTimeout = operationTimeout
    }

    public func perform(requestID: UUID) async throws {
        try await ensureRunning()
        try await createProject(named: "OpenReel Import \(requestID.uuidString.lowercased())")
        try await invokeBridgeScript()
    }

    public func ensureRunning() async throws {
        try Task.checkCancellation()
        try await driver.requireAccessibility(prompt: true)
        do {
            try await driver.launchApplication(bundleIdentifier: Self.resolveBundleIdentifier)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw BridgeError.resolveLaunchFailed
        }
        _ = try await waitForSnapshot(timeoutError: .resolveLaunchTimedOut) { snapshot in
            guard snapshot.resolveRunning,
                  snapshot.activeBundleIdentifier == Self.resolveBundleIdentifier else { return false }
            switch self.screen(in: snapshot) {
            case .projectManager: return true
            case .unavailable: return false
            case .workspace, .ambiguous: throw BridgeError.unexpectedScreen
            }
        }
    }

    public func createProject(named name: String) async throws {
        let current = try await driver.snapshot()
        try requireActive(current)
        guard screen(in: current) == .projectManager else { throw BridgeError.unexpectedScreen }
        let newProject = try uniqueNode(in: current, role: .button, title: "New Project")
        try await projectAction(.press, on: newProject.id)

        let dialog = try await waitForSnapshot(timeoutError: .projectCreationFailed) { snapshot in
            try self.requireActive(snapshot)
            return self.matches(snapshot, role: .sheet).count == 1
        }
        let nameField = try uniqueNode(in: dialog, role: .textField)
        let create = try uniqueNode(in: dialog, role: .button, title: "Create")
        try await projectAction(.setValue(name), on: nameField.id)
        try await projectAction(.press, on: create.id)

        _ = try await waitForSnapshot(timeoutError: .projectCreationFailed) { snapshot in
            try self.requireActive(snapshot)
            switch self.screen(in: snapshot) {
            case .workspace: return true
            case .unavailable, .projectManager: return false
            case .ambiguous: throw BridgeError.unexpectedScreen
            }
        }
    }

    public func invokeBridgeScript() async throws {
        let current = try await driver.snapshot()
        try requireActive(current)
        guard screen(in: current) == .workspace else { throw BridgeError.unexpectedScreen }
        let workspace = try uniqueNode(in: current, role: .menuBarItem, title: "Workspace")
        try await driver.perform(.press, on: workspace.id)

        let workspaceMenu = try await waitForSnapshot(timeoutError: .scriptMissing) { snapshot in
            try self.requireActive(snapshot)
            return self.matches(snapshot, role: .menuItem, title: "Scripts").count == 1
        }
        let scripts = try uniqueNode(in: workspaceMenu, role: .menuItem, title: "Scripts")
        try await driver.perform(.press, on: scripts.id)

        let scriptMenu = try await waitForSnapshot(timeoutError: .scriptMissing) { snapshot in
            try self.requireActive(snapshot)
            return self.matches(snapshot, role: .menuItem, title: "OpenReel Bridge").count == 1
        }
        let script = try uniqueNode(in: scriptMenu, role: .menuItem, title: "OpenReel Bridge")
        try await driver.perform(.press, on: script.id)
    }

    private enum Screen { case projectManager, workspace, unavailable, ambiguous }

    private func screen(in snapshot: ResolveAXSnapshot) -> Screen {
        let projectManager = matches(snapshot, role: .window, title: "Project Manager").count
        let windows = matches(snapshot, role: .window).count
        if projectManager == 1, windows == 1 { return .projectManager }
        if projectManager == 0, windows == 1 { return .workspace }
        if windows == 0 { return .unavailable }
        return .ambiguous
    }

    private func requireActive(_ snapshot: ResolveAXSnapshot) throws {
        guard snapshot.resolveRunning,
              snapshot.activeBundleIdentifier == Self.resolveBundleIdentifier else {
            throw BridgeError.unexpectedScreen
        }
    }

    private func matches(
        _ snapshot: ResolveAXSnapshot,
        role: ResolveAXRole,
        title: String? = nil,
        identifier: String? = nil
    ) -> [ResolveAXNode] {
        snapshot.nodes.filter { node in
            node.role == role
                && node.enabled
                && (title == nil || node.title == title)
                && (identifier == nil || node.identifier == identifier)
        }
    }

    private func uniqueNode(
        in snapshot: ResolveAXSnapshot,
        role: ResolveAXRole,
        title: String? = nil,
        identifier: String? = nil
    ) throws -> ResolveAXNode {
        let found = matches(snapshot, role: role, title: title, identifier: identifier)
        guard found.count == 1, let node = found.first else { throw BridgeError.unexpectedScreen }
        return node
    }

    private func projectAction(_ action: ResolveAXAction, on elementID: String) async throws {
        do {
            try Task.checkCancellation()
            try await driver.perform(action, on: elementID)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw BridgeError.projectCreationFailed
        }
    }

    private func waitForSnapshot(
        timeoutError: BridgeError,
        predicate: (ResolveAXSnapshot) throws -> Bool
    ) async throws -> ResolveAXSnapshot {
        let deadline = await timing.now() + operationTimeout
        while true {
            try Task.checkCancellation()
            let snapshot = try await driver.snapshot()
            if try predicate(snapshot) { return snapshot }
            guard await timing.now() < deadline else { throw timeoutError }
            try await timing.sleep(for: Self.pollingInterval)
        }
    }
}
