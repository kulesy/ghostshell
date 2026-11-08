import GhostShellKit
@preconcurrency import UserNotifications
#if os(macOS)
import AppKit
#endif

/// Posts through the system notification centre and hears the click. The app sets it as the centre's delegate at launch.
@MainActor
public final class UserNotificationPoster: NSObject, AlertPoster {
    public var onOpen: ((String) -> Void)?
    private let center: UNUserNotificationCenter

    public override init() {
        center = .current()
        super.init()
        center.delegate = self
    }

    public func requestAuthorization() async {
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
    }

    public func isDenied() async -> Bool { await center.notificationSettings().authorizationStatus == .denied }

    public func post(_ alert: SessionAlert) {
        let content = UNMutableNotificationContent()
        content.title = alert.title
        content.body = alert.kind.text
        content.sound = .default
        content.threadIdentifier = alert.sessionID
        content.userInfo = [Self.sessionKey: alert.sessionID]
        // The id is the session's, so a newer alert for a session replaces its older one.
        center.add(UNNotificationRequest(identifier: alert.sessionID, content: content, trigger: nil))
    }

    public func withdraw(_ sessionIDs: [String]) { center.removeDeliveredNotifications(withIdentifiers: sessionIDs) }

    public func setBadge(_ count: Int?) {
        #if os(macOS)
        NSApp.dockTile.badgeLabel = count.flatMap { $0 > 0 ? String($0) : nil }
        #endif
    }

    fileprivate nonisolated static let sessionKey = "sessionID"
}

extension UserNotificationPoster: UNUserNotificationCenterDelegate {
    // The session on screen is filtered out before posting, so anything that arrives here is worth showing even with the app in front.
    nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo[Self.sessionKey] as? String else { return }
        await MainActor.run { onOpen?(id) }
    }
}
