import Foundation
import GhostShellKit
import Observation

/// What the sidebar remembers: the view, what is folded and which rows are chosen. Slots read it from the environment.
/// The view and the folds are kept in the model's defaults, so they survive a restart.
@Observable @MainActor
final class SidebarState {
    /// The project on show, or nil for Home.
    var project: String? { didSet { save() } }
    /// Sections, groups and routine headings that are folded, by id. Routine headings use `routine-heading:<name>`, as the page does.
    private(set) var collapsed: Set<String> = []
    /// Family heads whose nested sessions are hidden.
    private(set) var folded: Set<String> = []
    /// Routines whose earlier runs are showing. Not kept, so they start closed, as on the page.
    var openEarlier: Set<String> = []
    /// The chosen rows. One chosen row is open in the detail pane. Several are a selection for bulk actions.
    var selection: Set<String> = []
    /// A phone's edit mode: rows show checkmarks and a tap chooses a row instead of opening it. Never on in the Mac app.
    var editing = false
    /// The search field's text. Empty shows the sections.
    var query = ""
    /// Routines that have never run, shown in Routines beside the ones that have. Issue 92 fills this from `/api/routines`.
    var idleRoutines: [IdleRoutine] = []

    private let defaults: UserDefaults
    private static let projectKey = "sidebar.project", collapsedKey = "sidebar.collapsed", foldedKey = "sidebar.folded"

    init(defaults: UserDefaults) {
        self.defaults = defaults
        // Assigning `project` here runs its didSet, which saves, so the folds load first or empty ones would overwrite the stored folds.
        collapsed = Set(defaults.stringArray(forKey: Self.collapsedKey) ?? [])
        folded = Set(defaults.stringArray(forKey: Self.foldedKey) ?? [])
        project = defaults.string(forKey: Self.projectKey)
    }

    /// Whether the menu offers Deselect. A phone keeps the open chat in `selection`, so it only counts as chosen in edit mode.
    func isPicked(_ id: String) -> Bool {
        #if os(iOS)
        editing && selection.contains(id)
        #else
        selection.contains(id)
        #endif
    }

    /// The row menu's Select. A phone starts edit mode with this row chosen, and sets `editing` first so the choice does not open the chat.
    func togglePick(_ id: String) {
        #if os(iOS)
        if !editing { editing = true; selection = [id]; return }
        #endif
        if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    }

    func isOpen(_ id: String) -> Bool { !collapsed.contains(id) }
    func setOpen(_ id: String, _ open: Bool) {
        if open { collapsed.remove(id) } else { collapsed.insert(id) }
        save()
    }

    func isUnfolded(_ rowID: String) -> Bool { !folded.contains(rowID) }
    func setUnfolded(_ rowID: String, _ open: Bool) {
        if open { folded.remove(rowID) } else { folded.insert(rowID) }
        save()
    }

    private func save() {
        defaults.set(project, forKey: Self.projectKey)
        defaults.set(collapsed.sorted(), forKey: Self.collapsedKey)
        defaults.set(folded.sorted(), forKey: Self.foldedKey)
    }
}
