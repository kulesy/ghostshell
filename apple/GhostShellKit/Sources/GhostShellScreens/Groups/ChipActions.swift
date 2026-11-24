import GhostShellKit
import Observation
import SwiftUI

/// What a chat knows of its chips: the server's record of each, read when a chip first shows, and the presses in flight. One per open chat, kept in `ChatContext.store`.
@Observable @MainActor
final class ChipStore {
    private(set) var chips: [String: ChipRecord] = [:]
    private(set) var busy: Set<String> = []
    private(set) var problems: [String: String] = [:]
    /// The words for a chip the server has not stored, and the accounts the card's line and menu name. The names come only from the accounts list.
    private(set) var accountDefault: ChipAccountCard?
    private(set) var accounts: [Account]?
    /// The owner's pick on each card, kept for as long as the chat is open.
    private(set) var picks: [String: ChipPick] = [:]
    private(set) var signingIn: Set<String> = []
    @ObservationIgnored private var accountsKey: String?
    @ObservationIgnored private var accountsAt = Date.distantPast
    @ObservationIgnored private var asking = false
    @ObservationIgnored private var pinsSeen: String?
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
            if let list = try? await client.chipList(sessionID: sessionID) {
                for chip in list.chips { chips[chip.toolUseId] = chip }
                accountDefault = list.accountDefault
            }
        }
        inflight = task
        await task.value
        inflight = nil
    }

    func pick(_ choice: ChipPick, for toolID: String) { picks[toolID] = choice }

    /// Reads the accounts, at most once in three seconds unless `force`. A change in who is listed, signed in or active asks for the cards again.
    func loadAccounts(force: Bool = false) async {
        guard !asking, force || Date().timeIntervalSince(accountsAt) > 3 else { return }
        asking = true
        defer { asking = false }
        guard let list = try? await client.accounts() else { return }
        await take(list.accounts)
    }

    private func take(_ list: [Account]) async {
        accountsAt = Date()
        let key = list.map { "\($0.id)|\($0.name)|\($0.signedOut)|\($0.active)" }.joined(separator: ",")
        let changed = accountsKey != nil && accountsKey != key
        accounts = list
        accountsKey = key
        if changed { await reload() }
    }

    /// A card drawn from the pins is asked for again when a pin moves.
    func pins(_ key: String) async {
        defer { pinsSeen = key }
        if let seen = pinsSeen, seen != key { await reload() }
    }

    func signIn(_ toolID: String, account: String) async {
        guard signingIn.insert(toolID).inserted else { return }
        defer { signingIn.remove(toolID) }
        problems[toolID] = nil
        do { await take(try await client.signIn(account: account).accounts) } catch { problems[toolID] = error.localizedDescription }
    }

    /// `line` is the account line the card showed. Start posts what it holds, and is refused here when the card disabled it.
    func press(start: Bool, _ call: ToolCall, folder: String, line: ChipAccountLine? = nil) async {
        if start, let line, !line.ok { return }
        guard busy.insert(call.id).inserted else { return }
        defer { busy.remove(call.id) }
        problems[call.id] = nil
        let input = call.input
        func text(_ key: String) -> String? { input[key]?.string.flatMap { $0.isEmpty ? nil : $0 } }
        let request = ChipRequest(sessionID: sessionID, toolUseID: call.id, title: text("title") ?? "", tldr: text("tldr") ?? "", prompt: text("prompt") ?? "", cwd: text("cwd"),
                                  folder: folder, model: text("model"), effort: text("effort"), account: start ? line?.post : nil)
        do {
            let result = start ? try await client.startChip(request) : try await client.dismissChip(request)
            chips[call.id] = result.chip ?? ChipRecord(toolUseId: call.id, sessionId: sessionID, status: start ? .started : .dismissed, startedId: result.id)
            await refreshIndex()
        } catch GhostShellError.refused(let status, let message, _, _) where status == 409 || (status == 400 && start && line != nil) {
            // Another screen settled it first, or the account the card showed is not the one it would start on. The refusal's body is not kept, so the list says how.
            // The card and the accounts are read again and nothing is posted a second time.
            checked.insert(call.id)
            await reload()
            if line != nil { await loadAccounts(force: true) }
            if chips[call.id]?.status == .open || chips[call.id] == nil { problems[call.id] = message }
        } catch {
            problems[call.id] = error.localizedDescription
        }
    }
}

/// Start and Dismiss under a suggested task, and once it is settled what became of it. With more than one account listed an open card also says which account
/// Start uses and where that comes from, and offers Change account and Sign in.
struct ChipActions: View {
    @Environment(AppModel.self) private var app
    let call: ToolCall
    let chat: ChatContext

