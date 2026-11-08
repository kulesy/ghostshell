import Foundation
import GhostShellKit
import Observation

/// What the server last said of one session, and the stamp of the row it was read for.
struct Heard: Sendable {
    var stamp: String
    var summary: SessionSummary
}

/// A reply box's state. It lives in `GroupCards` by session id, because a card is drawn afresh when its session moves to another part.
struct ReplyBoxState: Equatable {
    var open = false
    var text = ""
    var sending = false
    var problem = ""
}

/// A line at the foot of the list saying what just happened, with an Undo for an archive.
struct GroupToast: Identifiable {
    let id = UUID()
    var text: String
    var problem = false
    var undo: (@MainActor () -> Void)?
}

/// A question to ask before stopping a running session to archive it.
struct StopQuestion: Identifiable {
    let id: String
    var title: String
    var detail: String
}

/// Everything the Sub sessions panel of one group keeps between polls: summaries and pulls by session, which cards are open, the reply boxes and what an archive left.
/// Summaries and pulls are read again only for a row whose stamp moved. The panel never opens a session's event stream, because that marks the session read.
@Observable @MainActor
final class GroupCards {
    private(set) var said = Kept<Heard>()
    private(set) var replies = Kept<Heard>()
    private(set) var pulls = Kept<PullKept>()
    private(set) var failed = false
    private(set) var replyProblems: [String: String] = [:]
    var boxes: [String: ReplyBoxState] = [:]
    var opened: Set<String> = []
    var toast: GroupToast?
    var stopQuestion: StopQuestion?
    /// The session whose reply box has the keyboard, so a box drawn afresh in another part takes it back.
    var focusing: String?
    private(set) var archiving: Set<String> = []

    @ObservationIgnored let client: GhostShellClient
    @ObservationIgnored private let refreshIndex: @MainActor () async -> Void
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    /// `refreshIndex` reads the list again after a write, so a card moves at once and not at the next poll.
    init(client: GhostShellClient, refreshIndex: @escaping @MainActor () async -> Void) { (self.client, self.refreshIndex) = (client, refreshIndex) }

    func flip(_ id: String) {
        if !opened.insert(id).inserted { opened.remove(id) }
    }

    // MARK: Reading

    // NOTE: [8 Nov 2026] EK - No in-flight guard: a cancelled read stores nothing.
    /// Reads what is stale for the cards on screen and the pull requests of the group's live sessions. Cancelling it, as a newer list does, abandons what is out.
    func refresh(_ index: SessionIndex, chat: String, drawn: [SessionRow]) async {
        await readSummaries(index, drawn)
        await readPulls(index, chat: chat, tries: 0)
    }

    private func readSummaries(_ index: SessionIndex, _ drawn: [SessionRow]) async {
        guard index.features?.subStatus == true else { return }
        let onScreen = Set(drawn.map(\.id))
        for _ in 0..<3 {
            let ids = GroupRules.staleIDs(drawn, stamps: { said[$0]?.stamp })
            if ids.isEmpty { return }
            let stamps = Dictionary(drawn.map { ($0.id, GroupRules.stamp($0)) }, uniquingKeysWith: { first, _ in first })
            for batch in GroupRules.batches(ids) {
                do {
                    let reply = try await client.summaries(ids: batch)
                    for id in batch { said.set(id, Heard(stamp: stamps[id] ?? "", summary: reply[id] ?? SessionSummary(ask: nil))) }
                    said.trim(keeping: onScreen)
                    failed = false
                } catch {
                    if !Task.isCancelled { failed = true }
                    return
                }
            }
        }
    }

    private func readPulls(_ index: SessionIndex, chat: String, tries: Int) async {
        guard index.features?.pullStatus == true else { return }
        let scope = GroupRules.scope(index, chat: chat)
        let ids = GroupRules.pullsToAsk(scope, known: pulls)
        guard !ids.isEmpty, let answer = try? await client.pulls(ids: ids) else { return }
        let stamps = Dictionary(scope.map { ($0.id, GroupRules.stamp($0)) }, uniquingKeysWith: { first, _ in first })
        let now = Date()
        for id in ids { pulls.set(id, PullKept(stamp: stamps[id] ?? "", at: now, pulls: answer.pulls[id] ?? [], settling: answer.settling)) }
        pulls.trim(keeping: Set(scope.map(\.id)))
        // GitHub is still being read for some of them, so the server is asked again shortly.
        if answer.settling, tries < 10 {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { await readPulls(index, chat: chat, tries: tries + 1) }
        }
    }

