import GhostShellKit
import SwiftUI

/// A phone's way to choose several sessions. Edit mode puts checkmarks on the list, a tap chooses a row instead of opening it, and a bottom bar holds
/// Done, the count and the Mac's selection menu. The Mac has no edit mode and gets nothing here.
struct OrganiseEditMode: ViewModifier {
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise

    func body(content: Content) -> some View {
        #if os(iOS)
        ScrollViewReader { proxy in
            content
                .environment(\.editMode, Binding(get: { state.editing ? .active : .inactive }, set: { state.editing = $0.isEditing }))
                // The bottom bar takes room from the list, so the row that started edit mode is scrolled back into view once the bar is up.
                .onChange(of: state.editing) { _, editing in
                    guard editing, let id = state.selection.first else { return }
                    Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        withAnimation { proxy.scrollTo(id, anchor: .center) }
                    }
                }
                .toolbar {
                    if state.editing {
                        // A bar sizes a bare text button to its words, so the labels carry their own 44pt frame.
                        ToolbarItemGroup(placement: .bottomBar) {
                            Button { organise.clearSelection() } label: { Text("Done").fontWeight(.semibold).phoneIconTouch() }
                            Spacer()
                            Text("\(state.selection.count) chosen").font(.subheadline).foregroundStyle(.secondary)
                            Spacer()
                            Menu { SelectionMenu(ids: organise.ordered(state.selection)) } label: { Text("Actions").phoneIconTouch() }.disabled(state.selection.isEmpty)
                        }
                    }
                }
        }
        #else
        content
        #endif
    }
}
