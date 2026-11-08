import XCTest
@testable import GhostShellKit

/// Answers by path, records each request with its body, and holds a stream open the way the server does. The token in these tests is fake.
private final class WatchStub: URLProtocol, @unchecked Sendable {
    struct Route { var status = 200; var body = "{}"; var stream = false; var fail = false }
    nonisolated(unsafe) static var routes: [String: Route] = [:]
    nonisolated(unsafe) static var seen: [(path: String, body: Data)] = []
    private static let lock = NSLock()

    static func reset(_ routes: [String: Route]) {
        lock.lock(); defer { lock.unlock() }
        self.routes = routes
        seen = []
    }
    static func posts(to path: String) -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return seen.filter { $0.path == path }.compactMap { try? JSONSerialization.jsonObject(with: $0.body) as? [String: Any] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 256)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 256); if n <= 0 { break }; body.append(buffer, count: n) }
        }
        let path = request.url!.path
        Self.lock.lock()
        Self.seen.append((path, body))
        let route = Self.routes[path] ?? Route(status: 404, body: "{\"error\":\"Not found\"}")
        Self.lock.unlock()
        if route.fail { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return }
        let headers = ["Content-Type": route.stream ? "text/event-stream" : "application/json"]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: route.status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(route.body.utf8))
        if !route.stream { client?.urlProtocolDidFinishLoading(self) }
    }
}

private final class DictionaryStore: WatchStore, @unchecked Sendable {
    private var items: [String: Data] = [:]
    private let lock = NSLock()
    func data(forKey key: String) -> Data? { lock.lock(); defer { lock.unlock() }; return items[key] }
    func save(_ data: Data?, forKey key: String) { lock.lock(); defer { lock.unlock() }; items[key] = data }
}

