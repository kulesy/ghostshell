import GhostShellKit
import SwiftUI

/// The own chat of a group or of one of Home's built-in sections, beside the Sub sessions panel that lists the group's sessions as cards.
struct GroupScreen: View {
    @Environment(AppModel.self) private var app
    let id: String
    @State private var booked: String?
    @State private var problem = ""
    @State private var attempt = 0
    @State private var showPanel = false

    var body: some View {
        let pane = GroupRules.pane(app.index, id)
        Group {
            switch pane {
            case .unloaded: Stub(title: "Sessions did not load", text: "GhostShell could not be reached. This opens when the list does.", kind: kind)
            case .unsupported(let kind):
                Stub(title: "Restart GhostShell to talk to a \(kind.lowercased())",
                     text: "This GhostShell started before \(kind == "Group" ? "groups" : "sections") had sessions of their own. Restart it to open one.", kind: kind)
            case .missing(let kind):
                Stub(title: "\(kind) not found", text: (kind == "Group" ? "It may have been deleted. " : "") + "Pick another from the list.", kind: kind)
            case .ready(let target): ready(target)
            }
        }
        .navigationTitle(title(pane))
    }

    private var kind: String { GroupRules.sectionName(id) == nil ? "Group" : "Section" }

    private func title(_ pane: GroupPane) -> String {
        if case .ready(let target) = pane { return target.name }
        return "\(kind) session"
    }

    @ViewBuilder private func ready(_ target: GroupTarget) -> some View {
        if let session = target.chat?.id ?? booked {
            GroupLayout(target: target, session: session, showPanel: $showPanel)
        } else {
            Stub(title: problem.isEmpty ? "Opening the session" : "Could not open the session", text: problem.isEmpty ? "Getting \(target.name) ready." : problem, kind: kind,
                 retry: problem.isEmpty ? nil : { attempt += 1 })
                .task(id: attempt) { await book() }
        }
    }

    /// A group not yet opened is given its session first, which starts no process. The list brings the id on its next poll, and the chat opens now.
    private func book() async {
        guard let client = app.client else { return }
        problem = ""
        do { booked = try await client.groupSession(id) } catch { problem = error.localizedDescription }
    }
}

/// A pane with no chat in it: why, and a way to try again.
private struct Stub: View {
    let title: String
    let text: String
    let kind: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "bubble.left").font(.system(size: 28)).foregroundStyle(.secondary).accessibilityHidden(true)
            Text(title).font(.headline)
            Text(text).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 360)
            if let retry { Button("Try again", action: retry).padding(.top, 4) }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }
}

/// The chat and the panel. A pane too narrow for both shows one at a time, picked from a bar above them.
// NOTE: [8 Nov 2026] EK - The picker is not a toolbar item. Next to ChatScreen's own toolbar it made AppKit throw while registering a separator, which crashed the app.
private struct GroupLayout: View {
    @Environment(AppModel.self) private var app
    let target: GroupTarget
    let session: String
    @Binding var showPanel: Bool
    @State private var cards: GroupCards?

    private static let panelWidth: CGFloat = 320
    private static let both: CGFloat = 680

    var body: some View {
        GeometryReader { box in
            let narrow = box.size.width < Self.both
            VStack(spacing: 0) {
                if narrow {
                    Picker("Show", selection: $showPanel) {
                        Text("Chat").tag(false)
                        Text("Sub sessions").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .padding(8)
                    Divider()
                }
                HStack(spacing: 0) {
                    if !(narrow && showPanel) { ChatScreen(sessionID: session, title: target.name) }
                    if (showPanel || !narrow), let cards {
                        if !narrow { Divider() }
                        SubSessionsPanel(target: target, chat: session, cards: cards)
                            .frame(width: narrow ? nil : Self.panelWidth)
                            .frame(maxWidth: narrow ? .infinity : Self.panelWidth)
                    }
                }
            }
        }
        .onAppear { if cards == nil, let client = app.client { cards = GroupCards(client: client, refreshIndex: { [app] in await app.refreshIndex() }) } }
    }
}
