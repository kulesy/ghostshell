import GhostShellKit
import SwiftUI

/// The Routines page: every routine with its schedule, its next and last run, a switch, Run now and an actions menu.
struct RoutinesScreen: View {
    @Environment(AppModel.self) private var model
    @State private var deleting: RoutineSummary?
    @State private var asked = false
    private let confirmFirst: String?

    /// `confirmDelete` raises the delete question for that routine as the screen opens, which is how the sidebar's Delete reaches it.
    init(confirmDelete: String? = nil) { confirmFirst = confirmDelete }

    private var store: RoutinesStore { model.routines }

    var body: some View {
        Group {
            if let routines = store.routines {
                if routines.isEmpty { empty } else { list(routinesByTitle(routines)) }
            } else if let failure = store.failure {
                ContentUnavailableView {
                    Label("Could not load routines", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Could not load routines: \(failure)")
                } actions: {
                    Button("Try again") { Task { await store.refresh() } }.phoneTouch(boxed: true)
                }
            } else {
                ProgressView("Loading routines").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Routines")
        .toolbar {
            if store.features.routineEdits {
                ToolbarItem {
                    Button { model.navigator.show { RoutineFormScreen(id: nil) } } label: {
                        Image(systemName: "plus").phoneIconTouch().accessibilityLabel("New routine")
                    }
                    .help("Add a routine")
                }
            }
        }
        .noteBar()
        .safeAreaInset(edge: .top, spacing: 0) {
            if let problem = store.problem { ProblemBanner(text: problem) }
        }
        .task { await store.refresh() }
        .task(id: store.routines?.count) {
            if let id = confirmFirst, !asked, let r = store.routine(id) { asked = true; deleting = r }
        }
        .confirmationDialog("Delete “\(deleting?.title ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { r in
            Button("Delete routine", role: .destructive) { Task { await store.delete(r) } }
            Button("Cancel", role: .cancel) {}.keyboardShortcut(.defaultAction)
        } message: { r in
            Text(deleteDetail(r))
        }
    }

    private var empty: some View {
        ContentUnavailableView {
            Label("No routines yet.", systemImage: "calendar.badge.clock")
        } description: {
            Text(store.features.routineEdits
                 ? "A routine runs a prompt on a schedule, such as weekdays at 07:30. GhostShell starts a session for each run."
                 : "Routines are listed here once they are in routines.json in the GhostShell folder.")
        } actions: {
            if store.features.routineEdits {
                Button("New routine") { model.navigator.show { RoutineFormScreen(id: nil) } }.buttonStyle(.borderedProminent).largeOnPhone()
            }
        }
    }

    private func list(_ routines: [RoutineSummary]) -> some View {
        List(routines) { r in
            RoutineRow(routine: r) { deleting = r }
        }
        .listStyle(.inset)
    }
}

/// The server's warning about a file it cannot read, above a list.
struct ProblemBanner: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(.callout)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(.orange.opacity(0.18), in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
    }
}

private struct RoutineRow: View {
    @Environment(AppModel.self) private var model
    let routine: RoutineSummary
    let askDelete: () -> Void
    @State private var busy = false

    private var store: RoutinesStore { model.routines }
    private var editable: Bool { store.features.routineEdits }

    var body: some View {
        let r = routine
        // The controls drop under the text when the pane is too narrow for both side by side.
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 14) { info; Spacer(minLength: 8); controls }
            VStack(alignment: .leading, spacing: 8) { info; controls }
        }
        .padding(.vertical, 6)
        .contextMenu { RoutineMenu(routine: r, withRun: true, askDelete: askDelete) }
        .accessibilityElement(children: .contain)
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(routine.title).font(.headline).lineLimit(1)
                if routine.running { RunningMark() }
            }
            schedule
            times
            alerts
        }
    }

    private var schedule: some View {
        HStack(spacing: 6) {
            if let words = scheduleWords(routine.cron, jitterSeconds: routine.jitterSeconds) { Text(words) }
            Text(routine.cron).font(.callout.monospaced()).foregroundStyle(.secondary)
        }
        .lineLimit(2)
    }

    private var times: some View {
        HStack(spacing: 6) {
            Text(routine.enabled ? (routine.next.map { "Next \(fireTime($0))" } ?? "No upcoming run") : "Off")
            Text("·").foregroundStyle(.tertiary)
            if let id = routine.lastSessionId, !id.isEmpty, routine.lastRunAt != nil {
                Button("Last run \(fireTime(routine.lastRunAt))") { model.navigator.openSession(id) }
                    .buttonStyle(.borderless).foregroundStyle(Color.accentColor).phoneTouch()
            } else {
                Text(routine.lastRunAt == nil ? "Never run" : "Last run \(fireTime(routine.lastRunAt))")
            }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder private var alerts: some View {
        if let problem = routine.problem, !problem.isEmpty { alert(problem, .red) }
        if let retry = routine.retry, routine.enabled {
            alert("\(retryWords(retry)). The last try said: \(routine.lastError ?? "no reason given")", .orange)
        } else if let error = routine.lastError, !error.isEmpty {
            alert("The last run did not start: \(error)", .orange)
        }
        if let skipped = routine.skipped { alert(skippedWords(skipped), .secondary) }
    }

    private func alert(_ text: String, _ tint: Color) -> some View {
        Label(text, systemImage: tint == .secondary ? "forward.end" : "exclamationmark.triangle.fill")
            .font(.callout).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
    }

    private var controls: some View {
        HStack(spacing: 10) {
            Toggle("Run \(routine.title) on its schedule", isOn: Binding(get: { routine.enabled }, set: { on in
                Task { await store.setEnabled(routine, on) }
            }))
            .toggleStyle(.switch).labelsHidden().compactOnMac()
            Button("Run now") { busy = true; Task { await store.run(routine); busy = false } }
                .disabled(routine.running || busy)
                .phoneTouch()
            if editable {
                Menu {
                    RoutineMenu(routine: routine, withRun: false, askDelete: askDelete)
                } label: {
                    Label("Actions for \(routine.title)", systemImage: "ellipsis.circle").labelStyle(.iconOnly).phoneIconTouch()
                }
                .menuStyle(.borderlessButton).fixedSize()
            }
        }
    }
}

/// The small lamp beside a routine that is working now.
struct RunningMark: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(.green).frame(width: 7, height: 7)
            Text("Running").font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Run now, Pause or Resume, Edit and Delete, in the page's order. The list leaves out Run now and Pause, which it has as controls.
struct RoutineMenu: View {
    @Environment(AppModel.self) private var model
    let routine: RoutineSummary
    var withRun = true
    var askDelete: (() -> Void)?

    var body: some View {
        if withRun {
            Button("Run now") { Task { await model.routines.run(routine) } }.disabled(routine.running)
            Button(routine.enabled ? "Pause" : "Resume") { Task { await model.routines.setEnabled(routine, !routine.enabled) } }
        }
        if model.routines.features.routineEdits {
            Button("Edit") { model.navigator.show { RoutineFormScreen(id: routine.id) } }
            Button("Delete", role: .destructive) {
                if let askDelete { askDelete() } else { model.navigator.show { RoutinesScreen(confirmDelete: routine.id) } }
            }
        }
    }
}
