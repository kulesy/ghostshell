import GhostShellKit
import SwiftUI

/// The small button on a group or section heading in the sidebar that opens its own chat and sessions.
// NOTE: [8 Nov 2026] EK - Not a Button: the list merges a heading's content into one AXHeading, so a Button here would become its AXPress and VoiceOver would open the chat instead of folding.
struct GroupHeadingButton: View {
    @Environment(AppModel.self) private var app
    let heading: SidebarHeading

    var body: some View {
        if heading.kind != .routineHeading {
            Image(systemName: "bubble.left.and.text.bubble.right").font(.caption2).frame(width: 22, height: 20).contentShape(Rectangle())
                .onTapGesture { open(heading, in: app) }
                .help("Open the \(heading.title) chat")
                .accessibilityAction(named: "Open the \(heading.title) chat") { open(heading, in: app) }
        }
    }
}

/// The "Open group chat" item of a heading's right-click menu.
struct GroupHeadingMenuItem: View {
    @Environment(AppModel.self) private var app
    let heading: SidebarHeading

    var body: some View {
        if heading.kind != .routineHeading {
            Button(heading.kind == .group ? "Open group chat" : "Open section chat") { open(heading, in: app) }
        }
    }
}

@MainActor private func open(_ heading: SidebarHeading, in app: AppModel) {
    app.navigator.show { GroupScreen(id: heading.id).id(heading.id) }
}
