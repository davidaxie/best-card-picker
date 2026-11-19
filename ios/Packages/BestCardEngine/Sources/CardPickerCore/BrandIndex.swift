import Foundation
import BestCardEngine

/// About 3,900 US chains bundled with the app (Resources/brands.json, built by
/// ios/scripts/build-brands.py from the name-suggestion-index), plus the
/// curated brands from cards.json and merchants.json.
///
/// Two uses, both fully offline:
/// - `lookup` names the category of a place Apple Maps found. Bundled brands
///   only match a whole name ("Kings", or "Kings 1234" with a store number),
///   never a prefix, so "Kings BBQ" is not taken for the Kings supermarket.
///   Curated brands keep the engine's own prefix rule and are checked first.
/// - `search` powers "Where are you?" on the Pick tab: type a store name, get
///   the card, no location needed.
public struct BrandIndex: Sendable {
    public struct Hit: Identifiable, Hashable, Sendable {
        public var name: String
        public var category: String
        /// From cards.json or merchants.json (reviewed by hand).
        public var curated: Bool
        public var verify: Bool
        public var id: String { "\(name)|\(category)" }
    }

    private struct Entry: Sendable {
        var hit: Hit
        var key: String        // folded, normalized display name
        var altKey: String     // folded, normalized match key (an alias)
    }

    public static let shared = BrandIndex(bundled: Self.loadBundled(), curated: DefaultData.curatedBrands())

    private let byKey: [String: Merchant]
    private let entries: [Entry]
    public var count: Int { byKey.count }

    public init(bundled: [Merchant], curated: [Merchant]) {
        var map: [String: Merchant] = [:]
        for m in bundled where map[m.match] == nil { map[m.match] = m }
        byKey = map

        // Keys that are a brand's own name. An alias row ("macs", shown as
        // "Circle K") is left out of search when that name has its own row,
        // so search never lists the same store twice; lookup still uses it.
        let ownKeys = Set((curated + bundled).map { Self.fold($0.match) })
        var seen = Set<String>()
        var list: [Entry] = []
        for (m, isCurated) in curated.map({ ($0, true) }) + bundled.map({ ($0, false) }) {
            let name = m.name ?? m.match.capitalized
            let hit = Hit(name: name, category: m.category, curated: isCurated, verify: m.verify ?? false)
            let key = Self.fold(name)
            if !isCurated, key != Self.fold(m.match), ownKeys.contains(key) { continue }
            // One row per store name and category, curated first.
            guard seen.insert("\(key)|\(m.category)").inserted else { continue }
            list.append(Entry(hit: hit, key: key, altKey: Self.fold(m.match)))
        }
        entries = list
    }

    /// Category for a place name from Apple Maps, or nil.
    public func lookup(_ placeName: String) -> Merchant? {
        for candidate in Self.candidates(placeName) {
            if let m = byKey[candidate] { return m }
        }
        return nil
    }

    /// Ranked store-name search: exact, then starts-with, then a word that
    /// starts with the query, then contains. Accents and case are ignored.
    public func search(_ query: String, limit: Int = 25) -> [Hit] {
        let q = Self.fold(query)
        guard q.count >= 2 else { return [] }
        var scored: [(Int, Entry)] = []
        for e in entries {
            let s = min(Self.score(e.key, q), Self.score(e.altKey, q))
            if s < 4 { scored.append((s, e)) }
        }
        scored.sort { a, b in
            if a.0 != b.0 { return a.0 < b.0 }
            if a.1.hit.curated != b.1.hit.curated { return a.1.hit.curated }
            return a.1.hit.name.count < b.1.hit.name.count
        }
        var out: [Hit] = []
        var names = Set<String>()
        for (_, e) in scored where names.insert("\(e.key)|\(e.hit.category)").inserted {
            out.append(e.hit)
            if out.count == limit { break }
        }
        return out
    }

    // MARK: Helpers

    private static func score(_ key: String, _ q: String) -> Int {
        if key == q { return 0 }
        if key.hasPrefix(q) { return 1 }
        if key.split(separator: " ").contains(where: { $0.hasPrefix(q) }) { return 2 }
        if q.count >= 3, key.contains(q) { return 3 }
        return 4
    }

    /// Engine.normalize after folding accents, for search only.
    static func fold(_ s: String) -> String {
        Engine.normalize(s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil))
    }

    /// The keys a place name could be stored under: as the engine normalizes
    /// it, accent-folded, without a trailing store number, without "The".
    static func candidates(_ placeName: String) -> [String] {
        var out: [String] = []
        for base in [Engine.normalize(placeName), fold(placeName)] where !base.isEmpty {
            var words = base.split(separator: " ").map(String.init)
            out.append(words.joined(separator: " "))
            if words.count > 1, words.last!.allSatisfy(\.isNumber) {
                words.removeLast()
                out.append(words.joined(separator: " "))
            }
            if words.first == "the", words.count > 1 {
                out.append(words.dropFirst().joined(separator: " "))
            } else {
                out.append((["the"] + words).joined(separator: " "))
            }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    static func loadBundled() -> [Merchant] {
        guard let url = Bundle.module.url(forResource: "brands", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(MerchantsFile.self, from: data) else { return [] }
        return file.merchants
    }
}
