import Foundation

/// What a widget's web view may navigate to. The only loads are the host page, then the widget's own `about:srcdoc` frame. Anything else means the widget
/// tried to leave, so it is closed, as the web page closes a frame that loads a second time.
public struct WidgetNavigation: Sendable, Equatable {
    public enum Verdict: Sendable, Equatable { case allow, cancel, close }

    private var hostLoaded = false
    private var frameLoaded = false

    public init() {}

    /// `inNewWindow` is true when the navigation has no frame to land in, such as a request to open a window.
    public mutating func decide(url: URL?, mainFrame: Bool, inNewWindow: Bool) -> Verdict {
        if inNewWindow { return .cancel }
        let address = url?.absoluteString.lowercased() ?? ""
        if mainFrame {
            guard !hostLoaded, address == "about:blank" else { return .close }
            hostLoaded = true
            return .allow
        }
        switch address {
        case "about:srcdoc":
            guard !frameLoaded else { return .close }
            frameLoaded = true
            return .allow
        case "about:blank": return .allow
        default: return .close
        }
    }
}
