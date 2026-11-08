import GhostShellKit
import SwiftUI

/// One session: what it is waiting on or its latest message, then the reply.
struct SessionScreen: View {
    let row: WatchRow
    @Environment(WatchModel.self) private var model
    @Environment(\.scenePhase) private var phase
    @State private var draft = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(row.title).font(.headline)
                // A reply still held goes first, so it is on screen even when the session itself could not load.
                let holding = model.keptReply(for: row.id) != nil
                if holding { ReplyBox(row: row, draft: $draft) }
                content
                if !holding { ReplyBox(row: row, draft: $draft) }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("Session")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: phase == .active) {
            guard phase == .active else { return }
            #if DEBUG
            if draft.isEmpty, let typed = await DebugHooks.draft(for: row, model: model) { draft = typed }
            #endif
            while !Task.isCancelled {
                await model.refreshSession(row.id)
                try? await Task.sleep(for: .seconds(8))
            }
        }
        .onDisappear { model.closeSession() }
    }

    @ViewBuilder private var content: some View {
        switch model.session {
        case .loading:
            ProgressView().frame(maxWidth: .infinity)
        case .problem(let problem):
            ProblemView(problem: problem) { Task { await model.refreshSession(row.id) } }
        case .loaded(let session):
            ForEach(Array(session.prompts.enumerated()), id: \.offset) { _, prompt in PromptView(prompt: prompt) }
            if let latest = session.latest {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.prompts.isEmpty ? "Claude said" : "Earlier").font(.caption2).foregroundStyle(.secondary)
                    Text(markdown(latest)).font(.footnote)
                }
            } else if session.prompts.isEmpty {
                Text("Nothing to read yet.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private func markdown(_ text: String) -> AttributedString {
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
}

private struct PromptView: View {
    let prompt: WatchPrompt

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(prompt.title, systemImage: prompt.kind == .question ? "questionmark.bubble.fill" : "exclamationmark.bubble.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(.orange)
            Text(markdown(prompt.text)).font(.footnote)
            ForEach(prompt.options, id: \.self) { option in
                Label(option, systemImage: "circle").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The reply field, or the reply the watch is still holding with its way to try again.
private struct ReplyBox: View {
    let row: WatchRow
    @Binding var draft: String
    @Environment(WatchModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let pending = model.keptReply(for: row.id) {
                Label("Not sent", systemImage: "tray.and.arrow.up").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                Text(pending.text).font(.footnote)
                if model.sending.contains(row.id) {
                    ProgressView("Sending")
                } else {
                    if let problem = model.failure[row.id] { Text(problem.words).font(.caption2).foregroundStyle(.secondary) }
                    Button("Send again") { Task { await model.sendAgain(row.id) } }
                    Button("Discard", role: .destructive) { model.discard(row.id) }
                }
            } else {
                if model.sent.contains(row.id) {
                    Label("Sent", systemImage: "checkmark.circle.fill").font(.caption.weight(.semibold)).foregroundStyle(.green)
                }
                TextField("Reply", text: $draft)
                Button("Send") {
                    let text = draft
                    draft = ""
                    Task { await model.reply(text, to: row.id, title: row.title) }
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }
}
