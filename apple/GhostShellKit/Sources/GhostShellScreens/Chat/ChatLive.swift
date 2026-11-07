import GhostShellKit
import SwiftUI

/// What is being written right now: Claude's thinking, the reply so far, and the line that says what it is doing. It is the only view that reads
/// the streamed text, so a word arriving draws this and nothing else.
struct LiveArea: View {
    @Environment(ChatModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let think = model.think { LiveThink(think: think, open: think.done ? model.opened.contains("live-think") : true) }
            if !model.live.isEmpty {
                MarkdownView(blocks: ChatMarkdown.parse(model.live, fileLinks: model.chat.fileLinks))
                    .textSelection(.enabled)
                    .accessibilityLabel("Claude is writing")
            }
            if model.turn != .none { WorkingLine() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct LiveThink: View {
    @Environment(ChatModel.self) private var model
    let think: ChatThink
    let open: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { if think.done { model.toggle("live-think") } } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).rotationEffect(.degrees(open ? 90 : 0)).frame(width: 10)
                    Text(think.done ? "Thought" : "Thinking").fontWeight(.medium)
                    Text(verbatim: ChatText.preview(think.text)).lineLimit(1).truncationMode(.tail)
                }
                .font(ChatStyle.small).foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                MarkdownView(blocks: ChatMarkdown.parse(think.text, fileLinks: model.chat.fileLinks), font: ChatStyle.small)
                    .foregroundStyle(.secondary).textSelection(.enabled)
                    .padding(.leading, 26).padding(.trailing, 8)
            }
        }
    }
}

/// "12s · 1.2k tokens · Reading a file", counted from when the turn began.
private struct WorkingLine: View {
    @Environment(ChatModel.self) private var model

    var body: some View {
        let outside = model.turn == .outside
        let work = outside ? model.outside : model.work
        let since = outside ? model.outsideStart : model.turnStart
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(Self.text(work: work, since: since, now: context.date, connectors: model.chat.session.connectors))
            }
            .monospacedDigit().lineLimit(1).truncationMode(.tail)
        }
        .font(ChatStyle.body).foregroundStyle(.secondary)
        .help(outside ? "Another app runs this chat, so GhostShell reads the time and tokens from its transcript. They move when a step is saved."
              : "Time since the turn began, and the tokens in the replies Claude has finished this turn. The count moves when a reply ends, not while it is written.")
        .accessibilityElement(children: .combine)
    }

    static func text(work: ChatWork?, since: Date?, now: Date, connectors: [String: String]) -> String {
        var parts: [String] = []
        if let work, let since { parts.append(ChatText.duration(ms: Int(now.timeIntervalSince(since) * 1000))); if work.tokens > 0 { parts.append("\(ChatText.tokenCount(work.tokens)) tokens") } }
        parts.append(ChatFold.doingNow(work, connectors: connectors))
        return parts.joined(separator: " · ")
    }
}

/// The subagents the session has started: a line that counts them, and a list when it is opened.
struct AgentStrip: View {
    @Environment(ChatModel.self) private var model
    @State private var open = false

    var body: some View {
        let agents = model.agents
        if !agents.isEmpty {
            let (running, finished) = ChatAgents.parts(agents)
            VStack(alignment: .leading, spacing: 0) {
                Button { open.toggle() } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).rotationEffect(.degrees(open ? 90 : 0)).frame(width: 10)
                        Text("Subagents").fontWeight(.medium)
                        Text(ChatAgents.summaryLine(agents)).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                    .font(ChatStyle.small)
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? "expanded" : "collapsed")
                if open {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(running + finished) { heard in AgentLine(heard: heard, now: context.date) }
                        }
                        .padding(.horizontal, 34).padding(.bottom, 8)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.bar)
        }
    }
}

private struct AgentLine: View {
    let heard: HeardAgent
    let now: Date

    var body: some View {
        let agent = heard.agent
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(color(agent.state)).frame(width: 7, height: 7)
            Text(verbatim: agent.type.isEmpty ? "Agent" : agent.type).fontWeight(.medium)
            Text(verbatim: agent.description).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            Text(ChatAgents.stateWord(agent.state)).foregroundStyle(.secondary)
            Text(ChatText.duration(ms: heard.elapsed(at: now))).monospacedDigit().foregroundStyle(.secondary)
        }
        .font(ChatStyle.small)
        .accessibilityElement(children: .combine)
    }

    private func color(_ state: Subagent.State) -> Color {
        switch state {
        case .running: .green
        case .done: .secondary
        case .stopped: .orange
        case .failed: .red
        case .other: .secondary
        }
    }
}

/// A line the chat could not read, or a turn that ended badly, until it is dismissed.
struct NoticeBar: View {
    @Environment(ChatModel.self) private var model

    var body: some View {
        if !model.notice.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text(verbatim: model.notice).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                Button("Dismiss", systemImage: "xmark") { model.dismissNotice() }
                    .labelStyle(.iconOnly).buttonStyle(.borderless).foregroundStyle(.secondary)
            }
            .font(ChatStyle.small)
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(.bar)
            .accessibilityElement(children: .contain)
        }
    }
}
