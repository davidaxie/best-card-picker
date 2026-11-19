import CoreLocation
import Foundation
import MapKit
import BestCardEngine
import CardPickerCore

/// The app's only network use: an MKLocalPointsOfInterestRequest, which sends
/// the phone's location to Apple. Never called in Offline mode.
@MainActor
enum NearbySearch {
    struct Place: Identifiable, Equatable {
        var id: String { key }
        var name: String
        var latitude: Double
        var longitude: Double
        var distance: Double
        var poiCategory: MKPointOfInterestCategory?
        var key: String { PlaceKey.make(name: name, latitude: latitude, longitude: longitude) }
    }

    enum SearchError: LocalizedError {
        case offline
        var errorDescription: String? { "Offline mode is on, so nearby lookups are off. Use the category grid or a saved place." }
    }

    /// Places where you pay at a register. Offices, clinics, parks and
    /// uncategorized businesses would otherwise crowd stores out of the list.
    static let payingCategories: [MKPointOfInterestCategory] = [
        .restaurant, .cafe, .bakery, .brewery, .winery, .nightlife,
        .foodMarket, .store, .gasStation, .evCharger, .pharmacy,
        .hotel, .parking, .publicTransport, .carRental,
        .movieTheater, .theater, .fitnessCenter, .laundry, .amusementPark, .museum, .zoo, .aquarium,
    ]

    /// The list radius. The PRD's "about 100 m" is used for "Which card here?".
    static let listRadius: CLLocationDistance = 200
    static let hereRadius: CLLocationDistance = 100

    static func search(around location: CLLocation, radius: CLLocationDistance = listRadius, limit: Int = 5, offline: Bool) async throws -> [Place] {
        guard !offline else { throw SearchError.offline }
        let request = MKLocalPointsOfInterestRequest(center: location.coordinate, radius: radius)
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: payingCategories)
        let response = try await MKLocalSearch(request: request).start()
        let places = response.mapItems.compactMap { item -> Place? in
            guard let name = item.name else { return nil }
            let c = item.placemark.coordinate
            let d = location.distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude))
            return Place(name: name, latitude: c.latitude, longitude: c.longitude, distance: d, poiCategory: item.pointOfInterestCategory)
        }
        return Array(places.sorted { $0.distance < $1.distance }.prefix(limit))
    }
}

extension AppData {
    /// Category for a nearby place: remembered choice, brand, MapKit, general.
    func resolve(_ place: NearbySearch.Place) -> PlaceCategoryMapper.Resolution {
        PlaceCategoryMapper.resolve(name: place.name, poi: place.poiCategory,
                                    rememberedCategory: placeCategories[place.key], engine: engine)
    }

    func answer(for place: NearbySearch.Place) -> (Answer?, PlaceCategoryMapper.Resolution) {
        let r = resolve(place)
        let ctx = PurchaseContext(category: r.category, merchant: place.name, channel: .inStore)
        // Brand matches and remembered choices are still MapKit-identified places.
        return (answer(for: ctx, likely: r.source != .remembered), r)
    }
}
