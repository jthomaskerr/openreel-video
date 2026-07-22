import Foundation

public protocol ResolveAutomating: Sendable {
    func ensureRunning() async throws
    func createProject(named name: String) async throws
    func invokeBridgeScript() async throws
}

public enum ImportCoordinatorError: Error, Equatable, CustomStringConvertible, Sendable {
    case requestAlreadyRunning
    case importFailed(ResolveJobPhase)

    public var description: String {
        switch self {
        case .requestAlreadyRunning:
            "An OpenReel import is already running."
        case .importFailed:
            "Resolve did not complete the OpenReel import."
        }
    }
}

public actor ImportCoordinator: BridgeImportRunning {
    private let backend: any BackendServing
    private let resolve: any ResolveAutomating
    private let terminalTimeout: Duration
    private var running = false

    public init(
        backend: any BackendServing,
        resolve: any ResolveAutomating,
        terminalTimeout: Duration = .seconds(180)
    ) {
        self.backend = backend
        self.resolve = resolve
        self.terminalTimeout = terminalTimeout
    }

    var isRunning: Bool { running }

    public func run(launchToken: UUID) async throws {
        try await run(launchToken: launchToken) { _ in }
    }

    public func run(
        launchToken: UUID,
        progress: @Sendable (ImportProgress) async -> Void
    ) async throws {
        guard !running else { throw ImportCoordinatorError.requestAlreadyRunning }
        running = true
        defer { running = false }

        await progress(.connecting)
        let jobID = try await backend.redeem(launchToken: launchToken).jobID
        try Task.checkCancellation()
        await progress(.openingResolve)
        try await resolve.ensureRunning()
        try Task.checkCancellation()
        await progress(.creatingProject)
        try await resolve.createProject(named: "OpenReel Import \(jobID.uuidString.lowercased())")
        try Task.checkCancellation()
        await progress(.runningImporter)
        try await resolve.invokeBridgeScript()
        try Task.checkCancellation()
        await progress(.validating)
        let terminal = try await backend.waitForTerminalResult(
            jobID: jobID,
            timeout: terminalTimeout
        )
        guard terminal.phase == .completed else {
            throw ImportCoordinatorError.importFailed(terminal.phase)
        }
    }
}
