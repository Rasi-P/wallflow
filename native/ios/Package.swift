// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WallflowCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "WallflowCore", targets: ["WallflowCore"])],
    targets: [.target(name: "WallflowCore"), .testTarget(name: "WallflowCoreTests", dependencies: ["WallflowCore"])]
)
