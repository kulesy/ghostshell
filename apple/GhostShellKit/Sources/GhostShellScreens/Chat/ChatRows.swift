import GhostShellKit
import SwiftUI

/// One row of the thread. It is `Equatable`, so a row draws again only when its own item, its open state or what it depends on changes.
struct ChatRowView: View, Equatable {
    @Environment(ChatModel.self) private var model
    let row: ChatRow
    let opened: Set<String>
    let running: Bool
    let fileLinks: Bool
    let connectors: [String: String]
    let gapAbove: CGFloat

    nonisolated static func == (a: Self, b: Self) -> Bool {
        a.row == b.row && a.running == b.running && a.fileLinks == b.fileLinks && a.connectors == b.connectors && a.opened == b.opened && a.gapAbove == b.gapAbove
    }

    var body: some View {
        Group {
            switch row {
            case .group(let group):
                ToolGroupView(group: group, opened: opened, running: running, connectors: connectors)
            case .item(let item):
                ItemView(item: item, opened: opened, connectors: connectors)
            }
        }
        .padding(.top, gapAbove)
    }
}

private struct ItemView: View {
    @Environment(ChatModel.self) private var model
    let item: ChatItem
    let opened: Set<String>
    let connectors: [String: String]

    var body: some View {
        switch item.body {
        case .user(let message): UserMessageView(item: item, message: message, opened: opened)
        case .assistant(_, let text): AssistantMessageView(item: item, text: text)
        case .thinking(_, let text): ThinkRow(item: item, text: text, open: opened.contains(item.key))
        case .tool(let call): ToolItemView(item: item, call: call, opened: opened, connectors: connectors)
        case .result, .other: EmptyView()
        case .system(let notice): SystemNoticeView(key: item.key, notice: notice, open: opened.contains(item.key))
        case .bash(let run): BashRunView(run: run)
        case .divider(let text): DividerLine(text: text)
        case .model(let name): DividerLine(text: "Model set to \(ChatText.modelLabel(name))")
        case .routine(let name): DividerLine(text: "Started by the \(name) routine")
        case .scheduled(let name): DividerLine(text: "Started by the \(name) scheduled session")
        }
    }
}

// MARK: Messages

/// The time under a message. It reads `today`, so a new day words it again.
struct MessageTime: View {
    @Environment(ChatModel.self) private var model
    let at: Date?
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        if let at {
            let _ = model.today
            Text(ChatTime.sentAt(at))
                .font(ChatStyle.caption).monospacedDigit().foregroundStyle(.secondary)
                .accessibilityLabel("Sent \(ChatTime.sentAt(at))")
        }
    }
}

struct UserMessageView: View {
    @Environment(ChatModel.self) private var model
    let item: ChatItem
    let message: UserMessage
    let opened: Set<String>

    var body: some View {
        let (quotes, text) = ChatText.splitQuotes(message.text)
        let body = ChatText.lf(text)
        VStack(alignment: .trailing, spacing: 8) {
            if !message.files.isEmpty || !message.images.isEmpty {
                ChatSlots.attachments(ChatAttachments(files: message.files, images: message.images, source: .user), model.chat)
            }
            ForEach(Array(quotes.enumerated()), id: \.offset) { n, quote in
                QuotedView(quote: quote, open: opened.contains("\(item.key)q\(n)"), key: "\(item.key)q\(n)")
            }
            if !body.isEmpty {
                Text(verbatim: body)
                    .font(ChatStyle.body).lineSpacing(4)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
                    .frame(maxWidth: ChatStyle.column * 0.8, alignment: .trailing)
            }
            MessageTime(at: item.at)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .contextMenu { Button("Copy") { ChatLinks.copy(message.text) }; ChatSlots.messageActions(item, model.chat) }
    }
}

/// A message the composer has sent and the transcript does not hold yet.
struct SendingBubble: View {
    let message: SendingMessage

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if message.imageCount + message.fileCount > 0 {
                Label("\(ChatText.plural(message.imageCount + message.fileCount, "attachment"))", systemImage: "paperclip")
                    .font(ChatStyle.caption).foregroundStyle(.secondary)
            }
            if !message.text.isEmpty {
                Text(verbatim: ChatText.lf(message.text))
                    .font(ChatStyle.body).lineSpacing(4)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
                    .frame(maxWidth: ChatStyle.column * 0.8, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .opacity(0.6)
        .accessibilityLabel("Sending")
    }
}

private struct QuotedView: View {
    let quote: ChatText.Quote
    let open: Bool
    let key: String
    @Environment(ChatModel.self) private var model

