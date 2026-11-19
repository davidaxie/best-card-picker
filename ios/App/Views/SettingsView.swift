import SwiftUI
import UniformTypeIdentifiers
import BestCardEngine
import CardPickerCore

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(ImportController.self) private var importer
    @State private var showImporter = false
    @State private var confirmClear = false
    @State private var confirmReset = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink {
                        CardsView()
                    } label: {
                        Label("My cards", systemImage: "creditcard.fill")
                            .badge(model.data.cardsFile.cards.filter(\.isEnabled).count)
                    }
                    .accessibilityIdentifier("myCards")
                } footer: {
                    Text("Card rules, caps reached, and which cards are on.")
                }
                Section {
                    Toggle("Offline mode", isOn: Binding(get: { model.data.offlineMode }, set: { v in model.update { $0.offlineMode = v } }))
                        .accessibilityIdentifier("offlineToggle")
                } footer: {
                    Text("MapKit lookups send your location to Apple. Offline mode turns them off; the category grid and saved places still work.")
                }
                Section {
                    Toggle("Cash back wins ties", isOn: Binding(get: { model.data.preferCashOnTie }, set: { v in model.update { $0.preferCashOnTie = v } }))
                } footer: {
                    Text("Blue Cash Everyday 3% and Freedom Unlimited 1.5x UR both come to 3 cents. On: cash. Off: points.")
                }
                Section("Point values (cents)") {
                    ForEach(model.data.cardsFile.pointValuesCents.keys.sorted(), id: \.self) { key in
                        NumberField(title: key, value: Binding(
                            get: { model.data.cardsFile.pointValuesCents[key] ?? 0 },
                            set: { v in model.update { $0.cardsFile.pointValuesCents[key] = v } }))
                    }
                }
                Section {
                    Button("Import cards.json…") { showImporter = true }
                        .accessibilityIdentifier("importCards")
                    ShareLink(item: CardsExport(model: model), preview: SharePreview("cards.json")) {
                        Text("Export cards.json")
                    }
                    Button("Reset cards to defaults", role: .destructive) { confirmReset = true }
                } header: { Text("Card rules") } footer: {
                    Text("Move rules between devices with a file: export from the extension, AirDrop it here, open it in Card Picker. Rules updated \(model.data.cardsFile.updated).")
                }
                Section {
                    Button("Clear all data", role: .destructive) { confirmClear = true }
                } footer: {
                    Text("Deletes saved places, per-place categories, cap toggles and edited cards from this phone. Nothing is stored anywhere else: no account, no iCloud, no analytics.")
                }
                if let error = model.saveError {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Settings")
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                switch result {
                case .success(let url): importer.load(from: url)
                case .failure(let e): importer.error = e.localizedDescription
                }
            }
            .confirmationDialog("Clear all data?", isPresented: $confirmClear, titleVisibility: .visible) {
                Button("Clear all data", role: .destructive) { model.clearAllData() }
            } message: { Text("This can't be undone.") }
            .confirmationDialog("Reset cards to the bundled defaults?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset cards", role: .destructive) { model.resetCardsToDefaults() }
            }
        }
    }
}

/// cards.json for the share sheet, in the same schema the extension reads.
struct CardsExport: Transferable {
    let data: Data

    @MainActor
    init(model: AppModel) {
        data = (try? model.exportCardsData()) ?? Data()
    }

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { export in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("cards.json")
            try export.data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}
