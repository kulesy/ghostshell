import SwiftUI

extension View {
    /// The page's header over a screen. A Mac draws it in the window's toolbar band: an optional back link, the title in Geist semibold and the screen's one
    /// action, if it has one, as an ink button at the right. A phone keeps the navigation bar's title, its back button and its own plus.
    func pageHeader(_ title: String, back: String? = nil, goBack: @escaping () -> Void = {}, button: String? = nil, perform: @escaping () -> Void = {}) -> some View {
        #if os(macOS)
        navigationTitle(title)
            .toolbar(removing: .title)
            .toolbar { PageToolbar(title: title, back: back, goBack: goBack, button: button, perform: perform) }
            .safeAreaInset(edge: .top, spacing: 0) { Rule() }
        #else
        navigationTitle(title)
        #endif
    }
}

#if os(macOS)
/// The toolbar items of `pageHeader`. macOS 26 wraps each item in a glass capsule, which the page's header does not have.
private struct PageToolbar: ToolbarContent {
    let title: String
    let back: String?
    let goBack: () -> Void
    let button: String?
    let perform: () -> Void

    private var heading: some View {
        HStack(spacing: 8) {
            if let back {
                // A toolbar draws a Label as its icon alone, and the page's back link has its words.
                Button(action: goBack) { HStack(spacing: 4) { Image(systemName: "chevron.left"); Text(back) } }.buttonStyle(.ghost(.ghost, size: .compact)).accessibilityLabel(back)
            }
            Text(title).font(.geist(16, weight: .semibold)).foregroundStyle(Color.ghost.foreground).lineLimit(1)
        }
        .padding(.leading, 8)
    }

    private var action: some View {
        Button(button ?? "", action: perform).buttonStyle(.ghost(.primary, size: .compact))
    }

    var body: some ToolbarContent {
        if #available(macOS 26, *) {
            ToolbarItem(placement: .navigation) { heading }.sharedBackgroundVisibility(.hidden)
            // With the title removed nothing stretches between the two, so the action would sit beside the heading.
            ToolbarSpacer(.flexible)
            if button != nil { ToolbarItem(placement: .primaryAction) { action }.sharedBackgroundVisibility(.hidden) }
        }
        if #unavailable(macOS 26) {
            ToolbarItem(placement: .navigation) { heading }
            if button != nil { ToolbarItem(placement: .primaryAction) { action } }
        }
    }
}
#endif
