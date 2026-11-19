import Foundation

/// Canonical categories from PRD.md.
public enum Categories {
    public static let all: [String] = [
        "restaurant", "us_supermarket", "online_grocery", "gas_ev", "streaming", "drugstore",
        "us_online_retail", "airline_united", "airline_aa", "airline_direct", "hotel_direct",
        "chase_travel", "amex_travel_prepaid_hotel", "vacation_rental", "rideshare_transit",
        "rental_car", "wholesale_club", "general",
    ]

    /// A rule for a parent category also covers these children unless a more
    /// specific rule exists.
    public static let parent: [String: String] = [
        "airline_united": "airline_direct",
        "airline_aa": "airline_direct",
    ]

    /// Most specific first: the category itself, then its parents.
    public static func lookupChain(_ category: String) -> [String] {
        var chain = [category]
        var current = category
        while let p = parent[current] {
            chain.append(p)
            current = p
        }
        return chain
    }

    public static let labels: [String: String] = [
        "restaurant": "Restaurant",
        "us_supermarket": "Supermarket",
        "online_grocery": "Online grocery",
        "gas_ev": "Gas / EV",
        "streaming": "Streaming",
        "drugstore": "Drugstore",
        "us_online_retail": "Online retail",
        "airline_united": "United",
        "airline_aa": "American Airlines",
        "airline_direct": "Airline",
        "hotel_direct": "Hotel",
        "chase_travel": "Chase Travel",
        "amex_travel_prepaid_hotel": "Amex Travel hotel",
        "vacation_rental": "Vacation rental",
        "rideshare_transit": "Rideshare / transit",
        "rental_car": "Rental car",
        "wholesale_club": "Warehouse club",
        "general": "Everything else",
    ]

    public static func label(_ category: String) -> String { labels[category] ?? category }
}

/// The shared card rules engine: a Swift port of src/engine (TypeScript).
/// Pure functions over a `CardsFile`; both ports pass data/golden_tests.json.
public struct Engine: Sendable {
    public let file: CardsFile
    /// Merchants from cards.json first (user-editable), then data/merchants.json.
    public let merchants: [Merchant]

    public init(file: CardsFile, extraMerchants: [Merchant] = []) {
        self.file = file
        self.merchants = (file.merchants ?? []) + extraMerchants
    }

    // MARK: Merchant lookup

    /// Merchant whose `match` appears in the merchant string as whole words
    /// after normalizing both: "smile.amazon.com" matches "amazon.com",
    /// "Trader Joe's #123" matches "trader joes", "H-E-B" matches "h e b".
    /// The longest match wins ("costco gasoline" beats "costco"); on equal
    /// length the earlier entry wins.
    public func merchant(for name: String?) -> Merchant? {
        guard let name else { return nil }
        let hay = " " + Self.normalize(name) + " "
        guard hay.count > 2 else { return nil }
        var best: Merchant?
        var bestLength = 0
        for m in merchants {
            let match = Self.normalize(m.match)
            if !match.isEmpty, match.count > bestLength, hay.contains(" " + match + " ") {
                best = m
                bestLength = match.count
            }
        }
        return best
    }

    /// Lowercase, strip accents and apostrophes, turn every other
    /// non-alphanumeric character into a space, collapse spaces.
    public static func normalize(_ s: String) -> String {
        let folded = s.lowercased()
            .folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        var out = ""
        var lastWasSpace = true
        for ch in folded {
            if ch == "'" || ch == "\u{2019}" { continue }
            if ch.isASCII && (ch.isLetter || ch.isNumber) {
                out.append(ch)
                lastWasSpace = false
            } else if !lastWasSpace {
                out.append(" ")
                lastWasSpace = true
            }
        }
        if out.hasSuffix(" ") { out.removeLast() }
        return out
    }

    // MARK: Context

    public func isForeign(_ ctx: PurchaseContext) -> Bool {
        if ctx.foreign == true { return true }
        if let c = ctx.currency, !c.isEmpty, c.uppercased() != "USD" { return true }
        if let c = ctx.country, !c.isEmpty, c.uppercased() != "US" { return true }
        return false
    }

    public func category(for ctx: PurchaseContext) -> String {
        ctx.category ?? merchant(for: ctx.merchant)?.category ?? "general"
    }

