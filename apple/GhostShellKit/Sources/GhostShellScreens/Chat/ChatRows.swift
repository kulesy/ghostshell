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
                .font(ChatStyle.caption).monospacedDigit().foregroundStyle(ChatStyle.muted)
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
                BubbleWidth() {
                    Text(verbatim: body)
                        .font(ChatStyle.body).lineSpacing(ChatStyle.lineSpacing)
                        .textSelection(.enabled)
                        .frame(maxWidth: ChatStyle.page ? .infinity : nil, alignment: .leading)
                        .padding(ChatStyle.bubblePadding)
                        .background(ChatStyle.bubble, in: RoundedRectangle(cornerRadius: ChatStyle.radiusBubble))
                }
                .frame(maxWidth: ChatStyle.column * 0.8, alignment: .trailing)
            }
            MessageTime(at: item.at)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .contextMenu { Button("Copy") { ChatLinks.copy(message.text) }; ChatSlots.messageActions(item, model.chat) }
    }
}

/// Holds a bubble to a share of the width it is offered, which the page sets at 80%. The Mac's share is all of it, up to the column's cap.
/// A bubble that wraps fills its whole share, as the page's fit-content does.
private struct BubbleWidth: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews[0].sizeThatFits(fitted(proposal, subviews[0]))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let fit = fitted(proposal, subviews[0])
        let size = subviews[0].sizeThatFits(fit)
        subviews[0].place(at: CGPoint(x: bounds.maxX - size.width, y: bounds.minY), proposal: ProposedViewSize(size))
    }

    private func fitted(_ proposal: ProposedViewSize, _ bubble: LayoutSubview) -> ProposedViewSize {
        guard let width = proposal.width else { return proposal }
        let ideal = bubble.sizeThatFits(.unspecified).width
        return ProposedViewSize(width: min(ideal, width * ChatStyle.bubbleFraction), height: proposal.height)
    }
}

/// A message the composer has sent and the transcript does not hold yet.
struct SendingBubble: View {
    let message: SendingMessage

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if message.imageCount + message.fileCount > 0 {
                Label("\(ChatText.plural(message.imageCount + message.fileCount, "attachment"))", systemImage: "paperclip")
                    .font(ChatStyle.caption).foregroundStyle(ChatStyle.muted)
            }
            if !message.text.isEmpty {
                BubbleWidth() {
                    Text(verbatim: ChatText.lf(message.text))
                        .font(ChatStyle.body).lineSpacing(ChatStyle.lineSpacing)
                        .frame(maxWidth: ChatStyle.page ? .infinity : nil, alignment: .leading)
                        .padding(ChatStyle.bubblePadding)
                        .background(ChatStyle.bubble, in: RoundedRectangle(cornerRadius: ChatStyle.radiusBubble))
                }
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
                Image(systemName: "quote.opening").font(ChatStyle.caption).foregroundStyle(ChatStyle.muted).padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    if let from = quote.from {
                        Text("From \(from.isEmpty ? "another session" : from)").font(ChatStyle.caption).fontWeight(.medium).foregroundStyle(ChatStyle.muted)
                    }
                    Text(verbatim: ChatText.lf(quote.text)).font(ChatStyle.small).foregroundStyle(ChatStyle.muted).lineLimit(open ? nil : 3).multilineTextAlignment(.leading)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusQuoted).strokeBorder(ChatStyle.border))
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
            MarkdownView(blocks: model.blocks(key: item.key, text: text), canRun: true)
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
    var chevron = true
    var font = ChatStyle.summary
    var minHeight: CGFloat = 0
    let toggle: () -> Void
    @ViewBuilder var lead: Lead
    @ViewBuilder var trail: Trail
    @State private var hovering = false

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if chevron { Image(systemName: "chevron.right").font(ChatStyle.chevron).rotationEffect(.degrees(open ? 90 : 0)).frame(width: ChatStyle.chevronWidth) }
                lead
                trail
            }
            .font(font)
            .foregroundStyle(open || hovering ? ChatStyle.text : ChatStyle.muted)
            .frame(minHeight: ChatStyle.summaryHeight)
            .padding(ChatStyle.summaryPadding)
            .frame(minHeight: minHeight)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hovering ? Color.secondary.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: ChatStyle.radiusSummary))
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
            DisclosureLine(open: open, chevron: ChatStyle.rowChevrons, toggle: { model.toggle(item.key) }) {
                Text("Thought").fontWeight(.medium)
            } trail: {
                Text(verbatim: ChatText.preview(text)).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
            }
            if open {
                MarkdownView(blocks: model.blocks(key: item.key, text: text), font: ChatStyle.thinkText)
                    .foregroundStyle(ChatStyle.muted).textSelection(.enabled)
                    .railed(padding: 12)
                    .padding(.leading, ChatStyle.thinkIndent).padding(.trailing, 8).padding(.bottom, ChatStyle.thinkBottom)
            }
        }
    }
}

