import Foundation
import UserNotifications
import CardPickerCore

enum Notifications {
    @discardableResult
    static func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }

    /// "Trader Joe's: use Amex Gold (4x)"
    static func postArrival(placeName: String, answer: Answer, placeId: String) async {
        let content = UNMutableNotificationContent()
        content.title = answer.notificationText(placeName: placeName)
        content.body = [answer.reasonLine, answer.runnerUpLine].compactMap { $0 }.joined(separator: "\n")
        content.sound = .default
        content.threadIdentifier = "arrival"
        content.interruptionLevel = .active
        let request = UNNotificationRequest(identifier: "arrival-\(placeId)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    static func removeAll() {
        let c = UNUserNotificationCenter.current()
        c.removeAllPendingNotificationRequests()
        c.removeAllDeliveredNotifications()
    }
}
