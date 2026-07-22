import Foundation
import Testing
@testable import OpenReelBridge

@Suite("Backend client", .serialized)
struct BackendClientTests {
    @Test func redeemsSharedFixtureOverLoopbackPOST() async throws {
        let fixture = try fixtureData()
        URLProtocolStub.handler = { request in
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path == "/api/projects/resolve-launches/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/redeem")
            #expect(request.url?.query == nil)
            return response(for: request, status: 200, data: fixture)
        }
        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:4041")!, session: stubSession())

        let request = try await client.redeem(
            launchToken: UUID(uuidString: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")!
        )

        #expect(request.jobID.uuidString.lowercased() == "11111111-1111-4111-8111-111111111111")
        #expect(request.projectID == "vintage-tokyo")
        #expect(request.artifacts.count == 3)
    }

    @Test func rejectsNonLoopbackBackendBeforeNetworkAccess() async {
        var requests = 0
        URLProtocolStub.handler = { request in
            requests += 1
            return response(for: request, status: 200, data: Data())
        }
        let client = BackendClient(baseURL: URL(string: "https://example.com")!, session: stubSession())

        let error = await capturedError { try await client.redeem(launchToken: UUID()) }
        #expect(error as? BackendClientError == .invalidBaseURL)
        #expect(requests == 0)
    }

    @Test func rejectsUnknownFieldsAndMalformedUUIDs() async throws {
        var object = try #require(JSONSerialization.jsonObject(with: fixtureData()) as? [String: Any])
        object["unexpected"] = true
        object["jobId"] = "not-a-uuid"
        let data = try JSONSerialization.data(withJSONObject: object)
        URLProtocolStub.handler = { response(for: $0, status: 200, data: data) }
        let client = BackendClient(baseURL: URL(string: "http://localhost:4041")!, session: stubSession())

        let error = await capturedError { try await client.redeem(launchToken: UUID()) }
        #expect(error as? BackendClientError == .invalidResponse)
    }

    @Test func rejectsProjectIDsAndRevisionsOutsideTheBackendContract() async throws {
        var object = try #require(JSONSerialization.jsonObject(with: fixtureData()) as? [String: Any])
        object["projectId"] = "../../outside-store"
        object["revision"] = "not-a-commit"
        let data = try JSONSerialization.data(withJSONObject: object)
        URLProtocolStub.handler = { response(for: $0, status: 200, data: data) }
        let client = BackendClient(baseURL: URL(string: "http://localhost:4041")!, session: stubSession())

        let error = await capturedError { try await client.redeem(launchToken: UUID()) }
        #expect(error as? BackendClientError == .invalidResponse)
    }

    @Test func rejectsMalformedStatusDate() async throws {
        let fixture = try fixtureData()
        URLProtocolStub.handler = { request in
            if request.httpMethod == "POST" {
                return response(for: request, status: 200, data: fixture)
            }
            return response(for: request, status: 200, data: statusData(phase: "completed", createdAt: "yesterday"))
        }
        let client = BackendClient(baseURL: URL(string: "http://[::1]:4041")!, session: stubSession())
        _ = try await client.redeem(launchToken: UUID())

        let error = await capturedError {
            try await client.waitForTerminalResult(
                jobID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
                timeout: .seconds(1)
            )
        }
        #expect(error as? BackendClientError == .invalidResponse)
    }

    @Test func sanitizesHTTPErrorBodies() async {
        URLProtocolStub.handler = { request in
            response(for: request, status: 500, data: Data("callbackToken=secret /Users/Joseph/project".utf8))
        }
        let token = UUID()
        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:4041")!, session: stubSession())

        let error = await capturedError { try await client.redeem(launchToken: token) }
        let message = String(describing: error)
        #expect(!message.contains("secret"))
        #expect(!message.contains("Joseph"))
        #expect(!message.contains(token.uuidString.lowercased()))
        #expect(error as? BackendClientError == .serverRejected(status: 500))
    }

    @Test func requestTimesOutAndCancelsTransport() async {
        URLProtocolStub.handler = { request in
            try await Task.sleep(for: .seconds(10))
            return response(for: request, status: 200, data: Data())
        }
        let client = BackendClient(
            baseURL: URL(string: "http://127.0.0.1:4041")!,
            session: stubSession(),
            requestTimeout: .milliseconds(20)
        )

        let error = await capturedError { try await client.redeem(launchToken: UUID()) }
        #expect(error as? BackendClientError == .timedOut)
    }

    @Test func callerCancellationPropagates() async {
        URLProtocolStub.handler = { request in
            try await Task.sleep(for: .seconds(10))
            return response(for: request, status: 200, data: Data())
        }
        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:4041")!, session: stubSession())
        let task = Task { try await client.redeem(launchToken: UUID()) }
        task.cancel()

        let error = await capturedError { try await task.value }
        #expect(error is CancellationError)
    }

    private func fixtureData() throws -> Data {
        let testFile = URL(fileURLWithPath: #filePath)
        let fixture = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("fixtures/ready-job.json")
        return try Data(contentsOf: fixture)
    }
}

private final class URLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) async throws -> (HTTPURLResponse, Data))?
    private var loadingTask: Task<Void, Never>?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        loadingTask = Task {
            do {
                let result = try await Self.handler?(request)
                guard !Task.isCancelled, let (response, data) = result else { return }
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch is CancellationError {
                client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
            }
        }
    }

    override func stopLoading() {
        loadingTask?.cancel()
        loadingTask = nil
    }
}

private func stubSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [URLProtocolStub.self]
    return URLSession(configuration: configuration)
}

private func response(for request: URLRequest, status: Int, data: Data) -> (HTTPURLResponse, Data) {
    (
        HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!,
        data
    )
}

private func statusData(phase: String, createdAt: String = "2026-07-22T00:00:00.000Z") -> Data {
    Data("""
    {"id":"11111111-1111-4111-8111-111111111111","projectId":"vintage-tokyo","revision":"0123456789abcdef0123456789abcdef01234567","phase":"\(phase)","processed":38,"total":38,"percent":100,"warnings":[],"createdAt":"\(createdAt)","updatedAt":"2026-07-22T00:01:00.000Z"}
    """.utf8)
}
