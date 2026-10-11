// swift-tools-version:5.9
// Test harness for the sources the StrafePush pod and the Notification Service Extension share
// (Shared/). The app never builds this package: CocoaPods compiles Shared/ through
// StrafePush.podspec and the extension target references the same files. CI runs
// `swift test --package-path modules/strafe-push/ios` on macOS, where CryptoKit is available.
import PackageDescription

let package = Package(
  name: "StrafePushShared",
  platforms: [.iOS(.v16), .macOS(.v13)],
  targets: [
    .target(name: "StrafePushShared", path: "Shared"),
    .testTarget(name: "StrafePushSharedTests", dependencies: ["StrafePushShared"], path: "Tests/StrafePushSharedTests"),
  ]
)
