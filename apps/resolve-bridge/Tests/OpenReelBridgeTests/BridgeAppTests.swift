import Foundation
import Testing
@testable import OpenReelBridge

@Suite("Bridge app request handling", .serialized)
struct BridgeAppTests {
    private let token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

    @Test func acceptsOnlyCanonicalOpaqueLaunchURL() throws {
        let url = try #require(URL(string: "openreel-resolve://import/\(token)"))
        #expect(BridgeURL.parse(url)?.uuidString.lowercased() == token)

        let rejected = [
            "openreel-resolve://import/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            "openreel-resolve://import/\(token)?job=secret",
            "openreel-resolve://import/\(token)#fragment",
            "openreel-resolve://import/\(token)/extra",
            "openreel-resolve://other/\(token)",
            "https://import/\(token)",
            "openreel-resolve://user@import/\(token)",
        ]
        for value in rejected {
            #expect(BridgeURL.parse(try #require(URL(string: value))) == nil)
        }
    }

    @Test func rejectsMultipleURLsWithoutStartingAnImport() async throws {
        let runner = FakeAppImportRunner()
        let status = RecordingStatus()
        let controller = BridgeRequestController(runner: runner, status: status)
        let url = try #require(URL(string: "openreel-resolve://import/\(token)"))

        await controller.handle(urls: [url, url])

        #expect(await runner.runCount == 0)
        #expect(await status.states.last == .failed(.invalidLaunchURL))
    }

    @Test func propagatesPhasesAndRejectsAConcurrentRequest() async throws {
        let runner = FakeAppImportRunner(suspend: true)
        let status = RecordingStatus()
        let controller = BridgeRequestController(runner: runner, status: status)
        let url = try #require(URL(string: "openreel-resolve://import/\(token)"))
        let first = Task { await controller.handle(urls: [url]) }
        await runner.waitUntilStarted()

        await controller.handle(urls: [url])

        #expect(await runner.runCount == 1)
        #expect(await status.states.contains(.failed(.requestAlreadyRunning)))
        first.cancel()
        await first.value
    }

    @Test func failedRequestCanBeRetriedOnceWithoutOverlapping() async throws {
        let runner = FakeAppImportRunner(failuresRemaining: 1)
        let status = RecordingStatus()
        let controller = BridgeRequestController(runner: runner, status: status)
        let url = try #require(URL(string: "openreel-resolve://import/\(token)"))

        await controller.handle(urls: [url])
        #expect(await status.states.last == .failed(.importFailed))
        await controller.retry()

        #expect(await runner.runCount == 2)
        #expect(await status.states.suffix(6) == [
            .connecting, .openingResolve, .creatingProject, .runningImporter, .validating, .completed,
        ])
        await controller.retry()
        #expect(await runner.runCount == 2)
        #expect(await status.states.last == .failed(.retryUnavailable))
    }

    @Test func everyStatusHasStableAccessibleText() {
        for state in BridgeStatusState.allExamples {
            #expect(!state.accessibilityText.isEmpty)
        }
    }
}

private actor RecordingStatus: BridgeStatusReporting {
    private(set) var states: [BridgeStatusState] = []
    func show(_ state: BridgeStatusState) async { states.append(state) }
}

private actor FakeAppImportRunner: BridgeImportRunning {
    private(set) var runCount = 0
    private var failuresRemaining: Int
    private let suspend: Bool
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    init(failuresRemaining: Int = 0, suspend: Bool = false) {
        self.failuresRemaining = failuresRemaining
        self.suspend = suspend
    }

    func run(launchToken: UUID, progress: @Sendable (ImportProgress) async -> Void) async throws {
        runCount += 1
        let waiters = startWaiters
        startWaiters.removeAll()
        waiters.forEach { $0.resume() }
        if suspend { try await Task.sleep(for: .seconds(30)) }
        if failuresRemaining > 0 {
            failuresRemaining -= 1
            throw TestFailure.failed
        }
        for phase in ImportProgress.allCases { await progress(phase) }
    }

    func waitUntilStarted() async {
        if runCount > 0 { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }

    private enum TestFailure: Error { case failed }
}
