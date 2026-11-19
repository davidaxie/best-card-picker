import CoreLocation
import XCTest
import BestCardEngine
import CardPickerCore
@testable import BestCardPicker

@MainActor
final class AppTests: XCTestCase {
    private func tempModel() -> AppModel {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return AppModel(store: DocumentStore(directory: dir), snapshots: SnapshotStore(directory: dir))
    }

    func testFirstLaunchWritesDefaultsAndSnapshot() {
        let m = tempModel()
        XCTAssertFalse(m.readOnly)
        XCTAssertEqual(m.store.load()?.cardsFile.cards.count, 6)
        XCTAssertNotNil(m.snapshots.load())
    }

    func testUpdatePersistsToDocumentsAndSnapshot() {
        let m = tempModel()
        m.update { $0.offlineMode = true }
        XCTAssertEqual(m.store.load()?.offlineMode, true)
        XCTAssertEqual(m.snapshots.load()?.appData.offlineMode, true)
    }

    func testEveryGridTileAnswersUnder200ms() {
        let m = tempModel()
        for tile in GridTile.all {
            let start = ContinuousClock.now
            let answer = m.answer(for: tile.context(foreign: false))
            let elapsed = ContinuousClock.now - start
            XCTAssertNotNil(answer, tile.id)
            XCTAssertLessThan(elapsed, .milliseconds(200), tile.id)
        }
    }

    func testGridAnswersMatchPRD() {
        let m = tempModel()
        func pick(_ id: String) -> String? { m.answer(for: GridTile.all.first { $0.id == id }!.context(foreign: false))?.card.id }
        XCTAssertEqual(pick("gas_ev"), "chase-sapphire-preferred")
        XCTAssertEqual(pick("restaurant"), "amex-gold")
        XCTAssertEqual(pick("us_supermarket"), "amex-gold")
        XCTAssertEqual(pick("drugstore"), "chase-freedom-unlimited")
        XCTAssertEqual(pick("costco"), "chase-freedom-unlimited")
    }

    func testHereUsesSavedPlaceFirstAndRecordsForWidget() async {
        let m = tempModel()
        let tj = SavedPlace(name: "Trader Joe's", latitude: 37.3349, longitude: -122.0090, category: "us_supermarket")
        m.update { $0.savedPlaces = [tj]; $0.offlineMode = true }
        let r = await HereResolver.resolve(model: m, location: CLLocation(latitude: 37.33495, longitude: -122.00905))
        XCTAssertEqual(r.source, .savedPlace)
        XCTAssertEqual(r.answer?.card.id, "amex-gold")
        XCTAssertEqual(r.spoken, "Trader Joe's: use Amex Gold (4x). 8.0 cents per dollar.")
        XCTAssertEqual(m.snapshots.load()?.lastAnswer?.cardName, "Amex Gold")
    }

    func testOfflineModeNeverSearches() async {
        let m = tempModel()
        m.update { $0.offlineMode = true }
        let r = await HereResolver.resolve(model: m, location: CLLocation(latitude: 0, longitude: 0))
        XCTAssertEqual(r.source, .none)
        XCTAssertTrue(r.message.contains("Offline mode"))
        do {
            _ = try await NearbySearch.search(around: CLLocation(latitude: 0, longitude: 0), offline: true)
            XCTFail("search ran in offline mode")
        } catch {
            XCTAssertTrue(error is NearbySearch.SearchError)
        }
    }

    func testImportKeepsCapsForRemainingCards() throws {
        let m = tempModel()
        m.update { $0.setCap(cardId: "amex-gold", category: "restaurant", reached: true) }
        var file = m.data.cardsFile
        file.cards.removeAll { $0.id == "amex-blue-cash-everyday" }
        m.importCards(file)
        XCTAssertEqual(m.data.cardsFile.cards.count, 5)
        XCTAssertTrue(m.data.capReached(cardId: "amex-gold", category: "restaurant"))
    }

    func testExportReimportIdentical() throws {
        let m = tempModel()
        let data = try m.exportCardsData()
        let back = try CardsValidator.decode(data)
        XCTAssertEqual(back, m.data.cardsFile)
    }

    func testClearAllData() {
        let m = tempModel()
        m.update { $0.savedPlaces = [SavedPlace(name: "X", latitude: 1, longitude: 1, category: "general")] }
        m.clearAllData()
        XCTAssertTrue(m.data.savedPlaces.isEmpty)
        XCTAssertEqual(m.data, AppData.defaults())
    }
}