    var body: some View {
        Button { model.toggle(key) } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "quote.opening").font(ChatStyle.caption).foregroundStyle(.secondary).padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    if let from = quote.from {
                        Text("From \(from.isEmpty ? "another session" : from)").font(ChatStyle.caption).fontWeight(.medium).foregroundStyle(.secondary)
                    }
                    Text(verbatim: ChatText.lf(quote.text)).font(ChatStyle.small).foregroundStyle(.secondary).lineLimit(open ? nil : 3).multilineTextAlignment(.leading)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.quaternary))
            .frame(maxWidth: ChatStyle.column * 0.8, alignment: .trailing)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(open ? "Shows less" : "Shows all of the quote")
    }
}

struct AssistantMessageView: View {
    @Environment(ChatModel.self) private var model
    let item: ChatItem
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            MarkdownView(blocks: model.blocks(key: item.key, text: text))
                .textSelection(.enabled)
            MessageTime(at: item.at)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contextMenu { Button("Copy") { ChatLinks.copy(text) }; ChatSlots.messageActions(item, model.chat) }
    }
}

// MARK: Thinking and tools

/// A disclosure line, as the page's tool and group summaries: a chevron, the lead, and the trailing facts.
private struct DisclosureLine<Lead: View, Trail: View>: View {
    let open: Bool
    let toggle: () -> Void
    @ViewBuilder var lead: Lead
    @ViewBuilder var trail: Trail
    @State private var hovering = false

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).rotationEffect(.degrees(open ? 90 : 0)).frame(width: 10)
                lead
                trail
            }
            .font(ChatStyle.small)
            .foregroundStyle(open || hovering ? .primary : .secondary)
            .padding(.horizontal, 8).padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hovering ? Color.secondary.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityValue(open ? "expanded" : "collapsed")
    }
}

struct ThinkRow: View {
    @Environment(ChatModel.self) private var model
    let item: ChatItem
    let text: String
    let open: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DisclosureLine(open: open, toggle: { model.toggle(item.key) }) {
                Text("Thought").fontWeight(.medium)
            } trail: {
                Text(verbatim: ChatText.preview(text)).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
            }
            if open {
                MarkdownView(blocks: model.blocks(key: item.key, text: text), font: ChatStyle.small)
                    .foregroundStyle(.secondary).textSelection(.enabled)
                    .padding(.leading, 26).padding(.trailing, 8).padding(.bottom, 6)
            }
        }
    }
}

/// A tool's input or output in a scrolling box.
struct ToolIO: View {
    let text: String
    var maxHeight: CGFloat = 220

    var body: some View {
        ScrollView(.vertical) {
            Text(verbatim: text).font(ChatStyle.monoSmall).lineSpacing(2).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(10)
        }
        .frame(maxHeight: maxHeight)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }
}

private func statusColor(_ status: ToolStatus) -> Color {
    switch status {
    case .failed, .denied: .red
    default: .secondary
    }
}

