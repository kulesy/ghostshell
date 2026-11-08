import SwiftUI

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
}
