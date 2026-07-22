import Foundation

public struct RedeemedImportRequest: Decodable, Equatable, Sendable {
    public let jobID: UUID
    public let projectID: String
    public let revision: String
    public let artifacts: [ResolveArtifact]

    public init(jobID: UUID, projectID: String, revision: String, artifacts: [ResolveArtifact]) {
        self.jobID = jobID
        self.projectID = projectID
        self.revision = revision
        self.artifacts = artifacts
    }

    public init(from decoder: Decoder) throws {
        try requireExactKeys(decoder, ["jobId", "projectId", "revision", "artifacts"])
        let values = try decoder.container(keyedBy: CodingKeys.self)
        jobID = try decodeCanonicalUUID(values, forKey: .jobID)
        projectID = try decodeNonemptyString(values, forKey: .projectID)
        revision = try decodeNonemptyString(values, forKey: .revision)
        artifacts = try values.decode([ResolveArtifact].self, forKey: .artifacts)
        guard projectID.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
            options: .regularExpression
        ) != nil,
            revision.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil,
            !artifacts.isEmpty else {
            throw dataCorrupted(decoder, "request metadata is invalid")
        }
    }

    private enum CodingKeys: String, CodingKey {
        case jobID = "jobId"
        case projectID = "projectId"
        case revision
        case artifacts
    }
}

public struct ResolveArtifact: Decodable, Equatable, Sendable {
    public let name: String
    public let url: String
    public let mediaType: String
    public let byteLength: Int
    public let sha256: String

    public init(name: String, url: String, mediaType: String, byteLength: Int, sha256: String) {
        self.name = name
        self.url = url
        self.mediaType = mediaType
        self.byteLength = byteLength
        self.sha256 = sha256
    }

    public init(from decoder: Decoder) throws {
        try requireExactKeys(decoder, ["name", "url", "mediaType", "byteLength", "sha256"])
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try decodeNonemptyString(values, forKey: .name)
        url = try decodeNonemptyString(values, forKey: .url)
        mediaType = try decodeNonemptyString(values, forKey: .mediaType)
        byteLength = try values.decode(Int.self, forKey: .byteLength)
        sha256 = try decodeNonemptyString(values, forKey: .sha256)

        guard byteLength >= 0,
              url.hasPrefix("/api/projects/"),
              url.contains("?capability="),
              sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            throw dataCorrupted(decoder, "artifact metadata is invalid")
        }
    }

    private enum CodingKeys: String, CodingKey {
        case name, url, mediaType, byteLength, sha256
    }
}

public enum ResolveJobPhase: String, Decodable, Equatable, Sendable {
    case queued
    case loading
    case assessing
    case resolvingMedia = "resolving-media"
    case serializing
    case verifying
    case ready
    case launching
    case importing
    case saving
    case validating
    case completed
    case failed
    case cancelled

    public var isTerminal: Bool {
        self == .completed || self == .failed || self == .cancelled
    }
}

public struct ResolveJobStatus: Decodable, Equatable, Sendable {
    public let id: UUID
    public let projectID: String
    public let revision: String
    public let phase: ResolveJobPhase
    public let processed: Int
    public let total: Int
    public let percent: Double
    public let warnings: [String]
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUID,
        projectID: String,
        revision: String,
        phase: ResolveJobPhase,
        processed: Int,
        total: Int,
        percent: Double,
        warnings: [String],
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.projectID = projectID
        self.revision = revision
        self.phase = phase
        self.processed = processed
        self.total = total
        self.percent = percent
        self.warnings = warnings
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        try requireExactKeys(decoder, [
            "id", "projectId", "revision", "phase", "processed", "total", "percent",
            "warnings", "createdAt", "updatedAt",
        ])
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try decodeCanonicalUUID(values, forKey: .id)
        projectID = try decodeNonemptyString(values, forKey: .projectID)
        revision = try decodeNonemptyString(values, forKey: .revision)
        phase = try values.decode(ResolveJobPhase.self, forKey: .phase)
        processed = try values.decode(Int.self, forKey: .processed)
        total = try values.decode(Int.self, forKey: .total)
        percent = try values.decode(Double.self, forKey: .percent)
        warnings = try values.decode([String].self, forKey: .warnings)
        createdAt = try decodeBackendDate(values, forKey: .createdAt)
        updatedAt = try decodeBackendDate(values, forKey: .updatedAt)
        guard processed >= 0, total >= 0, (0 ... 100).contains(percent) else {
            throw dataCorrupted(decoder, "job progress is invalid")
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case projectID = "projectId"
        case revision, phase, processed, total, percent, warnings, createdAt, updatedAt
    }
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

private func requireExactKeys(_ decoder: Decoder, _ expected: Set<String>) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    let actual = Set(container.allKeys.map(\.stringValue))
    guard actual == expected else {
        throw dataCorrupted(decoder, "object keys do not match the backend contract")
    }
}

private func decodeCanonicalUUID<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> UUID {
    let value = try container.decode(String.self, forKey: key)
    guard value.range(
        of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        options: .regularExpression
    ) != nil, let uuid = UUID(uuidString: value) else {
        throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "invalid UUID")
    }
    return uuid
}

private func decodeNonemptyString<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> String {
    let value = try container.decode(String.self, forKey: key)
    guard !value.isEmpty else {
        throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "empty string")
    }
    return value
}

private func decodeBackendDate<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> Date {
    let value = try container.decode(String.self, forKey: key)
    guard value.range(
        of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
        options: .regularExpression
    ) != nil else {
        throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "invalid date")
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
    guard let date = formatter.date(from: value) else {
        throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "invalid date")
    }
    return date
}

private func dataCorrupted(_ decoder: Decoder, _ description: String) -> DecodingError {
    .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: description))
}
