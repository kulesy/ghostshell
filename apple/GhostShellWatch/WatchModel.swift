import Foundation
import GhostShellKit
import Observation

/// What the watch screens show. Every answer comes through the relay, and a reply is kept in the outbox before it is sent.
@Observable @MainActor
final class WatchModel {
    enum Load<Value: Equatable>: Equatable {
        case loading
        case loaded(Value)
        case problem(WatchProblem)
    }

    private(set) var list: Load<[WatchRow]> = .loading
    private(set) var session: Load<WatchSession> = .loading
    private(set) var kept: [PendingReply]
    /// Sessions whose reply is on its way, and the sessions whose reply just reached the server.
    private(set) var sending: Set<String> = []
    private(set) var sent: Set<String> = []
    /// Why the last try at a kept reply failed.
    private(set) var failure: [String: WatchProblem] = [:]
    /// Sessions whose answer found its question already answered, on the iPhone, the Mac or by the turn ending.
    private(set) var answeredElsewhere: Set<String> = []

    private let relay: any Relay
    private let outbox: WatchOutbox
    private var shownSession: String?

    init(relay: any Relay, store: any WatchStore) {
        self.relay = relay
        outbox = WatchOutbox(store: store)
        kept = outbox.replies
    }

    func refreshList() async {
        let answer = await relay.ask(WatchRequest(.waiting))
        switch answer.body {
        case .waiting(let rows): list = .loaded(rows)
        case .problem(let problem): list = .problem(problem)
        case .session, .sent, .answeredElsewhere: list = .problem(.outOfDate)
        }
    }

    func refreshSession(_ id: String) async {
        if shownSession != id { shownSession = id; session = .loading }
        let answer = await relay.ask(WatchRequest(.session(id: id)))
        guard shownSession == id else { return }
        switch answer.body {
        case .session(let loaded): session = .loaded(loaded)
        case .problem(let problem): session = .problem(problem)
        case .waiting, .sent, .answeredElsewhere: session = .problem(.outOfDate)
        }
    }

    func closeSession() { shownSession = nil }

    func keptReply(for id: String) -> PendingReply? { kept.first { $0.sessionID == id } }

    /// Keeps `text` first, then sends it. Returns false for text the outbox refuses.
    @discardableResult
    func reply(_ text: String, to id: String, title: String) async -> Bool {
        guard let pending = outbox.keep(text, for: id, title: title) else { return false }
        kept = outbox.replies
        await send(pending)
        return true
    }

    /// Keeps `text` as the answer to `prompt`, then sends it through `decide` on the iPhone. A tapped option and a typed answer both come here.
    @discardableResult
    func answer(_ text: String, to prompt: WatchPrompt, in row: WatchRow) async -> Bool {
        guard prompt.answerable, let pending = outbox.keepAnswer(text, question: prompt.text, requestID: prompt.requestID, for: row.id, title: row.title) else { return false }
        kept = outbox.replies
        await send(pending)
        return true
    }

    func sendAgain(_ id: String) async {
        if let pending = keptReply(for: id) { await send(pending) }
    }

    func discard(_ id: String) {
        outbox.discard(sessionID: id)
        kept = outbox.replies
        failure[id] = nil
        answeredElsewhere.remove(id)
    }

    private func send(_ pending: PendingReply) async {
        guard sending.insert(pending.sessionID).inserted else { return }
        defer { sending.remove(pending.sessionID) }
        failure[pending.sessionID] = nil
        sent.remove(pending.sessionID)
        answeredElsewhere.remove(pending.sessionID)
        let request: WatchRequest
        if let requestID = pending.requestID, let question = pending.question {
            request = WatchRequest(.answer(id: pending.sessionID, requestID: requestID, question: question, text: pending.text, answerID: pending.replyID))
        } else {
            request = WatchRequest(.reply(id: pending.sessionID, text: pending.text, replyID: pending.replyID))
        }
        let answer = await relay.ask(request)
        switch answer.body {
        case .sent:
            outbox.confirm(pending)
            sent.insert(pending.sessionID)
        case .answeredElsewhere:
            // The question is gone, so the kept answer has nothing to wait for.
            outbox.confirm(pending)
            answeredElsewhere.insert(pending.sessionID)
        case .problem(let problem):
            failure[pending.sessionID] = problem
        case .waiting, .session:
            failure[pending.sessionID] = .outOfDate
        }
        kept = outbox.replies
        if pending.isAnswer, shownSession == pending.sessionID { await refreshSession(pending.sessionID) }
    }
}
