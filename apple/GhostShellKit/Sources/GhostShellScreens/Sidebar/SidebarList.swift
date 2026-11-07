import GhostShellKit
import SwiftUI

/// The list itself. One chosen row opens its session, and several stay chosen for bulk actions.
struct SidebarList: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state

    var body: some View {
        @Bindable var state = state
        Group {
            if !model.hasLoaded {
                List {
                    ForEach(0..<8, id: \.self) { _ in SessionRowView(title: "Session title goes here", dot: nil).redacted(reason: .placeholder) }
                }
                .allowsHitTesting(false)
                .accessibilityLabel("Loading sessions")
            } else if model.rows.isEmpty {
                ContentUnavailableView("No sessions yet", systemImage: "bubble.left", description: Text("Start a chat in GhostShell and it will show up here."))
            } else {
                List(model.rows, selection: $state.selection) { row in
                    SessionRowView(title: row.title, dot: row.dot)
                        .contextMenu { SessionRowMenuSlot(row: row) }
                        .modifier(SessionRowSlot(row: row))
                }
            }
        }
        .onChange(of: state.selection) { _, chosen in
            if chosen.count == 1, let id = chosen.first, id != model.navigator.selectedSessionID { model.navigator.openSession(id) }
        }
        .onChange(of: model.navigator.selectedSessionID) { _, id in
            if let id, !state.selection.contains(id) { state.selection = [id] } else if id == nil { state.selection = [] }
        }
    }
}
