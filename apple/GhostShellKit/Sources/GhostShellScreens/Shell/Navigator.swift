import SwiftUI

/// Holds what the detail pane shows. A screen puts itself there with `navigator.show { MyScreen() }`, so adding a screen
/// never edits a central list of destinations.
@Observable @MainActor
public final class Navigator {
    public private(set) var detail: AnyView?
    public private(set) var selectedSessionID: String?

    public init() {}

    /// Any screen shown here clears the chosen row, so choosing the same session again opens it.
    public func show<Content: View>(@ViewBuilder _ content: () -> Content) {
        detail = AnyView(content())
        selectedSessionID = nil
    }

    /// Shows a session's chat and marks its row as chosen.
    public func openSession(_ id: String) {
        guard id != selectedSessionID else { return }
        show { ChatScreen(sessionID: id) }
        selectedSessionID = id
    }

    /// Back to the empty pane.
    public func clear() {
        detail = nil
        selectedSessionID = nil
    }
}
