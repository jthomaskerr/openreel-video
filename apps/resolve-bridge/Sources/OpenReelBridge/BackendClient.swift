import Foundation

public enum BackendClientError: Error, Equatable, CustomStringConvertible, Sendable {
    case invalidBaseURL
    case invalidResponse
    case serverRejected(status: Int)
    case transportUnavailable
    case timedOut
    case unknownJob

    public var description: String {
        switch self {
        case .invalidBaseURL: "The OpenReel backend address is not a local loopback address."
        case .invalidResponse: "The OpenReel backend returned an invalid response."
        case let .serverRejected(status): "The OpenReel backend rejected the request (HTTP \(status))."
        case .transportUnavailable: "The OpenReel backend could not be reached."
        case .timedOut: "The OpenReel backend did not respond before the deadline."
        case .unknownJob: "The OpenReel import job is not available to this bridge session."
        }
    }
}

public protocol BackendServing: Sendable {
    func redeem(launchToken: UUID) async throws -> RedeemedImportRequest
    func waitForTerminalResult(jobID: UUID, timeout: Duration) async throws -> ResolveJobStatus
}

public actor BackendClient: BackendServing {
    private let baseURL: URL
    private let session: URLSession
    private let requestTimeout: Duration
    private let pollInterval: Duration
    private var redeemedProjects: [UUID: String] = [:]

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        requestTimeout: Duration = .seconds(10),
        pollInterval: Duration = .milliseconds(250)
    ) {
        self.baseURL = baseURL
        self.session = session
        self.requestTimeout = requestTimeout
        self.pollInterval = pollInterval
    }

    public func redeem(launchToken: UUID) async throws -> RedeemedImportRequest {
        try validateBaseURL()
        try Task.checkCancellation()
        let token = launchToken.uuidString.lowercased()
        let url = try endpoint(path: "/api/projects/resolve-launches/\(token)/redeem")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let payload: RedeemedImportRequest = try await send(request)
        redeemedProjects[payload.jobID] = payload.projectID
        return payload
    }

    public func waitForTerminalResult(jobID: UUID, timeout: Duration) async throws -> ResolveJobStatus {
        try validateBaseURL()
        guard let projectID = redeemedProjects[jobID] else { throw BackendClientError.unknownJob }
        defer { redeemedProjects[jobID] = nil }

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            try Task.checkCancellation()
            let encodedProjectID = try pathSegment(projectID)
            let status: ResolveJobStatus = try await send(URLRequest(url: try endpoint(
                path: "/api/projects/\(encodedProjectID)/exports/resolve/\(jobID.uuidString.lowercased())"
            )))
            guard status.id == jobID, status.projectID == projectID else {
                throw BackendClientError.invalidResponse
            }
            if status.phase.isTerminal { return status }
            try await Task.sleep(for: pollInterval)
        }
        throw BackendClientError.timedOut
    }

    private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let response: NetworkResponse
        do {
            response = try await withThrowingTaskGroup(of: NetworkResponse.self) { group in
                group.addTask { [session] in
                    let (data, response) = try await session.data(for: request)
                    return NetworkResponse(data: data, response: response)
                }
                group.addTask { [requestTimeout] in
                    try await Task.sleep(for: requestTimeout)
                    throw BackendClientError.timedOut
                }
                defer { group.cancelAll() }
                guard let first = try await group.next() else { throw BackendClientError.transportUnavailable }
                return first
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as BackendClientError {
            throw error
        } catch let error as URLError where error.code == .cancelled && Task.isCancelled {
            throw CancellationError()
        } catch {
            throw BackendClientError.transportUnavailable
        }

        guard let http = response.response as? HTTPURLResponse else {
            throw BackendClientError.invalidResponse
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw BackendClientError.serverRejected(status: http.statusCode)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: response.data)
        } catch {
            throw BackendClientError.invalidResponse
        }
    }

    private func validateBaseURL() throws {
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              components.scheme == "http",
              let host = components.host?.lowercased(),
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              isLoopback(host) else {
            throw BackendClientError.invalidBaseURL
        }
    }

    private func isLoopback(_ host: String) -> Bool {
        let normalizedHost = host.hasPrefix("[") && host.hasSuffix("]")
            ? String(host.dropFirst().dropLast())
            : host
        if normalizedHost == "localhost" || normalizedHost == "::1" { return true }
        let octets = normalizedHost.split(separator: ".")
        return octets.count == 4
            && octets.first == "127"
            && octets.allSatisfy { UInt8($0) != nil }
    }

    private func endpoint(path: String) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw BackendClientError.invalidBaseURL
        }
        components.path = path
        guard let url = components.url else { throw BackendClientError.invalidBaseURL }
        return url
    }

    private func pathSegment(_ value: String) throws -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        guard !value.isEmpty, let encoded = value.addingPercentEncoding(withAllowedCharacters: allowed) else {
            throw BackendClientError.invalidResponse
        }
        return encoded
    }
}

private struct NetworkResponse: @unchecked Sendable {
    let data: Data
    let response: URLResponse
}
