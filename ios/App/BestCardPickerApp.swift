import SwiftUI
import UniformTypeIdentifiers
import BestCardEngine
import CardPickerCore

@main
struct BestCardPickerApp: App {
    @State private var model = AppModel.shared
    @State private var importer = ImportController()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // CLMonitor delivers saved place events to whichever launch is running,
        // including a background relaunch, so start listening right away.
        Task { await PlaceMonitor.shared.start() }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(importer)
                .onOpenURL { url in
                    if url.scheme == "bestcard" {
                        model.showHere = true
                    } else if url.isFileURL {
                        importer.load(from: url)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .openHereRequested)) { _ in
                    model.showHere = true
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active, Shared.defaults.bool(forKey: Shared.pendingHereKey) {
                        Shared.defaults.set(false, forKey: Shared.pendingHereKey)
                        model.showHere = true
                    }
                }
                .task {
                    let d = model.data
                    await PlaceMonitor.shared.sync(places: d.savedPlaces, enabled: d.savedPlaceAlerts)
                }
        }
    }
}

/// cards.json import from the file importer or the share sheet ("Open in
/// Card Picker"). Validates first, then asks before replacing the rules.
@MainActor
@Observable
final class ImportController {
    var pending: CardsFile?
    var error: String?

    func load(from url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            pending = try CardsValidator.decode(data)
            error = nil
        } catch {
            pending = nil
            self.error = (error as? CardsValidator.Problem)?.message ?? error.localizedDescription
        }
    }
}
