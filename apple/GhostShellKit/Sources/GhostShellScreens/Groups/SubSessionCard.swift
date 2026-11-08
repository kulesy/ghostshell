import GhostShellKit
import SwiftUI

/// One session of the group: its state, when it last moved, what to do next about it and its roll-up. It opens to the whole reply and the sessions under it.
struct SubSessionCard: View {
    @Environment(AppModel.self) private var app
    @Environment(GroupCards.self) private var cards
    let node: SubLine
    let rows: [SessionRow]
    let now: Date

    var body: some View {
        let row = node.row
        let open = cards.opened.contains(row.id)
        let name = row.title.isEmpty ? SidebarOutline.untitled : row.title
        let heard = cards.said[row.id]?.summary
        let main = GroupRules.mainPull(cards.pulls[row.id]?.pulls)
        let step = GroupRules.nextStep(row, heard: heard, pull: main)
        let pill = GroupRules.pill(row)
        let roll = GroupRules.rollup(rows, of: row.id, now: now)
        let running = GroupRules.isRunning(row)
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Button { app.navigator.openSession(row.id) } label: {
                        Text(verbatim: name).font(.system(size: 14, weight: .semibold)).multilineTextAlignment(.leading).lineLimit(3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(name), \(pill.label)")
                    .accessibilityHint("Opens the session")
                    Spacer(minLength: 4)
                    Text(SidebarOutline.when(row.lastActivityAt, now: now)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                Pill(pill: pill)
                if let step {
                    if step.source == .said {
                        Text(verbatim: step.text).font(.callout).lineLimit(3)
                    } else {
                        Text(verbatim: step.text).font(.callout.weight(.medium)).foregroundStyle(GroupTint.color(step.tone)).lineLimit(3)
                    }
                }
                if let main, step?.source != .pending { PullView(pull: main, row: row, said: step?.source == .pull) }
            }
            if !roll.isEmpty { Words(text: roll).font(.caption).foregroundStyle(.secondary) }
            HStack(spacing: 4) {
                Spacer(minLength: 4)
                CardButton(title: "Reply", icon: "arrowshape.turn.up.left", label: "Reply to \(name)") { cards.flipBox(row.id) }
                CardButton(title: "Archive", icon: "archivebox", label: "\(running || GroupRules.runningBelow(rows, row.id) > 0 ? "Stop and archive" : "Archive") \(name)") {
                    Task { await cards.archive(row, running: running, rows: rows) }
                }
                .disabled(cards.archiving.contains(row.id))
                CardButton(title: "Details", icon: open ? "chevron.down" : "chevron.right", label: "Details of \(name)", expanded: open) { cards.flip(row.id) }
            }
            if open { DetailsView(row: row) }
            if cards.box(row.id).open { GroupReplyBox(row: row, name: name) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary))
        .accessibilityElement(children: .contain)
        if open, !node.subs.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(node.subs) { sub in SubSessionCard(node: sub, rows: rows, now: now) }
            }
            .padding(.leading, 16)
            .accessibilityLabel("Sub sessions of \(name)")
        }
    }
}

private struct Pill: View {
    let pill: StatePill

    var body: some View {
        Text(pill.label).font(.caption.weight(.medium)).foregroundStyle(GroupTint.color(pill.tone))
            .padding(.horizontal, 9).padding(.vertical, 2)
            .background {
                Capsule().fill(GroupTint.fill(pill.tone))
                if pill.tone == .idle { CapsuleRing().fill(Color.secondary.opacity(0.35), style: FillStyle(eoFill: true)) }
            }
    }
}

/// A one point ring drawn as a fill, because a stroked Capsule leaves small nubs at its ends.
private struct CapsuleRing: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Capsule().path(in: rect)
        path.addPath(Capsule().path(in: rect.insetBy(dx: 1, dy: 1)))
        return path
    }
}

/// A pull request's status and link. When the next-step line already said the status, only the link shows.
private struct PullView: View {
    let pull: PullStatus
    let row: SessionRow
    let said: Bool

    var body: some View {
        let line = GroupRules.pullLine(pull, row)
        VStack(alignment: .leading, spacing: 2) {
            if !said { Text(verbatim: line.text).font(.callout.weight(.medium)).foregroundStyle(GroupTint.color(line.tone)) }
            if let url = URL(string: pull.url) {
                Link(destination: url) { Text(verbatim: pull.url).font(.caption).underline().lineLimit(2).multilineTextAlignment(.leading) }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Pull request \(pull.number)")
            }
        }
    }
}

private struct CardButton: View {
    let title: String
    let icon: String
    let label: String
    var expanded: Bool?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 3) {
                if expanded == nil { Image(systemName: icon) }
                Text(title)
                if expanded != nil { Image(systemName: icon).font(.system(size: 9, weight: .semibold)) }
            }
            .font(.caption)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help(label)
        .accessibilityLabel(label)
        .accessibilityValue(expanded.map { $0 ? "expanded" : "collapsed" } ?? "")
    }
}

/// The whole of the session's latest reply, read when the card opens and again when the session moves.
private struct DetailsView: View {
    @Environment(GroupCards.self) private var cards
    @Environment(AppModel.self) private var app
    let row: SessionRow
    @State private var model: ChatModel?

    var body: some View {
        let stamp = GroupRules.stamp(row)
        let held = cards.replies[row.id]
        VStack(alignment: .leading, spacing: 6) {
            if let held {
                if (held.summary.reply ?? "").isEmpty {
                    Text("No reply yet.").font(.callout).foregroundStyle(.secondary)
                } else if let model {
                    // NOTE: [8 Nov 2026] EK - The markdown view reads a ChatModel from the environment for its code blocks. This one never runs, so it opens no stream and marks nothing read.
                    MarkdownView(blocks: ChatMarkdown.parse(held.summary.reply ?? ""), font: ChatStyle.small)
                        .environment(model)
                        .textSelection(.enabled)
                        .accessibilityLabel("Latest reply of \(row.title.isEmpty ? SidebarOutline.untitled : row.title)")
                }
            } else if let problem = cards.replyProblems[row.id] {
                Text("Could not load the reply: \(problem)").font(.callout).foregroundStyle(.secondary)
            } else {
                Text("Loading the reply").font(.callout).foregroundStyle(.secondary)
            }
        }
        .padding(.top, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            if model == nil, let client = app.client { model = ChatModel(chat: ChatContext(sessionID: row.id, client: client)) }
        }
        .task(id: stamp) { await cards.readReply(row) }
    }
}
