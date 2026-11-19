import Foundation
import Testing
@testable import BestCardEngine

/// Runs every case in data/golden_tests.json (bundled copy) against the Swift
/// engine. The TypeScript engine runs the same file with `npm test`.
/// Compared: cardId, rate, centsPerDollar (1e-9), basis, category, runnerUp,
/// and warnings as a set of codes. Reason text is not compared.
struct GoldenFile: Decodable, Sendable {
    struct Case: Decodable, Sendable {
        var id: String
        var description: String?
        var input: PurchaseContext
        var options: EngineOptions?
        var expected: Expected
    }

    struct Expected: Decodable, Sendable {
        var cardId: String?
        var rate: Double?
        var centsPerDollar: Double?
        var basis: Basis?
        var category: String
        var runnerUp: RunnerUp?
        var warnings: [WarningCode]
    }

    var version: Int
    var cases: [Case]
}

enum Fixtures {
    static func url(_ name: String, bundle: Bundle) -> URL {
        bundle.url(forResource: name, withExtension: "json")!
    }

    static let golden: GoldenFile = {
        let data = try! Data(contentsOf: url("golden_tests", bundle: .module))
        return try! JSONDecoder().decode(GoldenFile.self, from: data)
    }()

    static let engine: Engine = {
        let cards = try! JSONDecoder().decode(CardsFile.self, from: Data(contentsOf: BundledData.cardsURL!))
        let merchants = try! JSONDecoder().decode(MerchantsFile.self, from: Data(contentsOf: BundledData.merchantsURL!))
        return Engine(file: cards, extraMerchants: merchants.merchants)
    }()
}

extension GoldenFile.Case: CustomTestStringConvertible {
    var testDescription: String { id }
}

@Suite("Golden tests (data/golden_tests.json)")
struct GoldenTests {
    @Test("golden file has cases")
    func fileLoads() {
        #expect(Fixtures.golden.cases.count >= 30)
    }

    @Test("golden case", arguments: Fixtures.golden.cases)
    func goldenCase(_ c: GoldenFile.Case) {
        let rec = Fixtures.engine.recommend(c.input, options: c.options ?? EngineOptions())
        let e = c.expected
        #expect(rec.cardId == e.cardId, "\(c.id): cardId")
        #expect(rec.rate == e.rate, "\(c.id): rate")
        #expect(close(rec.centsPerDollar, e.centsPerDollar), "\(c.id): centsPerDollar \(String(describing: rec.centsPerDollar)) vs \(String(describing: e.centsPerDollar))")
        #expect(rec.basis == e.basis, "\(c.id): basis")
        #expect(rec.category == e.category, "\(c.id): category")
        #expect(rec.runnerUp?.cardId == e.runnerUp?.cardId, "\(c.id): runnerUp.cardId")
        #expect(close(rec.runnerUp?.centsPerDollar, e.runnerUp?.centsPerDollar), "\(c.id): runnerUp.centsPerDollar")
        #expect(Set(rec.warnings.map(\.code)) == Set(e.warnings), "\(c.id): warnings \(rec.warnings.map(\.code.rawValue))")
    }

    func close(_ a: Double?, _ b: Double?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case let (x?, y?): return abs(x - y) <= 1e-9
        default: return false
        }
    }
}
