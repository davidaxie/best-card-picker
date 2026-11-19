import AppIntents
import SwiftUI
import BestCardEngine
import CardPickerCore

/// "Which card here?" for Siri, Shortcuts and the Action button. Runs without
/// opening the app.
struct WhichCardHereIntent: AppIntent {
    static let title: LocalizedStringResource = "Which card here?"
    static let description = IntentDescription("Names the best credit card for the place you're at.")
    static let openAppWhenRun = false

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        let result = await HereResolver.resolve()
        return .result(dialog: IntentDialog(stringLiteral: result.spoken)) {
            HereSnippet(result: result)
        }
    }
}

/// "Best card for gas": the category grid as an intent.
struct BestCardForCategoryIntent: AppIntent {
    static let title: LocalizedStringResource = "Best card for a category"
    static let description = IntentDescription("Names the best card for a kind of purchase, with no location lookup.")
    static let openAppWhenRun = false

    @Parameter(title: "Category")
    var category: PurchaseCategory

    init() {}
    init(category: PurchaseCategory) { self.category = category }

    static var parameterSummary: some ParameterSummary {
        Summary("Best card for \(\.$category)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = PurchaseContext(category: category.rawValue == "costco" ? nil : category.rawValue,
                                  merchant: category.rawValue == "costco" ? "Costco" : nil,
                                  channel: .inStore)
        guard let answer = AppModel.shared.answer(for: ctx) else {
            return .result(dialog: "None of your cards is accepted there.")
        }
        return .result(dialog: IntentDialog(stringLiteral: "\(answer.card.name), \(answer.rateText). \(answer.recommendation.reason)."))
    }
}

enum PurchaseCategory: String, AppEnum {
    case restaurant, us_supermarket, gas_ev, drugstore, costco, wholesale_club, hotel_direct,
         rideshare_transit, rental_car, streaming, us_online_retail, general

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Category"
    static let caseDisplayRepresentations: [PurchaseCategory: DisplayRepresentation] = [
        .restaurant: "Restaurant", .us_supermarket: "Supermarket", .gas_ev: "Gas", .drugstore: "Drugstore",
        .costco: "Costco", .wholesale_club: "Warehouse club", .hotel_direct: "Hotel",
        .rideshare_transit: "Rideshare or transit", .rental_car: "Rental car", .streaming: "Streaming",
        .us_online_retail: "Online shopping", .general: "Anything else",
    ]
}

struct CardPickerShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WhichCardHereIntent(),
            phrases: [
                "Which card here in \(.applicationName)",
                "\(.applicationName) which card here",
                "Which card should I use in \(.applicationName)",
                "Ask \(.applicationName) which card",
            ],
            shortTitle: "Which card here?",
            systemImageName: "creditcard")
        AppShortcut(
            intent: BestCardForCategoryIntent(),
            phrases: [
                "Best card for \(\.$category) in \(.applicationName)",
                "\(.applicationName) best card for \(\.$category)",
            ],
            shortTitle: "Best card for…",
            systemImageName: "square.grid.2x2")
        AppShortcut(
            intent: OpenHereIntent(),
            phrases: [
                "Open \(.applicationName) here",
                "Show \(.applicationName) for this store",
            ],
            shortTitle: "Open Which Card Here",
            systemImageName: "creditcard.and.123")
    }
}

struct HereSnippet: View {
    let result: HereResolver.Result

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let answer = result.answer, let place = result.placeName {
                Text(place).font(.caption).foregroundStyle(.secondary)
                Text(answer.card.name).font(.title2.bold())
                Text("\(answer.rateText) · \(answer.centsText) cents per dollar").font(.headline)
                Text(answer.reasonLine).font(.footnote).foregroundStyle(.secondary)
            } else {
                Text(result.message).font(.body)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
