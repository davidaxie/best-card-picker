import Foundation

/// Checks an imported cards.json before the app accepts it.
public enum CardsValidator {
    public struct Problem: Error, Equatable, Sendable, CustomStringConvertible {
        public var message: String
        public var description: String { message }
    }

    public static let networks: Set<String> = ["amex", "visa", "mastercard", "discover"]

    public static func decode(_ data: Data) throws -> CardsFile {
        try rejectCardNumbers(data)
        let file: CardsFile
        do {
            file = try JSONDecoder().decode(CardsFile.self, from: data)
        } catch {
            throw Problem(message: "Not a cards.json file: \(error.localizedDescription)")
        }
        let problems = validate(file)
        if let first = problems.first { throw first }
        return file
    }

    public static func validate(_ file: CardsFile) -> [Problem] {
        var out: [Problem] = []
        if file.cards.isEmpty { out.append(Problem(message: "The file has no cards.")) }
        var seen = Set<String>()
        let known = Set(Categories.all)
        for card in file.cards {
            if card.id.isEmpty { out.append(Problem(message: "A card has no id.")) }
            if !seen.insert(card.id).inserted { out.append(Problem(message: "Duplicate card id \(card.id).")) }
            if !networks.contains(card.network.lowercased()) {
                out.append(Problem(message: "\(card.name): unknown network \(card.network)."))
            }
            if file.pointValuesCents[card.currency] == nil {
                out.append(Problem(message: "\(card.name): no point value for \(card.currency)."))
            }
            if card.baseRate < 0 || card.foreignFeePct < 0 {
                out.append(Problem(message: "\(card.name): rates and fees cannot be negative."))
            }
            if let last = card.last4, !(last.count == 4 && last.allSatisfy(\.isNumber)) {
                out.append(Problem(message: "\(card.name): last4 must be exactly 4 digits."))
            }
            for perk in card.preferredFor ?? [] where !known.contains(perk.category) {
                out.append(Problem(message: "\(card.name): unknown perk category \(perk.category)."))
            }
            for rule in card.rules {
                if !known.contains(rule.category) {
                    out.append(Problem(message: "\(card.name): unknown category \(rule.category)."))
                }
                if rule.rate < 0 { out.append(Problem(message: "\(card.name): negative rate.")) }
            }
        }
        for m in file.merchants ?? [] where !known.contains(m.category) {
            out.append(Problem(message: "Merchant \(m.match): unknown category \(m.category)."))
        }
        return out
    }

    /// Privacy rule 1: never accept anything that looks like a card number
    /// (a run of 12 or more digits, allowing spaces or dashes between groups).
    public static func rejectCardNumbers(_ data: Data) throws {
        guard let text = String(data: data, encoding: .utf8) else { return }
        if containsCardNumber(text) {
            throw Problem(message: "The file contains something that looks like a card number. Card numbers are never stored.")
        }
    }

    public static func containsCardNumber(_ text: String) -> Bool {
        var digits = 0
        for ch in text {
            if ch.isASCII && ch.isNumber { digits += 1; if digits >= 12 { return true } }
            else if ch == " " || ch == "-" { continue }
            else { digits = 0 }
        }
        return false
    }
}
