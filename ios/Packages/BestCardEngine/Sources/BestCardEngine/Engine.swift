import Foundation

/// The 18 canonical categories. Labels and reason phrases come from the
/// bundled copy of data/categories.json so both apps show the same words.
public enum Categories {
    public static let all: [String] = [
        "restaurant", "us_supermarket", "online_grocery", "gas_ev", "streaming", "drugstore",
        "us_online_retail", "airline_united", "airline_aa", "airline_direct", "hotel_direct",
        "chase_travel", "amex_travel_prepaid_hotel", "vacation_rental", "rideshare_transit",
        "rental_car", "wholesale_club", "general",
    ]

    struct Entry: Decodable { var id: String; var label: String; var phrase: String }
    struct File: Decodable { var categories: [Entry] }

    static let entries: [String: Entry] = {
        guard let url = BundledData.categoriesURL,
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data) else { return [:] }
        return Dictionary(file.categories.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }()

    /// "Restaurants and food delivery"
    public static func label(_ category: String) -> String { entries[category]?.label ?? category }
    /// "at restaurants"
    public static func phrase(_ category: String) -> String { entries[category]?.phrase ?? "on \(category)" }
}

/// The shared card rules engine: a Swift port of src/engine/recommend.ts and
/// merchant.ts, following docs/ENGINE_SPEC.md. Both ports pass
/// data/golden_tests.json.
public struct Engine: Sendable {
    public let file: CardsFile
    /// The two merchant lists in search order: cards.json, then merchants.json.
    public let merchantLists: [[Merchant]]

    public init(file: CardsFile, extraMerchants: [Merchant] = []) {
        self.file = file
        self.merchantLists = [file.merchants ?? [], extraMerchants]
    }

    // MARK: Merchant resolution (spec "Merchant resolution")

    public enum MerchantKey: Equatable, Sendable {
        case host(String)
        case name(String)
    }

