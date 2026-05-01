// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CursorMobileCompanion",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "CursorMobileCompanion",
            path: "CursorMobileCompanion"
        )
    ]
)
