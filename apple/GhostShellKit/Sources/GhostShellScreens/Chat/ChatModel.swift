import GhostShellKit
import Observation
import SwiftUI

/// Everything one open chat shows: the loaded thread, the reply as it is written and the line under it. It owns the chat's event stream, so the stream
/// is open only while this chat is on screen.
@Observable @MainActor
final class ChatModel {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    /// Whose turn the line under the thread describes: this app's own, or one another app runs in a chat this app is not working on.
    enum Turn { case none, own, outside }

    let chat: ChatContext
    private(set) var phase = Phase.loading
    private(set) var rows: [ChatRow] = []
    private(set) var hasEarlier = false
    private(set) var loadingEarlier = false
    private(set) var live = ""
    private(set) var think: ChatThink?
    private(set) var work: ChatWork?
    private(set) var turnStart: Date?
    private(set) var outside: ChatWork?
    private(set) var outsideStart: Date?
    private(set) var agents: [HeardAgent] = []
    private(set) var notice = ""
    /// Counts up each time older items are put in front, so the thread can put the reader back where they were.
    private(set) var earlierCount = 0
    /// Changes at each local midnight, which is when the words of a message time can change.
    private(set) var today = Date()
    /// The groups and tool rows the reader has opened, by key. Held here because a row that scrolls out of view is built again when it returns.
    private(set) var opened: Set<String> = []

    var turn: Turn {
        switch chat.status?.state ?? .idle {
        case .working: .own
        case .idle: outside != nil ? .outside : .none
        default: .none
        }
    }

    var isEmpty: Bool { rows.isEmpty }

    @ObservationIgnored private var thread = ChatThread()
    @ObservationIgnored private var start = 0
    @ObservationIgnored private var end = 0
    @ObservationIgnored private var closed = false
    @ObservationIgnored private var fetching = false
    @ObservationIgnored private var again = false
    /// Once a turn ends the streamed text stays up until the transcript holds the real message, so it never blinks out.
    @ObservationIgnored private var ended = false
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var parsed: [String: (text: String, blocks: [MDBlock])] = [:]

    init(chat: ChatContext) {
        self.chat = chat
        chat.refreshHandler = { [weak self] in self?.fetchNew() }
    }

    // MARK: Running

    /// Reads the history, then follows the stream until the caller's task is cancelled. A nudge from `reconnects` opens the stream again at once.
    func run(reconnects: ReconnectSignal? = nil) async {
        await load()
        guard !closed, !Task.isCancelled else { return }
        var nudges: (@Sendable () -> AsyncStream<Void>)?
        if let reconnects { nudges = { reconnects.nudges() } }
        for await raw in chat.client.eventStream(sessionID: chat.sessionID).events(restartedBy: nudges) {
            if closed { break }
            chat.publish(raw)
            handle(ChatEvent(raw))
        }
    }

    func close() {
        closed = true
        fetchTask?.cancel()
        chat.refreshHandler = nil
        chat.close()
    }

    /// Re-reads the history after it failed. The stream is already open, and a reply that finished meanwhile is a row now.
    func retry() async {
        guard case .failed = phase else { return }
        notice = ""
        await load()
        if phase == .loaded { live = ""; think = nil; fetchNew() }
    }

    func dismissNotice() { notice = "" }

    func toggle(_ key: String) {
        if opened.contains(key) { opened.remove(key) } else { opened.insert(key) }
    }

