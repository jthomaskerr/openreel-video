import Testing

func capturedError<T>(_ operation: () async throws -> T) async -> Error? {
    do {
        _ = try await operation()
        Issue.record("Expected an error")
        return nil
    } catch {
        return error
    }
}
