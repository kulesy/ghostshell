import Foundation

/// Which widget, if any, the owner last used, and when. Only the latest counts: a click or key anywhere else ends the claim. Widgets are told apart
/// by an id the app hands out, and times are milliseconds on the one clock the widget layer shares.
public struct WidgetClaim: Sendable, Equatable {
    private var owner: Int?
    private var last: Double?

    public init() {}

    /// A click, landing in the widget with this id or (nil) anywhere else.
    public mutating func click(_ widget: Int?, at now: Double) {
        owner = widget
        last = now
    }

    /// A key press with focus in the widget with this id, or (nil) outside any widget. Browsers give no user activation for Escape or for a Command or
    /// Control shortcut, so those leave the claim as it was.
    public mutating func key(_ widget: Int?, escape: Bool, command: Bool, control: Bool, at now: Double) {
        if widget != nil, escape || command || control { return }
        click(widget, at: now)
    }

    /// The widget with this id was the last thing the owner used, within `activeMs`.
    public func isActive(_ widget: Int, at now: Double) -> Bool {
        guard owner == widget, let last else { return false }
        return now - last <= WidgetRules.activeMs
    }

    /// Ends this widget's claim, such as when its request was just cancelled or confirmed.
    public mutating func forget(_ widget: Int) {
        guard owner == widget else { return }
        owner = nil
        last = nil
    }
}
