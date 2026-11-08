import GhostShellKit

/// Where alerts go. The Mac app uses the notification centre. The test run swaps in a poster that writes to a file.
@MainActor
public protocol AlertPoster: AnyObject {
    /// Set by the notifier. The poster calls it with a session id when the person clicks that session's alert.
    var onOpen: ((String) -> Void)? { get set }
    /// Asks macOS for permission to notify. Safe to call again, because macOS only asks the person once.
    func requestAuthorization() async
    /// True when the person has turned notifications off for the app in System Settings.
    func isDenied() async -> Bool
    /// Shows the alert, replacing an older one for the same session.
    func post(_ alert: SessionAlert)
    func withdraw(_ sessionIDs: [String])
    /// The number on the Dock icon, or nil for none.
    func setBadge(_ count: Int?)
}
