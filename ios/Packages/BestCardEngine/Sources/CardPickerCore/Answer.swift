import Foundation
import BestCardEngine

/// A recommendation plus the text the UI, widget, notifications and Siri show.
/// Every surface builds its text here so they always agree.
public struct Answer: Equatable, Sendable {
    public var recommendation: Recommendation
    public var card: Card
    public var runnerUpCard: Card?
    public var context: PurchaseContext
    /// MapKit-based answers are guesses: the bank's merchant code can differ.
    public var likely: Bool

    public var rateText: String { Engine.formatRate(recommendation.rate ?? 0, currency: card.currency) }
    public var centsText: String { Engine.formatCents(recommendation.centsPerDollar ?? 0) }

    /// "Sapphire Preferred · 3x · 6.0 cents per dollar"
    public var headline: String { "\(card.name) · \(rateText) · \(centsText) cents per dollar" }

    /// The reason line, prefixed with "Likely" for MapKit-based answers.
    public var reasonLine: String {
        likely ? "Likely \(recommendation.reason)" : recommendation.reason
    }

    public var runnerUpLine: String? {
        guard let runnerUpCard, let r = recommendation.runnerUp else { return nil }
        return "Runner-up: \(runnerUpCard.name) · \(Engine.formatCents(r.centsPerDollar)) cents"
    }

    /// "Trader Joe's: use Amex Gold (4x)"
    public func notificationText(placeName: String) -> String {
        "\(placeName): use \(card.name) (\(rateText))"
    }

    public func lastAnswer(placeName: String, date: Date = Date()) -> LastAnswer {
        LastAnswer(placeName: placeName, cardName: card.name, shortCode: card.shortCode, rateText: rateText, centsText: centsText, reason: reasonLine, date: date)
    }
}

extension AppData {
    public func answer(for context: PurchaseContext, likely: Bool = false) -> Answer? {
        let engine = self.engine
        let rec = engine.recommend(context, options: options)
        guard let id = rec.cardId, let card = card(id) else { return nil }
        return Answer(
            recommendation: rec,
            card: card,
            runnerUpCard: rec.runnerUp.flatMap { self.card($0.cardId) },
            context: context,
            likely: likely
        )
    }

    /// Saved place within the alert radius of a coordinate, nearest first.
    public func savedPlace(nearLatitude lat: Double, longitude lon: Double, within meters: Double = SavedPlace.radiusMeters) -> SavedPlace? {
        savedPlaces
            .map { ($0, Geo.distance(lat, lon, $0.latitude, $0.longitude)) }
            .filter { $0.1 <= meters }
            .min { $0.1 < $1.1 }?.0
    }
}

public enum Geo {
    /// Haversine distance in meters.
    public static func distance(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}