struct ToolRowView: View {
    @Environment(ChatModel.self) private var model
    let call: ToolCall
    let open: Bool
    let connectors: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DisclosureLine(open: open, toggle: { model.toggle(call.id) }) {
                HStack(spacing: 4) {
                    let server = ChatText.serverLabel(call.name, connectors: connectors)
                    if !server.isEmpty { Text(server).foregroundStyle(.secondary) }
                    Text(ChatText.toolLabel(call.name)).fontWeight(.medium)
                }
                .layoutPriority(1)
            } trail: {
                HStack(spacing: 8) {
                    Text(verbatim: call.summary).lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
                    Text(call.status.word).foregroundStyle(statusColor(call.status))
                }
            }
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ToolIO(text: ChatText.clip(Self.inputText(call), lines: 500, characters: 50_000))
                    if let output = call.output, !output.isEmpty { ToolIO(text: ChatText.clip(output, lines: 500, characters: 50_000)) }
                }
                .padding(.leading, 26).padding(.trailing, 8).padding(.bottom, 4)
            }
            if !call.images.isEmpty {
                ChatSlots.attachments(ChatAttachments(files: [], images: call.images, source: .toolResult(tool: call.name)), model.chat)
                    .padding(.leading, 26)
            }
        }
    }

    static func inputText(_ call: ToolCall) -> String {
        if call.name == "Bash" { return ChatText.lf(call.input["command"]?.string ?? "") }
        if case .null = call.input { return "{}" }
        return call.input.pretty()
    }
}

/// A tool call that stands alone, such as a question, a chip, a chapter heading or a widget.
private struct ToolItemView: View {
    @Environment(ChatModel.self) private var model
    let item: ChatItem
    let call: ToolCall
    let opened: Set<String>
    let connectors: [String: String]

    var body: some View {
        if call.name.hasSuffix("__spawn_task") {
            ChipCard(call: call, folder: model.chat.session.cwd)
        } else if call.name.hasSuffix("__mark_chapter") {
            HStack(spacing: 12) {
                Text(call.input["title"]?.string ?? "Chapter").font(ChatStyle.body).fontWeight(.semibold)
                Rectangle().fill(.quaternary).frame(height: 1)
            }
            .padding(.top, 8)
            .accessibilityAddTraits(.isHeader)
        } else if ChatFold.isWidget(call) {
            ChatSlots.widget(call, model.chat)
        } else if call.name.hasSuffix("__dismiss_task") {
            EmptyView()
        } else {
            ToolRowView(call: call, open: opened.contains(call.id), connectors: connectors)
        }
    }
}

/// A task Claude suggested, as the page draws it, without the actions that start or dismiss it.
private struct ChipCard: View {
    let call: ToolCall
    let folder: String

    var body: some View {
        let input = call.input
        VStack(alignment: .leading, spacing: 4) {
            Text("Suggested task").font(ChatStyle.small).fontWeight(.medium).foregroundStyle(.secondary)
            Text(verbatim: input["title"]?.string ?? "Untitled task").font(ChatStyle.body).fontWeight(.semibold)
            if let tldr = input["tldr"]?.string, !tldr.isEmpty { Text(verbatim: tldr).font(ChatStyle.body).foregroundStyle(.secondary) }
            if let prompt = input["prompt"]?.string, !prompt.isEmpty { ToolIO(text: ChatText.clip(prompt, lines: 8), maxHeight: 144).padding(.top, 4) }
            let start = input["cwd"]?.string ?? folder
            if !start.isEmpty { Text(verbatim: "Starts in \(start)").font(ChatStyle.monoSmall).foregroundStyle(.secondary).padding(.top, 2) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.quaternary))
    }
}

struct ToolGroupView: View {
    @Environment(ChatModel.self) private var model
    let group: ChatGroup
    let opened: Set<String>
    let running: Bool
    let connectors: [String: String]

