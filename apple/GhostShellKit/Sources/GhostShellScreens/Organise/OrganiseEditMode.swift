import GhostShellKit
import SwiftUI

/// A phone's way to choose several sessions. Edit mode puts checkmarks on the list and a tap chooses a row instead of opening it. The select bar is
/// in PhoneFooter. The Mac has no edit mode and gets nothing here.
struct OrganiseEditMode: ViewModifier {
    @Environment(SidebarState.self) private var state

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
        }
        #else
        content
        #endif
    }
}
