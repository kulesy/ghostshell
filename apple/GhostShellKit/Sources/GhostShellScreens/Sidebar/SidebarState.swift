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
