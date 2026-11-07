import Foundation
import GhostShellKit
import Observation

/// What the footer's pickers can change.
enum ComposerSetting: Equatable {
    case mode(String), model(String), effort(String), fast(Bool)
}

/// The keys the text box hands to the slash list.
enum SlashKey { case up, down, accept }

/// The state of one composer: the text box, what is attached, the slash list and the settings. It sits in a chat's `store` for one visit, or belongs to
/// the New Session screen. What must outlive the visit is in `ComposerStore`.
@Observable @MainActor
final class ComposerModel {
    /// What a new session starts with, which the person may change before the first message.
    struct Fresh: Equatable {
        var mode: String?
        var model: String?
        var effort: String?
        var fast = false
        var touched: Set<String> = []
    }

    let client: GhostShellClient
    /// The chat this composer belongs to, or nil on the New Session screen.
    let chat: ChatContext?
    private let store = ComposerStore.shared
    @ObservationIgnored private let started: (String) -> Void

    var fresh = Fresh()
    /// The folder a new session starts in.
    var folder = ""
    var text: String { didSet { if text != oldValue { store.setText(text, for: draftID) } } }
    /// Where the caret is, or nil while text is selected.
    var caret: Int?
    var focused = false
    var composing = false
    var notice = ""
    private(set) var sending = false
    /// Where a pick put the caret. The box moves its caret when `serial` is new.
    struct Settle: Equatable { var at = 0, serial = 0 }
    private(set) var settle = Settle()
    /// Counts up when something outside the box, such as Quote, wants the cursor back in it.
    private(set) var focusRequests = 0
    private var dismissed: String?
    private var chosen: (query: String?, at: Int) = (nil, 0)

    private init(client: GhostShellClient, chat: ChatContext?, started: @escaping (String) -> Void) {
        self.client = client
        self.chat = chat
        self.started = started
        text = ComposerStore.shared.text(for: chat?.sessionID ?? DraftTexts.new)
    }

    /// The composer of an open chat, made on first use.
    static func of(_ chat: ChatContext) -> ComposerModel {
        chat.store(ComposerModel.self) { ComposerModel(client: chat.client, chat: chat, started: { _ in }) }
    }

    /// The composer of the New Session screen. `started` hears the id of the session the server made.
    static func newSession(client: GhostShellClient, started: @escaping (String) -> Void) -> ComposerModel {
        ComposerModel(client: client, chat: nil, started: started)
    }

    var draftID: String { chat?.sessionID ?? DraftTexts.new }
    func requestFocus() { focusRequests += 1 }

    // MARK: What the box holds

