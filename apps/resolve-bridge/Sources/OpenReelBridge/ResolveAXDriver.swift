#if os(macOS)
import AppKit
import ApplicationServices
import Foundation

public actor ResolveAXDriver: ResolveAXDriving {
    private let permission = AccessibilityPermission()
    private let workspace = NSWorkspace.shared
    private var elements: [String: AXUIElement] = [:]

    public init() {}

    public func requireAccessibility(prompt: Bool) async throws {
        try permission.require(prompt: prompt)
    }

    public func launchApplication(bundleIdentifier: String) async throws {
        guard bundleIdentifier == ResolveStateMachine.resolveBundleIdentifier,
              let applicationURL = workspace.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            throw BridgeError.resolveLaunchFailed
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let application = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<NSRunningApplication, Error>) in
            workspace.openApplication(at: applicationURL, configuration: configuration) { application, error in
                if let error { continuation.resume(throwing: error) }
                else if let application { continuation.resume(returning: application) }
                else { continuation.resume(throwing: BridgeError.resolveLaunchFailed) }
            }
        }
        guard application.bundleIdentifier == bundleIdentifier else { throw BridgeError.resolveLaunchFailed }
    }

    public func snapshot() async throws -> ResolveAXSnapshot {
        let running = workspace.runningApplications.first {
            $0.bundleIdentifier == ResolveStateMachine.resolveBundleIdentifier
        }
        guard let running else {
            elements = [:]
            return .init(
                activeBundleIdentifier: workspace.frontmostApplication?.bundleIdentifier,
                resolveRunning: false,
                nodes: []
            )
        }

        let root = AXUIElementCreateApplication(running.processIdentifier)
        var nextElements: [String: AXUIElement] = [:]
        var nodes: [ResolveAXNode] = []
        var visited = 0
        walk(root, path: "0", depth: 0, visited: &visited, elements: &nextElements, nodes: &nodes)
        elements = nextElements
        return .init(
            activeBundleIdentifier: workspace.frontmostApplication?.bundleIdentifier,
            resolveRunning: true,
            nodes: nodes
        )
    }

    public func perform(_ action: ResolveAXAction, on elementID: String) async throws {
        guard workspace.frontmostApplication?.bundleIdentifier == ResolveStateMachine.resolveBundleIdentifier,
              let element = elements[elementID] else {
            throw BridgeError.unexpectedScreen
        }
        let result: AXError
        switch action {
        case .press:
            result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        case let .setValue(value):
            result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        }
        guard result == .success else { throw BridgeError.unexpectedScreen }
    }

    private func walk(
        _ element: AXUIElement,
        path: String,
        depth: Int,
        visited: inout Int,
        elements: inout [String: AXUIElement],
        nodes: inout [ResolveAXNode]
    ) {
        guard depth <= 12, visited < 5_000 else { return }
        visited += 1
        if let roleValue = stringAttribute(kAXRoleAttribute, of: element),
           let role = ResolveAXRole(rawValue: roleValue) {
            let id = "ax-\(path)"
            elements[id] = element
            nodes.append(.init(
                id: id,
                role: role,
                title: stringAttribute(kAXTitleAttribute, of: element),
                identifier: stringAttribute(kAXIdentifierAttribute, of: element),
                enabled: boolAttribute(kAXEnabledAttribute, of: element) ?? true
            ))
        }
        for (index, child) in children(of: element).enumerated() {
            walk(
                child,
                path: "\(path).\(index)",
                depth: depth + 1,
                visited: &visited,
                elements: &elements,
                nodes: &nodes
            )
        }
    }

    private func children(of element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success else {
            return []
        }
        return value as? [AXUIElement] ?? []
    }

    private func stringAttribute(_ name: String, of element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private func boolAttribute(_ name: String, of element: AXUIElement) -> Bool? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? Bool
    }
}
#endif
