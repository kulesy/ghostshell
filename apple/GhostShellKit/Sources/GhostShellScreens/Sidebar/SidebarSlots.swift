import GhostShellKit
import SwiftUI

// The places later features plug into the sidebar. Each slot is drawn by the sidebar already and is empty here.
// A feature puts its own view or modifier in its own folder and adds one line to the slot it fills, so it never edits the rest of the sidebar.
// See apple/README.md, "Sidebar slots", for which PBI fills which slot.

/// A section, group or routine sub-heading, as a slot sees it. Built-in sections have no group.
struct SidebarHeading: Hashable, Sendable, Identifiable {
    /// `routines` is the Routines section and `routineHeading` is one of its sub-headings.
    enum Kind: Hashable, Sendable { case pinned, routines, routineHeading, started, ungrouped, other, group }
    /// The section id the server and the page use (`pinned`, `started`...), or the group's id.
    var id: String
    var title: String
    var kind: Kind
    var group: SessionGroup?
}

/// Buttons at the end of the Mac sidebar's toolbar, beside Sign Out. The iPhone draws its own top bar and footer instead.
struct SidebarToolbarSlot: View {
    var body: some View {
        NotificationToggle()
        NewGroupButton()
        // NOTE: [9 Nov 2026] EK - Last, so a narrow sidebar folds this one away first. New Group has no other way in, and New Session has the File menu and Command-N.
        NewSessionButton()
    }
}

/// Items at the end of the view picker's menu, under Home and the projects.
struct ViewMenuSlot: View {
    let project: String?

    var body: some View {
        ProjectMenuItems(project: project)
        RoutineMenuItems()
    }
}

/// The right-click menu on a session row. The row may be a routine's latest run (`row.routine` is set) or a nested session (`row.parent` is set).
struct SessionRowMenuSlot: View {
    let row: SessionRow

    var body: some View {
        RoutineRowMenu(row: row)
        SessionRowMenu(row: row)
    }
}

/// Modifiers on every session row, such as a drag source or a drop target.
struct SessionRowSlot: ViewModifier {
    let row: SessionRow

    func body(content: Content) -> some View {
        content.modifier(RowDragDrop(row: row))
    }
}

/// Small buttons at the trailing end of a section or group heading, before its session count.
struct HeadingAccessorySlot: View {
    let heading: SidebarHeading

    var body: some View {
        GroupHeadingButton(heading: heading)
    }
}

/// The right-click menu on a section or group heading on the Mac, and a long press on the phone.
struct HeadingMenuSlot: View {
    let heading: SidebarHeading

    var body: some View {
        GroupHeadingMenu(heading: heading)
        GroupHeadingMenuItem(heading: heading)
    }
}

/// Modifiers on every section and group heading, such as a drop target.
struct HeadingSlot: ViewModifier {
    let heading: SidebarHeading

    func body(content: Content) -> some View {
        content.modifier(HeadingDrop(heading: heading))
    }
}

/// Whole sections drawn at the top of Home, before Routines. Each must be a `Section` and use `SidebarState.isOpen` to fold.
struct HomeTopSectionsSlot: View {
    var body: some View {
        ScheduledSection()
    }
}

/// The row for a routine that has never run, drawn in its routine bucket after the routines that have.
struct IdleRoutineRowSlot: View {
    let routine: IdleRoutine

    var body: some View {
        IdleRoutineRow(routine: routine)
    }
}

/// Modifiers on the whole sidebar, for work that watches the index or the chosen session rather than drawing in the list.
struct SidebarWatchSlot: ViewModifier {
    func body(content: Content) -> some View {
        content
            .modifier(RoutineIdleWatch())
            .modifier(OrganiseEditMode())
    }
}
