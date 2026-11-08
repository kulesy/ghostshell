import GhostShellKit
import SwiftUI

/// Manage routines, and Scheduled sessions when this GhostShell has them.
struct RoutineToolbarButtons: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button("Manage routines", systemImage: "calendar.badge.clock") { model.navigator.show { RoutinesScreen() } }
            .help("Manage routines")
        if model.routines.features.scheduled {
            Button("Manage scheduled sessions", systemImage: "clock") { model.navigator.show { ScheduledScreen() } }
                .help("Manage scheduled sessions")
        }
    }
}

/// Run now, Pause or Resume, Edit and Delete, then a divider, for the latest run of a routine that routines.json holds.
struct RoutineRowMenu: View {
    @Environment(AppModel.self) private var model
    let row: SessionRow

    var body: some View {
        if let id = row.routine, !id.isEmpty, model.index?.routines.contains(where: { $0.latest?.id == row.id }) == true, let routine = model.routines.routine(id) {
            RoutineMenu(routine: routine, withRun: true, askDelete: nil)
            Divider()
        }
    }
}

/// The Scheduled section at the top of Home: pending and skipped sessions, soonest first. Hidden when there are none.
struct ScheduledSection: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    private let id = "scheduled"

    var body: some View {
        let shown = ordered(inSidebar(model.routines.scheduled ?? []))
        if model.routines.features.scheduled, !shown.isEmpty {
            Section(isExpanded: Binding(get: { state.isOpen(id) }, set: { state.setOpen(id, $0) })) {
                ForEach(shown) { ScheduledSidebarRow(entry: $0) }
            } header: {
                HeadingRow(heading: SidebarHeading(id: id, title: "Scheduled", kind: .other), count: shown.count)
            }
        }
    }
}

private struct ScheduledSidebarRow: View {
    @Environment(AppModel.self) private var model
    let entry: ScheduledSummary

    var body: some View {
        let note = noteOf(entry)
        Button {
            let id = entry.id
            if entry.isPending { model.navigator.show { ScheduledFormScreen(id: id) } } else { model.navigator.show { ScheduledScreen() } }
        } label: {
            QuietRow(title: entry.title, line: note.text, tint: note.tone == .problem ? .red : note.tone == .warning ? .orange : nil)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(entry.title), \(note.text)")
        .help("\(entry.title): \(note.text)")
        .contextMenu { ScheduledMenu(entry: entry) }
    }
}

/// Hands the sidebar the routines to draw as idle rows. It sets every routine and the outline drops the ones that have runs.
struct RoutineIdleWatch: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state

    func body(content: Content) -> some View {
        let idle = (model.routines.routines ?? []).map { IdleRoutine(id: $0.id, title: $0.title, heading: $0.heading) }
        content.onChange(of: idle, initial: true) { _, latest in state.idleRoutines = latest }
    }
}

/// A routine that has not run, as a plain button. It is not tagged, so choosing it never opens a session.
struct IdleRoutineRow: View {
    @Environment(AppModel.self) private var model
    let routine: IdleRoutine

    var body: some View {
        if let full = model.routines.routine(routine.id) {
            let words = idleWords(full)
            Button {
                let id = full.id
                if model.routines.features.routineEdits { model.navigator.show { RoutineFormScreen(id: id) } } else { model.navigator.show { RoutinesScreen() } }
            } label: {
                QuietRow(title: full.title, line: words, tint: nil)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(full.title), \(words)")
            .help("\(full.title): \(words)")
            .contextMenu { RoutineMenu(routine: full, withRun: true, askDelete: nil) }
        }
    }
}

/// A title with a quiet line under it, aligned with the session rows.
private struct QuietRow: View {
    let title: String
    let line: String
    let tint: Color?

    var body: some View {
        HStack(spacing: 10) {
            StateMark(dot: nil)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).lineLimit(1)
                Text(line).font(.caption).foregroundStyle(tint ?? .secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