    var attachments: [Attachment] { store.attachments[draftID] ?? [] }
    var quotes: [Quote] { store.quotes }
    var preparing: Bool { attachments.contains(where: \.working) }
    var status: ChatStatus? { chat?.status }
    /// Working or waiting on the person, as the page counts it.
    var busy: Bool { status.map { $0.state == .working || $0.state == .waiting } ?? false }
    var ready: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty || !quotes.isEmpty }
    /// While Claude works and the box is empty, Send is Stop.
    var showsStop: Bool { busy && !ready }
    var canSend: Bool { ready && !preparing && !sending && (chat != nil || !folder.trimmingCharacters(in: .whitespaces).isEmpty) }

    // MARK: Settings

    var mode: String? { chat != nil ? status?.mode : fresh.mode }
    var shownModel: String? { chat != nil ? (status?.shownModel ?? status?.model) : fresh.model }
    var effort: String? { chat != nil ? status?.effort : fresh.effort }
    var fast: Bool { chat != nil ? status?.fast ?? false : fresh.fast }
    var listedModels: [ListedModel]? { store.modelLists[listKey ?? ""] }
    var takesFast: Bool { ComposerOptions.takesFast(shownModel, listed: listedModels) }

    // MARK: The slash list

    private var listKey: String? { chat.map { "id:\($0.sessionID)" } ?? (folder.isEmpty ? nil : "cwd:\(folder)") }
    private var target: GhostShellClient.ListTarget? { chat.map { .session($0.sessionID) } ?? (folder.isEmpty ? nil : .folder(folder)) }
    var commands: [SlashCommand]? { store.commandLists[listKey ?? ""]?.list }
    /// What follows the `/` while the first word is being typed with the caret in it.
    var slashQuery: String? { caret.flatMap { SlashRules.typed(in: text, caret: $0)?.query } }
    var wantsCommands: Bool { text.hasPrefix("/") && focused }
    var matches: [SlashCommand] { slashQuery.flatMap { q in commands.map { SlashRules.matching($0, query: q) } } ?? [] }
    var menuOpen: Bool { slashQuery != nil && focused && !composing && dismissed != slashQuery && !matches.isEmpty }
    var highlighted: Int { menuOpen ? (chosen.query == slashQuery ? min(chosen.at, matches.count - 1) : 0) : -1 }
    var hint: String { SlashRules.hint(for: commands, text: text) }

    func loadCommands() async {
        guard let key = listKey, let target else { return }
        if let held = store.commandLists[key], Date().timeIntervalSince(held.at) < 60 { return }
        if let list = try? await client.commands(target) { store.store(commands: list, for: key) }
    }

    func loadModels() async {
        guard let key = listKey, let target, store.modelLists[key] == nil else { return }
        if let list = try? await client.models(target) { store.store(models: list, for: key) }
    }

    func choose(_ command: SlashCommand) {
        let next = SlashRules.pick(command.name, in: text)
        text = next.text
        settle = Settle(at: next.caret, serial: settle.serial + 1)
        caret = next.caret
    }

    /// True when the key was used by the list.
    func slashKey(_ key: SlashKey) -> Bool {
        guard menuOpen else { return false }
        switch key {
        case .up, .down:
            chosen = (slashQuery, max(0, min(highlighted + (key == .down ? 1 : -1), matches.count - 1)))
        case .accept:
            choose(matches[highlighted])
        }
        return true
    }

    /// Escape closes the list, and with no list it stops a busy chat. True when it did either.
    func escape() -> Bool {
        if menuOpen { dismissed = slashQuery; return true }
        if chat != nil, busy { Task { await stop() }; return true }
        return false
    }

    // MARK: Attaching

    func attach(_ items: [Incoming]) {
        Task { await store.attach(items, to: draftID, client: client) { [weak self] in self?.notice = $0 } }
    }

    func attach(urls: [URL]) {
        Task {
            let items = await Incoming.read(urls)
            if items.count < urls.count { notice = "Some of those files could not be read." }
            await store.attach(items, to: draftID, client: client) { [weak self] in self?.notice = $0 }
        }
    }

    func remove(_ attachment: Attachment) { store.remove(attachment.id, from: draftID) }
    func remove(_ quote: Quote) { store.removeQuote(quote.key) }

    // MARK: Sending

    func send() async {
        guard canSend else { return }
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let held = attachments
        let heldQuotes = quotes
        let files = held.compactMap(\.file)
        if SlashRules.isCommand(typed) && !files.isEmpty { notice = "Send a slash command on its own, without files."; return }
        // A slash command has to stay first to run, so the quotes wait for the next message.
        let (words, kept) = QuoteRules.messageFor(heldQuotes, text: typed, here: chat?.sessionID)
        let pictures = held.compactMap(\.image)
        let message = OutgoingMessage(text: words, mode: mode, images: pictures.map(\.outgoing), files: files.map(\.id))
        text = ""
        _ = store.takeAttachments(from: draftID)
        store.setQuotes(kept)
        notice = ""
        sending = true
        let sent = await deliver(message)
        sending = false
        guard !sent else { return }
        text = text.isEmpty ? typed : typed + "\n" + text
        store.restore(held, to: draftID)
        store.setQuotes(heldQuotes + store.quotes.filter { q in !heldQuotes.contains { $0.key == q.key } })
    }

    private func deliver(_ message: OutgoingMessage) async -> Bool {
        if let chat {
            let mine = chat.beginSending(SendingMessage(text: message.text, imageCount: message.images.count, fileCount: message.files.count))
            do {
                var reply = try await client.sendMessage(message, to: chat.sessionID).status
                // Each change of fast mode reaches the chat over its stream, and a reply can be older than the last one.
                if let now = chat.status { reply.fast = now.fast }
                chat.apply(status: reply)
                chat.refresh()
                return true
            } catch {
                chat.endSending(mine)
                notice = "Not sent: \(ComposerWords.failure(error))"
                return false
            }
        }
        let place = folder.trimmingCharacters(in: .whitespaces)
        let request = NewSessionRequest(cwd: place, message: message,
                                        model: fresh.touched.contains("model") ? fresh.model : nil,
                                        effort: fresh.touched.contains("effort") ? fresh.effort : nil,
                                        fast: fresh.touched.contains("fast") ? fresh.fast : nil)
        do {
            started(try await client.startSession(request))
            return true
        } catch {
            notice = "Not started: \(ComposerWords.failure(error))"
            return false
        }
    }

    func stop() async {
        guard let chat else { return }
        do { chat.apply(status: try await client.stop(sessionID: chat.sessionID)) } catch { notice = ComposerWords.failure(error) }
    }

    // MARK: Changing a setting

    func pick(_ setting: ComposerSetting) async {
        notice = ""
        guard let chat else {
            change(&fresh, setting)
            fresh.touched.insert(Self.kind(setting))
            return
        }
        let before = chat.status
        var shown = before ?? ChatStatus()
        change(&shown, setting)
        chat.apply(status: shown)
        do {
            switch setting {
            case .mode(let mode): try await client.setMode(mode, sessionID: chat.sessionID)
            case .model(let model): chat.apply(status: try await client.setModel(model, sessionID: chat.sessionID))
            case .effort(let effort): chat.apply(status: try await client.setEffort(effort, sessionID: chat.sessionID))
            case .fast(let fast): chat.apply(status: try await client.setFast(fast, sessionID: chat.sessionID))
            }
        } catch {
            // Only the setting that was tried goes back, so a change the stream reported meanwhile stays.
            if var now = chat.status, let before { change(&now, Self.previous(setting, in: before)); chat.apply(status: now) }
            notice = ComposerWords.failure(error)
        }
    }

    private static func kind(_ setting: ComposerSetting) -> String {
        switch setting {
        case .mode: "mode"
        case .model: "model"
        case .effort: "effort"
        case .fast: "fast"
        }
    }

    private static func previous(_ setting: ComposerSetting, in status: ChatStatus) -> ComposerSetting {
        switch setting {
        case .mode: .mode(status.mode ?? "")
        case .model: .model(status.shownModel ?? status.model ?? "")
        case .effort: .effort(status.effort ?? "")
        case .fast: .fast(status.fast)
        }
    }

    private func change(_ status: inout ChatStatus, _ setting: ComposerSetting) {
        switch setting {
        case .mode(let mode): status.mode = mode.isEmpty ? nil : mode
        case .model(let model): (status.model, status.shownModel) = (model, model)
        case .effort(let effort): status.effort = effort.isEmpty ? nil : effort
        case .fast(let fast): status.fast = fast
        }
    }

    private func change(_ fresh: inout Fresh, _ setting: ComposerSetting) {
        switch setting {
        case .mode(let mode): fresh.mode = mode
        case .model(let model): fresh.model = model
        case .effort(let effort): fresh.effort = effort
        case .fast(let fast): fresh.fast = fast
        }
    }

    /// The folder's own mode, model and effort, for the ones the person has not changed.
    func loadDefaults() async {
        let asked = folder.trimmingCharacters(in: .whitespaces)
        guard chat == nil, !asked.isEmpty, let found = try? await client.defaults(cwd: asked), asked == folder.trimmingCharacters(in: .whitespaces) else { return }
        if !fresh.touched.contains("mode") { fresh.mode = found.mode }
        if !fresh.touched.contains("model") { fresh.model = found.shownModel ?? found.model }
        if !fresh.touched.contains("effort") { fresh.effort = found.effort }
    }
}