    /// Wakes at each local midnight so the times that say "Yesterday" move on. The caller's task ends it.
    func keepDay() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(ChatTime.untilMidnight()))
            if !Task.isCancelled { today = Date() }
        }
    }

    // MARK: Reading the transcript

    private func load() async {
        do {
            let page = try await chat.client.messages(sessionID: chat.sessionID)
            guard !closed, !Task.isCancelled else { return }
            if let info = page.session { chat.session = info }
            chat.fileLinks = page.fileLinks
            chat.terminalAvailable = page.terminal
            thread = ChatThread()
            thread.absorb(page.items)
            (start, end, hasEarlier) = (page.start, page.end, page.hasEarlier)
            settleSending(by: page.items)
            parsed = [:]
            rebuild()
            phase = .loaded
        } catch {
            guard !closed, !Task.isCancelled else { return }
            phase = .failed(Self.words(error))
        }
    }

    /// One read at a time: an event that arrives meanwhile asks for another once this one is done.
    private func fetchNew() {
        guard phase == .loaded, !closed else { return }
        if fetching { again = true; return }
        fetching = true
        fetchTask = Task { [weak self] in
            while let self, !self.closed, !Task.isCancelled {
                await self.readNew()
                guard self.again else { break }
                self.again = false
            }
            self?.fetching = false
        }
    }

    private func readNew() async {
        do {
            let page = try await chat.client.messages(sessionID: chat.sessionID, after: end)
            guard !closed, !Task.isCancelled else { return }
            let over = ended
            let clearLive = over || page.items.contains { if case .assistant = $0.body { true } else { false } }
            ended = false
            if let names = page.session?.connectors, names != chat.session.connectors { chat.session.connectors = names }
            if page.reset { thread.removeAll(); parsed = [:] }
            thread.absorb(page.items)
            // An incremental read never ends earlier than the last one, so a reply without an end leaves it alone.
            end = page.reset ? page.end : max(end, page.end)
            if page.reset { (start, hasEarlier) = (page.start, page.hasEarlier) }
            settleSending(by: page.items)
            if clearLive { live = "" }
            let saved = think?.done == true && page.items.contains { item in
                if case .thinking(let id, _) = item.body { id == think?.id } else { false }
            }
            if over || saved { think = nil }
            if page.reset || !page.items.isEmpty { rebuild() }
        } catch {
            guard !closed, !Task.isCancelled else { return }
            notice = Self.words(error)
        }
    }

    /// `beforePutting` runs just before the older items go in front, so the thread can note which row the reader is on at that moment.
    func loadEarlier(beforePutting note: () -> Void = {}) async {
        guard hasEarlier, !loadingEarlier, phase == .loaded, !closed else { return }
        loadingEarlier = true
        defer { loadingEarlier = false }
        do {
            let page = try await chat.client.messages(sessionID: chat.sessionID, before: start)
            guard !closed, !Task.isCancelled else { return }
            note()
            let before = rows
            thread.prepend(page.items)
            (start, hasEarlier) = (page.start, page.hasEarlier)
            rebuild()
            // Older items can join the top group and change its id, so an opened group moves to the new id.
            if let top = before.first, opened.contains(top.id), let now = ChatRow.id(holding: top.itemKeys, in: rows), now != top.id {
                opened.remove(top.id)
                opened.insert(now)
            }
            earlierCount += 1
        } catch {
            guard !closed, !Task.isCancelled else { return }
            notice = Self.words(error)
        }
    }

    private func rebuild() { rows = ChatFold.display(thread.items) }

    /// A message the composer is still sending and the transcript's copy of it are one message when the words and the number of pictures match.
    private func settleSending(by items: [ChatItem]) {
        guard !chat.sending.isEmpty else { return }
        for sent in chat.sending {
            let match = items.contains { item in
                guard case .user(let message) = item.body else { return false }
                return message.text.trimmingCharacters(in: .whitespacesAndNewlines) == sent.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    && message.images.count == sent.imageCount && (sent.fileCount == 0 || message.files.count == sent.fileCount)
            }
            if match { chat.endSending(sent.id) }
        }
    }

    private static func words(_ error: Error) -> String { error.localizedDescription }

    // MARK: Markdown

    /// A reply's Markdown, read once while its text stays the same. A longer text for the same item is read again.
    func blocks(key: String, text: String) -> [MDBlock] {
        if let held = parsed[key], held.text == text { return held.blocks }
        let fresh = ChatMarkdown.parse(text, fileLinks: chat.fileLinks)
        parsed[key] = (text, fresh)
        return fresh
    }

    // MARK: Events

    private static func began(_ work: ChatWork?) -> Date? { work.map { Date().addingTimeInterval(-Double($0.turnMs) / 1000) } }

    private func handle(_ event: ChatEvent) {
        var status = chat.status ?? ChatStatus()
        if status.apply(event) { chat.apply(status: status) }
        switch event {
        case .status(let status):
            ended = false
            live = status.live
            think = status.think
            work = status.work
            turnStart = Self.began(status.work)
            outside = status.outside
            outsideStart = Self.began(status.outside)
            notice = ""
            // A fresh stream after a failed read means the server is reachable again.
            if case .failed = phase { Task { await retry() } } else { fetchNew() }
        case .state(let state):
            if state == .idle { (work, turnStart) = (nil, nil) } else { (outside, outsideStart) = (nil, nil) }
        case .delta(let text):
            let fresh = ended
            ended = false
            live = (fresh ? "" : live) + text
        case .think(let id, let text, let done):
            if done {
                if var shown = think, shown.id == id { shown.done = true; think = shown }
            } else {
                think = ChatThink(id: id, text: (think?.id == id ? think?.text ?? "" : "") + (text ?? ""), done: false)
            }
        case .work(let fresh):
            // A later report can only move the start earlier, so a slow one never steps the timer back.
            if let fresh, let begun = Self.began(fresh) {
                turnStart = work != nil ? min(turnStart ?? begun, begun) : begun
            } else {
                turnStart = nil
            }
            work = fresh
        case .outside(let fresh):
            if let fresh, let begun = Self.began(fresh) {
                outsideStart = outside?.startedAt == fresh.startedAt ? min(outsideStart ?? begun, begun) : begun
            } else {
                outsideStart = nil
            }
            outside = fresh
        case .subagents(let list):
            agents = ChatAgents.heard(before: agents, list: list)
        case .changed:
            fetchNew()
        case .turnEnd(let failed, let message):
            ended = true
            if failed { notice = message ?? "The last turn ended with an error." }
            fetchNew()
        case .error(let message):
            notice = message
        case .exit:
            (work, turnStart) = (nil, nil)
        case .approval, .approvalResolved, .hold, .holdEnded, .mode, .model, .effort, .fast, .terminal, .other:
            break
        }
    }
}
