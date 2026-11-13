import GhostShellKit
import SwiftUI

/// The small button on a group or section heading in the sidebar that opens its own chat and sessions.
// NOTE: [8 Nov 2026] EK - Not a Button: the list merges a heading's content into one AXHeading, so a Button here would become its AXPress and VoiceOver would open the chat instead of folding.
struct GroupHeadingButton: View {
    @Environment(AppModel.self) private var app
    @Environment(SidebarState.self) private var state
    let heading: SidebarHeading

    var body: some View {
        if hasChat(heading, app, state) {
            let icon = Image(systemName: "bubble.left.and.text.bubble.right").font(.caption2).frame(width: 22, height: 20).phoneIconTouch().contentShape(Rectangle())
                .onTapGesture { open(heading, in: app) }
                .help("Open the \(heading.title) chat")
                .accessibilityAction(named: "Open the \(heading.title) chat") { open(heading, in: app) }
            #if os(iOS)
            // A phone has no hover, so the icon needs a name and a role of its own, which a person or a test can find and press.
            icon.accessibilityLabel("Open the \(heading.title) chat").accessibilityAddTraits(.isButton)
            #else
            icon
            #endif
        }
    }
}

/// The "Open group chat" item of a heading's right-click menu.
struct GroupHeadingMenuItem: View {
    @Environment(AppModel.self) private var app
    @Environment(SidebarState.self) private var state
    let heading: SidebarHeading

    var body: some View {
        if hasChat(heading, app, state) {
            Button(heading.kind == .group ? "Open group chat" : "Open section chat") { open(heading, in: app) }
        }
    }
}

// The Routines section's chat is Home's, so a project's Routines section has no link to it, as on the page.
@MainActor private func hasChat(_ heading: SidebarHeading, _ app: AppModel, _ state: SidebarState) -> Bool {
    if heading.kind == .routines, let index = app.index, SidebarOutline.view(state.project, in: index) != nil { return false }
    return heading.kind != .routineHeading
}

@MainActor private func open(_ heading: SidebarHeading, in app: AppModel) {
    app.navigator.show { GroupScreen(id: heading.id).id(heading.id) }
}
