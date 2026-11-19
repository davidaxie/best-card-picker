// swift-tools-version: 6.0
// Best Card Picker: Swift port of the shared card rules engine, plus the
// app-side core (storage, MapKit category mapping) shared by the iPhone app
// and its widget extension. No third-party dependencies.
import PackageDescription

let package = Package(
    name: "BestCardEngine",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "BestCardEngine", targets: ["BestCardEngine"]),
        .library(name: "CardPickerCore", targets: ["CardPickerCore"]),
    ],
    targets: [
        // Pure scoring logic. Bundles copies of data/cards.json,
        // data/merchants.json and data/categories.json (refreshed by ios/scripts/sync-shared-data.sh).
        .target(
            name: "BestCardEngine",
            resources: [.copy("Resources/cards.json"), .copy("Resources/merchants.json"), .copy("Resources/categories.json")],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        // Storage, settings, saved places, MapKit category mapping.
        .target(
            name: "CardPickerCore",
            dependencies: ["BestCardEngine"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "BestCardEngineTests",
            dependencies: ["BestCardEngine"],
            resources: [.copy("Resources/golden_tests.json")],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "CardPickerCoreTests",
            dependencies: ["CardPickerCore"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
