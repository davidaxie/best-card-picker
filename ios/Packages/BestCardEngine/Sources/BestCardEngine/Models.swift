import Foundation

// Mirrors src/engine/types.ts (the TypeScript engine). Field names match the
// cards.json schema exactly so files round-trip between the extension and the
// iPhone app.

// MARK: - cards.json

public struct CardsFile: Codable, Equatable, Sendable {
    public var version: Int
    public var updated: String
    public var pointValuesCents: [String: Double]
    public var cards: [Card]
    public var merchants: [Merchant]?

    public init(version: Int, updated: String, pointValuesCents: [String: Double], cards: [Card], merchants: [Merchant]? = nil) {
        self.version = version
        self.updated = updated
        self.pointValuesCents = pointValuesCents
        self.cards = cards
        self.merchants = merchants
    }
}

public struct Card: Codable, Equatable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var shortCode: String?
    /// Badge color, "#RRGGBB".
    public var color: String?
    public var network: String
    public var currency: String
    public var foreignFeePct: Double
    public var baseRate: Double
    public var rules: [Rule]
    /// Categories where this card ranks first regardless of points.
    public var preferredFor: [PerkPreference]?
    /// nil or true means enabled.
    public var enabled: Bool?
    /// Optional last 4 or 5 digits (Amex shows 5), never more (PRD privacy
    /// rule 1). The name stays `last4` for schema compatibility.
    public var last4: String?
    /// Field names to double-check against issuer terms, e.g. ["foreignFeePct"].
    public var verify: [String]?
    public var note: String?

    public init(id: String, name: String, shortCode: String? = nil, color: String? = nil, network: String, currency: String, foreignFeePct: Double, baseRate: Double, rules: [Rule], preferredFor: [PerkPreference]? = nil, enabled: Bool? = nil, last4: String? = nil, verify: [String]? = nil, note: String? = nil) {
        self.id = id
        self.name = name
        self.shortCode = shortCode
        self.color = color
        self.network = network
        self.currency = currency
        self.foreignFeePct = foreignFeePct
        self.baseRate = baseRate
        self.rules = rules
        self.preferredFor = preferredFor
        self.enabled = enabled
        self.last4 = last4
        self.verify = verify
        self.note = note
    }

    public var isEnabled: Bool { enabled ?? true }
}

public struct Rule: Codable, Equatable, Hashable, Sendable {
    public var category: String
    public var rate: Double
    public var capUsdPerYear: Double?
    /// Dropped for foreign purchases (Blue Cash Everyday's 3%).
    public var usOnly: Bool?
    public var verify: Bool?
    public var note: String?

    public init(category: String, rate: Double, capUsdPerYear: Double? = nil, usOnly: Bool? = nil, verify: Bool? = nil, note: String? = nil) {
        self.category = category
        self.rate = rate
        self.capUsdPerYear = capUsdPerYear
        self.usOnly = usOnly
        self.verify = verify
        self.note = note
    }
}

public struct PerkPreference: Codable, Equatable, Hashable, Sendable {
    public var category: String
    public var reason: String

    public init(category: String, reason: String) {
        self.category = category
        self.reason = reason
    }
}

public struct Merchant: Codable, Equatable, Hashable, Sendable {
    public var match: String
    public var name: String?
    public var category: String
    public var inStoreNetworks: [String]?
    public var onlineNetworks: [String]?
    public var mayNotTakeAmex: Bool?
    public var verify: Bool?
    public var note: String?

    public init(match: String, name: String? = nil, category: String, inStoreNetworks: [String]? = nil, onlineNetworks: [String]? = nil, mayNotTakeAmex: Bool? = nil, verify: Bool? = nil, note: String? = nil) {
        self.match = match
        self.name = name
        self.category = category
        self.inStoreNetworks = inStoreNetworks
        self.onlineNetworks = onlineNetworks
        self.mayNotTakeAmex = mayNotTakeAmex
        self.verify = verify
        self.note = note
    }
}

public struct MerchantsFile: Codable, Equatable, Sendable {
    public var version: Int
    public var updated: String
    public var merchants: [Merchant]

