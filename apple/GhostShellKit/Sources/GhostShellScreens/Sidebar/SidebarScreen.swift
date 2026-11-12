import GhostShellKit
import SwiftUI

/// The sidebar. It holds the sidebar's state and toolbar, and leaves the list to SidebarList. Later features plug in through SidebarSlots.
public struct SidebarScreen: View {
    @Environment(AppModel.self) private var model

    public init() {}

    public var body: some View {
        SidebarHost(defaults: model.defaults)
    }
}

private struct SidebarHost: View {
    @Environment(AppModel.self) private var model
    @State private var state: SidebarState

    init(defaults: UserDefaults) { _state = State(initialValue: SidebarState(defaults: defaults)) }

    var body: some View {
        #if os(iOS)
        // The page's own top bar and footer replace the navigation bar, the search field and the toolbar. The title stays for the Back button of a chat.
        SidebarList()
            .safeAreaInset(edge: .top, spacing: 0) { SidebarHeader() }
            .safeAreaInset(edge: .bottom, spacing: 0) { PhoneFooter() }
            .background(Color.ghost.sidebar.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .modifier(SidebarWatchSlot())
            .modifier(OrganiseHost())
            .navigationTitle("Sessions")
            // Last, so the header, footer and watch slot all read the same state.
            .environment(state)
        #else
        @Bindable var state = state
        SidebarList()
            .safeAreaInset(edge: .top, spacing: 0) { SidebarHeader() }
            .searchable(text: $state.query, placement: .sidebar, prompt: "Search")
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if model.connection == .unreachable { UnreachableLine() }
            }
            .toolbar {
                ToolbarItemGroup {
                    SidebarToolbarSlot()
                    Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right") { Task { await model.signOut() } }
                        .help("Sign Out")
                }
            }
            .modifier(SidebarWatchSlot())
            .modifier(OrganiseHost())
            .navigationTitle("Sessions")
            // Last, so the header, toolbar and watch slot all read the same state.
            .environment(state)
        #endif
    }
}
