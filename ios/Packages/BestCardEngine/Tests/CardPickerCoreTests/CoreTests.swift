import Foundation
import MapKit
import Testing
import BestCardEngine
@testable import CardPickerCore

@Suite("iPhone core")
struct CoreTests {
    let data = AppData.defaults()

    @Test func defaultsLoadBundledCards() {
        #expect(data.cardsFile.cards.count == 6)
        #expect(!DefaultData.merchants().isEmpty)
    }

    @Test func mapKitCategoryTable() {
        #expect(PlaceCategoryMapper.engineCategory(for: .restaurant) == "restaurant")
        #expect(PlaceCategoryMapper.engineCategory(for: .cafe) == "restaurant")
        #expect(PlaceCategoryMapper.engineCategory(for: .foodMarket) == "us_supermarket")
        #expect(PlaceCategoryMapper.engineCategory(for: .gasStation) == "gas_ev")
        #expect(PlaceCategoryMapper.engineCategory(for: .evCharger) == "gas_ev")
        #expect(PlaceCategoryMapper.engineCategory(for: .pharmacy) == "drugstore")
        #expect(PlaceCategoryMapper.engineCategory(for: .hotel) == "hotel_direct")
        #expect(PlaceCategoryMapper.engineCategory(for: .publicTransport) == "rideshare_transit")
        #expect(PlaceCategoryMapper.engineCategory(for: .carRental) == "rental_car")
        #expect(PlaceCategoryMapper.engineCategory(for: .store) == nil)
    }

    @Test func brandBeatsMapKitCategory() {
        // Walmart shows up in MapKit as a foodMarket, but it codes as general.
        let r = PlaceCategoryMapper.resolve(name: "Walmart Supercenter", poi: .foodMarket, rememberedCategory: nil, engine: data.engine)
        #expect(r.source == .brand)
        #expect(r.category == "general")
        let tj = PlaceCategoryMapper.resolve(name: "Trader Joe's", poi: .store, rememberedCategory: nil, engine: data.engine)
        #expect(tj.category == "us_supermarket")
        let unknown = PlaceCategoryMapper.resolve(name: "Joe's Hardware", poi: .store, rememberedCategory: nil, engine: data.engine)
        #expect(unknown.source == .unknown && unknown.category == "general")
        let remembered = PlaceCategoryMapper.resolve(name: "Joe's Hardware", poi: .store, rememberedCategory: "drugstore", engine: data.engine)
        #expect(remembered.category == "drugstore")
    }

    @Test func costcoRecommendsFreedomUnlimited() {
        let place = SavedPlace(name: "Costco Wholesale", latitude: 37.0, longitude: -122.0, category: "wholesale_club")
        let answer = data.answer(for: place.context)
        #expect(answer?.card.id == "chase-freedom-unlimited")
    }

    @Test func gasGridAnswerText() {
        let answer = data.answer(for: PurchaseContext(category: "gas_ev", channel: .inStore))!
        #expect(answer.headline == "Chase Sapphire Preferred · 3x · 6.0 cents per dollar")
        #expect(answer.notificationText(placeName: "Shell") == "Shell: use Chase Sapphire Preferred (3x)")
    }

    @Test func likelyPrefixForMapKitAnswers() {
        let answer = data.answer(for: PurchaseContext(category: "restaurant", merchant: "Some Cafe", channel: .inStore), likely: true)!
        #expect(answer.reasonLine == "Likely 4x at restaurants, about 8 cents per dollar")
    }

    @Test func capToggleFallsBackToBase() {
        var d = data
        d.setCap(cardId: "amex-gold", category: "restaurant", reached: true)
        #expect(d.capReached(cardId: "amex-gold", category: "restaurant"))
        #expect(d.answer(for: PurchaseContext(category: "restaurant"))?.card.id == "chase-sapphire-preferred")
        d.setCap(cardId: "amex-gold", category: "restaurant", reached: false)
        #expect(d.capState.isEmpty)
    }

    @Test func savedPlaceRadius() {
        var d = data
        let tj = SavedPlace(name: "Trader Joe's", latitude: 37.7749, longitude: -122.4194, category: "us_supermarket")
        d.savedPlaces = [tj]
        #expect(d.savedPlace(nearLatitude: 37.7753, longitude: -122.4194)?.id == tj.id)   // ~45 m
        #expect(d.savedPlace(nearLatitude: 37.7779, longitude: -122.4194) == nil)          // ~330 m
    }

    @Test func storeRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        var d = data
        d.offlineMode = true
        d.placeCategories["x|1|2"] = "drugstore"
        let store = DocumentStore(directory: dir)
        try store.save(d)
        #expect(store.load() == d)
        let snap = SnapshotStore(directory: dir)
        let s = SharedSnapshot(appData: d, lastAnswer: d.answer(for: .init(category: "gas_ev"))?.lastAnswer(placeName: "Shell", date: Date(timeIntervalSince1970: 0)))
        try snap.save(s)
        #expect(snap.load() == s)
    }

    @Test func noCardNumbersInStorage() throws {
        let json = String(data: try JSONCoding.encoder.encode(data), encoding: .utf8)!
        #expect(!CardsValidator.containsCardNumber(json))
    }
}
