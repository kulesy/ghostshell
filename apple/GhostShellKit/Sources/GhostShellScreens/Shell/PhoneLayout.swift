import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Puts the keyboard away, for the action that ends a text entry.
@MainActor func dismissKeyboard() {
    #if os(iOS)
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    #endif
}

/// What the Mac puts side by side, a phone stacks, because 375pt has no room for a title and its buttons in one row.
struct SideBySide<Content: View>: View {
    var alignment: VerticalAlignment = .firstTextBaseline
    var spacing: CGFloat = 8
    @ViewBuilder var content: Content

    var body: some View {
        #if os(iOS)
        let layout = AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
        #else
        let layout = AnyLayout(HStackLayout(alignment: alignment, spacing: spacing))
        #endif
        layout { content }
    }
}

extension View {
    /// The Mac's link button, which iOS does not have. A phone gets a borderless button in the tint.
    func linkStyle() -> some View {
        #if os(iOS)
        buttonStyle(.borderless)
        #else
        buttonStyle(.link)
        #endif
    }

    /// A control a thumb has to hit is at least 44pt tall on a phone. Borderless keeps two buttons in one list row from both firing on a tap, and
    /// `boxed` gives a main action its outline. The Mac is left as it was.
    func phoneTouch(boxed: Bool = false) -> some View {
        #if os(iOS)
        Group {
            if boxed { buttonStyle(.bordered).controlSize(.large) } else { buttonStyle(.borderless).frame(minHeight: 44).contentShape(Rectangle()) }
        }
        #else
        self
        #endif
    }

    /// An icon-only control is 44pt square on a phone, whatever its glyph. The Mac is left as it was.
    func phoneIconTouch() -> some View {
        #if os(iOS)
        frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        #else
        self
        #endif
    }

    /// A full-size control on a phone, where a thumb has to hit it, for a button that keeps its own style. The Mac is left as it was.
    func largeOnPhone() -> some View {
        #if os(iOS)
        controlSize(.large)
        #else
        self
        #endif
    }

    /// A small control on the Mac and a full-size one on a phone, where a thumb has to hit it.
    func compactOnMac() -> some View {
        #if os(iOS)
        controlSize(.large)
        #else
        controlSize(.small)
        #endif
    }
}
