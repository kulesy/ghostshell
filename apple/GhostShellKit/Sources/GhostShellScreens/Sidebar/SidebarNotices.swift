import GhostShellKit
import SwiftUI

/// What the list says when the view has nothing to show.
struct EmptyNotice: View {
    let noGroups: Bool
    var searching = false

    #if os(macOS)
    private static let newKey = "\u{2318}"
    #else
    private static let newKey = "^"
    #endif

    var body: some View {
        let touch = SidebarMetrics.current.touch
        EmptyList(title: noGroups ? "No groups yet" : "No sessions found",
                  text: noGroups ? (touch ? "Tap + to make one, or move one here from a group's menu in Home." : "Make one from the + menu, or move one here from a group's menu in Home.")
                      : searching ? "Nothing matches that search." : (touch ? "Tap + to start one." : "Press \(Self.newKey)N to start one."))
    }
}

/// The page's empty list: a dashed box that fills the list, a muted square holding the new-chat icon, a title and a line under it.
struct EmptyList: View {
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