    /// Step 1: decide whether the string is a host or a place name.
    public static func merchantKey(_ raw: String) -> MerchantKey {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let r = s.range(of: "://") { s = String(s[r.upperBound...]) }
        if let cut = s.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) { s = String(s[..<cut]) }
        if let colon = s.lastIndex(of: ":"), s[s.index(after: colon)...].allSatisfy(\.isNumber) {
            s = String(s[..<colon])
        }
        if s.hasSuffix(".") { s.removeLast() }
        if s.contains("."), !s.contains(where: { $0.isWhitespace }) { return .host(s) }
        return .name(raw)
    }

    public func merchant(for raw: String?) -> Merchant? {
        guard let raw else { return nil }
        switch Self.merchantKey(raw) {
        case .host(let host): return lookupHost(host)
        case .name(let name): return lookupName(name)
        }
    }

    /// Step 2: longest suffix first, down to the last two labels.
    func lookupHost(_ host: String) -> Merchant? {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard labels.count >= 2 else { return nil }
        for i in 0...(labels.count - 2) {
            let suffix = labels[i...].joined(separator: ".")
            for list in merchantLists {
                if let hit = list.first(where: { $0.match.contains(".") && $0.match.lowercased() == suffix }) {
                    return hit
                }
            }
        }
        return nil
    }

    /// Step 3: brands (no dot) match when the name equals the brand or starts
    /// with brand + " ". Longest brand wins; ties go to the earlier entry.
    func lookupName(_ raw: String) -> Merchant? {
        let name = Self.normalize(raw)
        guard !name.isEmpty else { return nil }
        var best: Merchant?
        var bestLength = 0
        for list in merchantLists {
            for m in list where !m.match.contains(".") {
                let brand = Self.normalize(m.match)
                guard !brand.isEmpty, brand.count > bestLength else { continue }
                if name == brand || name.hasPrefix(brand + " ") {
                    best = m
                    bestLength = brand.count
                }
            }
        }
        return best
    }

    /// Lowercase; delete ' and U+2019; each run of characters outside
    /// [a-z0-9] becomes one space; trim.
    public static func normalize(_ s: String) -> String {
        var out = ""
        var pendingSpace = false
        for ch in s.lowercased() where ch != "'" && ch != "\u{2019}" {
            if let a = ch.asciiValue, (a >= 97 && a <= 122) || (a >= 48 && a <= 57) {
                if pendingSpace && !out.isEmpty { out.append(" ") }
                pendingSpace = false
                out.append(ch)
            } else {
                pendingSpace = true
            }
        }
        return out
    }

    // MARK: Context

    public func isForeign(_ ctx: PurchaseContext) -> Bool {
        if ctx.foreign == true { return true }
        if let c = ctx.currency, c.uppercased() != "USD" { return true }
        if let c = ctx.country, c.uppercased() != "US" { return true }
        return false
    }

    func pointValues(_ options: EngineOptions) -> [String: Double] {
        file.pointValuesCents.merging(options.pointValuesCents ?? [:]) { _, new in new }
    }

    // MARK: Scoring (spec "Scoring")

    /// sign(x) * roundHalfAwayFromZero(|x| * 10000) / 10000, with -0 as 0.
    public static func round4(_ x: Double) -> Double {
        let r = (abs(x) * 10000).rounded(.toNearestOrAwayFromZero) / 10000
        let signed = x < 0 ? -r : r
        return signed == 0 ? 0 : signed
    }

    static func capEntry(_ options: EngineOptions, cardId: String, category: String) -> CapEntry? {
        options.capState?[cardId]?[category]
    }

    static func capReached(_ options: EngineOptions, card: Card, rule: Rule) -> Bool {
        guard let entry = capEntry(options, cardId: card.id, category: rule.category) else { return false }
        if entry.reached == true { return true }
        if let used = entry.usedUsd, let cap = rule.capUsdPerYear, used >= cap { return true }
        return false
    }

    /// Highest rate wins; the first one on equal rate.
    static func highest(_ rules: [Rule]) -> Rule? {
        var best: Rule?
        for r in rules where best == nil || r.rate > best!.rate { best = r }
        return best
    }

    public func score(card: Card, category: String, foreign: Bool, options: EngineOptions, pointValues: [String: Double]) -> CardScore {
        let eligible = card.rules.filter { rule in
            !(rule.usOnly == true && foreign) && !Self.capReached(options, card: card, rule: rule)
        }
        var applied = Self.highest(eligible.filter { $0.category == category })
        if applied == nil, category == "airline_united" || category == "airline_aa" {
            applied = Self.highest(eligible.filter { $0.category == "airline_direct" })
        }
        let rate = applied.map { max($0.rate, card.baseRate) } ?? card.baseRate
        let cents = Self.round4(rate * (pointValues[card.currency] ?? 0) - (foreign ? card.foreignFeePct : 0))
        let perk = card.preferredFor?.first { $0.category == category }
        let basis: Basis
        if perk != nil { basis = .perk }
        else if let applied, applied.rate > card.baseRate { basis = .bonus }
        else { basis = .base }
        return CardScore(cardId: card.id, rate: rate, centsPerDollar: cents, basis: basis, appliedRule: applied, perkReason: perk?.reason)
    }

    static func networkRank(_ network: String) -> Int {
        switch network.lowercased() {
        case "visa", "mastercard": return 0
        case "discover": return 1
        case "amex": return 2
        default: return 3
        }
    }

    public func recommend(_ ctx: PurchaseContext, options: EngineOptions = .init()) -> Recommendation {
        let merchant = merchant(for: ctx.merchant)
        let category = ctx.category ?? merchant?.category ?? "general"
        let foreign = isForeign(ctx)
        let accepted: Set<String>? = (ctx.acceptedNetworks
            ?? (ctx.channel == .inStore ? merchant?.inStoreNetworks : merchant?.onlineNetworks))
            .map { Set($0.map { $0.lowercased() }) }
        let disabled = Set(options.disabledCards ?? [])
        let indexed = file.cards.enumerated().filter { _, card in
            card.isEnabled && !disabled.contains(card.id) && (accepted?.contains(card.network.lowercased()) ?? true)
        }
        let candidates = indexed.map(\.element)

        var warnings: [EngineWarning] = []
        let feeCards = candidates.filter { $0.foreignFeePct > 0 }
        if foreign, !feeCards.isEmpty {
            warnings.append(EngineWarning(code: .foreignFees, message: "Foreign purchase: \(feeCards.map(\.name).joined(separator: ", ")) charge foreign fees."))
        }

        guard !candidates.isEmpty else {
            warnings.append(EngineWarning(code: .noAcceptedCard, message: "None of your cards is accepted here."))
            return Recommendation(cardId: nil, rate: nil, centsPerDollar: nil, basis: nil, category: category, foreign: foreign,
                                  reason: "None of your cards is accepted here.", runnerUp: nil, warnings: warnings,
                                  merchant: merchant, ranked: [])
        }

        let pv = pointValues(options)
        let preferCash = options.preferCashOnTie ?? true
        let byId = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0) })
        let indexOf = Dictionary(uniqueKeysWithValues: indexed.map { ($0.element.id, $0.offset) })
        let ranked = candidates
            .map { score(card: $0, category: category, foreign: foreign, options: options, pointValues: pv) }
            .sorted { a, b in
                let aPerk = a.basis == .perk, bPerk = b.basis == .perk
                if aPerk != bPerk { return aPerk }
                if a.centsPerDollar != b.centsPerDollar { return a.centsPerDollar > b.centsPerDollar }
                let ca = byId[a.cardId]!, cb = byId[b.cardId]!
                let aCash = ca.currency == "cash", bCash = cb.currency == "cash"
                if aCash != bCash { return preferCash ? aCash : bCash }
                let ra = Self.networkRank(ca.network), rb = Self.networkRank(cb.network)
                if ra != rb { return ra < rb }
                return indexOf[a.cardId]! < indexOf[b.cardId]!
            }

        let best = ranked[0]
        let card = byId[best.cardId]!
        let runner = ranked.count > 1 ? ranked[1] : nil

        if ctx.mayNotTakeAmex == true || merchant?.mayNotTakeAmex == true, card.network.lowercased() == "amex" {
            warnings.append(EngineWarning(code: .mayNotTakeAmex, message: "This merchant may not take Amex. Have \(runner.flatMap { byId[$0.cardId]?.name } ?? "a backup card") ready."))
        }
        if let rule = best.appliedRule, let cap = rule.capUsdPerYear,
           let used = Self.capEntry(options, cardId: card.id, category: rule.category)?.usedUsd,
           used >= 0.9 * cap, used < cap {
            warnings.append(EngineWarning(code: .capNearLimit, message: "\(card.name) is near its $\(Self.formatNumber(cap)) yearly cap \(Categories.phrase(rule.category))."))
        }
        if best.appliedRule?.verify == true {
            warnings.append(EngineWarning(code: .verifyRule, message: "Check this rate against \(card.name)'s current terms."))
        }
        if foreign, card.verify?.contains("foreignFeePct") == true {
            warnings.append(EngineWarning(code: .verifyCard, message: "Confirm \(card.name)'s foreign transaction fee."))
        }
        if merchant?.verify == true {
            warnings.append(EngineWarning(code: .verifyMerchant, message: "This merchant's category is a best guess; the bank may code it differently."))
        }

        return Recommendation(
            cardId: best.cardId, rate: best.rate, centsPerDollar: best.centsPerDollar, basis: best.basis,
            category: category, foreign: foreign,
            reason: reason(for: best, card: card, category: category, foreign: foreign),
            runnerUp: runner.map { RunnerUp(cardId: $0.cardId, centsPerDollar: $0.centsPerDollar) },
            warnings: warnings, merchant: merchant, ranked: ranked)
    }

    // MARK: Text (spec "Reason text", not compared by golden tests)

    /// Up to 4 decimals, trailing zeros dropped: 4, 1.5, 3.6.
    public static func formatNumber(_ x: Double) -> String {
        let r = round4(x)
        if r == r.rounded() { return String(Int(r)) }
        var s = String(format: "%.4f", r)
        while s.hasSuffix("0") { s.removeLast() }
        return s
    }

    /// One decimal, ".0" dropped: "8", "3.6".
    public static func formatCentsShort(_ cents: Double) -> String {
        let r = (cents * 10).rounded(.toNearestOrAwayFromZero) / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }

    /// "4x" for points cards, "3%" for cash back.
    public static func formatRate(_ rate: Double, currency: String) -> String {
        currency == "cash" ? "\(formatNumber(rate))%" : "\(formatNumber(rate))x"
    }

    /// One decimal always: "8.0".
    public static func formatCents(_ cents: Double) -> String {
        String(format: "%.1f", cents)
    }

    public func reason(for score: CardScore, card: Card, category: String, foreign: Bool) -> String {
        let rate = Self.formatRate(score.rate, currency: card.currency)
        let fee = foreign && card.foreignFeePct > 0 ? " after the \(Self.formatNumber(card.foreignFeePct))% foreign fee" : ""
        let value = "about \(Self.formatCentsShort(score.centsPerDollar)) cents per dollar\(fee)"
        if let perk = score.perkReason {
            return "Perk pick: \(perk) (\(rate), \(value))"
        }
        let cashBack = card.currency == "cash" ? " cash back" : ""
        if score.basis == .bonus {
            return "\(rate)\(cashBack) \(Categories.phrase(category)), \(value)"
        }
        return "\(rate)\(cashBack) on everything else, \(value)"
    }
}
