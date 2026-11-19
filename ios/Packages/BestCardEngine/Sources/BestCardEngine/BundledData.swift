import Foundation

/// URLs of the bundled copies of data/cards.json and data/merchants.json.
public enum BundledData {
    public static var cardsURL: URL? { Bundle.module.url(forResource: "cards", withExtension: "json") }
    public static var merchantsURL: URL? { Bundle.module.url(forResource: "merchants", withExtension: "json") }
}
