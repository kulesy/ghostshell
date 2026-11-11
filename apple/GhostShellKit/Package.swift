// swift-tools-version: 6.0
import PackageDescription

// SwiftPM globs every folder under Sources, so a new screen or endpoint is a new file and edits nothing here.
let package = Package(
    name: "GhostShellKit",
    platforms: [.macOS(.v15), .iOS(.v18), .watchOS(.v11)],
    products: [
        .library(name: "GhostShellKit", targets: ["GhostShellKit"]),
        .library(name: "GhostShellScreens", targets: ["GhostShellScreens"]),
    ],
    targets: [
        .target(name: "GhostShellKit"),
        .target(name: "GhostShellScreens", dependencies: ["GhostShellKit"], resources: [.copy("Resources/Fonts")]),
        .testTarget(name: "GhostShellKitTests", dependencies: ["GhostShellKit", "GhostShellScreens"]),
    ]
)
