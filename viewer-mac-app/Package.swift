// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SOSAppointmentViewerApp",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "SOSAppointmentViewerApp",
            targets: ["SOSAppointmentViewerApp"]
        )
    ],
    targets: [
        .executableTarget(
            name: "SOSAppointmentViewerApp",
            path: "Sources/SOSAppointmentViewerApp"
        )
    ]
)
