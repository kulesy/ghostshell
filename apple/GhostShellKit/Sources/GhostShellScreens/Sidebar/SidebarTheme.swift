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

/// The sidebar's sizes. The page draws the sidebar twice: with `pointer: fine`, which is the Mac, and for a finger, which is the iPhone.
/// Colours, type and shapes are the same on both, so a view reads its sizes from here and draws one way.
struct SidebarMetrics {
    /// The page's `1rem`, which a pointer sets to 15pt.
    var rem: CGFloat
    /// A row's height with the 2pt the page leaves between rows.
    var row: CGFloat
    var rowFont: CGFloat
    /// A heading's height, and the size of its name and count.
    var heading: CGFloat
    var headingFont: CGFloat
    var countFont: CGFloat
    /// The space above and below the rule between groups.
    var rule: CGFloat
    /// The square an icon button has to fill.
    var target: CGFloat
    /// A row's menu and fold buttons.
    var button: CGSize
    /// The size of the status dot.
    var dot: CGFloat
    /// The height of a footer link and the size of its text.
    var foot: CGFloat
    var footFont: CGFloat
    /// The height of an inline name field's row and of the box in it.
    var field: CGFloat
    var input: CGFloat
    /// A finger, not a pointer. The page then shows a row's second line and its menu button always, where a pointer gets them as hover text and on hover or choice.
    var touch: Bool

    static let touch = SidebarMetrics(rem: 16, row: 52, rowFont: 14, heading: 44, headingFont: 12, countFont: 11, rule: 6, target: 44, button: CGSize(width: 44, height: 44), dot: 8, foot: 44, footFont: 14, field: 48, input: 36, touch: true)
    static let pointer = SidebarMetrics(rem: 15, row: 28, rowFont: 12.2, heading: 26, headingFont: 11.25, countFont: 11, rule: 4.5, target: 32, button: CGSize(width: 24, height: 24), dot: 6, foot: 36, footFont: 13, field: 28, input: 24, touch: false)

    #if os(iOS)
    static let current = touch
    #else
    static let current = pointer
    #endif
}

/// The page's status dot: a white eye in a dark socket while it works, the warning colour in the socket while it waits for you, a blue dot for unread
/// and a warning triangle for a failure.
struct StatusDot: View {
    let dot: SessionDot?
    private let size = SidebarMetrics.current.dot

    var body: some View {
        Group {
            switch dot {
            case .running?: lamp(Color.ghost.eye)
            case .awaiting?: lamp(Color.ghost.warning)
            case .ready?: Circle().fill(Color.ghost.ready).frame(width: size, height: size)
            case .error?: Image(systemName: "exclamationmark.triangle.fill").font(.system(size: size + 3)).foregroundStyle(Color.ghost.warningForeground)
            default: Color.clear
            }
        }
        .frame(width: size + 4, height: size + 4)
        .accessibilityElement()
        .accessibilityLabel(label)
    }

    /// The page's `.row-dot`: a core over the first 58% of the radius, the socket beyond it, and a faint ring.
    private func lamp(_ core: Color) -> some View {
        Circle().fill(Color.ghost.socket)
            .overlay(Circle().fill(core).frame(width: size * 0.58, height: size * 0.58))
            .overlay(Circle().strokeBorder(Color.ghost.foreground.opacity(0.16), lineWidth: 1).padding(-1))
            .shadow(color: core.opacity(0.45), radius: 2)
            .frame(width: size, height: size)
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
    func sidebarListRow(picked: Bool = false) -> some View {
        listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: SidebarMetrics.current.touch ? 0 : 4))
            .listRowSeparator(.hidden)
            .listRowBackground(ZStack {
                Color.ghost.sidebar
                if picked {
                    // The page's chosen row is a rounded box on a pointer. A finger's row fills the width.
                    if SidebarMetrics.current.touch { Color.ghost.sidebarAccent } else { RoundedRectangle(cornerRadius: GhostRadius.md).fill(Color.ghost.sidebarAccent).padding(.horizontal, 4) }
                }
            })
    }

    /// An icon button's square: 44pt for a finger and the page's smaller one for a pointer.
    func sidebarIconTouch() -> some View {
        frame(minWidth: SidebarMetrics.current.target, minHeight: SidebarMetrics.current.target).contentShape(Rectangle())
    }

    /// The page's list meets its header and footer with no blur. macOS 26 blurs and tints a scroll view's edge under a bar, which the iPhone keeps.
    @ViewBuilder func flatScrollEdges() -> some View {
        #if os(macOS)
        if #available(macOS 26, *) { scrollEdgeEffectHidden(true, for: .all) } else { self }
        #else
        self
        #endif
    }

    /// Escape on a Mac. A phone has no such key.
    func onEscape(_ action: @escaping () -> Void) -> some View {
        #if os(macOS)
        onExitCommand(perform: action)
        #else
        self
        #endif
    }
}
