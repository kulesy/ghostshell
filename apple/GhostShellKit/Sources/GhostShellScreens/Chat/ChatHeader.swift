#if os(macOS)
import GhostShellKit
import SwiftUI

/// The page's chat head, fixed above the thread: the name, a line of mono under it, and the tools and the lamp on the right.
struct ChatHeader: View {
    @Environment(AppModel.self) private var app
    @Environment(ChatModel.self) private var model
    let title: String
    /// A group's own chat is not a row, so it has nothing to archive.
    let archivable: Bool
    @State private var asking = false
    @State private var failure: String?

    private static let rem = GhostMetrics.current.rem

    var body: some View {
        let chat = model.chat
        HStack(alignment: .center, spacing: 0.75 * Self.rem) {
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: title.isEmpty ? "Untitled" : title).font(.geist(Self.rem, weight: .bold)).foregroundStyle(Color.ghost.foreground).lineLimit(1)
                Text(verbatim: subtitle(chat)).font(.geistMono(0.75 * Self.rem)).foregroundStyle(Color.ghost.mutedForeground).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            HStack(spacing: 0.5 * Self.rem) {
                if archivable { archiveButton(chat) }
                AgentsButton()
                TerminalToggle(chat: chat).labelStyle(.iconOnly).buttonStyle(.ghost(.ghost, size: .icon))
                ChatLamp(state: lampState(chat)).accessibilityHidden(true)
            }
        }
        .padding(.horizontal, Self.rem).padding(.vertical, 0.65 * Self.rem)
        .frame(maxWidth: .infinity)
        .background(Color.ghost.background)
        .overlay(alignment: .bottom) { Hairline() }
        .confirmationDialog("Stop and archive \u{201C}\(title)\u{201D}?", isPresented: $asking) {
            Button("Stop and archive", role: .destructive) { archive(stop: true) }
        } message: { Text("It has a chat running, and archiving stops it.") }
        .alert("That did not work", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: { Text(failure ?? "") }
    }

    private func archiveButton(_ chat: ChatContext) -> some View {
        Button { if chat.status?.running == true { asking = true } else { archive(stop: false) } } label: {
            Label(chat.status?.running == true ? "Stop and archive" : "Archive", systemImage: "archivebox").labelStyle(.iconOnly)
        }
        .buttonStyle(.ghost(.ghost, size: .icon))
        .help("Archive")
    }

    /// Without `stop` the server refuses a chat that is running, which turns into the question.
    private func archive(stop: Bool) {
        let id = model.chat.sessionID
        Task {
            guard let client = app.client else { return }
            do {
                try await client.archiveSession(id, stop: stop)
            } catch GhostShellError.running {
                asking = true
            } catch {
                failure = error.localizedDescription
            }
            await app.refreshIndex()
        }
    }

    /// The folder, branch, routine, model and effort, as the page joins them.
    private func subtitle(_ chat: ChatContext) -> String {
        let session = chat.session
        let modelLabel = (chat.status?.shownModel ?? chat.status?.model).map { ComposerOptions.modelName($0) }
        let effort = chat.status?.effort.map(ComposerOptions.effortName)
        return [session.cwd.isEmpty ? nil : SidebarOutline.folderName(session.cwd), session.branch.isEmpty ? nil : session.branch,
                session.routine.map { "\($0) routine" }, modelLabel, effort]
            .compactMap { $0 }.joined(separator: "  ")
    }

    private func lampState(_ chat: ChatContext) -> String {
        switch chat.status?.state {
        case .working: "working"
        case .waiting: "waiting"
        default: chat.status?.outside != nil ? "working" : "idle"
        }
    }
}

/// The page's robot, drawn on a 24 unit grid.
private struct BotShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(12, 8)); path.addLine(to: p(12, 4)); path.addLine(to: p(8, 4))
        path.addRoundedRect(in: CGRect(x: rect.minX + 4 * s, y: rect.minY + 8 * s, width: 16 * s, height: 12 * s), cornerSize: CGSize(width: 2 * s, height: 2 * s))
        for (a, b) in [((2, 14), (4, 14)), ((20, 14), (22, 14)), ((15, 13), (15, 15)), ((9, 13), (9, 15))] as [((CGFloat, CGFloat), (CGFloat, CGFloat))] {
            path.move(to: p(a.0, a.1)); path.addLine(to: p(b.0, b.1))
        }
        return path
    }
}

/// The subagents the session has started, opened from the head. A green dot shows while one runs.
private struct AgentsButton: View {
    @Environment(ChatModel.self) private var model
    @State private var open = false
    private static let rem = GhostMetrics.current.rem

    var body: some View {
        let agents = model.agents
        if !agents.isEmpty {
            let summary = ChatAgents.summaryLine(agents)
            Button { open.toggle() } label: {
                BotShape().stroke(style: StrokeStyle(lineWidth: 2 * Self.rem / 24, lineCap: .round, lineJoin: .round)).frame(width: Self.rem, height: Self.rem)
            }
            .buttonStyle(.ghost(.ghost, size: .icon))
            .overlay(alignment: .topTrailing) {
                if !ChatAgents.parts(agents).running.isEmpty {
                    Circle().fill(Color.ghost.success).frame(width: 0.5 * Self.rem, height: 0.5 * Self.rem)
                        .overlay(Circle().stroke(Color.ghost.background, lineWidth: 2))
                        .padding(0.3125 * Self.rem).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
            .help("Subagents, \(summary)")
            .accessibilityLabel("Subagents, \(summary)")
            .accessibilityValue(open ? "expanded" : "collapsed")
            .popover(isPresented: $open, arrowEdge: .bottom) { AgentList(agents: agents).padding(12).frame(minWidth: 320) }
        }
    }
}
#endif
