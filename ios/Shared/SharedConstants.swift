import Foundation

/// Names shared by the app and the widget extension.
enum Shared {
    static let appGroup = "group.com.davidxie.bestcardpicker"
    static let widgetKind = "WhichCardHereWidget"
    static let controlKind = "com.davidxie.bestcardpicker.whichcard"
    /// Set by the Control Center control; the app shows the "here" sheet.
    static let pendingHereKey = "pendingHere"
    static let hereURL = URL(string: "bestcard://here")!

    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }
}
