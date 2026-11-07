import GhostShellKit
import SwiftUI

// The places later features plug into the sidebar. Each slot is drawn by the sidebar already and is empty here.
// A feature puts its own view or modifier in its own folder and adds one line to the slot it fills, so it never edits the rest of the sidebar.
// See apple/README.md, "Sidebar slots", for which PBI fills which slot.

/// A section or group heading, as a slot sees it. Built-in sections have no group.
struct SidebarHeading: Hashable, Sendable, Identifiable {
    enum Kind: Hashable, Sendable { case pinned, routines, started, ungrouped, other, group }
    /// The section id the server and the page use (`pinned`, `started`...), or the group's id.
    var id: String
    var title: String
    var kind: Kind
    var group: SessionGroup?
}

/// Buttons at the end of the sidebar's toolbar, after search and the view picker.
struct SidebarToolbarSlot: View {
    var body: some View {
    }
}

/// Items at the end of the view picker's menu, under Home and the projects.
struct ViewMenuSlot: View {
    let project: String?

    var body: some View {
    }
}

/// The right-click menu on a session row. The row may be a routine's latest run (`row.routine` is set) or a nested session (`row.parent` is set).
struct SessionRowMenuSlot: View {
    let row: SessionRow

    var body: some View {
    }
}

/// Modifiers on every session row, such as a drag source or a drop target.
struct SessionRowSlot: ViewModifier {
    let row: SessionRow

    func body(content: Content) -> some View {
        content
    }
}

/// Small buttons at the trailing end of a section or group heading, before its fold chevron.
struct HeadingAccessorySlot: View {
    let heading: SidebarHeading

    var body: some View {
    }
}

/// The right-click menu on a section or group heading.
struct HeadingMenuSlot: View {
    let heading: SidebarHeading

    var body: some View {
    }
}

/// Modifiers on every section and group heading, such as a drop target.
struct HeadingSlot: ViewModifier {
    let heading: SidebarHeading

    func body(content: Content) -> some View {
        content
    }
}

/// Whole sections drawn at the top of Home, before Routines. Each must be a `Section` and use `SidebarState.isOpen` to fold.
struct HomeTopSectionsSlot: View {
    var body: some View {
    }
}

/// Rows at the end of a routine bucket: the loose routines when `heading` is nil, else one routine heading's rows.
struct RoutineRowsSlot: View {
    let heading: String?

    var body: some View {
    }
}

/// Modifiers on the whole sidebar, for work that watches the index or the chosen session rather than drawing in the list.
struct SidebarWatchSlot: ViewModifier {
    func body(content: Content) -> some View {
        content
    }
}
