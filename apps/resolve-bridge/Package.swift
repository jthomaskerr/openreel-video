// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OpenReelBridge",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "OpenReelBridge", targets: ["OpenReelBridge"]),
    ],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-testing.git", exact: "0.12.0"),
    ],
    targets: [
        .target(name: "OpenReelBridge"),
        .testTarget(
            name: "OpenReelBridgeTests",
            dependencies: [
                "OpenReelBridge",
                .product(name: "Testing", package: "swift-testing"),
            ]
        ),
    ],
    swiftLanguageModes: [.v5]
)
