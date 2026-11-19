import XCTest

@MainActor
final class CardPickerUITests: XCTestCase {
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"] + extra
        app.launch()
        return app
    }

    @MainActor
    func testGasTileOneTap() {
        let app = launch()
        app.buttons["tile-gas_ev"].tap()
        let name = app.staticTexts["answerCardName"]
        XCTAssertTrue(name.waitForExistence(timeout: 2))
        XCTAssertEqual(name.label, "Chase Sapphire Preferred")
        XCTAssertEqual(app.staticTexts["answerValue"].label, "3x · 6.0 cents per dollar")
    }

    @MainActor
    func testCostcoIsVisaOnly() {
        let app = launch()
        app.buttons["tile-costco"].tap()
        XCTAssertTrue(app.staticTexts["answerCardName"].waitForExistence(timeout: 2))
        XCTAssertEqual(app.staticTexts["answerCardName"].label, "Chase Freedom Unlimited")
    }

    @MainActor
    func testOfflineModeDisablesNearby() {
        let app = launch(["-offline"])
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.staticTexts["offlineNotice"].waitForExistence(timeout: 2)
                      || app.otherElements["offlineNotice"].exists
                      || app.cells.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Offline mode is on'")).firstMatch.exists)
    }

    /// PRD: a category grid answer takes one tap and shows in under 200 ms.
    /// The app measures tap to rendered answer itself (XCUITest's own tap
    /// and wait overhead is over a second, so it can't measure this).
    @MainActor
    func testGridAnswerUnder200ms() {
        let app = launch()
        for tile in ["restaurant", "gas_ev", "costco", "drugstore", "us_supermarket"] {
            app.buttons["tile-\(tile)"].tap()
            let latency = app.staticTexts["answerLatencyMs"]
            XCTAssertTrue(latency.waitForExistence(timeout: 2), tile)
            let ms = Int(latency.label) ?? .max
            XCTAssertLessThan(ms, 200, "\(tile) took \(ms) ms")
            print("grid-latency \(tile): \(ms) ms")
        }
    }

}
