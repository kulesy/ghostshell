import GhostShellKit
import SwiftUI

/// A phone's way to choose several sessions. Edit mode puts checkmarks on the list and a tap chooses a row instead of opening it. The select bar is
/// in PhoneFooter. It also brings a row being renamed clear of the keyboard. The Mac has no edit mode and gets nothing here.
struct OrganiseEditMode: ViewModifier {
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise

    func body(content: Content) -> some View {
        #if os(iOS)
        ScrollViewReader { proxy in
            content
                .environment(\.editMode, Binding(get: { state.editing ? .active : .inactive }, set: { state.editing = $0.isEditing }))
                // The select bar takes room from the list, so the row that started edit mode is scrolled back into view once the bar is up.
                .onChange(of: state.editing) { _, editing in
                    guard editing, let id = state.selection.first else { return }
                    Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        withAnimation { proxy.scrollTo(id, anchor: .center) }
                    }
                }
                // The list only scrolls a focused field to the keyboard's edge, so the row is centred once the keyboard is up.
                .onChange(of: organise.naming?.target) { _, target in
                    guard case .session(let id) = target else { return }
                    Task {
                        try? await Task.sleep(for: .milliseconds(400))
                        withAnimation { proxy.scrollTo(id, anchor: .center) }
                    }
                }
        }
        #else
        content
        #endif
    }
}
