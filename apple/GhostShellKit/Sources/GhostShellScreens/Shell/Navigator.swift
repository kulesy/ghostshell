import SwiftUI

/// Holds what the detail pane shows. A screen puts itself there with `navigator.show { MyScreen() }`, so adding a screen
/// never edits a central list of destinations.
@Observable @MainActor
public final class Navigator {
    public private(set) var detail: AnyView?
    public private(set) var selectedSessionID: String?
    /// Which sidebar entry the screen belongs to ("routines", "scheduled" or "routine:<id>"), so the sidebar marks it as the page does. Nil for the rest.
    public private(set) var page: String?
    /// A layer over the detail pane that the image viewer and the force-restart question use. Each draws and removes only its own, through `raise` and `lower`.
    public private(set) var overlay: AnyView?
    /// How dark the sidebar goes while a layer is up, because the sidebar's list is drawn above anything in the window's own layer.
    public private(set) var overlayDim = 0.5
    private var overlayOwner: String?

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

    public func raise(_ owner: String, dim: Double = 0.5, _ layer: AnyView) {
        overlay = layer
        overlayDim = dim
        overlayOwner = owner
    }

    /// Takes the layer down only if `owner` put it up, so a chat leaving the screen cannot remove another screen's dialog.
    public func lower(_ owner: String) {
        guard overlayOwner == owner else { return }
        overlay = nil
        overlayOwner = nil
    }

    /// Back to the empty pane.
    public func clear() {
        overlay = nil
        overlayOwner = nil
        detail = nil
        selectedSessionID = nil
        page = nil
    }
}
