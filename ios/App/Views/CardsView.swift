import SwiftUI
import BestCardEngine
import CardPickerCore

/// The card editor: same fields as the extension's options page.
struct CardsView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: Card?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.data.cardsFile.cards) { card in
                        Button { editing = card } label: {
                            HStack {
                                CardBadge(card: card)
                                VStack(alignment: .leading) {
                                    Text(card.name).font(.headline)
                                    Text(summary(card)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Spacer()
                                if !card.isEnabled { Text("Off").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("card-\(card.id)")
                    }
                    .onDelete { idx in model.update { $0.cardsFile.cards.remove(atOffsets: idx) } }
                    .onMove { from, to in model.update { $0.cardsFile.cards.move(fromOffsets: from, toOffset: to) } }
                } footer: {
                    Text("Card order breaks the last tie. Only a nickname and optional last four digits are stored, never a card number.")
                }
                Section("Caps reached") {
                    CapToggles()
                }
            }
            .navigationTitle("Cards")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editing = Card(id: "card-\(Int(Date().timeIntervalSince1970))", name: "New card", network: "visa",
                                       currency: "cash", foreignFeePct: 0, baseRate: 1, rules: [])
                    } label: { Image(systemName: "plus") }
                }
            }
            .sheet(item: $editing) { card in
                CardEditor(card: card)
            }
        }
    }

    private func summary(_ card: Card) -> String {
        let rules = card.rules.map { "\(Engine.formatRate($0.rate, currency: card.currency)) \(Categories.label($0.category).lowercasedFirst)" }
        return (rules + ["\(Engine.formatRate(card.baseRate, currency: card.currency)) else"]).joined(separator: ", ")
    }
}

/// Manual "cap reached" switches for every capped rule (PRD default).
struct CapToggles: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let capped = model.data.cardsFile.cards.flatMap { card in
            card.rules.filter { $0.capUsdPerYear != nil }.map { (card, $0) }
        }
        if capped.isEmpty { Text("No capped rules.").foregroundStyle(.secondary) }
        ForEach(Array(capped.enumerated()), id: \.offset) { _, pair in
            let (card, rule) = pair
            Toggle(isOn: Binding(
                get: { model.data.capReached(cardId: card.id, category: rule.category) },
                set: { on in model.update { $0.setCap(cardId: card.id, category: rule.category, reached: on) } })) {
                VStack(alignment: .leading) {
                    Text("\(card.shortCode ?? card.name) \(Categories.label(rule.category).lowercasedFirst)")
                    Text("$\(Engine.formatNumber(rule.capUsdPerYear ?? 0)) a year at \(Engine.formatRate(rule.rate, currency: card.currency))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .accessibilityIdentifier("cap-\(card.id)-\(rule.category)")
        }
    }
}

struct CardEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var card: Card
    @State private var problem: String?

    private var currencies: [String] { model.data.cardsFile.pointValuesCents.keys.sorted() }

    var body: some View {
        NavigationStack {
            Form {
                Section("Card") {
                    TextField("Nickname", text: $card.name).accessibilityIdentifier("cardName")
                    TextField("Badge code (e.g. GOLD)", text: Binding(get: { card.shortCode ?? "" }, set: { card.shortCode = $0.isEmpty ? nil : $0 }))
                    TextField("Last four digits (optional)", text: Binding(
                        get: { card.last4 ?? "" },
                        set: { v in
                            let digits = String(v.filter(\.isNumber).prefix(4))
                            card.last4 = digits.isEmpty ? nil : digits
                        }))
                        .keyboardType(.numberPad)
                    Toggle("Use this card", isOn: Binding(get: { card.isEnabled }, set: { card.enabled = $0 ? nil : false }))
                }
                Section("Earning") {
                    Picker("Network", selection: $card.network) {
                        ForEach(["visa", "mastercard", "amex", "discover"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Picker("Currency", selection: $card.currency) {
                        ForEach(currencies, id: \.self) { Text($0).tag($0) }
                    }
                    NumberField(title: card.currency == "cash" ? "Base rate (%)" : "Base rate (x)", value: $card.baseRate)
                        .accessibilityIdentifier("baseRate")
                    NumberField(title: "Foreign fee (%)", value: $card.foreignFeePct)
                }
                Section("Bonus rules") {
                    ForEach($card.rules.indices, id: \.self) { i in
                        RuleEditor(rule: $card.rules[i], currency: card.currency)
                    }
                    .onDelete { card.rules.remove(atOffsets: $0) }
                    Button("Add rule") { card.rules.append(Rule(category: "restaurant", rate: 2)) }
                }
                Section {
                    ForEach($card.preferredFor.unwrapped.indices, id: \.self) { i in
                        Picker("Category", selection: $card.preferredFor.unwrapped[i].category) {
                            ForEach(Categories.all, id: \.self) { Text(Categories.label($0)).tag($0) }
                        }
                        TextField("Why (e.g. free checked bag)", text: $card.preferredFor.unwrapped[i].reason)
                    }
                    .onDelete { card.preferredFor?.remove(atOffsets: $0) }
                    Button("Add perk preference") {
                        card.preferredFor = (card.preferredFor ?? []) + [PerkPreference(category: "airline_direct", reason: "")]
                    }
                } header: { Text("Perk preference") } footer: {
                    Text("This card ranks first in these categories even if another card earns more points.")
                }
                if let note = card.note {
                    Section("Note") { Text(note).font(.footnote) }
                }
                if let problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
            }
            .navigationTitle(card.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.accessibilityIdentifier("saveCard")
                }
            }
        }
    }

    private func save() {
        if card.preferredFor?.isEmpty == true { card.preferredFor = nil }
        var file = model.data.cardsFile
        if let i = file.cards.firstIndex(where: { $0.id == card.id }) { file.cards[i] = card } else { file.cards.append(card) }
        if let first = CardsValidator.validate(file).first {
            problem = first.message
            return
        }
        model.update { $0.cardsFile = file }
        dismiss()
    }
}

struct RuleEditor: View {
    @Binding var rule: Rule
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("Category", selection: $rule.category) {
                ForEach(Categories.all, id: \.self) { Text(Categories.label($0)).tag($0) }
            }
            NumberField(title: currency == "cash" ? "Rate (%)" : "Rate (x)", value: $rule.rate)
            NumberField(title: "Yearly cap ($, blank for none)", value: Binding(
                get: { rule.capUsdPerYear ?? 0 },
                set: { rule.capUsdPerYear = $0 > 0 ? $0 : nil }))
            Toggle("US only", isOn: Binding(get: { rule.usOnly ?? false }, set: { rule.usOnly = $0 ? true : nil }))
            Toggle("Marked verify", isOn: Binding(get: { rule.verify ?? false }, set: { rule.verify = $0 ? true : nil }))
        }
        .padding(.vertical, 4)
    }
}

struct NumberField: View {
    let title: String
    @Binding var value: Double
    @State private var text = ""

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField("0", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 100)
                .onChange(of: text) { _, new in
                    if let v = Double(new.replacingOccurrences(of: ",", with: ".")) { value = v }
                    else if new.isEmpty { value = 0 }
                }
        }
        .onAppear { text = value == 0 ? "" : Engine.formatNumber(value) }
    }
}

extension Optional where Wrapped == [PerkPreference] {
    /// Binding helper: treat nil as an empty list.
    var unwrapped: [PerkPreference] {
        get { self ?? [] }
        set { self = newValue }
    }
}
