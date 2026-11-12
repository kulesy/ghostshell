#if os(iOS)
import GhostShellKit
import SwiftUI

extension GhostPalette {
    /// The page's `--ready`, `--socket` and `--eye`, for the status dots.
    var ready: Color { Color(light: .init(0.577, 0.149, 260), dark: .init(0.65, 0.15, 260)) }
    var socket: Color { Color(light: .init(0.25), dark: .init(0.15)) }
    var eye: Color { Color(light: .init(0.99), dark: .init(0.99)) }
    /// A row's second line and a heading's count: the sidebar's text at 70%.
    var sidebarMuted: Color { sidebarForeground.opacity(0.7) }
}

/// The page's status dot: a white eye in a dark socket while it works, the warning colour in the socket while it waits for you, a blue dot for unread
/// and a warning triangle for a failure.
struct PhoneStatusDot: View {
    let dot: SessionDot?

    var body: some View {
        Group {
            switch dot {
            case .running?: lamp(Color.ghost.eye)
            case .awaiting?: lamp(Color.ghost.warning)
            case .ready?: Circle().fill(Color.ghost.ready).frame(width: 8, height: 8)
            case .error?: Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(Color.ghost.warningForeground)
            default: Color.clear
            }
        }
        .frame(width: 12, height: 12)
        .accessibilityElement()
        .accessibilityLabel(label)
    }

    /// The page's `.row-dot`: 8pt, a core over the first 58% of the radius, the socket beyond it, and a faint ring.
    private func lamp(_ core: Color) -> some View {
        Circle().fill(Color.ghost.socket)
            .overlay(Circle().fill(core).frame(width: 4.64, height: 4.64))
            .overlay(Circle().strokeBorder(Color.ghost.foreground.opacity(0.16), lineWidth: 1).padding(-1))
            .shadow(color: core.opacity(0.45), radius: 2)
            .frame(width: 8, height: 8)
    }

    private var label: String {
        switch dot {
        case .awaiting?: "Waiting for you"
        case .error?: "Failed"
        case .ready?: "Unread"
        case .running?: "Working"
        default: ""
        }
    }
}

extension View {
    /// A session or heading drawn as a plain row of the sidebar: no card, no separator and the sidebar's own background.
    func phoneListRow(picked: Bool = false) -> some View {
        listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 0))
            .listRowSeparator(.hidden)
            .listRowBackground(picked ? Color.ghost.sidebarAccent : Color.ghost.sidebar)
    }
}
#endif
