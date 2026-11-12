import CoreTransferable
import GhostShellKit
import SwiftUI
import UniformTypeIdentifiers

/// The sessions a drag carries. It travels as JSON, so text dragged in from elsewhere is never taken for sessions.
struct DraggedSessions: Codable, Transferable {
    var sessions: [String]
    static var transferRepresentation: some TransferRepresentation { CodableRepresentation(contentType: .json) }
}

/// A drag source on a session row, and a drop target that nests what is dropped under it. A row in a selection of several drags them all.
struct RowDragDrop: ViewModifier {
    @Environment(OrganiseModel.self) private var organise
    @Environment(SidebarState.self) private var state
    let row: SessionRow
    @State private var targeted = false

    func body(content: Content) -> some View {
        // A test run sets `still`: while a draggable row's menu is open, iOS 27's test runner waits 60s a step on its lift animation.
        if row.archived || LiveMotion.still {
            content
        } else {
            content
                .draggable(DraggedSessions(sessions: carried))
                .dropDestination(for: DraggedSessions.self) { items, _ in
                    guard row.routine == nil else { return false }
                    organise.drop(items.flatMap(\.sessions), onRow: row)
                    return true
                } isTargeted: { targeted = $0 && row.routine == nil }
                .overlay { if targeted { DropRing(corner: 5) } }
        }
    }

    // Several are carried only when the server takes a write of several, as on the page.
    private var carried: [String] {
        guard organise.features.many, state.selection.count > 1, state.selection.contains(row.id) else { return [row.id] }
        return organise.ordered(state.selection)
    }
}

/// A drop target on a heading. Pinned, the loose lists and groups take sessions. Routines do not.
struct HeadingDrop: ViewModifier {
    @Environment(OrganiseModel.self) private var organise
    let heading: SidebarHeading
    @State private var targeted = false

    private var droppable: Bool {
        switch heading.kind {
        case .pinned, .started, .ungrouped, .other, .group: true
        case .routines, .routineHeading: false
        }
    }

    func body(content: Content) -> some View {
        if droppable {
            content
                .dropDestination(for: DraggedSessions.self) { items, _ in
                    organise.drop(items.flatMap(\.sessions), onSection: heading.id)
                    return true
                } isTargeted: { targeted = $0 }
                .background { if targeted { DropRing(corner: 4) } }
        } else {
            content
        }
    }
}

private struct DropRing: View {
    let corner: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: corner)
            .strokeBorder(Color.accentColor, lineWidth: 2)
            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: corner))
            .allowsHitTesting(false)
    }
}

extension OrganiseModel {
    /// A drop on a heading moves one session the way the page does, or several in one write.
    func drop(_ ids: [String], onSection section: String) {
        if ids.count > 1 { return moveMany(ids, section: section) }
        if let row = OrganiseRules.find(index, ids.first) { place(row, section: section) }
    }

    /// A drop on a row nests under it. Several that cannot nest there say why, and one that would change nothing sends nothing.
    func drop(_ ids: [String], onRow target: SessionRow) {
        if ids.count > 1 { return nestMany(ids, under: target.id) }
        if let row = OrganiseRules.find(index, ids.first) { nest(row, under: target.id) }
    }
}
