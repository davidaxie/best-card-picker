import CoreLocation
import Foundation
import WidgetKit
import BestCardEngine
import CardPickerCore

/// Saved places (max 20) as CLMonitor circular conditions of about 100 m.
/// On entry it posts a local notification with the best card. CLMonitor
/// relaunches the app in the background for events, so `start()` runs at every
/// launch. The data comes from the App Group snapshot because the Documents
/// file is unreadable while the phone is locked.
actor PlaceMonitor {
    static let shared = PlaceMonitor()
    static let monitorName = "BestCardPickerSavedPlaces"

    /// Created once. CoreLocation allows only one CLMonitor per name, and
    /// `get()` can be re-entered while the init is suspended, so callers share
    /// one creation task instead of each creating a monitor.
    private var creation: Task<CLMonitor, Never>?
    private var listening = false
    /// iOS 18 and later: CLMonitor's implicit service session only covers
    /// "While Using", so locationd drops the fences when the app goes to the
    /// background. Holding an explicit Always session while alerts are on
    /// keeps them armed. (iOS 17 has no service sessions and needs none.)
    private var alwaysSession: AnyObject?

    private func get() async -> CLMonitor {
        if let creation { return await creation.value }
        let task = Task { await CLMonitor(Self.monitorName) }
        creation = task
        return await task.value
    }

    func start() async {
        guard !listening else { return }
        listening = true
        let m = await get()
        Task {
            do {
                for try await event in await m.events {
                    await self.handle(identifier: event.identifier, state: event.state)
                }
            } catch {
                // Monitoring stopped; it restarts on the next launch.
            }
        }
    }

    /// Make the monitored conditions match the saved places exactly.
    func sync(places: [SavedPlace], enabled: Bool) async {
        let m = await get()
        let wanted = enabled ? Array(places.prefix(SavedPlace.maxCount)) : []
        let wantedIds = Set(wanted.map(\.id.uuidString))
        for id in await m.identifiers where !wantedIds.contains(id) {
            await m.remove(id)
        }
        let existing = Set(await m.identifiers)
        for place in wanted where !existing.contains(place.id.uuidString) {
            let condition = CLMonitor.CircularGeographicCondition(
                center: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude),
                radius: SavedPlace.radiusMeters)
            await m.add(condition, identifier: place.id.uuidString, assuming: .unsatisfied)
        }
        holdAlwaysSession(enabled && !wanted.isEmpty)
        if enabled { await start() }
    }

    private func holdAlwaysSession(_ hold: Bool) {
        guard #available(iOS 18.0, *) else { return }
        if hold {
            if alwaysSession == nil { alwaysSession = CLServiceSession(authorization: .always) }
        } else if let session = alwaysSession as? CLServiceSession {
            session.invalidate()
            alwaysSession = nil
        }
    }

    func monitoredIdentifiers() async -> [String] {
        await get().identifiers
    }

    private func handle(identifier: String, state: CLMonitor.Event.State) async {
        guard state == .satisfied else { return }
        await PlaceArrival.handle(placeId: identifier)
    }
}

/// What happens on arrival at a saved place. Also used by the debug button in
/// Saved places and by tests.
@MainActor
enum PlaceArrival {
    static func handle(placeId: String) async {
        let model = AppModel.shared
        let data = model.data
        guard data.savedPlaceAlerts,
              let place = data.savedPlaces.first(where: { $0.id.uuidString == placeId }),
              let answer = data.answer(for: place.context) else { return }
        model.record(answer, placeName: place.name)
        await Notifications.postArrival(placeName: place.name, answer: answer, placeId: placeId)
    }
}