    func pointValues(_ options: EngineOptions) -> [String: Double] {
        file.pointValuesCents.merging(options.pointValuesCents ?? [:]) { _, new in new }
    }

    // MARK: Scoring

    /// Matches JavaScript's Math.round(x * 10000) / 10000.
    public static func round4(_ x: Double) -> Double {
        (x * 10000 + 0.5).rounded(.down) / 10000
    }

    public static func capEntry(_ options: EngineOptions, cardId: String, category: String) -> CapEntry? {
        options.capState?[cardId]?[category]
    }

    static func capReached(_ entry: CapEntry?, rule: Rule) -> Bool {
        guard let entry else { return false }
        if entry.reached == true { return true }
        if let used = entry.usedUsd, let cap = rule.capUsdPerYear, used >= cap { return true }
        return false
    }

    public func score(card: Card, category: String, foreign: Bool, options: EngineOptions) -> CardScore {
        var applied: Rule?
        for cat in Categories.lookupChain(category) {
            let candidates = card.rules.filter { $0.category == cat && !(foreign && $0.usOnly == true) }
            if let best = candidates.max(by: { $0.rate < $1.rate }) {
                applied = best
                break
            }
        }
        if let rule = applied, Self.capReached(Self.capEntry(options, cardId: card.id, category: rule.category), rule: rule) {
            applied = nil
        }
        let rate = applied?.rate ?? card.baseRate
        let pv = pointValues(options)[card.currency] ?? 0
        let cents = Self.round4(rate * pv - (foreign ? card.foreignFeePct : 0))
        let perk = card.preferredFor?.first { $0.category == category }
        let basis: Basis = perk != nil ? .perk : (applied != nil ? .bonus : .base)
        return CardScore(cardId: card.id, rate: rate, centsPerDollar: cents, basis: basis, appliedRule: applied, perkReason: perk?.reason)
    }

    /// Cards left after enabled/disabled and network acceptance filters.
    public func eligibleCards(_ ctx: PurchaseContext, merchant: Merchant?, options: EngineOptions) -> [Card] {
        let disabled = Set(options.disabledCards ?? [])
        let accepted: [String]? = ctx.acceptedNetworks
            ?? (ctx.channel == .inStore ? merchant?.inStoreNetworks : merchant?.onlineNetworks)
        let acceptedSet = accepted.map { Set($0.map { $0.lowercased() }) }
        return file.cards.filter { card in
            card.isEnabled && !disabled.contains(card.id)
                && (acceptedSet?.contains(card.network.lowercased()) ?? true)
        }
    }

