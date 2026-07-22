#if os(macOS)
import AppKit

@MainActor
public final class StatusWindowController: NSWindowController, BridgeStatusReporting {
    private let statusLabel = NSTextField(labelWithString: "")
    private let retryButton = NSButton(title: "Retry", target: nil, action: nil)
    public var onRetry: (() -> Void)?

    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 180),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "OpenReel Bridge"
        window.center()
        super.init(window: window)

        statusLabel.maximumNumberOfLines = 3
        statusLabel.alignment = .center
        statusLabel.font = .systemFont(ofSize: 15, weight: .medium)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.setAccessibilityRole(.staticText)
        statusLabel.setAccessibilityLabel("OpenReel import status")

        retryButton.target = self
        retryButton.action = #selector(retryPressed)
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.setAccessibilityLabel("Retry OpenReel import")

        let content = NSView()
        content.addSubview(statusLabel)
        content.addSubview(retryButton)
        window.contentView = content
        NSLayoutConstraint.activate([
            statusLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            statusLabel.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -18),
            retryButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 20),
            retryButton.centerXAnchor.constraint(equalTo: content.centerXAnchor),
        ])
    }

    required init?(coder: NSCoder) { nil }

    nonisolated public func show(_ state: BridgeStatusState) async {
        await MainActor.run { self.apply(state) }
    }

    public func show(_ state: BridgeStatusState) {
        apply(state)
    }

    private func apply(_ state: BridgeStatusState) {
        statusLabel.stringValue = state.accessibilityText
        statusLabel.setAccessibilityValue(state.accessibilityText)
        retryButton.isHidden = state != .failed(.importFailed)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func retryPressed() { onRetry?() }
}
#endif
