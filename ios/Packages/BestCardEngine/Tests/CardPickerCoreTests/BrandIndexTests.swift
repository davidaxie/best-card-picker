import Foundation
import MapKit
import Testing
import BestCardEngine
@testable import CardPickerCore

@Suite("Bundled brand list (brands.json)")
struct BrandIndexTests {
    let brands = BrandIndex.shared
    let engine = AppData.defaults().engine

    @Test func loadsThousandsOfBrands() {
        #expect(brands.count > 3000)
    }

    @Test func everyEntryIsValid() {
        let merchants = BrandIndex.loadBundled()
        let known = Set(Categories.all)
        let unknown = merchants.filter { !known.contains($0.category) }.map(\.match)
        #expect(unknown.isEmpty, "unknown categories: \(unknown.prefix(5))")
        // Keys must be exactly what the engine's normalize produces.
        let off = merchants.filter { Engine.normalize($0.match) != $0.match }.map(\.match)
        #expect(off.isEmpty, "not normalized: \(off.prefix(5))")
        // Walmart and Target are never supermarkets, under any store name.
        let wt = merchants.filter { $0.match.split(separator: " ").contains { $0 == "walmart" || $0 == "target" } }
        #expect(wt.allSatisfy { $0.category == "general" })
    }

    @Test func walmartAndTargetAreNeverSupermarkets() {
        for name in ["Walmart Neighborhood Market", "Walmart Supercenter", "Super Target", "Target"] {
            let r = PlaceCategoryMapper.resolve(name: name, poi: .foodMarket, rememberedCategory: nil, engine: engine)
            #expect(r.category == "general", "\(name) -> \(r.category)")
        }
    }

    @Test func wholeNameOnly() {
        #expect(brands.lookup("McDonald's")?.category == "restaurant")
        #expect(brands.lookup("Circle K")?.category == "gas_ev")
        #expect(brands.lookup("Circle K 2741")?.category == "gas_ev")      // store number
        #expect(brands.lookup("Home Depot")?.category == "general")        // stored as "The Home Depot"
        #expect(brands.lookup("Kings")?.category == "us_supermarket")
        #expect(brands.lookup("Kings BBQ") == nil)                           // no prefix match
        // An NSI alias takes its brand's main category, unless it names fuel.
        #expect(brands.lookup("Tops Friendly Markets")?.category == "us_supermarket")
        #expect(brands.lookup("Tops Gas")?.category == "gas_ev")
    }

    @Test func resolverOrder() {
        // A bundled brand beats the MapKit guess...
        let k = PlaceCategoryMapper.resolve(name: "Circle K", poi: .store, rememberedCategory: nil, engine: engine)
        #expect(k.category == "gas_ev" && k.source == .brand)
        // ...but an unknown name falls through to MapKit.
        let bbq = PlaceCategoryMapper.resolve(name: "Kings BBQ", poi: .restaurant, rememberedCategory: nil, engine: engine)
        #expect(bbq.category == "restaurant" && bbq.source == .mapKit)
        // Curated merchants.json still wins over the bundled list.
        let tj = PlaceCategoryMapper.resolve(name: "Trader Joe's", poi: nil, rememberedCategory: nil, engine: engine)
        #expect(tj.category == "us_supermarket" && tj.source == .brand)
    }

    @Test func searchRanksCuratedAndPrefixFirst() {
        let tj = brands.search("trader")
        #expect(tj.first?.name == "Trader Joe's" && tj.first?.curated == true)
        let mc = brands.search("mcdon")
        #expect(mc.first?.name == "McDonald's" && mc.first?.category == "restaurant")
        #expect(brands.search("chevr").first?.category == "gas_ev")
        // "Mac's" is an NSI alias of Circle K (general); search lists Circle K once.
        #expect(brands.search("circle k").filter { $0.name == "Circle K" }.map(\.category) == ["gas_ev"])
        #expect(brands.search("x").isEmpty)                  // too short
        #expect(brands.search("cafe rio").contains { $0.category == "restaurant" })
    }

    @Test func searchAnswerUsesTheHitCategory() throws {
        let data = AppData.defaults()
        let hit = try #require(brands.search("safeway").first)
        let answer = try #require(data.answer(for: PurchaseContext(category: hit.category, merchant: hit.name, channel: .inStore)))
        #expect(answer.card.id == data.cardsFile.cards.first { $0.shortCode == "GOLD" }?.id)
    }
}
