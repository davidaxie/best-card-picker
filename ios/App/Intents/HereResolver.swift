import CoreLocation
import Foundation
import BestCardEngine
import CardPickerCore

/// "Which card here?": one answer used by the app's Here sheet, Siri,
/// Shortcuts, the Action button and Control Center, so they always agree.
/// Order: a saved place within 100 m, then (unless Offline mode) the nearest
/// MapKit place within 100 m, else a pointer to the category grid.
@MainActor
enum HereResolver {
    struct Result {
        var placeName: String?
        var answer: Answer?
        var message: String
        var source: Source

        enum Source { case savedPlace, nearby, none }

        /// What Siri says.
        var spoken: String {
            guard let answer, let placeName else { return message }
            let likely = source == .nearby ? "Probably " : ""
            return "\(likely)\(answer.notificationText(placeName: placeName)). \(answer.centsText) cents per dollar."
        }
    }

    static func resolve(model: AppModel = .shared, location: CLLocation? = nil) async -> Result {
        let data = model.data
        let loc: CLLocation
        do {
            if let location { loc = location } else { loc = try await LocationService.shared.currentLocation() }
        } catch {
            return Result(message: error.localizedDescription, source: .none)
        }

        if let place = data.savedPlace(nearLatitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude),
           let answer = data.answer(for: place.context) {
            model.record(answer, placeName: place.name)
            return Result(placeName: place.name, answer: answer, message: answer.headline, source: .savedPlace)
        }

        if data.offlineMode {
            return Result(message: "Offline mode is on and you're not at a saved place. Open Card Picker and tap a category.", source: .none)
        }

        do {
            let places = try await NearbySearch.search(around: loc, radius: NearbySearch.hereRadius, limit: 1, offline: data.offlineMode)
            guard let nearest = places.first else {
                return Result(message: "No store found within 100 m. Open Card Picker and tap a category.", source: .none)
            }
            let (answer, _) = data.answer(for: nearest)
            guard let answer else {
                return Result(message: "None of your cards is accepted at \(nearest.name).", source: .none)
            }
            model.record(answer, placeName: nearest.name)
            return Result(placeName: nearest.name, answer: answer, message: answer.headline, source: .nearby)
        } catch {
            return Result(message: "Couldn't look up nearby places: \(error.localizedDescription)", source: .none)
        }
    }
}
