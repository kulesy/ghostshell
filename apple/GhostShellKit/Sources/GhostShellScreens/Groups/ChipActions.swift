import GhostShellKit
import Observation
import SwiftUI

/// What a chat knows of its chips: the server's record of each, read when a chip first shows, and the presses in flight. One per open chat, kept in `ChatContext.store`.
@Observable @MainActor
final class ChipStore {
    private(set) var chips: [String: ChipRecord] = [:]
    private(set) var busy: Set<String> = []
    private(set) var problems: [String: String] = [:]
    @ObservationIgnored private let client: GhostShellClient
    @ObservationIgnored private let sessionID: String
    @ObservationIgnored private let refreshIndex: @MainActor () async -> Void
    @ObservationIgnored private var checked: Set<String> = []
    @ObservationIgnored private var inflight: Task<Void, Never>?

    init(client: GhostShellClient, sessionID: String, refreshIndex: @escaping @MainActor () async -> Void) { (self.client, self.sessionID, self.refreshIndex) = (client, sessionID, refreshIndex) }

    /// Reads the chips list the first time a chip shows. A chip the server does not list is open, since it has been neither started nor dismissed.
    func load(_ toolID: String) async {
        guard chips[toolID] == nil, !checked.contains(toolID) else { return }
        if let inflight {
            await inflight.value
            if chips[toolID] != nil || checked.contains(toolID) { return }
        }
        checked.insert(toolID)
        await reload()
    }

    private func reload() async {
        let task = Task { [client, sessionID] in
            if let list = try? await client.chips(sessionID: sessionID) { for chip in list { chips[chip.toolUseId] = chip } }
        }
        inflight = task
        await task.value
        inflight = nil
    }

    func press(start: Bool, _ call: ToolCall, folder: String) async {
        guard busy.insert(call.id).inserted else { return }
        defer { busy.remove(call.id) }
        problems[call.id] = nil
        let input = call.input
        func text(_ key: String) -> String? { input[key]?.string.flatMap { $0.isEmpty ? nil : $0 } }
        let request = ChipRequest(sessionID: sessionID, toolUseID: call.id, title: text("title") ?? "", tldr: text("tldr") ?? "", prompt: text("prompt") ?? "", cwd: text("cwd"),
                                  folder: folder, model: text("model"), effort: text("effort"))
        do {
            let result = start ? try await client.startChip(request) : try await client.dismissChip(request)
            chips[call.id] = result.chip ?? ChipRecord(toolUseId: call.id, sessionId: sessionID, status: start ? .started : .dismissed, startedId: result.id)
            await refreshIndex()
        } catch GhostShellError.refused(409, let message, _, _) {
            // Another screen settled it first. The refusal's body is not kept, so the list says how.
            checked.insert(call.id)
            await reload()
            if chips[call.id]?.status == .open || chips[call.id] == nil { problems[call.id] = message }
        } catch {
            problems[call.id] = error.localizedDescription
        }
    }
}

/// Start and Dismiss under a suggested task, and once it is settled what became of it.
struct ChipActions: View {
    @Environment(AppModel.self) private var app
    let call: ToolCall
    let chat: ChatContext

    var body: some View {
        let store = chat.store(ChipStore.self) { ChipStore(client: chat.client, sessionID: chat.sessionID, refreshIndex: { [app] in await app.refreshIndex() }) }
        let record = store.chips[call.id]
        let busy = store.busy.contains(call.id)
        let folder = GroupRules.chipFolder(record: record?.cwd, input: call.input["cwd"]?.string, session: chat.session.cwd)
        VStack(alignment: .leading, spacing: 6) {
            if !folder.isEmpty { Text(verbatim: "Starts in \(folder)").font(ChatStyle.monoSmall).foregroundStyle(.secondary) }
            switch record?.status {
            case .started?:
                HStack(spacing: 8) {
                    Label("Started", systemImage: "checkmark.circle").font(.callout.weight(.medium)).foregroundStyle(GroupTint.color(.ready))
                    if let id = record?.startedId, !id.isEmpty { Button("Open") { app.navigator.openSession(id) }.phoneTouch(boxed: true).compactOnMac() }
                }
            case .dismissed?:
                Label("Dismissed", systemImage: "xmark.circle").font(.callout).foregroundStyle(.secondary)
            default:
                HStack(spacing: 8) {
                    Button("Start") { Task { await store.press(start: true, call, folder: folder) } }
                        .buttonStyle(.ghost(.primary, size: .compact))
                    Button("Dismiss") { Task { await store.press(start: false, call, folder: folder) } }
                        .buttonStyle(.ghost(.outline, size: .compact))
                    if busy { ProgressView().controlSize(.small) }
                }
                .disabled(busy)
            }
            if let opens = record?.opensIn, !opens.isEmpty { Text(verbatim: opens).font(ChatStyle.small).foregroundStyle(.secondary) }
            if let problem = store.problems[call.id] {
                Text(verbatim: problem).font(ChatStyle.small).foregroundStyle(GroupTint.color(.error)).accessibilityLabel("Not done: \(problem)")
            }
        }
        .padding(.top, 6)
        .task(id: call.id) { await store.load(call.id) }
    }
}
