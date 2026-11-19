import SwiftUI
import BestCardEngine
import CardPickerCore

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(ImportController.self) private var importer

    var body: some View {
        @Bindable var model = model
        @Bindable var importer = importer
        TabView {
            GridView()
                .tabItem { Label("Pick", systemImage: "square.grid.2x2.fill") }
            NearbyView()
                .tabItem { Label("Map", systemImage: "map.fill") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .sheet(isPresented: $model.showHere) { HereSheet() }
        .alert("Import cards.json?", isPresented: Binding(get: { importer.pending != nil }, set: { if !$0 { importer.pending = nil } })) {
            Button("Replace my cards", role: .destructive) {
                if let file = importer.pending { model.importCards(file) }
                importer.pending = nil
            }
            Button("Cancel", role: .cancel) { importer.pending = nil }
        } message: {
            if let f = importer.pending {
                Text("\(f.cards.count) cards, updated \(f.updated). This replaces your current card rules.")
            }
        }
        .alert("Couldn't import", isPresented: Binding(get: { importer.error != nil }, set: { if !$0 { importer.error = nil } })) {
            Button("OK", role: .cancel) { importer.error = nil }
        } message: {
            Text(importer.error ?? "")
        }
    }
}

/// The answer, as every screen shows it.
struct AnswerView: View {
    let answer: Answer
    var placeName: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let placeName {
                Text(placeName).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline) {
                CardBadge(card: answer.card)
                Text(answer.card.name)
                    .font(.title2.bold())
                    .accessibilityIdentifier("answerCardName")
            }
            if let last4 = answer.card.last4 {
                Text("ending \(last4)").font(.caption).foregroundStyle(.secondary)
            }
            Text("\(answer.rateText) · \(answer.centsText) cents per dollar")
                .font(.title3.weight(.semibold))
                .accessibilityIdentifier("answerValue")
            Text(answer.reasonLine)
                .font(.callout)
                .accessibilityIdentifier("answerReason")
            if let runner = answer.runnerUpLine {
                Text(runner).font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(answer.recommendation.warnings, id: \.message) { w in
                Label(w.message, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
            Text("Open Wallet and swipe to this card.")
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("answer")
    }
}

struct CardBadge: View {
    let card: Card
    var body: some View {
        Text(card.shortCode ?? String(card.name.prefix(3)).uppercased())
            .font(.caption.bold().monospaced())
            .padding(.horizontal, 6).padding(.vertical, 3)
            .foregroundStyle(.white)
            .background(Color(hex: card.color) ?? .accentColor, in: RoundedRectangle(cornerRadius: 5))
    }
}

extension Color {
    init?(hex: String?) {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
        s.removeFirst()
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// "Which card here?" inside the app (widget tap, Control Center).
struct HereSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var result: HereResolver.Result?

    var body: some View {
        NavigationStack {
            Group {
                if let result {
                    ScrollView {
                        if let answer = result.answer {
                            AnswerView(answer: answer, placeName: result.placeName).padding()
                        } else {
                            ContentUnavailableView("No answer", systemImage: "location.slash", description: Text(result.message))
                        }
                    }
                } else {
                    ProgressView("Checking where you are…")
                }
            }
            .navigationTitle("Which card here?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .task { result = await HereResolver.resolve(model: model) }
        .presentationDetents([.medium, .large])
    }
}