    public func recommend(_ ctx: PurchaseContext, options: EngineOptions = .init()) -> Recommendation {
        let merchant = merchant(for: ctx.merchant)
        let category = ctx.category ?? merchant?.category ?? "general"
        let foreign = isForeign(ctx)
        let cards = eligibleCards(ctx, merchant: merchant, options: options)

        guard !cards.isEmpty else {
            return Recommendation(
                cardId: nil, rate: nil, centsPerDollar: nil, basis: nil,
                category: category, foreign: foreign,
                reason: "None of your cards is accepted here.",
                runnerUp: nil,
                warnings: [EngineWarning(code: .noAcceptedCard, message: "None of your cards is accepted here.")],
                merchant: merchant, ranked: [])
        }

        let byId = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, $0) })
        let order = Dictionary(uniqueKeysWithValues: file.cards.enumerated().map { ($1.id, $0) })
        let preferCash = options.preferCashOnTie ?? true
        let ranked = cards
            .map { score(card: $0, category: category, foreign: foreign, options: options) }
            .sorted { a, b in
                Self.isBetter(a, b, cards: byId, preferCash: preferCash, order: order)
            }

        let best = ranked[0]
        let bestCard = byId[best.cardId]!
        let runner = ranked.count > 1 ? ranked[1] : nil

        var warnings: [EngineWarning] = []
        if foreign, cards.contains(where: { $0.foreignFeePct > 0 }) {
            let names = cards.filter { $0.foreignFeePct > 0 }.map(\.name).joined(separator: ", ")
            warnings.append(EngineWarning(code: .foreignFees, message: "Foreign purchase: foreign fees apply on \(names)."))
        }
        if (ctx.mayNotTakeAmex == true || merchant?.mayNotTakeAmex == true), bestCard.network.lowercased() == "amex" {
            warnings.append(EngineWarning(code: .mayNotTakeAmex, message: "This merchant may not take Amex. Have a backup card ready."))
        }
        if let rule = best.appliedRule, let cap = rule.capUsdPerYear,
           let used = Self.capEntry(options, cardId: best.cardId, category: rule.category)?.usedUsd,
           used >= 0.9 * cap {
            warnings.append(EngineWarning(code: .capNearLimit, message: "\(bestCard.name) \(Categories.label(rule.category).lowercased()) cap is nearly used ($\(Self.formatNumber(used)) of $\(Self.formatNumber(cap)))."))
        }
        if best.appliedRule?.verify == true {
            warnings.append(EngineWarning(code: .verifyRule, message: "Check this rate against the issuer's terms."))
        }
        if Self.relevantVerifyFields(bestCard, basis: best.basis, foreign: foreign).isEmpty == false {
            warnings.append(EngineWarning(code: .verifyCard, message: "Some of \(bestCard.name)'s terms are marked verify."))
        }
        if merchant?.verify == true {
            warnings.append(EngineWarning(code: .verifyMerchant, message: "This merchant's category is a best guess; the bank may code it differently."))
        }

        return Recommendation(
            cardId: best.cardId, rate: best.rate, centsPerDollar: best.centsPerDollar, basis: best.basis,
            category: category, foreign: foreign,
            reason: reason(for: best, card: bestCard, category: category),
            runnerUp: runner.map { RunnerUp(cardId: $0.cardId, centsPerDollar: $0.centsPerDollar) },
            warnings: warnings, merchant: merchant, ranked: ranked)
    }

    /// A card's `verify` fields that matter for this purchase.
    static func relevantVerifyFields(_ card: Card, basis: Basis, foreign: Bool) -> [String] {
        (card.verify ?? []).filter { field in
            switch field {
            case "foreignFeePct": return foreign
            case "baseRate": return basis == .base
            case "rules": return basis == .bonus
            case "preferredFor": return basis == .perk
            default: return true
            }
        }
    }

    static func isBetter(_ a: CardScore, _ b: CardScore, cards: [String: Card], preferCash: Bool, order: [String: Int]) -> Bool {
        // 5. Perk preference ranks first even if another card earns more.
        let aPerk = a.basis == .perk, bPerk = b.basis == .perk
        if aPerk != bPerk { return aPerk }
        if a.centsPerDollar != b.centsPerDollar { return a.centsPerDollar > b.centsPerDollar }
        // 6. Ties: cash back first (unless flipped), then Visa/Mastercard over Amex, then file order.
        let ca = cards[a.cardId]!, cb = cards[b.cardId]!
        let aCash = ca.currency == "cash", bCash = cb.currency == "cash"
        if aCash != bCash { return preferCash ? aCash : bCash }
        let aAmex = ca.network.lowercased() == "amex", bAmex = cb.network.lowercased() == "amex"
        if aAmex != bAmex { return !aAmex }
        return (order[a.cardId] ?? .max) < (order[b.cardId] ?? .max)
    }

    // MARK: Text

    public static func formatNumber(_ x: Double) -> String {
        let r = round4(x)
        if r == r.rounded() { return String(Int(r)) }
        var s = String(format: "%.4f", r)
        while s.hasSuffix("0") { s.removeLast() }
        return s
    }

    /// "4x" for points cards, "3%" for cash back.
    public static func formatRate(_ rate: Double, currency: String) -> String {
        currency == "cash" ? "\(formatNumber(rate))%" : "\(formatNumber(rate))x"
    }

    /// One decimal: "8.0".
    public static func formatCents(_ cents: Double) -> String {
        String(format: "%.1f", cents)
    }

    public func reason(for score: CardScore, card: Card, category: String) -> String {
        let rate = Self.formatRate(score.rate, currency: card.currency)
        let target = score.appliedRule.map { Categories.label($0.category).lowercased() } ?? "everything"
        let value = "\(rate) on \(target), about \(Self.formatCents(score.centsPerDollar)) cents per dollar"
        if let perk = score.perkReason { return "Best for the perk: \(perk). \(value)" }
        return value
    }
}
