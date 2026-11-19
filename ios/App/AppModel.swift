import Foundation
import Observation
import UIKit
import WidgetKit
import BestCardEngine
import CardPickerCore

/// Owns the app's data. Every change goes through `update`, which saves the
/// Documents file, refreshes the App Group snapshot (for the widget, the intent
/// and background alerts), reloads widgets and re-syncs saved place monitoring.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    private(set) var data: AppData
    /// True when the Documents file exists but could not be read, which
    /// happens when iOS relaunches the app in the background while the phone
    /// is locked (complete file protection). The snapshot is used instead and
    /// nothing is saved until the file is readable again.
    private(set) var readOnly = false
    private(set) var lastAnswer: LastAnswer?
    var saveError: String?
    var showHere = false

    let store: DocumentStore
    let snapshots: SnapshotStore
    private var protectedDataObserver: NSObjectProtocol?

    init(store: DocumentStore? = nil, snapshots: SnapshotStore? = nil) {
        let testing = ProcessInfo.processInfo.arguments.contains("-uiTesting")
        if testing {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("uitest-\(UUID().uuidString)")
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.store = store ?? DocumentStore(directory: dir)
            self.snapshots = snapshots ?? SnapshotStore(directory: dir)
        } else {
            self.store = store ?? DocumentStore()
            self.snapshots = snapshots ?? SnapshotStore()
        }
        let snapshot = self.snapshots.load()
        lastAnswer = snapshot?.lastAnswer
        (data, readOnly) = Self.loadInitial(store: self.store, snapshot: snapshot)
        if testing, ProcessInfo.processInfo.arguments.contains("-offline") { data.offlineMode = true }
        if readOnly {
            protectedDataObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.reloadAfterUnlock() }
            }
        } else if !FileManager.default.fileExists(atPath: self.store.url.path) {
            persist()   // first launch: write the bundled defaults
        }
    }

    static func loadInitial(store: DocumentStore, snapshot: SharedSnapshot?) -> (AppData, Bool) {
        if FileManager.default.fileExists(atPath: store.url.path) {
            if let d = store.load() { return (d, false) }
            return (snapshot?.appData ?? .defaults(), true)
        }
        return (.defaults(), false)
    }

    private func reloadAfterUnlock() {
        guard readOnly, let d = store.load() else { return }
        data = d
        readOnly = false
        writeSnapshot()
    }

    // MARK: Changes

    func update(_ change: (inout AppData) -> Void) {
        var copy = data
        change(&copy)
        guard copy != data else { return }
        data = copy
        persist()
    }

    private func persist() {
        if !readOnly {
            do {
                try store.save(data)
                saveError = nil
            } catch {
                saveError = "Could not save: \(error.localizedDescription)"
            }
        }
        writeSnapshot()
        WidgetCenter.shared.reloadAllTimelines()
        let places = data.savedPlaces
        let enabled = data.savedPlaceAlerts
        Task { await PlaceMonitor.shared.sync(places: places, enabled: enabled) }
    }

    private func writeSnapshot() {
        try? snapshots.save(SharedSnapshot(appData: data, lastAnswer: lastAnswer))
    }

    /// Remember a place-based answer so the lock screen widget shows it.
    func record(_ answer: Answer, placeName: String) {
        lastAnswer = answer.lastAnswer(placeName: placeName)
        writeSnapshot()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Answers

    func answer(for context: PurchaseContext, likely: Bool = false) -> Answer? {
        data.answer(for: context, likely: likely)
    }

    // MARK: Import, export, reset

    /// Replace the card rules with an imported cards.json. Cap toggles are kept
    /// for card ids that still exist.
    func importCards(_ file: CardsFile) {
        update { d in
            d.cardsFile = file
            let ids = Set(file.cards.map(\.id))
            d.capState = d.capState.filter { ids.contains($0.key) }
        }
    }

    func exportCardsData() throws -> Data {
        try JSONCoding.exportCards(data.cardsFile)
    }

    func resetCardsToDefaults() {
        update { $0.cardsFile = DefaultData.cardsFile(); $0.capState = [:] }
    }

    /// "Clear all data": wipes the Documents file, the snapshot, saved places,
    /// per-place categories, cap toggles and pending notifications.
    func clearAllData() {
        store.delete()
        snapshots.delete()
        lastAnswer = nil
        data = .defaults()
        readOnly = false
        persist()
        Notifications.removeAll()
    }
}
