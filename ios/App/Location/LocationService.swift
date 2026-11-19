import CoreLocation
import Foundation

/// Core Location access. "While Using" for nearby lookups; "Always" is asked
/// for only when saved place alerts are turned on (PRD privacy rule 6).
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    private let manager = CLLocationManager()
    private var authWaiters: [CheckedContinuation<CLAuthorizationStatus, Never>] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    var status: CLAuthorizationStatus { manager.authorizationStatus }
    var canLocate: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }
    var hasAlways: Bool { status == .authorizedAlways }

    @discardableResult
    func requestWhenInUse() async -> CLAuthorizationStatus {
        guard status == .notDetermined else { return status }
        return await withCheckedContinuation { c in
            authWaiters.append(c)
            manager.requestWhenInUseAuthorization()
        }
    }

    /// Called only from the "Saved place alerts" switch.
    @discardableResult
    func requestAlways() async -> CLAuthorizationStatus {
        if status == .notDetermined { await requestWhenInUse() }
        guard status == .authorizedWhenInUse else { return status }
        return await withCheckedContinuation { c in
            authWaiters.append(c)
            manager.requestAlwaysAuthorization()
            // iOS may not show the prompt (already declined once); stop waiting.
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(15))
                self.resumeWaiters(self.status)
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        Task { @MainActor in
            if s != .notDetermined { self.resumeWaiters(s) }
        }
    }

    private func resumeWaiters(_ s: CLAuthorizationStatus) {
        let waiters = authWaiters
        authWaiters.removeAll()
        waiters.forEach { $0.resume(returning: s) }
    }

    enum LocationError: LocalizedError {
        case notAuthorized, timedOut
        var errorDescription: String? {
            switch self {
            case .notAuthorized: return "Location is off for Card Picker. Turn it on in Settings, or use the category grid."
            case .timedOut: return "Couldn't get your location. Try again, or use the category grid."
            }
        }
    }

    /// One precise fix, using CLLocationUpdate (iOS 17).
    func currentLocation(timeout: Duration = .seconds(10)) async throws -> CLLocation {
        if status == .notDetermined { await requestWhenInUse() }
        guard canLocate else { throw LocationError.notAuthorized }
        return try await withThrowingTaskGroup(of: CLLocation?.self) { group in
            group.addTask {
                for try await update in CLLocationUpdate.liveUpdates() {
                    if let loc = update.location, loc.horizontalAccuracy >= 0, loc.horizontalAccuracy < 200 {
                        return loc
                    }
                }
                return nil
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                return nil
            }
            defer { group.cancelAll() }
            if let first = try await group.next(), let loc = first { return loc }
            throw LocationError.timedOut
        }
    }
}