    var body: some View {
        let store = chat.store(ChipStore.self) { ChipStore(client: chat.client, sessionID: chat.sessionID, refreshIndex: { [app] in await app.refreshIndex() }) }
        let record = store.chips[call.id]
        let busy = store.busy.contains(call.id)
        let folder = GroupRules.chipFolder(record: record?.cwd, input: call.input["cwd"]?.string, session: chat.session.cwd)
        // The card's account words are the server's: the chip's own, or for a chip it has not stored the default for this chat. The account is the chip's, never the tool input's.
        let card = (record?.status ?? .open) == .open ? (record?.accountCard ?? (record == nil ? store.accountDefault : nil)) : nil
        let line = chipAccount(card: card, accounts: store.accounts, named: record?.account, pick: store.picks[call.id])
        let signing = line?.state == .signedOut ? store.accounts?.first { $0.id == line?.id } : nil
        let failure = signing?.stage == .failed ? signing?.problem ?? "" : ""
        let problem = store.problems[call.id] ?? (failure.isEmpty ? nil : failure)
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
                if let line { ChipAccountLineView(line: line) }
                ChipFlow(spacing: 8) {
                    Button("Start") { Task { await store.press(start: true, call, folder: folder, line: line) } }
                        .buttonStyle(.ghost(.primary, size: .compact))
                        .disabled(busy || (line.map { !$0.ok } ?? false))
                    if let line, let card, let accounts = store.accounts {
                        if line.state == .signedOut, let id = line.id {
                            let waiting = signing?.stage == .waiting
                            Button(waiting ? "Waiting for the Mac" : "Sign in to \(line.name)") { Task { await store.signIn(call.id, account: id) } }
                                .buttonStyle(.ghost(.outline, size: .compact))
                                .disabled(waiting || store.signingIn.contains(call.id))
                        }
                        ChipAccountMenu(accounts: accounts, card: card, line: line) { store.pick($0, for: call.id) }
                    }
                    Button("Dismiss") { Task { await store.press(start: false, call, folder: folder) } }
                        .buttonStyle(.ghost(.outline, size: .compact))
                        .disabled(busy)
                    if busy { ProgressView().controlSize(.small) }
                }
            }
            if let opens = record?.opensIn, !opens.isEmpty { Text(verbatim: opens).font(ChatStyle.small).foregroundStyle(.secondary) }
            if let problem {
                Text(verbatim: problem).font(ChatStyle.small).foregroundStyle(GroupTint.color(.error)).accessibilityLabel("Not done: \(problem)")
            }
        }
        .padding(.top, 6)
        .task(id: call.id) { await store.load(call.id) }
        .task(id: card != nil) { if card != nil { await store.loadAccounts() } }
        .task(id: line?.state == .signedOut ? (signing?.stage == .waiting ? 2 : 5) : 0) {
            let seconds = line?.state == .signedOut ? (signing?.stage == .waiting ? 2 : 5) : 0
            while seconds > 0, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(seconds))
                if !Task.isCancelled { await store.loadAccounts(force: true) }
            }
        }
        .task(id: pinsKey(app.index)) { await store.pins(pinsKey(app.index)) }
    }
}

/// The sentence under the folder that says which account Start uses and why, in red when Start is stopped, and the chip's note that it leaves its place's pin.
private struct ChipAccountLineView: View {
    let line: ChipAccountLine

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: line.line)
                .foregroundStyle(line.ok ? Color.secondary : GroupTint.color(.error))
                .accessibilityIdentifier("chip-account-line")
            if !line.replaces.isEmpty { Text(verbatim: line.replaces).foregroundStyle(.secondary) }
        }
        .font(ChatStyle.monoSmall)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// The Change account control: follow the pins, or one listed account. Its menu is the Account menu's, as `OrganiseMenus` draws it.
private struct ChipAccountMenu: View {
    let accounts: [Account]
    let card: ChipAccountCard
    let line: ChipAccountLine
    let pick: (ChipPick) -> Void

    var body: some View {
        Menu {
            ForEach(chipAccountItems(accounts: accounts, card: card, line: line)) { item in
                Toggle(item.value.map { "\(item.label) (\($0))" } ?? item.label, isOn: Binding(get: { item.checked }, set: { _ in if let choice = item.pick { pick(choice) } }))
                    .disabled(!item.picks)
            }
        } label: {
            Text("Change account")
        }
        .menuStyle(.button)
        .menuIndicator(.hidden)
        .buttonStyle(.ghost(.ghost, size: .compact))
        .fixedSize()
        .accessibilityLabel("Change account")
    }
}