    var body: some View {
        let open = opened.contains(group.id)
        let summary = group.summary
        VStack(alignment: .leading, spacing: 2) {
            DisclosureLine(open: open, toggle: { model.toggle(group.id) }) {
                HStack(spacing: 6) {
                    if running { ProgressView().controlSize(.mini) }
                    Text(running ? ChatFold.step(group.rows, connectors: connectors) : summary.title)
                        .fontWeight(.medium).lineLimit(1).truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } trail: {
                HStack(spacing: 8) {
                    if summary.edited {
                        Text("+\(summary.added)").foregroundStyle(.green)
                        Text("-\(summary.removed)").foregroundStyle(.red)
                    }
                    if running, let began = ChatFold.start(of: group.rows) {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            Text(ChatText.duration(ms: Int(context.date.timeIntervalSince(began) * 1000)))
                        }
                    } else {
                        Text(summary.note).foregroundStyle(summary.status == .failed ? .red : .secondary)
                    }
                }
                .monospacedDigit()
            }
            if open {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(group.rows) { item in
                        switch item.body {
                        case .thinking(_, let text): ThinkRow(item: item, text: text, open: opened.contains(item.key))
                        case .tool(let call): ToolRowView(call: call, open: opened.contains(call.id), connectors: connectors)
                        default: EmptyView()
                        }
                    }
                }
                .padding(.leading, 12)
            } else {
                let images = group.rows.flatMap { item -> [ChatImageRef] in if case .tool(let c) = item.body { c.images } else { [] } }
                if !images.isEmpty {
                    ChatSlots.attachments(ChatAttachments(files: [], images: images, source: .toolResult(tool: "")), model.chat).padding(.leading, 26)
                }
            }
        }
    }
}

// MARK: Notices, commands and dividers

private struct SystemNoticeView: View {
    @Environment(ChatModel.self) private var model
    let key: String
    let notice: SystemNotice
    let open: Bool

    var body: some View {
        let failed = notice.state == "failed"
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(lamp(notice.state)).frame(width: 8, height: 8).padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: notice.title).font(ChatStyle.body).fontWeight(.medium).foregroundStyle(failed ? Color.red : Color.primary)
                if let text = notice.text, !text.isEmpty {
                    Text(verbatim: ChatText.lf(text)).font(ChatStyle.body).foregroundStyle(failed ? Color.red.opacity(0.9) : Color.secondary).textSelection(.enabled)
                }
                if let output = notice.output, !output.isEmpty { ToolIO(text: ChatText.clip(output, lines: 500, characters: 50_000), maxHeight: 144) }
                if !notice.details.isEmpty {
                    DisclosureLine(open: open, toggle: { model.toggle(key) }) {
                        Text("Details")
                    } trail: { EmptyView() }
                    .padding(.leading, -8)
                    if open {
                        Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 4) {
                            ForEach(Array(notice.details.enumerated()), id: \.offset) { _, detail in
                                GridRow {
                                    Text(verbatim: detail.label).foregroundStyle(.secondary)
                                    Text(verbatim: ChatText.lf(detail.value)).textSelection(.enabled)
                                }
                            }
                        }
                        .font(ChatStyle.small)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary))
    }

    private func lamp(_ state: String?) -> Color {
        switch state {
        case "failed": .red
        case "waiting": .orange
        case "working", "active", "done": .green
        default: .secondary
        }
    }
}

/// A command run with `!`, with what it printed.
private struct BashRunView: View {
    let run: BashRun

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("!").font(ChatStyle.monoSmall).fontWeight(.bold).foregroundStyle(.secondary)
                Text(verbatim: run.command).font(ChatStyle.monoSmall).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                Button("Copy command", systemImage: "doc.on.doc") { ChatLinks.copy(run.command) }
                    .labelStyle(.iconOnly).buttonStyle(.borderless).foregroundStyle(.secondary).help("Copy command")
            }
            if !run.stdout.isEmpty { ToolIO(text: ChatText.clip(run.stdout, lines: 200, characters: 50_000)) }
            if !run.stderr.isEmpty { ToolIO(text: ChatText.clip(run.stderr, lines: 200, characters: 50_000)).foregroundStyle(.red) }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct DividerLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(.quaternary).frame(height: 1)
            Text(verbatim: text).font(ChatStyle.small).fontWeight(.medium).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.center).layoutPriority(1)
            Rectangle().fill(.quaternary).frame(height: 1)
        }
    }
}
