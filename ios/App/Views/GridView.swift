import SwiftUI
import BestCardEngine
import CardPickerCore

/// One tap: pick what you're buying, see the card.
struct GridView: View {
    @Environment(AppModel.self) private var model
    @State private var selected: GridTile?
    @State private var foreign = false
    /// Tap-to-render time, shown only under UI tests to check the PRD's 200 ms.
    @State private var tapTime: ContinuousClock.Instant?
    @State private var latencyMs: Int?
    /// Store-name search over the bundled brand list (no location needed).
    @State private var query = ""
    @State private var store: BrandIndex.Hit?
    private let measuring = ProcessInfo.processInfo.arguments.contains("-uiTesting")

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    let hits = BrandIndex.shared.search(query)
                    if !hits.isEmpty {
                        storeResults(hits)
                    } else {
                        if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                            Text("\(query) isn't in the store list. Pick what you're buying instead:")
                                .font(.subheadline).foregroundStyle(.secondary)
                                .accessibilityIdentifier("storeNoMatch")
                        }
                        if let selected, let answer = model.answer(for: selected.context(foreign: foreign)) {
                            AnswerView(answer: answer, placeName: selected.title + (foreign ? " · abroad" : ""))
                                .transition(.opacity)
                        } else if selected != nil {
                            ContentUnavailableView("No card accepted", systemImage: "creditcard.trianglebadge.exclamationmark")
                        }
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(GridTile.all) { tile in
                                Button {
                                    tapTime = .now
                                    selected = tile
                                } label: {
                                    VStack(spacing: 6) {
                                        Image(systemName: tile.symbol).font(.title2)
                                        Text(tile.title).font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 78)
                                    .background(selected == tile ? Color.accentColor.opacity(0.2) : Color(.secondarySystemBackground),
                                                in: RoundedRectangle(cornerRadius: 14))
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("tile-\(tile.id)")
                            }
                        }
                    }
                    if measuring, let latencyMs {
                        Text("\(latencyMs)").font(.caption2).accessibilityIdentifier("answerLatencyMs")
                    }
                    Toggle("Paying abroad or in another currency", isOn: $foreign)
                        .font(.subheadline)
                        .accessibilityIdentifier("foreignToggle")
                }
                .padding()
            }
            .navigationTitle("What are you buying?")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Store name, e.g. Trader Joe's")
            .autocorrectionDisabled()
            .onChange(of: query) { store = nil }
            .task(id: selected) {
                // Runs after SwiftUI has committed the update that shows the answer.
                guard measuring, let tapTime else { return }
                await Task.yield()
                latencyMs = Int((ContinuousClock.now - tapTime) / .milliseconds(1))
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { model.showHere = true } label: { Label("Which card here?", systemImage: "location.circle") }
                        .disabled(model.data.offlineMode && model.data.savedPlaces.isEmpty)
                }
            }
        }
    }

    /// Matching stores, each with its card. Tapping one shows the full answer.
    @ViewBuilder
    private func storeResults(_ hits: [BrandIndex.Hit]) -> some View {
        if let store, let answer = model.answer(for: context(store)) {
            AnswerView(answer: answer, placeName: store.name + (foreign ? " · abroad" : ""))
            if store.verify {
                Text("\(store.name) runs several kinds of store; this assumes \(Categories.label(store.category).lowercasedFirst).")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        VStack(spacing: 0) {
            ForEach(hits) { hit in
                Button { store = hit } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hit.name).font(.body.weight(.medium))
                            Text(Categories.label(hit.category)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let answer = model.answer(for: context(hit)) {
                            CardBadge(card: answer.card)
                            Text(answer.rateText).font(.subheadline.monospacedDigit())
                        }
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("store-\(hit.name)")
                Divider()
            }
        }
        Text("Store list from the name-suggestion-index (OpenStreetMap contributors). The bank's merchant code can differ.")
            .font(.caption2).foregroundStyle(.secondary)
    }

    private func context(_ hit: BrandIndex.Hit) -> PurchaseContext {
        PurchaseContext(category: hit.category, merchant: hit.name, channel: .inStore, foreign: foreign ? true : nil)
    }
}

struct GridTile: Identifiable, Hashable {
    var id: String
    var title: String
    var symbol: String
    var category: String?
    var merchant: String?

    func context(foreign: Bool) -> PurchaseContext {
        PurchaseContext(category: category, merchant: merchant, channel: .inStore, foreign: foreign ? true : nil)
    }

    static let all: [GridTile] = [
        GridTile(id: "restaurant", title: "Restaurant", symbol: "fork.knife", category: "restaurant"),
        GridTile(id: "us_supermarket", title: "Grocery", symbol: "cart.fill", category: "us_supermarket"),
        GridTile(id: "gas_ev", title: "Gas", symbol: "fuelpump.fill", category: "gas_ev"),
        GridTile(id: "drugstore", title: "Drugstore", symbol: "cross.case.fill", category: "drugstore"),
        GridTile(id: "costco", title: "Costco", symbol: "shippingbox.fill", merchant: "Costco"),
        GridTile(id: "wholesale_club", title: "Warehouse club", symbol: "building.2.fill", category: "wholesale_club"),
        GridTile(id: "hotel_direct", title: "Hotel", symbol: "bed.double.fill", category: "hotel_direct"),
        GridTile(id: "rideshare_transit", title: "Transit / parking", symbol: "tram.fill", category: "rideshare_transit"),
        GridTile(id: "rental_car", title: "Rental car", symbol: "car.fill", category: "rental_car"),
        GridTile(id: "airline_direct", title: "Airline", symbol: "airplane", category: "airline_direct"),
        GridTile(id: "streaming", title: "Streaming", symbol: "play.tv.fill", category: "streaming"),
        GridTile(id: "general", title: "Anything else", symbol: "bag.fill", category: "general"),
    ]
}
