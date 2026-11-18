import SwiftUI

/// Holds what the detail pane shows. A screen puts itself there with `navigator.show { MyScreen() }`, so adding a screen
/// never edits a central list of destinations.
@Observable @MainActor
public final class Navigator {
    public private(set) var detail: AnyView?
    public private(set) var selectedSessionID: String?
    /// Which sidebar entry the screen belongs to ("routines", "scheduled" or "routine:<id>"), so the sidebar marks it as the page does. Nil for the rest.
    public private(set) var page: String?
    /// A layer over the detail pane that the image viewer and the force-restart question use. Set by whoever draws it.
    public var overlay: AnyView?
    /// How dark the sidebar goes while a layer is up, because the sidebar's list is drawn above anything in the window's own layer.
    public var overlayDim: Double = 0.5

    public init() {}

    /// Any screen shown here clears the chosen row, so choosing the same session again opens it.
    public func show<Content: View>(page: String? = nil, @ViewBuilder _ content: () -> Content) {
        detail = AnyView(content())
        selectedSessionID = nil
        self.page = page
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
        page = nil
    }
}
