import Foundation
import Testing
@testable import OpenReelBridge

@Suite("Import coordinator", .serialized)
struct ImportCoordinatorTests {
    private let fixtureToken = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!

    @Test func createsExactlyOneProjectThenInvokesScriptAndWaitsForTerminalResult() async throws {
        let backend = FakeBackend()
        let resolve = FakeResolveAutomation()
        let coordinator = ImportCoordinator(backend: backend, resolve: resolve, terminalTimeout: .seconds(1))

        try await coordinator.run(launchToken: fixtureToken)

        let actions = await resolve.actions
        let waitedJobIDs = await backend.waitedJobIDs
        let isRunning = await coordinator.isRunning
        #expect(actions == [
            .ensureRunning,
            .createProject("OpenReel Import 11111111-1111-4111-8111-111111111111"),
            .invokeScript,
        ])
        #expect(waitedJobIDs == [Self.request.jobID])
        #expect(!isRunning)
    }

    @Test func rejectsOverlappingRunsWithoutCreatingAnotherProjectOrScriptInvocation() async {
        let backend = FakeBackend(waitMode: .suspend)
        let resolve = FakeResolveAutomation()
        let coordinator = ImportCoordinator(backend: backend, resolve: resolve, terminalTimeout: .seconds(10))
        let first = Task { try await coordinator.run(launchToken: fixtureToken) }
        await backend.waitUntilPolling()

        let error = await capturedError { try await coordinator.run(launchToken: UUID()) }
        #expect(error as? ImportCoordinatorError == .requestAlreadyRunning)
        #expect(await resolve.projectCreations == 1)
        #expect(await resolve.scriptInvocations == 1)

        first.cancel()
        _ = try? await first.value
        #expect(await coordinator.isRunning == false)
    }

    @Test func cancellationClearsRetainedLaunchTokenAndAllowsLaterRequest() async throws {
        let backend = FakeBackend(waitMode: .suspend)
        let resolve = FakeResolveAutomation()
        let coordinator = ImportCoordinator(backend: backend, resolve: resolve, terminalTimeout: .seconds(10))
        let first = Task { try await coordinator.run(launchToken: fixtureToken) }
        await backend.waitUntilPolling()
        first.cancel()
        _ = try? await first.value

        #expect(await coordinator.isRunning == false)
        await backend.setWaitMode(.complete)
        try await coordinator.run(launchToken: UUID())
        #expect(await resolve.projectCreations == 2)
        #expect(await resolve.scriptInvocations == 2)
    }

    @Test func stopsBeforeCreatingProjectWhenRedemptionFails() async {
        let backend = FakeBackend(redeemError: BackendClientError.serverRejected(status: 404))
        let resolve = FakeResolveAutomation()
        let coordinator = ImportCoordinator(backend: backend, resolve: resolve)

        _ = await capturedError { try await coordinator.run(launchToken: fixtureToken) }
        #expect(await resolve.actions.isEmpty)
        #expect(await coordinator.isRunning == false)
    }

    fileprivate static let request = RedeemedImportRequest(
        jobID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
        projectID: "vintage-tokyo",
        revision: "0123456789abcdef0123456789abcdef01234567",
        artifacts: []
    )
}

private actor FakeResolveAutomation: ResolveAutomating {
    enum Action: Equatable {
        case ensureRunning
        case createProject(String)
        case invokeScript
    }

    private(set) var actions: [Action] = []
    var projectCreations: Int { actions.filter { if case .createProject = $0 { true } else { false } }.count }
    var scriptInvocations: Int { actions.filter { $0 == .invokeScript }.count }

    func ensureRunning() async throws { actions.append(.ensureRunning) }
    func createProject(named name: String) async throws { actions.append(.createProject(name)) }
    func invokeBridgeScript() async throws { actions.append(.invokeScript) }
}

private actor FakeBackend: BackendServing {
    enum WaitMode { case complete, suspend }

    private var waitMode: WaitMode
    private let redeemError: Error?
    private(set) var waitedJobIDs: [UUID] = []
    private var pollingContinuations: [CheckedContinuation<Void, Never>] = []

    init(waitMode: WaitMode = .complete, redeemError: Error? = nil) {
        self.waitMode = waitMode
        self.redeemError = redeemError
    }

    func redeem(launchToken: UUID) async throws -> RedeemedImportRequest {
        if let redeemError { throw redeemError }
        return ImportCoordinatorTests.request
    }

    func waitForTerminalResult(jobID: UUID, timeout: Duration) async throws -> ResolveJobStatus {
        waitedJobIDs.append(jobID)
        let continuations = pollingContinuations
        pollingContinuations.removeAll()
        continuations.forEach { $0.resume() }
        if waitMode == .suspend { try await Task.sleep(for: .seconds(30)) }
        return .fixture(phase: .completed)
    }

    func waitUntilPolling() async {
        if !waitedJobIDs.isEmpty { return }
        await withCheckedContinuation { pollingContinuations.append($0) }
    }

    func setWaitMode(_ mode: WaitMode) { waitMode = mode }
}

private extension ResolveJobStatus {
    static func fixture(phase: ResolveJobPhase) -> Self {
        .init(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            projectID: "vintage-tokyo",
            revision: "0123456789abcdef0123456789abcdef01234567",
            phase: phase,
            processed: 38,
            total: 38,
            percent: 100,
            warnings: [],
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 1)
        )
    }
}
