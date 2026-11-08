import GhostShellKit
import SwiftUI

/// The Scheduled sessions page: one-off sessions that start at a time, soonest first, then the ones that are done.
struct ScheduledScreen: View {
    @Environment(AppModel.self) private var model
    @State private var deleting: ScheduledSummary?
    @State private var asked = false
    private let confirmFirst: String?

    /// `confirmDelete` raises the delete question for that session as the screen opens, which is how the sidebar's Delete reaches it.
    init(confirmDelete: String? = nil) { confirmFirst = confirmDelete }

    private var store: RoutinesStore { model.routines }

    var body: some View {
        Group {
            if !store.features.scheduled && store.routines != nil {
                ContentUnavailableView("This GhostShell does not have scheduled sessions.", systemImage: "clock.badge.xmark")
            } else if let list = store.scheduled {
                if list.isEmpty { empty } else { rows(ordered(list)) }
            } else if let failure = store.failure {
                ContentUnavailableView {
                    Label("Could not load scheduled sessions", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Could not load scheduled sessions: \(failure)")
                } actions: {
                    Button("Try again") { Task { await store.refresh() } }
                }
            } else {
                ProgressView("Loading scheduled sessions").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Scheduled sessions")
        .toolbar {
            if store.features.scheduled {
                ToolbarItem {
                    Button("Schedule a session", systemImage: "plus") { model.navigator.show { ScheduledFormScreen(id: nil) } }
                        .help("Schedule a session")
                }
            }
        }
        .noteBar()
        .safeAreaInset(edge: .top, spacing: 0) {
            if let problem = store.scheduledProblem { ProblemBanner(text: problem) }
        }
        .task { await store.refresh() }
        .task(id: store.scheduled?.count) {
            if let id = confirmFirst, !asked, let s = store.scheduled?.first(where: { $0.id == id }) { asked = true; deleting = s }
        }
        .confirmationDialog("Delete “\(deleting?.title ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { s in
            Button("Delete scheduled session", role: .destructive) { Task { await store.delete(s) } }
            Button("Cancel", role: .cancel) {}.keyboardShortcut(.defaultAction)
        } message: { s in
            Text(deleteDetail(s))
        }
    }

    private var empty: some View {
        ContentUnavailableView {
            Label("No scheduled sessions.", systemImage: "clock")
        } description: {
            Text("A scheduled session starts once, at the date and time you pick, with the prompt you give it. For something that repeats, use a routine.")
        } actions: {
            Button("Schedule a session") { model.navigator.show { ScheduledFormScreen(id: nil) } }.buttonStyle(.borderedProminent)
        }
    }

    private func rows(_ list: [ScheduledSummary]) -> some View {
        List(list) { s in
            ScheduledRow(entry: s) { deleting = s }
        }
        .listStyle(.inset)
    }
}

private struct ScheduledRow: View {
    @Environment(AppModel.self) private var model
    let entry: ScheduledSummary
    let askDelete: () -> Void
    @State private var busy = false

    var body: some View {
        let s = entry
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 14) { info; Spacer(minLength: 8); controls }
            VStack(alignment: .leading, spacing: 8) { info; controls }
        }
        .padding(.vertical, 6)
        .contextMenu { ScheduledMenu(entry: s, askDelete: askDelete) }
        .accessibilityElement(children: .contain)
    }

    private var info: some View {
        let s = entry
        return VStack(alignment: .leading, spacing: 4) {
            Text(s.title).font(.headline).lineLimit(1)
            status
            Text(place).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            if let problem = s.problem, !problem.isEmpty { alert(problem, .red) }
            if let retry = s.retry, s.status == "pending" {
                alert("\(retryWords(retry)). The last try said: \(s.lastError ?? "no reason given")", .orange)
            } else if let error = s.lastError, !error.isEmpty, s.status == "skipped" || s.status == "started" {
                alert(error, .orange)
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 10) {
            if entry.isPending {
                Button("Start now") { busy = true; Task { await model.routines.startNow(entry); busy = false } }.disabled(entry.running || busy)
            }
            Menu {
                ScheduledMenu(entry: entry, askDelete: askDelete)
            } label: {
                Label("Actions for \(entry.title)", systemImage: "ellipsis.circle").labelStyle(.iconOnly)
            }
            .menuStyle(.borderlessButton).fixedSize()
        }
    }

    @ViewBuilder private var status: some View {
        if entry.status == "started", let id = entry.sessionId, !id.isEmpty {
            Button("Started \(fireTime(entry.startedAt))") { model.navigator.openSession(id) }
                .buttonStyle(.borderless).foregroundStyle(Color.accentColor).font(.callout)
        } else {
            let when = ["pending", "cancelled", "skipped"].contains(entry.status) ? fireTime(entry.at) : ""
            Text([statusWords(entry), when].filter { !$0.isEmpty }.joined(separator: " · ")).font(.callout).foregroundStyle(.secondary)
        }
    }

    private var place: String {
        let group = entry.group.map { _ in entry.groupName.map { "Group \($0)" } ?? "A group that has been deleted" } ?? "Home"
        return "\(entry.cwd) · \(group)"
    }

    private func alert(_ text: String, _ tint: Color) -> some View {
        Label(text, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
    }
}

/// Start now, Edit and Cancel for a pending session, then Delete for any, in the page's order.
struct ScheduledMenu: View {
    @Environment(AppModel.self) private var model
    let entry: ScheduledSummary
    var askDelete: (() -> Void)?

    var body: some View {
        let can = takes(entry)
        if can.start { Button("Start now") { Task { await model.routines.startNow(entry) } }.disabled(entry.running) }
        if can.edit { Button("Edit") { model.navigator.show { ScheduledFormScreen(id: entry.id) } } }
        if can.cancel { Button("Cancel") { Task { await model.routines.cancel(entry) } }.disabled(entry.running) }
        Button("Delete", role: .destructive) {
            if let askDelete { askDelete() } else { model.navigator.show { ScheduledScreen(confirmDelete: entry.id) } }
        }
    }
}
