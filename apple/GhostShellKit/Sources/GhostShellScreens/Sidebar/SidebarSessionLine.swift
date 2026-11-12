import GhostShellKit
import SwiftUI

/// One session in the list, with its tooltip and the slots every row carries. `title` overrides the row's own, as a routine's runs do.
struct SessionLine: View {
    #if os(iOS)
    @Environment(OrganiseModel.self) private var organise
    @Environment(SidebarState.self) private var state
    #endif
    let row: SessionRow
    var title: String?
    var dot: SessionDot?
    var fold: RowFold?
    var nested = false
    var last = false

    var body: some View {
        let shown = title ?? row.title
        #if os(iOS)
        if let naming = organise.naming, naming.target == .session(row.id) {
            PhoneNameField(naming: naming).id(naming.id).padding(.leading, nested ? 19 : 0).phoneListRow()
        } else {
            PhoneSessionRow(row: row, title: shown, dot: dot ?? row.dot, fold: fold, nested: nested, last: last)
                .tag(row.id)
                .contextMenu { SessionRowMenuSlot(row: row) }
                .modifier(SessionRowSlot(row: row))
                .phoneListRow(picked: state.editing && state.selection.contains(row.id))
        }
        #else
        SessionRowView(title: shown, dot: dot ?? row.dot, turnStart: row.turnStart, fold: fold)
            .padding(.leading, nested ? 14 : 0)
            .tag(row.id)
            .help(SidebarOutline.tooltip(row, title: shown))
            .contextMenu { SessionRowMenuSlot(row: row) }
            .modifier(SessionRowSlot(row: row))
        #endif
    }
}

/// A list of rows where a head with nested sessions gets a fold control and, while open, its children one level in.
struct FamilyRows: View {
    @Environment(SidebarState.self) private var state
    let rows: [SessionRow]

    var body: some View {
        ForEach(rows) { row in
            if row.children.isEmpty {
                SessionLine(row: row)
            } else {
                let open = state.isUnfolded(row.id)
                let note = SidebarOutline.familyNote(row)
                SessionLine(row: row, dot: open ? nil : note.dot,
                            fold: RowFold(open: open, label: open ? SidebarOutline.nested(row.children.count) : note.label) { state.setUnfolded(row.id, !open) })
                if open { ForEach(row.children) { SessionLine(row: $0, nested: true, last: $0.id == row.children.last?.id) } }
            }
        }
    }
}

/// A routine's latest run under the routine's title, and its earlier runs under their dates while the fold is open.
struct RoutineRows: View {
    @Environment(SidebarState.self) private var state
    let routine: OutlineRoutine

    var body: some View {
        let open = state.openEarlier.contains(routine.id)
        let n = routine.earlier.count
        SessionLine(row: routine.latest, fold: n == 0 ? nil : RowFold(open: open, label: "\(n) earlier run\(n == 1 ? "" : "s")") {
            if open { state.openEarlier.remove(routine.id) } else { state.openEarlier.insert(routine.id) }
        })
        if open {
            ForEach(routine.earlier) { SessionLine(row: $0, title: SidebarOutline.when($0.lastActivityAt), nested: true, last: $0.id == routine.earlier.last?.id) }
        }
    }
}
