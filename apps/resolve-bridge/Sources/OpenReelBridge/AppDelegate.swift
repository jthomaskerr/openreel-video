import Foundation

public enum BridgeURL {
    public static func parse(_ url: URL) -> UUID? {
        guard url.scheme == "openreel-resolve",
              url.host == "import",
              url.user == nil,
              url.password == nil,
              url.port == nil,
              url.query == nil,
              url.fragment == nil else { return nil }
        let token = String(url.path.dropFirst())
        guard url.path == "/\(token)",
              token.range(
                of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                options: .regularExpression
              ) != nil,
              let uuid = UUID(uuidString: token),
              url.absoluteString == "openreel-resolve://import/\(token)" else { return nil }
        return uuid
    }
}

public enum ImportProgress: String, CaseIterable, Equatable, Sendable {
    case connecting
    case openingResolve
    case creatingProject
    case runningImporter
    case validating
}

public protocol BridgeImportRunning: Sendable {
    func run(
        launchToken: UUID,
        progress: @Sendable (ImportProgress) async -> Void
    ) async throws
}

public enum BridgeAppError: Equatable, Sendable {
    case invalidLaunchURL
    case requestAlreadyRunning
    case importFailed
    case retryUnavailable
}

public enum BridgeStatusState: Equatable, Sendable {
    case connecting
    case openingResolve
    case creatingProject
    case runningImporter
    case validating
    case completed
    case failed(BridgeAppError)

    public static let allExamples: [Self] = [
        .connecting, .openingResolve, .creatingProject, .runningImporter, .validating, .completed,
        .failed(.invalidLaunchURL), .failed(.requestAlreadyRunning), .failed(.importFailed),
        .failed(.retryUnavailable),
    ]

    public var accessibilityText: String {
        switch self {
        case .connecting: "Connecting to OpenReel"
        case .openingResolve: "Opening DaVinci Resolve"
        case .creatingProject: "Creating a new Resolve project"
        case .runningImporter: "Running the OpenReel importer"
        case .validating: "Validating the Resolve import"
        case .completed: "OpenReel import completed"
        case .failed(.invalidLaunchURL): "The OpenReel import link is invalid. Start a new export from OpenReel."
        case .failed(.requestAlreadyRunning): "An OpenReel import is already running."
        case .failed(.importFailed): "The OpenReel import failed. Retry or start a new export."
        case .failed(.retryUnavailable): "There is no failed OpenReel import available to retry."
        }
    }

    init(progress: ImportProgress) {
        switch progress {
        case .connecting: self = .connecting
        case .openingResolve: self = .openingResolve
        case .creatingProject: self = .creatingProject
        case .runningImporter: self = .runningImporter
        case .validating: self = .validating
        }
    }
}

public protocol BridgeStatusReporting: Sendable {
    func show(_ state: BridgeStatusState) async
}

public actor BridgeRequestController {
    private let runner: any BridgeImportRunning
    private let status: any BridgeStatusReporting
    private var running = false
    private var retryToken: UUID?

    public init(runner: any BridgeImportRunning, status: any BridgeStatusReporting) {
        self.runner = runner
        self.status = status
    }

    public func handle(urls: [URL]) async {
        guard urls.count == 1, let token = urls.first.flatMap(BridgeURL.parse) else {
            await status.show(.failed(.invalidLaunchURL))
            return
        }
        await run(token: token)
    }

    public func retry() async {
        guard !running, let token = retryToken else {
            await status.show(.failed(running ? .requestAlreadyRunning : .retryUnavailable))
            return
        }
        retryToken = nil
        await run(token: token)
    }

    private func run(token: UUID) async {
        guard !running else {
            await status.show(.failed(.requestAlreadyRunning))
            return
        }
        running = true
        await status.show(.connecting)
        defer { running = false }
        do {
            try await runner.run(launchToken: token) { [status] progress in
                await status.show(.init(progress: progress))
            }
            retryToken = nil
            await status.show(.completed)
        } catch is CancellationError {
            retryToken = token
            await status.show(.failed(.importFailed))
        } catch {
            retryToken = token
            await status.show(.failed(.importFailed))
        }
    }
}

#if os(macOS)
import AppKit

@MainActor
public final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusWindow = StatusWindowController()
    private lazy var controller: BridgeRequestController = {
        let backend = BackendClient(baseURL: URL(string: "http://127.0.0.1:4041")!)
        let resolve = ResolveStateMachine(driver: ResolveAXDriver())
        return BridgeRequestController(
            runner: ImportCoordinator(backend: backend, resolve: resolve),
            status: statusWindow
        )
    }()

    public func applicationDidFinishLaunching(_ notification: Notification) {
        statusWindow.onRetry = { [weak self] in
            guard let self else { return }
            Task { await self.controller.retry() }
        }
        statusWindow.show(.connecting)
    }

    public func application(_ application: NSApplication, open urls: [URL]) {
        statusWindow.showWindow(nil)
        Task { await controller.handle(urls: urls) }
    }
}
#endif