    public init(version: Int = 1, updated: String = "", merchants: [Merchant]) {
        self.version = version
        self.updated = updated
        self.merchants = merchants
    }
}

// MARK: - Engine input

public enum Channel: String, Codable, Sendable {
    case online
    case inStore = "in_store"
}

public struct PurchaseContext: Codable, Equatable, Hashable, Sendable {
    /// When nil, the merchant's category is used, else general.
    public var category: String?
    /// A domain or host (smile.amazon.com) or a place name (Trader Joe's).
    public var merchant: String?
    public var channel: Channel
    public var foreign: Bool?
    /// ISO 4217 code of the price. Anything other than USD makes it foreign.
    public var currency: String?
    /// ISO 3166 alpha-2 country. Anything other than US makes it foreign.
    public var country: String?
    /// Hard acceptance list; overrides the merchant's list.
    public var acceptedNetworks: [String]?
    /// Soft flag: warn when the pick is an Amex card.
    public var mayNotTakeAmex: Bool?

    public init(category: String? = nil, merchant: String? = nil, channel: Channel = .inStore, foreign: Bool? = nil, currency: String? = nil, country: String? = nil, acceptedNetworks: [String]? = nil, mayNotTakeAmex: Bool? = nil) {
        self.category = category
        self.merchant = merchant
        self.channel = channel
        self.foreign = foreign
        self.currency = currency
        self.country = country
        self.acceptedNetworks = acceptedNetworks
        self.mayNotTakeAmex = mayNotTakeAmex
    }
}

public struct CapEntry: Codable, Equatable, Hashable, Sendable {
    public var reached: Bool?
    public var usedUsd: Double?

    public init(reached: Bool? = nil, usedUsd: Double? = nil) {
        self.reached = reached
        self.usedUsd = usedUsd
    }
}

/// capState[cardId][category]
public typealias CapState = [String: [String: CapEntry]]

public struct EngineOptions: Codable, Equatable, Sendable {
    /// Default true: on a value tie, a cash-back card beats a points card.
    public var preferCashOnTie: Bool?
    /// Merged over cardsFile.pointValuesCents.
    public var pointValuesCents: [String: Double]?
    public var disabledCards: [String]?
    public var capState: CapState?

    public init(preferCashOnTie: Bool? = nil, pointValuesCents: [String: Double]? = nil, disabledCards: [String]? = nil, capState: CapState? = nil) {
        self.preferCashOnTie = preferCashOnTie
        self.pointValuesCents = pointValuesCents
        self.disabledCards = disabledCards
        self.capState = capState
    }
}

// MARK: - Engine output

public enum Basis: String, Codable, Sendable {
    case bonus, base, perk
}

public enum WarningCode: String, Codable, Sendable, CaseIterable {
    case foreignFees = "foreign_fees"
    case mayNotTakeAmex = "may_not_take_amex"
    case capNearLimit = "cap_near_limit"
    case verifyRule = "verify_rule"
    case verifyCard = "verify_card"
    case verifyMerchant = "verify_merchant"
    case noAcceptedCard = "no_accepted_card"
}

public struct EngineWarning: Codable, Equatable, Sendable {
    public var code: WarningCode
    public var message: String
}

public struct CardScore: Codable, Equatable, Sendable {
    public var cardId: String
    public var rate: Double
    public var centsPerDollar: Double
    public var basis: Basis
    public var appliedRule: Rule?
    public var perkReason: String?
}

public struct RunnerUp: Codable, Equatable, Sendable {
    public var cardId: String
    public var centsPerDollar: Double
}

public struct Recommendation: Codable, Equatable, Sendable {
    public var cardId: String?
    public var rate: Double?
    public var centsPerDollar: Double?
    public var basis: Basis?
    public var category: String
    public var foreign: Bool
    public var reason: String
    public var runnerUp: RunnerUp?
    public var warnings: [EngineWarning]
    public var merchant: Merchant?
    /// All accepted cards, best first.
    public var ranked: [CardScore]
}