/// A tool's input or output in a scrolling box.
struct ToolIO: View {
    let text: String
    var maxHeight: CGFloat = 220
    /// The approval cards set a command a size larger than the thread does.
    var command = false

    var body: some View {
        ScrollView(.vertical) {
            Text(verbatim: text).font(command ? ChatStyle.commandMono : ChatStyle.monoSmall).lineSpacing(command ? ChatStyle.commandLineSpacing : ChatStyle.ioLineSpacing).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(ChatStyle.ioPadding)
        }
        .frame(maxHeight: maxHeight)
        .fixedSize(horizontal: false, vertical: true)
        .background(ChatStyle.well, in: RoundedRectangle(cornerRadius: ChatStyle.radiusInner))
    }
}

private func statusColor(_ status: ToolStatus) -> AnyShapeStyle {
    switch status {
    case .failed, .denied: AnyShapeStyle(ChatStyle.removed)
    case .ok where ChatStyle.page: AnyShapeStyle(ChatStyle.added)
    default: ChatStyle.muted
    }
}

struct ToolRowView: View {
    @Environment(ChatModel.self) private var model
    let call: ToolCall
    let open: Bool
    let connectors: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: ChatStyle.ioGap) {
            DisclosureLine(open: open, chevron: ChatStyle.rowChevrons, toggle: { model.toggle(call.id) }) {
                HStack(spacing: 4) {
                    let server = ChatText.serverLabel(call.name, connectors: connectors)
                    if !server.isEmpty { Text(server).foregroundStyle(ChatStyle.muted) }
                    Text(ChatText.toolLabel(call.name)).fontWeight(.medium)
                }
                .layoutPriority(1)
            } trail: {
                HStack(spacing: 8) {
                    Text(verbatim: call.summary).font(ChatStyle.toolSummary).lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
                    Text(call.status.word).font(ChatStyle.small).foregroundStyle(statusColor(call.status))
                }
            }
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ToolIO(text: ChatText.clip(Self.inputText(call), lines: 500, characters: 50_000))
                    if let output = call.output, !output.isEmpty { ToolIO(text: ChatText.clip(output, lines: 500, characters: 50_000)) }
                }
                .padding(.leading, ChatStyle.nestedIndent).padding(.trailing, 8).padding(.bottom, ChatStyle.ioBottom)
            }
            if !call.images.isEmpty {
                ChatSlots.attachments(ChatAttachments(files: [], images: call.images, source: .toolResult(tool: call.name)), model.chat)
                    .padding(.leading, ChatStyle.nestedIndent)
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
            ChipCard(call: call)
        } else if call.name.hasSuffix("__mark_chapter") {
            HStack(spacing: 12) {
                Text(call.input["title"]?.string ?? "Chapter").font(ChatStyle.body).fontWeight(.semibold)
                Rectangle().fill(ChatStyle.border).frame(height: 1)
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

/// A task Claude suggested, as the page draws it. The folder it starts in, Start and Dismiss come from `ChatSlots.chipActions`.
private struct ChipCard: View {
    @Environment(ChatModel.self) private var model
    let call: ToolCall

    var body: some View {
        let input = call.input
        VStack(alignment: .leading, spacing: 4) {
            Text("Suggested task").font(ChatStyle.small).fontWeight(.medium).foregroundStyle(ChatStyle.muted)
            Text(verbatim: input["title"]?.string ?? "Untitled task").font(ChatStyle.body).fontWeight(.semibold)
            if let tldr = input["tldr"]?.string, !tldr.isEmpty { Text(verbatim: tldr).font(ChatStyle.body).foregroundStyle(ChatStyle.muted) }
            if let prompt = input["prompt"]?.string, !prompt.isEmpty { ToolIO(text: ChatText.clip(prompt, lines: 8), maxHeight: 144).padding(.top, 4) }
            ChatSlots.chipActions(call, model.chat)
        }
        .padding(ChatStyle.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatStyle.card, in: RoundedRectangle(cornerRadius: ChatStyle.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusCard).strokeBorder(ChatStyle.border))
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
            DisclosureLine(open: open, minHeight: ChatStyle.groupHeight, toggle: { model.toggle(group.id) }) {
                HStack(spacing: 6) {
                    if running { ProgressView().controlSize(.mini) }
                    Text(running ? ChatFold.step(group.rows, connectors: connectors) : summary.title)
                        .fontWeight(.medium).lineLimit(1).truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } trail: {
                HStack(spacing: 8) {
                    if summary.edited {
                        Text("+\(summary.added)").foregroundStyle(ChatStyle.added)
                        Text("-\(summary.removed)").foregroundStyle(ChatStyle.removed)
                    }
                    if running, let began = ChatFold.start(of: group.rows) {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            Text(ChatText.duration(ms: Int(context.date.timeIntervalSince(began) * 1000)))
                        }
                    } else {
                        Text(summary.note).foregroundStyle(summary.status == .failed ? AnyShapeStyle(ChatStyle.removed) : ChatStyle.muted)
                    }
                }
                .font(ChatStyle.groupMeta)
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
                .railed(padding: ChatStyle.railPadding)
                .padding(.leading, ChatStyle.groupIndent)
            } else {
                let images = group.rows.flatMap { item -> [ChatImageRef] in if case .tool(let c) = item.body { c.images } else { [] } }
                if !images.isEmpty {
                    ChatSlots.attachments(ChatAttachments(files: [], images: images, source: .toolResult(tool: "")), model.chat).padding(.leading, ChatStyle.nestedIndent)
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
            ChatLamp(state: notice.state).padding(.top, ChatStyle.noticeLamp)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: notice.title).font(ChatStyle.body).fontWeight(.medium).tracking(ChatStyle.noticeTracking)
                    .foregroundStyle(failed ? AnyShapeStyle(ChatStyle.removed) : ChatStyle.text)
                if let text = notice.text, !text.isEmpty {
                    Text(verbatim: ChatText.lf(text)).font(ChatStyle.body).lineSpacing(ChatStyle.noticeLineSpacing)
                        .foregroundStyle(failed ? AnyShapeStyle(ChatStyle.removed.opacity(0.9)) : ChatStyle.muted).textSelection(.enabled)
                }
                if let output = notice.output, !output.isEmpty { ToolIO(text: ChatText.clip(output, lines: 500, characters: 50_000), maxHeight: 144) }
                if !notice.details.isEmpty {
                    DisclosureLine(open: open, font: ChatStyle.small, toggle: { model.toggle(key) }) {
                        Text("Details")
                    } trail: { EmptyView() }
                    .padding(.leading, -8)
                    if open {
                        Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 4) {
                            ForEach(Array(notice.details.enumerated()), id: \.offset) { _, detail in
                                GridRow {
                                    Text(verbatim: detail.label).foregroundStyle(ChatStyle.muted)
                                    Text(verbatim: ChatText.lf(detail.value)).font(ChatStyle.detailValue).textSelection(.enabled)
                                }
                            }
                        }
                        .font(ChatStyle.small)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(ChatStyle.noticePadding)
        .background(ChatStyle.card, in: RoundedRectangle(cornerRadius: ChatStyle.radiusNotice))
        .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusNotice).strokeBorder(ChatStyle.border))
    }
}

/// A command run with `!`, with what it printed.
private struct BashRunView: View {
    let run: BashRun

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("!").font(ChatStyle.monoSmall).fontWeight(.bold).foregroundStyle(ChatStyle.muted)
                Text(verbatim: run.command).font(ChatStyle.monoSmall).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                Button("Copy command", systemImage: "doc.on.doc") { ChatLinks.copy(run.command) }
                    .labelStyle(.iconOnly).buttonStyle(.borderless).foregroundStyle(ChatStyle.muted).help("Copy command")
            }
            if !run.stdout.isEmpty { ToolIO(text: ChatText.clip(run.stdout, lines: 200, characters: 50_000)) }
            if !run.stderr.isEmpty { ToolIO(text: ChatText.clip(run.stderr, lines: 200, characters: 50_000)).foregroundStyle(ChatStyle.removed) }
        }
        .padding(10)
        .background(ChatStyle.bashRun, in: RoundedRectangle(cornerRadius: ChatStyle.radiusBlock))
        .overlay { if ChatStyle.page { RoundedRectangle(cornerRadius: ChatStyle.radiusBlock).strokeBorder(ChatStyle.border) } }
    }
}

private struct DividerLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(ChatStyle.border).frame(height: 1)
            Text(verbatim: text).font(ChatStyle.small).fontWeight(.medium).foregroundStyle(ChatStyle.muted).lineLimit(2).multilineTextAlignment(.center).layoutPriority(1)
            Rectangle().fill(ChatStyle.border).frame(height: 1)
        }
    }
}
