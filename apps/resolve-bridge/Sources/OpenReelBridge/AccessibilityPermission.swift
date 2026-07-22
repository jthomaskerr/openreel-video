#if os(macOS)
import ApplicationServices

public struct AccessibilityPermission {
    public init() {}

    public func require(prompt: Bool) throws {
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt,
        ] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else {
            throw BridgeError.accessibilityDenied
        }
    }
}
#endif
