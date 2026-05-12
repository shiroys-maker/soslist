// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SOSListLocalApp",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "SOSListLocalApp",
            targets: ["SOSListLocalApp"]
        )
    ],
    targets: [
        .executableTarget(
            name: "SOSListLocalApp",
            path: "Sources/SOSListLocalApp"
        )
    ]
)
