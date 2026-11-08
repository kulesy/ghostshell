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
            .navigationTitle("Sessions")
            // Last, so the header, toolbar and watch slot all read the same state.
            .environment(state)
    }
}
