import GhostShellKit
import SwiftUI

/// One session: what it is waiting on or its latest message, then the reply. A question the watch can answer takes the answer in place of a reply,
/// because a message sent while a card is pending waits behind the card and never answers it.
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
                if holding { ReplyBox(row: row, question: question, draft: $draft) }
                content
                if !holding && !blocked { replyOrCheck }
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

    private var prompts: [WatchPrompt] {
        if case .loaded(let session) = model.session { return session.prompts }
        return []
    }

    /// The question a typed or dictated answer goes to.
    private var question: WatchPrompt? { prompts.first { $0.answerable } }

    /// A card only the iPhone or Mac can answer leaves no reply box, since a message would wait behind the card.
    private var blocked: Bool { question == nil && !prompts.isEmpty }

    /// A plain reply goes through /send and queues behind a pending card, so the box waits until the session has loaded with a known state.
    @ViewBuilder private var replyOrCheck: some View {
        switch model.session {
        case .loading, .problem:
            EmptyView()
        case .loaded(let session) where session.state == nil:
            VStack(alignment: .leading, spacing: 6) {
                Text("Couldn't check for a question. Try again.").font(.footnote).foregroundStyle(.secondary)
                Button("Try again") { Task { await model.refreshSession(row.id) } }
            }
        case .loaded:
            ReplyBox(row: row, question: question, draft: $draft)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.session {
        case .loading:
            ProgressView().frame(maxWidth: .infinity)
        case .problem(let problem):
            ProblemView(problem: problem) { Task { await model.refreshSession(row.id) } }
        case .loaded(let session):
            ForEach(Array(session.prompts.enumerated()), id: \.offset) { _, prompt in PromptView(prompt: prompt, row: row) }
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
    let row: WatchRow
    @Environment(WatchModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(prompt.title, systemImage: prompt.kind == .question ? "questionmark.bubble.fill" : "exclamationmark.bubble.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(.orange)
            Text(markdown(prompt.text)).font(.footnote)
            if prompt.answerable {
                // An answer already held stays in the reply box, so the options wait until it is sent or discarded.
                if model.keptReply(for: row.id) == nil {
                    ForEach(prompt.options, id: \.self) { option in
                        Button { Task { await model.answer(option, to: prompt, in: row) } } label: {
                            Text(option).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.bordered)
                    }
                }
            } else {
                ForEach(prompt.options, id: \.self) { option in
                    Label(option, systemImage: "circle").font(.footnote).foregroundStyle(.secondary)
                }
                Text(elsewhere).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: prompt.answerable ? .contain : .combine)
    }

    private var elsewhere: String {
        switch prompt.kind {
        case .question: "Answer this one on your iPhone or Mac."
        case .plan: "Approve this plan on your iPhone or Mac."
        case .permission: "Approve this on your iPhone or Mac."
        }
    }
}

/// The reply field, or the reply the watch is still holding with its way to try again.
private struct ReplyBox: View {
    let row: WatchRow
    /// The question this box answers, or nil when it sends a plain reply.
    let question: WatchPrompt?
    @Binding var draft: String
    @Environment(WatchModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let pending = model.keptReply(for: row.id) {
                Label(pending.isAnswer ? "Answer not sent" : "Not sent", systemImage: "tray.and.arrow.up").font(.caption.weight(.semibold)).foregroundStyle(.orange)
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
                if model.answeredElsewhere.contains(row.id) {
                    Label("Already answered elsewhere", systemImage: "arrow.triangle.branch").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
                TextField(question == nil ? "Reply" : "Your own answer", text: $draft)
                Button(question == nil ? "Send" : "Answer") {
                    let text = draft
                    draft = ""
                    Task {
                        if let question { await model.answer(text, to: question, in: row) } else { await model.reply(text, to: row.id, title: row.title) }
                    }
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }
}
