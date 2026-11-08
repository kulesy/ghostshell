import SwiftUI

/// What the list says when the view has nothing to show.
struct EmptyNotice: View {
    let noGroups: Bool

    var body: some View {
        if noGroups {
            ContentUnavailableView("No groups yet", systemImage: "folder.badge.plus", description: Text("Make one with New group, or move one here from a group's menu in Home."))
        } else {
            ContentUnavailableView("No sessions found", systemImage: "bubble.left")
        }
    }
}