    /// The whole of a session's latest reply, read when its card is opened and again when the session moves while it stays open.
    func readReply(_ row: SessionRow) async {
        let stamp = GroupRules.stamp(row)
        guard replies[row.id]?.stamp != stamp else { return }
        do {
            let reply = try await client.summaries(ids: [row.id], detail: true)
            replies.set(row.id, Heard(stamp: stamp, summary: reply[row.id] ?? SessionSummary(ask: nil)))
            replyProblems[row.id] = nil
        } catch {
            if !Task.isCancelled { replyProblems[row.id] = error.localizedDescription }
        }
    }

    /// The ids of the sessions that wait on the owner for a pull request.
    func needs(in rows: [SessionRow]) -> Set<String> { GroupRules.needs(rows, known: pulls) }

    // MARK: Reply boxes

    func box(_ id: String) -> ReplyBoxState { boxes[id] ?? ReplyBoxState() }

    func flipBox(_ id: String) {
        var box = box(id)
        box.open.toggle()
        boxes[id] = box
        focusing = box.open ? id : nil
    }

    func send(_ id: String, name: String) async {
        var box = box(id)
        let text = box.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !box.sending, !text.isEmpty else { return }
        box.sending = true
        box.problem = ""
        boxes[id] = box
        do {
            try await client.sendReply(text, to: id)
            boxes[id] = ReplyBoxState()
            focusing = nil
            say(GroupToast(text: "Sent to \(name)"))
            await refreshIndex()
        } catch {
            var failed = self.box(id)
            (failed.open, failed.sending, failed.problem) = (true, false, error.localizedDescription)
            boxes[id] = failed
        }
    }

    // MARK: Archiving

    /// Archives a card. A running session is asked about first, using the server's own refusal as the question when it refuses an unasked stop.
    func archive(_ row: SessionRow, running: Bool, rows: [SessionRow]) async {
        let name = row.title.isEmpty ? SidebarOutline.untitled : row.title
        let below = GroupRules.runningBelow(rows, row.id)
        if running || below > 0 {
            stopQuestion = StopQuestion(id: row.id, title: name, detail: GroupRules.stopDetail)
            return
        }
        await archive(id: row.id, name: name, stop: false)
    }

    func confirmStop(_ question: StopQuestion) async {
        stopQuestion = nil
        await archive(id: question.id, name: question.title, stop: true)
    }

    private func archive(id: String, name: String, stop: Bool) async {
        guard archiving.insert(id).inserted else { return }
        defer { archiving.remove(id) }
        do {
            let reply = try await client.archiveSession(id, stop: stop)
            say(GroupToast(text: OrganiseRules.archiveNote(archived: 1, total: 1, stopped: reply.stoppedCount, subs: reply.subs, name: name), undo: { [weak self] in Task { await self?.unarchive(id, name: name) } }))
            await refreshIndex()
        } catch GhostShellError.running(_, _, let message) where !stop {
            // The server says something is running that the list did not show, so the owner is asked as for a running card.
            stopQuestion = StopQuestion(id: id, title: name, detail: message.isEmpty ? GroupRules.stopDetail : message)
        } catch {
            say(GroupToast(text: error.localizedDescription, problem: true))
        }
    }

    private func unarchive(_ id: String, name: String) async {
        do {
            try await client.archiveSession(id, archived: false)
            say(GroupToast(text: "Unarchived \u{201C}\(name)\u{201D}."))
            await refreshIndex()
        } catch {
            say(GroupToast(text: error.localizedDescription, problem: true, undo: { [weak self] in Task { await self?.unarchive(id, name: name) } }))
        }
    }

    func say(_ fresh: GroupToast) {
        toast = fresh
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(fresh.undo == nil ? 4 : 10))
            if !Task.isCancelled, self?.toast?.id == fresh.id { self?.toast = nil }
        }
    }
}
