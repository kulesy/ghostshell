import GhostShellKit
import SwiftUI

/// The toolbar button that makes a group in the view on show.
struct NewGroupButton: View {
    @Environment(OrganiseModel.self) private var organise

    var body: some View {
        Button("New group", systemImage: "folder.badge.plus") { organise.newGroup() }
            .help("New group")
    }
}

/// New project, and for a project on show, its rename and delete.
struct ProjectMenuItems: View {
    @Environment(OrganiseModel.self) private var organise
    let project: String?

    var body: some View {
        Button("New project\u{2026}", systemImage: "folder.badge.plus") { organise.newProject() }
        if let shown = organise.index.projects.first(where: { $0.id == project }) {
            Button("Rename project\u{2026}", systemImage: "pencil") { organise.rename(shown) }
            Button("Delete project\u{2026}", systemImage: "trash", role: .destructive) { organise.delete(shown) }
        }
    }
}

/// The right-click menu on a session row. A row inside a selection of several gets the menu for the whole selection.
struct SessionRowMenu: View {
    @Environment(OrganiseModel.self) private var organise
    let row: SessionRow

    var body: some View {
        if row.archived {
            EmptyView()
        } else if let ids = organise.selection(with: row) {
            SelectionMenu(ids: ids)
        } else {
            SingleRowMenu(row: row)
        }
    }
}

private struct SingleRowMenu: View {
    @Environment(OrganiseModel.self) private var organise
    @Environment(SidebarState.self) private var state
    let row: SessionRow

    var body: some View {
        let index = organise.index
        let parent = OrganiseRules.find(index, row.parent)
        let under = OrganiseRules.nestTargets(index, row)
        // Pinned has its own item below, so Move to leaves it out.
        let places = OrganiseRules.sessionTargets(index, row).filter { $0 != .place(PlaceTarget(label: "Pinned", section: "pinned")) }
        let running = OrganiseRules.isRunning(row)
        let below = OrganiseRules.subsRunning(OrganiseRules.every(index), row.id) > 0
        let picked = state.selection.contains(row.id)
        if row.routine == nil { Button("Rename\u{2026}", systemImage: "pencil") { organise.rename(row) } }
        if let parent { Button("Move out of \u{201C}\(parent.title.isEmpty ? "Untitled" : parent.title)\u{201D}", systemImage: "arrow.up.left") { organise.nest(row, under: nil) } }
        if !under.isEmpty { NestMenu(rows: under) { organise.nest(row, under: $0) } }
        if !places.isEmpty { PlaceMenu(entries: places) { organise.place(row, section: $0) } }
        if row.pinned {
            Button("Unpin", systemImage: "pin.slash") { organise.place(row, section: "ungrouped") }
        } else {
            Button("Pin", systemImage: "pin") { organise.pin(row) }
        }
        Button(picked ? "Deselect" : "Select", systemImage: "checkmark.square") {
            if picked { state.selection.remove(row.id) } else { state.selection.insert(row.id) }
        }
        Divider()
        if running { Button("Stop", systemImage: "stop.circle") { organise.stop(row) } }
        Button(running || below ? "Stop and archive" : "Archive", systemImage: "archivebox", role: running || below ? .destructive : nil) { organise.archive(row) }
    }
}

private struct SelectionMenu: View {
    @Environment(OrganiseModel.self) private var organise
    let ids: [String]

    var body: some View {
        let index = organise.index
        let rows = OrganiseRules.carried(index, ids)
        let places = OrganiseRules.manyTargets(index, rows)
        let under = OrganiseRules.manyNestTargets(index, ids)
        let out = OrganiseRules.leavers(index, rows)
        let top = OrganiseRules.topmost(index, ids)
        let all = OrganiseRules.every(index)
        let busy = top.contains { OrganiseRules.isRunning($0) || OrganiseRules.subsRunning(all, $0.id) > 0 }
        let below = top.reduce(0) { $0 + OrganiseRules.descendants(all, of: $1.id).count }
        if organise.features.many {
            if !places.isEmpty { PlaceMenu(entries: places) { organise.moveMany(ids, section: $0) } }
            if !under.isEmpty { NestMenu(rows: under) { organise.nestMany(ids, under: $0) } }
            if !out.rows.isEmpty {
                Button(out.parent.map { "Move out of \u{201C}\($0.title.isEmpty ? "Untitled" : $0.title)\u{201D}" } ?? "Move out of parent", systemImage: "arrow.up.left") { organise.nestMany(ids, under: nil) }
            }
            Divider()
        }
        Button("Archive \(OrganiseRules.sessions(top.count))\(OrganiseRules.withSubs(below))", systemImage: "archivebox", role: busy ? .destructive : nil) { organise.archiveMany(ids) }
        Button("Clear selection", systemImage: "xmark") { organise.clearSelection() }
    }
}

/// A Move to menu. A project's groups sit under the project's name.
private struct PlaceMenu: View {
    let entries: [PlaceEntry]
    let pick: (String) -> Void

    var body: some View {
        Menu("Move to", systemImage: "folder") {
            ForEach(entries) { entry in
                switch entry {
                case .place(let place): Button(place.label) { pick(place.section) }
                case .project(let name, let items):
                    Section(name) { ForEach(items) { place in Button(place.label) { pick(place.section) } } }
                }
            }
        }
    }
}

private struct NestMenu: View {
    let rows: [SessionRow]
    let pick: (String) -> Void

    var body: some View {
        Menu("Nest under", systemImage: "arrow.down.right") {
            ForEach(rows) { row in Button(row.title.isEmpty ? "Untitled" : row.title) { pick(row.id) } }
        }
    }
}

/// The right-click menu on a group's heading. Without the server's group edits only the moves are offered, as on the page.
struct GroupHeadingMenu: View {
    @Environment(OrganiseModel.self) private var organise
    let group: SessionGroup

    var body: some View {
        let index = organise.index
        let moves = OrganiseRules.moveTargets(index.projects, group)
        let ids = OrganiseRules.groups(index, view: organise.view).map(\.id)
        let at = ids.firstIndex(of: group.id)
        if organise.features.groupEdits {
            if organise.features.groupRename { Button("Rename\u{2026}", systemImage: "pencil") { organise.rename(group) } }
            if let at, at > 0 { Button("Move up", systemImage: "arrow.up") { organise.order(group, .before, beside: ids[at - 1]) } }
            if let at, at < ids.count - 1 { Button("Move down", systemImage: "arrow.down") { organise.order(group, .after, beside: ids[at + 1]) } }
        }
        ForEach(moves) { move in Button(move.label, systemImage: "folder") { organise.move(group, toProject: move.project) } }
        if organise.features.groupEdits {
            Divider()
            Button("Delete group\u{2026}", systemImage: "trash", role: .destructive) { organise.delete(group) }
        }
    }
}
