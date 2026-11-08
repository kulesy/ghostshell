import Foundation

/// The iPhone's side of the relay: turns the watch's request into calls on the client it already holds and the answer into plain words. It adds no route
/// and builds no request of its own, so the client's rules (one request function, the token in the Cookie, Origin on a POST) apply to the watch too.
public actor WatchRelayHandler {
    private let ledger: WatchStore
    private let statusTimeout: Duration
    private var sending: [String: Task<WatchResponse.Body, Never>] = [:]
    private static let ledgerKey = "watchRelayDelivered"
    private static let ledgerSize = 50

    /// `ledger` remembers the replies already sent, so a watch that asks again after a lost answer does not message Claude twice.
    public init(ledger: any WatchStore, statusTimeout: Duration = .seconds(6)) {
        self.ledger = ledger
        self.statusTimeout = statusTimeout
    }

    /// A nil client is a phone that is signed out.
    public func handle(_ request: WatchRequest, client: GhostShellClient?) async -> WatchResponse {
        guard request.version == WatchRelay.version else { return WatchResponse(.problem(.outOfDate)) }
        guard let client else { return WatchResponse(.problem(.signedOut)) }
        switch request.action {
        case .waiting:
            return await answer { .waiting(Self.waitingRows(try await client.sessionIndex())) }
        case .session(let id):
            guard Self.isValid(sessionID: id) else { return WatchResponse(.problem(.invalid)) }
            return await answer { .session(try await self.session(id, client)) }
        case .reply(let id, let text, let replyID):
            let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard Self.isValid(sessionID: id), Self.isValid(replyID: replyID), !clean.isEmpty, clean.count <= WatchRelay.maxReplyCharacters else {
                return WatchResponse(.problem(.invalid))
            }
            return WatchResponse(await reply(clean, to: id, replyID: replyID, client))
        case .answer(let id, let requestID, let question, let text, let answerID):
            let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard Self.isValid(sessionID: id), Self.isValid(replyID: answerID), !requestID.isEmpty, requestID.count <= 200,
                  !question.isEmpty, question.count <= WatchRelay.maxQuestionCharacters, !clean.isEmpty, clean.count <= WatchRelay.maxReplyCharacters else {
                return WatchResponse(.problem(.invalid))
            }
            return WatchResponse(await answerCard(clean, question: question, requestID: requestID, in: id, answerID: answerID, client))
        }
    }

    // MARK: Rules

    /// The client's own rule for a session id, plus a length and character check, since this one arrives from another device.
    static func isValid(sessionID: String) -> Bool {
        !sessionID.isEmpty && sessionID.count <= 200 && !sessionID.contains("/")
            && !sessionID.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) || CharacterSet.whitespacesAndNewlines.contains($0) || "?#%".unicodeScalars.contains($0) }
    }

    static func isValid(replyID: String) -> Bool {
        !replyID.isEmpty && replyID.count <= 64 && replyID.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }

    /// Sessions waiting on the owner: those that need an answer first, then those that finished, each newest first. Archived sessions are left out.
    static func waitingRows(_ index: SessionIndex) -> [WatchRow] {
        let live = index.rows.filter { !$0.archived }
        func newest(_ dot: SessionDot) -> [SessionRow] {
            live.filter { $0.dot == dot }.sorted { ($0.sortAt ?? $0.lastActivityAt ?? .distantPast) > ($1.sortAt ?? $1.lastActivityAt ?? .distantPast) }
        }
        let rows = newest(.awaiting).map { ($0, WatchDot.awaiting) } + newest(.ready).map { ($0, WatchDot.ready) }
        return rows.prefix(WatchRelay.maxRows).map { row, dot in
            let folder = URL(fileURLWithPath: row.cwd).lastPathComponent
            return WatchRow(id: row.id, title: Self.title(row.title), dot: dot, line: row.cwd.isEmpty ? row.branch : folder)
        }
    }

    private static func title(_ text: String) -> String {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? "Untitled" : String(clean.prefix(80))
    }

    // MARK: One session

    private func session(_ id: String, _ client: GhostShellClient) async throws -> WatchSession {
        let page = try await client.messages(sessionID: id)
        let latest = page.items.reversed().lazy.compactMap { item -> String? in
            if case .assistant(_, let text) = item.body, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
            return nil
        }.first
        let status = await firstStatus(client, id)
        let state: WatchSession.State? = switch status?.state {
        case .working?: .working
        case .waiting?: .waiting
        case .idle?, .other?: .idle
        case nil: nil
        }
        return WatchSession(id: id, title: Self.title(page.session?.title ?? ""), state: state,
                            prompts: (status?.pending ?? []).flatMap { Self.prompts($0, connectors: page.session?.connectors ?? [:]) }.prefix(4).map { $0 },
                            latest: latest.map { Self.cut($0, 3000) })
    }

    // The stream's first frame is the whole status. Opening it marks the session read on the server, which is right for a session the owner is reading.
    private func firstStatus(_ client: GhostShellClient, _ id: String) async -> ChatStatus? {
        let timeout = statusTimeout
        return await withTaskGroup(of: ChatStatus?.self) { group in
            group.addTask {
                for await event in client.eventStream(sessionID: id).events() {
                    if case .status(let status) = ChatEvent(event) { return status }
                }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private static func prompts(_ pending: PendingApproval, connectors: [String: String]) -> [WatchPrompt] {
        switch Approvals.kind(of: pending) {
        case .question:
            let questions = Approvals.questions(of: pending)
            // Only a card with one single-choice question is answered here. The Mac builds the same dictionary from the same rules, so a longer card waits for it.
            let single = questions.count == 1 && !questions[0].multiSelect && !questions[0].question.isEmpty
                && questions[0].question.count <= WatchRelay.maxQuestionCharacters && !pending.requestID.isEmpty
            return questions.map {
                WatchPrompt(kind: .question, title: $0.header ?? "Question", text: cut($0.question, WatchRelay.maxQuestionCharacters), options: $0.options.prefix(6).map { cut($0.label, 120) },
                            requestID: pending.requestID, answerable: single)
            }
        case .plan:
            return [WatchPrompt(kind: .plan, title: "Plan ready", text: cut(Approvals.plan(of: pending) ?? "", 1500))]
        case .permission:
            let parts = Approvals.parts(of: pending, connectors: connectors)
            let detail = parts.path ?? parts.fields.first?.value ?? ""
            return [WatchPrompt(kind: .permission, title: parts.title, text: cut(detail, 600))]
        }
    }

    private static func cut(_ text: String, _ limit: Int) -> String {
        text.count <= limit ? text : String(text.prefix(limit)) + "..."
    }

    // MARK: Reply

    private func reply(_ text: String, to id: String, replyID: String, _ client: GhostShellClient) async -> WatchResponse.Body {
        await deliver(replyID) { _ = try await client.sendPrompt(sessionID: id, text: text, mode: nil); return .sent }
    }

    // The answer is the one `decide` call the Mac's Approvals screen makes: `answers` keyed by the question's text, built by the same `Approvals.answers`.
    // It never goes to /send, which does not look at a pending card, so the text would wait behind the card and the question would stay open.
    private func answerCard(_ text: String, question: String, requestID: String, in id: String, answerID: String, _ client: GhostShellClient) async -> WatchResponse.Body {
        let asked = ApprovalQuestion(question: question, header: nil, options: [], multiSelect: false)
        let answers = Approvals.answers(for: [asked], picks: [ApprovalPick(other: text)])
        return await deliver(answerID) {
            switch try await client.decide(sessionID: id, requestID: requestID, .answer(answers)) {
            case .resolved: return .sent
            case .answeredElsewhere: return .answeredElsewhere
            }
        }
    }

    // NOTE: [9 Nov 2026] EK - A second ask with an id that is already on its way waits for the first one's answer, and one already delivered is answered `sent`
    // without sending. The watch asks again when the answer to the first ask never reached it.
    private func deliver(_ key: String, _ work: @escaping @Sendable () async throws -> WatchResponse.Body) async -> WatchResponse.Body {
        if delivered().contains(key) { return .sent }
        if let running = sending[key] { return await running.value }
        let task = Task<WatchResponse.Body, Never> { await self.answer(work).body }
        sending[key] = task
        let body = await task.value
        sending[key] = nil
        if body == .sent { remember(key) }
        return body
    }

    private func delivered() -> [String] {
        ledger.data(forKey: Self.ledgerKey).flatMap { try? JSONDecoder().decode([String].self, from: $0) } ?? []
    }

    private func remember(_ replyID: String) {
        ledger.save(try? JSONEncoder().encode(Array((delivered() + [replyID]).suffix(Self.ledgerSize))), forKey: Self.ledgerKey)
    }

    // MARK: Errors

    private func answer(_ work: @Sendable () async throws -> WatchResponse.Body) async -> WatchResponse {
        do {
            return WatchResponse(try await work())
        } catch let error as GhostShellError {
            return WatchResponse(.problem(Self.problem(error)))
        } catch {
            return WatchResponse(.problem(.serverUnreachable))
        }
    }

    private static func problem(_ error: GhostShellError) -> WatchProblem {
        switch error {
        case .signedOut: .signedOut
        case .unreachable: .serverUnreachable
        case .badPath, .badAddress: .invalid
        case .refused, .running, .server, .wrongPassword, .locked: .refused(error.errorDescription ?? "GhostShell refused that.")
        }
    }
}
