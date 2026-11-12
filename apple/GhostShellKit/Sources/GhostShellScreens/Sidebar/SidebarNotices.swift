import SwiftUI

/// What the list says when the view has nothing to show.
struct EmptyNotice: View {
    let noGroups: Bool
    var searching = false

    var body: some View {
        #if os(iOS)
        PhoneEmptyList(title: noGroups ? "No groups yet" : "No sessions found",
                       text: noGroups ? "Tap + to make one, or move one here from a group's menu in Home." : searching ? "Nothing matches that search." : "Tap + to start one.")
        #else
        if noGroups {
            ContentUnavailableView("No groups yet", systemImage: "folder.badge.plus", description: Text("Make one with New group, or move one here from a group's menu in Home."))
        } else {
            ContentUnavailableView("No sessions found", systemImage: "bubble.left")
        }
        #endif
    }
}

#if os(iOS)
/// The page's empty list: a dashed box that fills the list, a muted square holding the new-chat icon, a title and a line under it.
struct PhoneEmptyList: View {
    let title: String
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "square.and.pencil").font(.system(size: 16)).foregroundStyle(Color.ghost.mutedForeground)
                .frame(width: 40, height: 40)
                .background(Color.ghost.muted, in: RoundedRectangle(cornerRadius: GhostRadius.lg))
                .accessibilityHidden(true)
            Text(title).font(.geist(14, weight: .medium, relativeTo: .body)).foregroundStyle(Color.ghost.sidebarForeground)
            Text(text).font(.geist(12, relativeTo: .caption)).foregroundStyle(Color.ghost.sidebarMuted).multilineTextAlignment(.center)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(RoundedRectangle(cornerRadius: GhostRadius.lg).strokeBorder(Color.ghost.sidebarBorder, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .padding(8)
        .background(Color.ghost.sidebar)
        .accessibilityElement(children: .combine)
    }
}
#endif