final class WatchRelayTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(String(repeating: "ab12", count: 16), for: address)
        return GhostShellClient(address: address, store: store, protocols: [WatchStub.self])
    }

    private func handler(ledger: WatchStore = DictionaryStore()) -> WatchRelayHandler {
        WatchRelayHandler(ledger: ledger, statusTimeout: .milliseconds(400))
    }

    private func row(_ id: String, _ title: String, dot: String?, ms: Int, archived: Bool = false) -> String {
        "{\"id\":\"\(id)\",\"title\":\"\(title)\",\"cwd\":\"/Users/someone/work/\(id)\",\"sortAt\":\(ms)\(dot.map { ",\"dot\":\"\($0)\"" } ?? ""),\"archived\":\(archived)}"
    }

    private func status(_ pending: String = "[]", state: String = "waiting") -> String {
        "event: status\ndata: {\"state\":\"\(state)\",\"running\":true,\"live\":\"\",\"pending\":\(pending),\"holds\":[]}\n\n"
    }

    private let page = "{\"items\":[{\"kind\":\"user\",\"text\":\"hi\"},{\"kind\":\"assistant\",\"msgId\":\"1\",\"text\":\"First\"},{\"kind\":\"assistant\",\"msgId\":\"2\",\"text\":\"The latest answer\"},{\"kind\":\"tool\",\"id\":\"t\",\"name\":\"Bash\",\"summary\":\"\",\"status\":\"ok\"}],\"session\":{\"id\":\"abc\",\"title\":\"Fix the build\"}}"

    // MARK: Wire

    func testARequestAndAResponseSurviveTheWatchConnectivityDictionary() throws {
        let request = WatchRequest(.reply(id: "abc", text: "Go ahead", replyID: "r-1"))
        let message = try XCTUnwrap(WatchRelay.pack(request))
        XCTAssertEqual(WatchRelay.unpack(WatchRequest.self, from: message), request)
        let response = WatchResponse(.session(WatchSession(id: "abc", title: "T", state: .waiting, prompts: [WatchPrompt(kind: .question, title: "Q", text: "Which?", options: ["A", "B"])], latest: "Hello")))
        XCTAssertEqual(WatchRelay.unpack(WatchResponse.self, from: try XCTUnwrap(WatchRelay.pack(response))), response)
        XCTAssertNil(WatchRelay.unpack(WatchRequest.self, from: ["gs": Data("nonsense".utf8)]))
        XCTAssertNil(WatchRelay.unpack(WatchRequest.self, from: [:]))
    }

    func testAnotherVersionIsAnsweredOutOfDateBeforeAnythingIsRead() async {
        WatchStub.reset([:])
        let answer = await handler().handle(WatchRequest(.waiting, version: 99), client: await client())
        XCTAssertEqual(answer.body, .problem(.outOfDate))
        XCTAssertTrue(WatchStub.seen.isEmpty)
    }

    func testASignedOutPhoneHasItsOwnAnswerAndMakesNoCall() async {
        WatchStub.reset([:])
        let answer = await handler().handle(WatchRequest(.waiting), client: nil)
        XCTAssertEqual(answer.body, .problem(.signedOut))
        XCTAssertEqual(WatchProblem.signedOut.words, "Sign in on your iPhone")
        XCTAssertEqual(WatchProblem.phoneUnreachable.words, "Can't reach your iPhone")
        XCTAssertEqual(WatchProblem.serverUnreachable.words, "Your iPhone can't reach GhostShell")
        XCTAssertFalse(WatchProblem.signedOut.canRetry)
        XCTAssertTrue(WatchProblem.serverUnreachable.canRetry)
    }

    // MARK: The list

    func testTheListHasNeedsYouFirstThenFinishedNewestFirstAndSkipsArchived() async {
        WatchStub.reset(["/api/sessions": .init(body: "{\"started\":["
            + [row("old-ready", "Old finished", dot: "ready", ms: 1_000), row("new-ready", "New finished", dot: "ready", ms: 3_000),
               row("ask", "Needs an answer", dot: "awaiting", ms: 500), row("busy", "Running", dot: "running", ms: 9_000), row("plain", "No mark", dot: nil, ms: 9_500),
               row("gone", "Archived", dot: "awaiting", ms: 9_900, archived: true)].joined(separator: ",") + "]}")])
        let answer = await handler().handle(WatchRequest(.waiting), client: await client())
        guard case .waiting(let rows) = answer.body else { return XCTFail("\(answer)") }
        XCTAssertEqual(rows.map(\.id), ["ask", "new-ready", "old-ready"])
        XCTAssertEqual(rows.map(\.dot), [.awaiting, .ready, .ready])
        XCTAssertEqual(rows.first?.line, "ask")
        XCTAssertEqual(rows.first?.dot.words, "Needs you")
    }

    func testAServerErrorIsWordedAnExpiredTokenIsSignedOutAndADeadServerIsUnreachable() async {
        WatchStub.reset(["/api/sessions": .init(status: 500, body: "nonsense")])
        let refused = await handler().handle(WatchRequest(.waiting), client: await client())
        XCTAssertEqual(refused.body, .problem(.refused("The server answered with an error (500). Try again.")))
        WatchStub.reset(["/api/sessions": .init(status: 401)])
        let out = await handler().handle(WatchRequest(.waiting), client: await client())
        XCTAssertEqual(out.body, .problem(.signedOut))
        WatchStub.reset(["/api/sessions": .init(fail: true)])
        let dead = await handler().handle(WatchRequest(.waiting), client: await client())
        XCTAssertEqual(dead.body, .problem(.serverUnreachable))
    }

    // MARK: One session

    func testASessionCarriesItsQuestionAndItsLatestMessage() async {
        let question = "[{\"requestId\":\"r1\",\"tool\":\"AskUserQuestion\",\"input\":{\"questions\":[{\"question\":\"Which database?\",\"header\":\"Storage\",\"options\":[{\"label\":\"SQLite\"},{\"label\":\"Postgres\"}]}]}}]"
        WatchStub.reset(["/api/sessions/abc/messages": .init(body: page), "/api/sessions/abc/events": .init(body: status(question), stream: true)])
        let answer = await handler().handle(WatchRequest(.session(id: "abc")), client: await client())
        guard case .session(let session) = answer.body else { return XCTFail("\(answer)") }
        XCTAssertEqual(session.title, "Fix the build")
        XCTAssertEqual(session.state, .waiting)
        XCTAssertEqual(session.latest, "The latest answer")
        XCTAssertEqual(session.prompts, [WatchPrompt(kind: .question, title: "Storage", text: "Which database?", options: ["SQLite", "Postgres"], requestID: "r1", answerable: true)])
    }

    func testAPermissionIsWordedAndAnOverlongMessageIsCut() async {
        let permission = "[{\"requestId\":\"r2\",\"tool\":\"Bash\",\"input\":{\"command\":\"rm -rf build\"}}]"
        let long = String(repeating: "x", count: 5000)
        WatchStub.reset(["/api/sessions/abc/messages": .init(body: "{\"items\":[{\"kind\":\"assistant\",\"msgId\":\"1\",\"text\":\"\(long)\"}]}"),
                         "/api/sessions/abc/events": .init(body: status(permission), stream: true)])
        let answer = await handler().handle(WatchRequest(.session(id: "abc")), client: await client())
        guard case .session(let session) = answer.body else { return XCTFail("\(answer)") }
        XCTAssertEqual(session.prompts, [WatchPrompt(kind: .permission, title: "Bash wants to run a command", text: "rm -rf build")])
        XCTAssertEqual(session.latest?.count, 3003)
        XCTAssertTrue(session.latest?.hasSuffix("...") == true)
    }

    func testASessionWhoseStatusNeverArrivesStillShowsItsMessage() async {
        WatchStub.reset(["/api/sessions/abc/messages": .init(body: page), "/api/sessions/abc/events": .init(body: "", stream: true)])
        let answer = await handler().handle(WatchRequest(.session(id: "abc")), client: await client())
        guard case .session(let session) = answer.body else { return XCTFail("\(answer)") }
        XCTAssertNil(session.state)
        XCTAssertEqual(session.prompts, [])
        XCTAssertEqual(session.latest, "The latest answer")
    }

    func testASessionIdThatCouldReachAnotherRouteIsRefusedBeforeACall() async {
        WatchStub.reset([:])
        for id in ["", "a/b", "../x", "a?b=1", "a b", "a#b", "a%2fb", String(repeating: "a", count: 201)] {
            let answer = await handler().handle(WatchRequest(.session(id: id)), client: await client())
            XCTAssertEqual(answer.body, .problem(.invalid), id)
            let reply = await handler().handle(WatchRequest(.reply(id: id, text: "hi", replyID: "r1")), client: await client())
            XCTAssertEqual(reply.body, .problem(.invalid), id)
        }
        XCTAssertTrue(WatchStub.seen.isEmpty)
    }

    private func prompts(pending: String) async -> [WatchPrompt] {
        WatchStub.reset(["/api/sessions/abc/messages": .init(body: page), "/api/sessions/abc/events": .init(body: status(pending), stream: true)])
        let answer = await handler().handle(WatchRequest(.session(id: "abc")), client: await client())
        if case .session(let session) = answer.body { return session.prompts }
        return []
    }

    // MARK: Answer

    func testOnlyAQuestionWithOneSingleChoicePartIsAnswerableOnTheWatch() async {
        let part = { (multi: Bool) in "{\"question\":\"Q\(multi)\",\"multiSelect\":\(multi),\"options\":[{\"label\":\"A\"},{\"label\":\"B\"}]}" }
        let single = await prompts(pending: "[{\"requestId\":\"r1\",\"tool\":\"AskUserQuestion\",\"input\":{\"questions\":[\(part(false))]}}]")
        XCTAssertEqual(single.map(\.answerable), [true])
        let multi = await prompts(pending: "[{\"requestId\":\"r1\",\"tool\":\"AskUserQuestion\",\"input\":{\"questions\":[\(part(true))]}}]")
        XCTAssertEqual(multi.map(\.answerable), [false])
        let several = await prompts(pending: "[{\"requestId\":\"r1\",\"tool\":\"AskUserQuestion\",\"input\":{\"questions\":[\(part(false)),\(part(false))]}}]")
        XCTAssertEqual(several.map(\.answerable), [false, false])
        let permission = await prompts(pending: "[{\"requestId\":\"r2\",\"tool\":\"Bash\",\"input\":{\"command\":\"ls\"}}]")
        XCTAssertEqual(permission.map(\.answerable), [false])
        let plan = await prompts(pending: "[{\"requestId\":\"r3\",\"tool\":\"ExitPlanMode\",\"input\":{\"plan\":\"Do it\"}}]")
        XCTAssertEqual(plan.map(\.kind), [.plan])
        XCTAssertEqual(plan.map(\.answerable), [false])
    }

    func testAnAnswerIsDecidedWithTheQuestionAsItsKeyAndNeverSentAsAMessage() async {
        WatchStub.reset(["/api/sessions/abc/approve": .init(body: "{\"ok\":true}"), "/api/sessions/abc/send": .init(body: "{}")])
        let relay = handler()
        let ask = WatchRequest(.answer(id: "abc", requestID: "r1", question: "Which database?", text: "  Postgres ", answerID: "a-1"))
        let first = await relay.handle(ask, client: await client())
        let again = await relay.handle(ask, client: await client())
        XCTAssertEqual([first.body, again.body], [.sent, .sent])
        let posts = WatchStub.posts(to: "/api/sessions/abc/approve")
        XCTAssertEqual(posts.count, 1, "Asking again must not decide twice.")
        XCTAssertEqual(posts.first?["requestId"] as? String, "r1")
        XCTAssertEqual(posts.first?["decision"] as? String, "answer")
        XCTAssertEqual(posts.first?["answers"] as? [String: String], ["Which database?": "Postgres"])
        XCTAssertTrue(WatchStub.posts(to: "/api/sessions/abc/send").isEmpty)
    }

    func testAnAnswerToAQuestionNoLongerPendingIsAnsweredElsewhereAndNotRemembered() async {
        WatchStub.reset(["/api/sessions/abc/approve": .init(status: 410, body: "{\"error\":\"Nothing pending.\"}")])
        let relay = handler()
        let ask = WatchRequest(.answer(id: "abc", requestID: "r1", question: "Which?", text: "A", answerID: "a-1"))
        let gone = await relay.handle(ask, client: await client())
        XCTAssertEqual(gone.body, .answeredElsewhere)
        WatchStub.reset(["/api/sessions/abc/approve": .init(body: "{}")])
        let retried = await relay.handle(ask, client: await client())
        XCTAssertEqual(retried.body, .sent, "A 410 is not a delivery, so the next try goes through.")
        XCTAssertEqual(WatchStub.posts(to: "/api/sessions/abc/approve").count, 1)
    }

    func testAChatNotRunningHereRefusesTheAnswerInTheServersWords() async {
        WatchStub.reset(["/api/sessions/abc/approve": .init(status: 409, body: "{\"error\":\"Not running here.\"}")])
        let answer = await handler().handle(WatchRequest(.answer(id: "abc", requestID: "r1", question: "Which?", text: "A", answerID: "a-1")), client: await client())
        XCTAssertEqual(answer.body, .problem(.refused("Not running here.")))
    }

    func testAnAnswerWithoutACardOrQuestionOrTextIsRefusedBeforeACall() async {
        WatchStub.reset([:])
        let long = String(repeating: "x", count: WatchRelay.maxQuestionCharacters + 1)
        let asks: [WatchRequest.Action] = [
            .answer(id: "a/b", requestID: "r1", question: "Q", text: "A", answerID: "a-1"),
            .answer(id: "abc", requestID: "", question: "Q", text: "A", answerID: "a-1"),
            .answer(id: "abc", requestID: "r1", question: "", text: "A", answerID: "a-1"),
            .answer(id: "abc", requestID: "r1", question: long, text: "A", answerID: "a-1"),
            .answer(id: "abc", requestID: "r1", question: "Q", text: "  ", answerID: "a-1"),
            .answer(id: "abc", requestID: "r1", question: "Q", text: String(repeating: "x", count: WatchRelay.maxReplyCharacters + 1), answerID: "a-1"),
            .answer(id: "abc", requestID: "r1", question: "Q", text: "A", answerID: "bad id"),
        ]
        for ask in asks {
            let answer = await handler().handle(WatchRequest(ask), client: await client())
            XCTAssertEqual(answer.body, .problem(.invalid), "\(ask)")
        }
        XCTAssertTrue(WatchStub.seen.isEmpty)
    }

    // MARK: Reply

    func testAReplyIsPostedOnceToTheSendRouteAndAskedAgainIsNotSentAgain() async throws {
        WatchStub.reset(["/api/sessions/abc/send": .init(body: "{\"state\":\"working\"}")])
        let relay = handler()
        let ask = WatchRequest(.reply(id: "abc", text: "  Go ahead  ", replyID: "reply-1"))
        let first = await relay.handle(ask, client: await client())
        let again = await relay.handle(ask, client: await client())
        XCTAssertEqual([first.body, again.body], [.sent, .sent])
        let posts = WatchStub.posts(to: "/api/sessions/abc/send")
        XCTAssertEqual(posts.count, 1)
        XCTAssertEqual(posts.first?["text"] as? String, "Go ahead")
    }

    func testAReplyDeliveredBeforeTheAppWasKilledIsNotSentAgain() async {
        WatchStub.reset(["/api/sessions/abc/send": .init(body: "{\"state\":\"working\"}")])
        let ledger = DictionaryStore()
        let ask = WatchRequest(.reply(id: "abc", text: "Go", replyID: "reply-1"))
        _ = await handler(ledger: ledger).handle(ask, client: await client())
        let reborn = await handler(ledger: ledger).handle(ask, client: await client())
        XCTAssertEqual(reborn.body, .sent)
        XCTAssertEqual(WatchStub.posts(to: "/api/sessions/abc/send").count, 1)
    }

    func testAFailedReplyIsNotRememberedSoAnotherTryGoesThrough() async {
        WatchStub.reset(["/api/sessions/abc/send": .init(status: 409, body: "{\"error\":\"Not running here.\"}")])
        let relay = handler()
        let ask = WatchRequest(.reply(id: "abc", text: "Go", replyID: "reply-1"))
        let failed = await relay.handle(ask, client: await client())
        XCTAssertEqual(failed.body, .problem(.refused("Not running here.")))
        WatchStub.reset(["/api/sessions/abc/send": .init(body: "{\"state\":\"working\"}")])
        let retried = await relay.handle(ask, client: await client())
        XCTAssertEqual(retried.body, .sent)
        XCTAssertEqual(WatchStub.posts(to: "/api/sessions/abc/send").count, 1)
    }

    func testABlankOrOverlongReplyIsRefusedBeforeACall() async {
        WatchStub.reset([:])
        for text in ["", "   \n", String(repeating: "x", count: WatchRelay.maxReplyCharacters + 1)] {
            let answer = await handler().handle(WatchRequest(.reply(id: "abc", text: text, replyID: "r1")), client: await client())
            XCTAssertEqual(answer.body, .problem(.invalid))
        }
        let badID = await handler().handle(WatchRequest(.reply(id: "abc", text: "hi", replyID: "bad id")), client: await client())
        XCTAssertEqual(badID.body, .problem(.invalid))
        XCTAssertTrue(WatchStub.seen.isEmpty)
    }

    // MARK: The outbox

    func testAKeptReplySurvivesANewOutboxOnTheSameStoreUntilItIsConfirmed() throws {
        let store = DictionaryStore()
        let kept = try XCTUnwrap(WatchOutbox(store: store).keep(" Go ahead ", for: "abc", title: "Fix the build"))
        XCTAssertEqual(kept.text, "Go ahead")
        let reopened = WatchOutbox(store: store)
        XCTAssertEqual(reopened.reply(for: "abc"), kept)
        reopened.confirm(kept)
        XCTAssertNil(WatchOutbox(store: store).reply(for: "abc"))
        XCTAssertNil(store.data(forKey: "watchOutbox"))
    }

    func testTheSameTextKeepsItsReplyIDAndNewTextGetsANewOne() throws {
        let outbox = WatchOutbox(store: DictionaryStore())
        let first = try XCTUnwrap(outbox.keep("Go", for: "abc", title: "T"))
        XCTAssertEqual(try XCTUnwrap(outbox.keep("Go", for: "abc", title: "T")).replyID, first.replyID)
        let second = try XCTUnwrap(outbox.keep("Stop", for: "abc", title: "T"))
        XCTAssertNotEqual(second.replyID, first.replyID)
        XCTAssertEqual(outbox.replies.count, 1)
        outbox.confirm(first)
        XCTAssertEqual(outbox.reply(for: "abc"), second, "Confirming the old reply must not drop the new one.")
    }

    func testAKeptAnswerSurvivesARelaunchKeepsItsIDForTheSameCardAndReplacesAReply() throws {
        let store = DictionaryStore()
        let outbox = WatchOutbox(store: store)
        let first = try XCTUnwrap(outbox.keepAnswer("Postgres", question: "Which?", requestID: "r1", for: "abc", title: "T"))
        XCTAssertTrue(first.isAnswer)
        let reopened = WatchOutbox(store: store)
        XCTAssertEqual(reopened.reply(for: "abc"), first)
        XCTAssertEqual(try XCTUnwrap(reopened.keepAnswer("Postgres", question: "Which?", requestID: "r1", for: "abc", title: "T")).replyID, first.replyID)
        XCTAssertNotEqual(try XCTUnwrap(reopened.keepAnswer("Postgres", question: "Which?", requestID: "r2", for: "abc", title: "T")).replyID, first.replyID, "A new card is a new answer.")
        let plain = try XCTUnwrap(reopened.keep("Postgres", for: "abc", title: "T"))
        XCTAssertFalse(plain.isAnswer)
        XCTAssertEqual(reopened.replies.count, 1)
        reopened.confirm(plain)
        XCTAssertNil(reopened.reply(for: "abc"))
    }

    func testOutboxRefusesBlankAndOverlongTextAndKeepsNewestFirstUpToTheLimit() throws {
        let outbox = WatchOutbox(store: DictionaryStore())
        XCTAssertNil(outbox.keep("  ", for: "abc", title: "T"))
        XCTAssertNil(outbox.keep(String(repeating: "x", count: WatchRelay.maxReplyCharacters + 1), for: "abc", title: "T"))
        for n in 0..<(WatchOutbox.limit + 3) { outbox.keep("r\(n)", for: "s\(n)", title: "T", now: Date(timeIntervalSince1970: Double(n))) }
        XCTAssertEqual(outbox.replies.count, WatchOutbox.limit)
        XCTAssertEqual(outbox.replies.first?.sessionID, "s\(WatchOutbox.limit + 2)")
        XCTAssertNil(outbox.reply(for: "s0"))
        outbox.discard(sessionID: "s5")
        XCTAssertNil(outbox.reply(for: "s5"))
    }
}
