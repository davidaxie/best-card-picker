import Foundation
import BestCardEngine

/// The app's single source of truth: one JSON file in Documents, written with
/// complete file protection (unreadable while the phone is locked).
public struct DocumentStore: Sendable {
    public static let fileName = "best-card-picker.json"
    public let url: URL

    public init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        url = dir.appendingPathComponent(Self.fileName)
    }

    public func load() -> AppData? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONCoding.decoder.decode(AppData.self, from: data)
    }

    public func save(_ appData: AppData) throws {
        let data = try JSONCoding.encoder.encode(appData)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: [.atomic])
        #endif
    }

    public func delete() {
        try? FileManager.default.removeItem(at: url)
    }
}

/// A copy of what the widget, the App Intent and background region alerts
/// need, in the App Group container. It must be readable while the phone is
/// locked (a geofence fires with the phone in a pocket), so it uses
/// "complete until first unlock" protection instead of "complete". It holds
/// card names and public earn rates, saved place names and coordinates, and
/// the last answer shown. Never card numbers.
public struct SharedSnapshot: Codable, Equatable, Sendable {
    public var appData: AppData
    public var lastAnswer: LastAnswer?

    public init(appData: AppData, lastAnswer: LastAnswer? = nil) {
        self.appData = appData
        self.lastAnswer = lastAnswer
    }
}

public struct LastAnswer: Codable, Equatable, Sendable {
    public var placeName: String
    public var cardName: String
    public var shortCode: String?
    public var rateText: String
    public var centsText: String
    public var reason: String
    public var date: Date

    public init(placeName: String, cardName: String, shortCode: String?, rateText: String, centsText: String, reason: String, date: Date) {
        self.placeName = placeName
        self.cardName = cardName
        self.shortCode = shortCode
        self.rateText = rateText
        self.centsText = centsText
        self.reason = reason
        self.date = date
    }
}

public struct SnapshotStore: Sendable {
    public static let appGroup = "group.com.davidxie.bestcardpicker"
    public static let fileName = "snapshot.json"
    public let url: URL?

    public init(directory: URL? = nil) {
        if let directory {
            url = directory.appendingPathComponent(Self.fileName)
        } else {
            url = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)?
                .appendingPathComponent(Self.fileName)
        }
    }

    public func load() -> SharedSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONCoding.decoder.decode(SharedSnapshot.self, from: data)
    }

    public func save(_ snapshot: SharedSnapshot) throws {
        guard let url else { return }
        let data = try JSONCoding.encoder.encode(snapshot)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: [.atomic])
        #endif
    }

    public func delete() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

public enum JSONCoding {
    public static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }

    public static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    /// cards.json for export: same schema the extension reads.
    public static func exportCards(_ file: CardsFile) throws -> Data {
        try encoder.encode(file)
    }
}
