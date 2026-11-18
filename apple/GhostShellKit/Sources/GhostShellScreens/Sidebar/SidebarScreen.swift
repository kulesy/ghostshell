import GhostShellKit
import SwiftUI

/// The sidebar. It holds the sidebar's state, header and footer, and leaves the list to SidebarList. Later features plug in through SidebarSlots.
public struct SidebarScreen: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        SidebarHost(defaults: model.defaults)
    }
}

private struct SidebarHost: View {
    @State private var state: SidebarState

    init(defaults: UserDefaults) { _state = State(initialValue: SidebarState(defaults: defaults)) }

    var body: some View {
        // The page's own top bar and footer replace the navigation bar, the search field and the toolbar. The title stays for the Back button of a chat.
        SidebarList()
            .flatScrollEdges()
            .safeAreaInset(edge: .top, spacing: 0) { SidebarHeader() }
            .safeAreaInset(edge: .bottom, spacing: 0) { SidebarFooter() }
            .background(Color.ghost.sidebar.ignoresSafeArea())
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
            .modifier(SidebarWatchSlot())
            .modifier(OrganiseHost())
            .navigationTitle("Sessions")
            // Last, so the header, footer and watch slot all read the same state.
            .environment(state)
    }
}
