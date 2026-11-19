import Foundation
import MapKit
import BestCardEngine

/// PRD table "MapKit category -> Engine category". Brand names in
/// merchants.json win over the MapKit category.
public enum PlaceCategoryMapper {
    public static func engineCategory(for poi: MKPointOfInterestCategory?) -> String? {
        guard let poi else { return nil }
        switch poi {
        case .restaurant, .cafe, .bakery, .brewery, .winery, .nightlife:
            return "restaurant"   // bakery and winery: verify how they code
        case .foodMarket:
            return "us_supermarket"
        case .gasStation, .evCharger:
            return "gas_ev"
        case .pharmacy:
            return "drugstore"
        case .hotel:
            return "hotel_direct"
        case .parking, .publicTransport:
            return "rideshare_transit"
        case .carRental:
            return "rental_car"
        default:
            return nil            // store or anything else: general, ask once
        }
    }

    public enum Source: String, Codable, Sendable {
        case remembered   // user picked it for this place before
        case brand        // curated or bundled brand match
        case mapKit       // MapKit point-of-interest category
        case unknown      // fell back to general; ask once
    }

    public struct Resolution: Equatable, Sendable {
        public var category: String
        public var source: Source
        public var merchant: Merchant?
    }

    /// Order: the user's remembered choice for this place, then a curated
    /// brand (cards.json / merchants.json, engine prefix rule), then a bundled
    /// brand from brands.json (whole name only), then the MapKit category,
    /// then general.
    public static func resolve(name: String, poi: MKPointOfInterestCategory?, rememberedCategory: String?, engine: Engine,
                               brands: BrandIndex = .shared) -> Resolution {
        let merchant = engine.merchant(for: name)
        if let rememberedCategory {
            return Resolution(category: rememberedCategory, source: .remembered, merchant: merchant)
        }
        if let merchant {
            return Resolution(category: merchant.category, source: .brand, merchant: merchant)
        }
        if let brand = brands.lookup(name) {
            return Resolution(category: brand.category, source: .brand, merchant: brand)
        }
        if let mapped = engineCategory(for: poi) {
            return Resolution(category: mapped, source: .mapKit, merchant: nil)
        }
        return Resolution(category: "general", source: .unknown, merchant: nil)
    }
}
