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
        app.tabBars.buttons["Nearby"].tap()
        XCTAssertTrue(app.staticTexts["offlineNotice"].waitForExistence(timeout: 2)
                      || app.otherElements["offlineNotice"].exists
                      || app.cells.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Offline mode is on'")).firstMatch.exists)
    }

    @MainActor
    func testGridTapLatency() {
        let app = launch()
        measure(metrics: [XCTClockMetric()]) {
            app.buttons["tile-restaurant"].tap()
            _ = app.staticTexts["answerCardName"].waitForExistence(timeout: 1)
        }
    }
}
