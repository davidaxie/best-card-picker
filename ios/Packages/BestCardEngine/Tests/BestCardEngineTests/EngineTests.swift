import Foundation
import Testing
@testable import BestCardEngine

@Suite("Engine details")
struct EngineTests {
    let engine = Fixtures.engine

    @Test func normalizeMatchesBrandSpellings() {
        #expect(Engine.normalize("Trader Joe’s #552") == "trader joes 552")
        #expect(Engine.normalize("  H-E-B plus! ") == "h e b plus")
        #expect(Engine.normalize("Stop & Shop") == "stop shop")
    }

    @Test func hostExtraction() {
        #expect(Engine.merchantKey("https://Smile.Amazon.com:443/gp/cart?x=1") == .host("smile.amazon.com"))
        #expect(Engine.merchantKey("amazon.com.") == .host("amazon.com"))
        #expect(Engine.merchantKey("Trader Joe's") == .name("Trader Joe's"))
        #expect(Engine.merchantKey("St. Louis Bread Co") == .name("St. Louis Bread Co"))
        #expect(engine.merchant(for: "travelsecure.chase.com")?.match == "travelsecure.chase.com")
        #expect(engine.merchant(for: "com") == nil)
    }

    @Test func reasonText() {
        let gold = engine.recommend(PurchaseContext(category: "restaurant"))
        #expect(gold.reason == "4x at restaurants, about 8 cents per dollar")
        let bce = engine.recommend(PurchaseContext(merchant: "amazon.com", channel: .online))
        #expect(bce.reason == "3% cash back on US online retail, about 3 cents per dollar")
        let base = engine.recommend(PurchaseContext(category: "general"))
        #expect(base.reason == "1.5x on everything else, about 3 cents per dollar")
        let ua = engine.recommend(PurchaseContext(merchant: "united.com", channel: .online))
        #expect(ua.reason == "Perk pick: free first checked bag and priority boarding on United (3x, about 3.6 cents per dollar)")
    }

    @Test func wholeWordMatchingAvoidsFalseHits() {
        // "arco" must not match "Marcos Pizza"; "shell" must not match "Shellfish".
        #expect(engine.merchant(for: "Marco's Pizza")?.match != "arco")
        #expect(engine.merchant(for: "The Shell Shop") == nil)
        #expect(engine.merchant(for: "Shellfish Shack")?.match != "shell")
        #expect(engine.merchant(for: "Costco Wholesale")?.match == "costco")
        #expect(engine.merchant(for: "Costco Gasoline")?.match == "costco gasoline")
        #expect(engine.merchant(for: "Whole Foods Market")?.category == "us_supermarket")
    }

    @Test func roundingMatchesJavaScript() {
        #expect(Engine.round4(1.2 * 3) == 3.6)
        #expect(Engine.round4(0.00005) == 0.0001)
        #expect(Engine.round4(-1.7) == -1.7)
        #expect(Engine.round4(-0.00001).sign == .plus)
    }

    @Test func everyCategoryAnswersFast() {
        // Category grid must answer in under 200 ms; the engine is far below that.
        let clock = ContinuousClock()
        let elapsed = clock.measure {
            for _ in 0..<10 {
                for category in Categories.all {
                    _ = engine.recommend(PurchaseContext(category: category, channel: .inStore))
                }
            }
        }
        #expect(elapsed < .milliseconds(200), "180 recommendations took \(elapsed)")
    }

    @Test func validatorRejectsCardNumbers() {
        #expect(CardsValidator.containsCardNumber("4111 1111 1111 1111"))
        #expect(CardsValidator.containsCardNumber("{\"note\":\"5500-0000-0000-0004\"}"))
        #expect(!CardsValidator.containsCardNumber("\"updated\": \"2026-11-18\", \"capUsdPerYear\": 50000"))
        let bundled = try! Data(contentsOf: BundledData.cardsURL!)
        #expect(throws: Never.self) { _ = try CardsValidator.decode(bundled) }
    }

    /// SCHEMA_CHANGES.md 2026-11-19: last4 takes 4 or 5 digits (Amex shows 5).
    /// Digits here are made up.
    @Test func last4AcceptsFourOrFiveDigits() throws {
        func problems(_ last4: String) -> [CardsValidator.Problem] {
            var file = engine.file
            file.cards[0].last4 = last4
            return CardsValidator.validate(file).filter { $0.message.contains("last4") }
        }
        #expect(problems("1234").isEmpty)
        #expect(problems("12345").isEmpty)
        for bad in ["123", "123456", "12a45", "12 45", "١٢٣٤"] {
            #expect(!problems(bad).isEmpty, "\(bad) should be rejected")
        }
        // An extension export carrying a 5-digit ending imports cleanly.
        var file = engine.file
        file.cards[0].last4 = "98765"
        let again = try CardsValidator.decode(try JSONEncoder().encode(file))
        #expect(again.cards[0].last4 == "98765")
    }

    @Test func exportReimportChangesNothing() throws {
        let original = engine.file
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(original)
        let again = try CardsValidator.decode(data)
        #expect(again == original)
        for c in Fixtures.golden.cases {
            let a = engine.recommend(c.input, options: c.options ?? .init())
            let b = Engine(file: again, extraMerchants: engine.merchantLists[1]).recommend(c.input, options: c.options ?? .init())
            #expect(a == b, "\(c.id)")
        }
    }
}
