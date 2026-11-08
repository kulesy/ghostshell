import GhostShellKit
import SwiftUI

/// The sessions waiting on the owner, with the replies the watch is still holding on top.
struct WaitingListScreen: View {
    @Environment(WatchModel.self) private var model
    @Environment(\.scenePhase) private var phase

    var body: some View {
        List {
            if !model.kept.isEmpty {
                Section("Not sent") {
                    ForEach(model.kept) { reply in
                        NavigationLink(value: WatchRow(id: reply.sessionID, title: reply.title, dot: .awaiting, line: "")) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(reply.title).font(.headline).lineLimit(1)
                                Text(reply.text).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
            }
            switch model.list {
            case .loading:
                ProgressView().frame(maxWidth: .infinity)
            case .problem(let problem):
                ProblemView(problem: problem) { Task { await model.refreshList() } }
            case .loaded(let rows) where rows.isEmpty:
                Label("Nothing waiting", systemImage: "checkmark.circle").foregroundStyle(.secondary)
            case .loaded(let rows):
                ForEach(rows) { row in
                    NavigationLink(value: row) { RowLabel(row: row) }
                }
            }
        }
        .navigationTitle("GhostShell")
        .navigationBarTitleDisplayMode(.inline)
        // Polls only while the app is on screen. The phone is woken by each ask, so a hidden watch app asks for nothing.
        .task(id: phase == .active) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.refreshList()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

private struct RowLabel: View {
    let row: WatchRow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(row.title).font(.headline).lineLimit(2)
            HStack(spacing: 4) {
                Image(systemName: row.dot == .awaiting ? "exclamationmark.bubble.fill" : "checkmark.circle.fill")
                    .foregroundStyle(row.dot == .awaiting ? .orange : .green)
                Text(row.dot.words).fixedSize()
            }
            .font(.caption2)
            if !row.line.isEmpty { Text(row.line).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }
        .accessibilityElement(children: .combine)
    }
}
