import Foundation
import BestCardEngine

/// Everything the iPhone app stores, in one JSON file.
/// No card numbers: cards carry a nickname and, optionally, the last four digits.
public struct AppData: Codable, Equatable, Sendable {
    public static let currentSchema = 1

    public var schema: Int
    public var cardsFile: CardsFile
    /// Manual "cap reached" toggles, capState[cardId][category].
    public var capState: CapState
    public var preferCashOnTie: Bool
    /// When on, the app makes no MapKit lookups (zero network requests).
    public var offlineMode: Bool
    /// When on, saved places are monitored and "Always" location is requested.
    public var savedPlaceAlerts: Bool
    public var savedPlaces: [SavedPlace]
    /// "Ask once, then remember": category chosen for a nearby place, keyed by `PlaceKey`.
    public var placeCategories: [String: String]

    public init(
        schema: Int = AppData.currentSchema,
        cardsFile: CardsFile,
        capState: CapState = [:],
        preferCashOnTie: Bool = true,
        offlineMode: Bool = false,
        savedPlaceAlerts: Bool = false,
        savedPlaces: [SavedPlace] = [],
        placeCategories: [String: String] = [:]
    ) {
        self.schema = schema
        self.cardsFile = cardsFile
        self.capState = capState
        self.preferCashOnTie = preferCashOnTie
        self.offlineMode = offlineMode
        self.savedPlaceAlerts = savedPlaceAlerts
        self.savedPlaces = savedPlaces
        self.placeCategories = placeCategories
    }

    public static func defaults() -> AppData {
        AppData(cardsFile: DefaultData.cardsFile())
    }

    public var options: EngineOptions {
        EngineOptions(preferCashOnTie: preferCashOnTie, capState: capState)
    }

    public var engine: Engine {
        Engine(file: cardsFile, extraMerchants: DefaultData.merchants())
    }

    public func card(_ id: String) -> Card? {
        cardsFile.cards.first { $0.id == id }
    }

    public func capReached(cardId: String, category: String) -> Bool {
        capState[cardId]?[category]?.reached == true
    }

    public mutating func setCap(cardId: String, category: String, reached: Bool) {
        var perCard = capState[cardId] ?? [:]
        perCard[category] = reached ? CapEntry(reached: true) : nil
        capState[cardId] = perCard.isEmpty ? nil : perCard
    }
}

public struct SavedPlace: Codable, Equatable, Identifiable, Hashable, Sendable {
    public static let maxCount = 20
    public static let radiusMeters = 100.0

    public var id: UUID
    public var name: String
    public var latitude: Double
    public var longitude: Double
    public var category: String
    /// Merchant string passed to the engine (brand overrides, Costco Visa-only).
    public var merchant: String?

    public init(id: UUID = UUID(), name: String, latitude: Double, longitude: Double, category: String, merchant: String? = nil) {
        self.id = id
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.category = category
        self.merchant = merchant
    }

    public var context: PurchaseContext {
        PurchaseContext(category: category, merchant: merchant ?? name, channel: .inStore)
    }
}

/// Stable key for remembering a nearby place's category: name plus
/// coordinates rounded to about 11 m.
public enum PlaceKey {
    public static func make(name: String, latitude: Double, longitude: Double) -> String {
        String(format: "%@|%.4f|%.4f", name.lowercased(), latitude, longitude)
    }
}

/// Bundled defaults, read from the engine's copy of data/.
public enum DefaultData {
    public static func cardsFile() -> CardsFile {
        guard let url = BundledData.cardsURL,
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(CardsFile.self, from: data) else {
            return CardsFile(version: 1, updated: "", pointValuesCents: [:], cards: [])
        }
        return file
    }

    public static func merchants() -> [Merchant] {
        guard let url = BundledData.merchantsURL,
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(MerchantsFile.self, from: data) else {
            return []
        }
        return file.merchants
    }

    /// Hand-reviewed store brands (not domains) from cards.json and
    /// merchants.json, for store search.
    public static func curatedBrands() -> [Merchant] {
        ((cardsFile().merchants ?? []) + merchants()).filter { !$0.match.contains(".") }
    }
}
