import AppIntents
import Foundation

/// Opens the app on the "Which card here?" sheet. Used by the Control Center
/// control and offered in Shortcuts, so it can go on Back Tap (Settings >
/// Accessibility > Touch > Back Tap) or the Action button. Compiled into both
/// targets so the control can reference it; with openAppWhenRun the system
/// runs it in the app.
struct OpenHereIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Which Card Here"
    static let description = IntentDescription("Opens Card Picker and checks the place you're at.")
    static let openAppWhenRun = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        Shared.defaults.set(true, forKey: Shared.pendingHereKey)
        NotificationCenter.default.post(name: .openHereRequested, object: nil)
        return .result()
    }
}

extension Notification.Name {
    static let openHereRequested = Notification.Name("openHereRequested")
}
