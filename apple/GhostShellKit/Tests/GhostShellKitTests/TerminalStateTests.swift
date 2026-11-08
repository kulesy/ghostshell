import XCTest
@testable import GhostShellKit

/// A stub of the network that answers from a closure and records what was asked. The token in these tests is fake.
final class TerminalStub: URLProtocol, @unchecked Sendable {
    typealias Reply = @Sendable (URLRequest) -> (status: Int, body: String)
    nonisolated(unsafe) static var reply: Reply = { _ in (200, "{}") }
    nonisolated(unsafe) static var seen: [(request: URLRequest, body: Data)] = []
    private static let lock = NSLock()

    static func reset(_ reply: @escaping Reply) {
        lock.lock(); defer { lock.unlock() }
        self.reply = reply
        seen = []
    }
    static func requests() -> [(request: URLRequest, body: Data)] { lock.lock(); defer { lock.unlock() }; return seen }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 256)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 256); if n <= 0 { break }; body.append(buffer, count: n) }
        }
        Self.lock.lock()
        Self.seen.append((request, body))
        let answer = Self.reply
        Self.lock.unlock()
        let result = answer(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: result.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(result.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class TerminalStateTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com/app")!
    private let fakeToken = String(repeating: "ab12", count: 16)

    private func signedInClient() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(fakeToken, for: address)
        return GhostShellClient(address: address, store: store, protocols: [TerminalStub.self])
    }

    private static func runJSON(_ id: String, command: String = "ls", running: Bool = true, extra: String = "") -> String {
        #"{"id":"\#(id)","command":"\#(command)","cwd":"/h/x","source":"panel","startedAt":1000,"endedAt":null,"exitCode":null,"signal":null,"stopped":false,"running":\#(running),"truncated":false,"delivered":null,"output":[]\#(extra)}"#
    }

    private func runJSON(_ id: String, command: String = "ls", running: Bool = true, extra: String = "") -> String {
        Self.runJSON(id, command: command, running: running, extra: extra)
    }

    private func frame(_ json: String) -> SSEEvent { SSEEvent(name: "terminal", data: json) }

    // MARK: Events

    func testDecodesEachKindOfFrame() throws {
        let state = try XCTUnwrap(TerminalEvent.decode(frame(#"{"type":"state","cwd":"/h/x","home":"/h","runs":[\#(runJSON("a"))]}"#)))
        guard case .state(let cwd, let home, let runs) = state else { return XCTFail("not a state") }
        XCTAssertEqual([cwd, home, runs.first?.id ?? ""], ["/h/x", "/h", "a"])

        XCTAssertEqual(TerminalEvent.decode(frame(#"{"type":"output","run":"a","chunks":[{"stream":"err","text":"oops"}]}"#)), .output(run: "a", chunks: [.init(stream: "err", text: "oops")]))
        XCTAssertEqual(TerminalEvent.decode(frame(#"{"type":"cwd","cwd":"/h/y"}"#)), .cwd("/h/y"))
        let ended = try XCTUnwrap(TerminalEvent.decode(frame(#"{"type":"run","run":\#(runJSON("a", running: false))}"#)))
        guard case .run(let run) = ended else { return XCTFail("not a run") }
        XCTAssertEqual(run.id, "a")
        XCTAssertFalse(run.running)
        guard case .cleared(let left) = try XCTUnwrap(TerminalEvent.decode(frame(#"{"type":"cleared","runs":[\#(runJSON("b"))]}"#))) else { return XCTFail("not cleared") }
        XCTAssertEqual(left.map(\.id), ["b"])
    }

    func testIgnoresOtherFramesAndAnythingItCannotRead() {
        XCTAssertNil(TerminalEvent.decode(SSEEvent(name: "status", data: #"{"type":"state"}"#)))
        XCTAssertNil(TerminalEvent.decode(frame(#"{"type":"future"}"#)))
        XCTAssertNil(TerminalEvent.decode(frame("not json")))
        XCTAssertNil(TerminalEvent.decode(frame(#"{"type":"output","run":"a","chunks":[]}"#)))
        XCTAssertNil(TerminalEvent.decode(frame(#"{"type":"cwd"}"#)))
    }

    func testOneOddRunNeverEmptiesAState() throws {
        let event = try XCTUnwrap(TerminalEvent.decode(frame(#"{"type":"state","cwd":"/h","home":"/h","runs":[{"nope":1},\#(runJSON("a")),{"id":7}]}"#)))
        guard case .state(_, _, let runs) = event else { return XCTFail() }
        XCTAssertEqual(runs.map(\.id), ["a"])
    }

    // MARK: Reducer

    private func decoded(_ json: String) throws -> TerminalRun { try JSONDecoder().decode(TerminalRun.self, from: Data(json.utf8)) }

    func testAStateEventMakesTheStateReady() throws {
        var state = TerminalState()
        XCTAssertFalse(state.ready)
        state.apply(.state(cwd: "/h/x", home: "/h", runs: [try decoded(runJSON("a"))]))
        XCTAssertTrue(state.ready)
        XCTAssertEqual(state.cwd, "/h/x")
        XCTAssertEqual(state.runs.map(\.key), ["a"])
    }

    func testOutputGrowsTheRunAndAnEndedRunSaysSoAloud() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a", command: "make"))]))
        state.apply(.output(run: "a", chunks: [.init(stream: "out", text: "one\n")]))
        state.apply(.output(run: "a", chunks: [.init(stream: "out", text: "two\n")]))
        state.apply(.output(run: "nope", chunks: [.init(stream: "out", text: "lost")]))
        XCTAssertEqual(state.runs[0].output, [.init(stream: "out", text: "one\ntwo\n")])
        state.apply(.run(try decoded(runJSON("a", command: "make", running: false).replacingOccurrences(of: #""exitCode":null"#, with: #""exitCode":2"#))))
        XCTAssertFalse(state.runs[0].running)
        XCTAssertEqual(state.announce, "Command finished with exit code 2: make")
        XCTAssertEqual(state.announceCount, 1)
        XCTAssertEqual(state.runs[0].output.first?.text, "one\ntwo\n", "the held output is the fuller account, so a summary with none leaves it")
    }

    func testTheRevisionRisesWithEveryAppendEvenWhenTheOutputIsHeldAtItsCap() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a"))]))
        let big = String(repeating: "x", count: TerminalRules.keep)
        state.apply(.output(run: "a", chunks: [.init(stream: "out", text: big)]))
        let before = state.runs[0]
        state.apply(.output(run: "a", chunks: [.init(stream: "out", text: "y")]))
        XCTAssertEqual(state.runs[0].output.map(\.text.utf16.count), before.output.map(\.text.utf16.count), "held at the cap, the size does not move")
        XCTAssertEqual(state.runs[0].revision, before.revision + 1)
    }

    func testAStartedRunTakesTheRowDrawnForIt() throws {
        var state = TerminalState()
        state.cwd = "/h/x"
        let key = try XCTUnwrap(state.begin(command: "ls", source: .panel, key: "local-1", now: 5))
        XCTAssertNil(state.begin(command: "ls", source: .panel, key: "local-2", now: 6), "a double tap while it starts")
        XCTAssertEqual(state.runs.count, 1)
        XCTAssertTrue(state.runs[0].pending)
        // The event can beat the answer to the request.
        state.apply(.run(try decoded(runJSON("a"))))
        state.settle(try decoded(runJSON("a")))
        XCTAssertEqual(state.runs.count, 1)
        XCTAssertEqual(state.runs[0].key, key)
        XCTAssertEqual(state.runs[0].id, "a")
        XCTAssertFalse(state.runs[0].pending)
    }

    func testASnapshotThatLandsAfterARunStartedLeavesOneRowForIt() throws {
        var state = TerminalState()
        _ = state.begin(command: "ls", source: .block, key: "local-1", now: 5)
        _ = state.begin(command: "pwd", source: .panel, key: "local-2", now: 5)
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a").replacingOccurrences(of: #""source":"panel""#, with: #""source":"block""#))]))
        XCTAssertEqual(state.runs.map(\.command), ["ls", "pwd"])
        XCTAssertEqual(state.runs.map(\.key), ["local-1", "local-2"])
        XCTAssertEqual(state.runs.map(\.pending), [false, true], "only the run the server has no row for yet is still waiting")
    }

    func testARefusedCommandLeavesNoRow() {
        var state = TerminalState()
        _ = state.begin(command: "ls", source: .panel, key: "local-1", now: 5)
        state.refused(key: "local-1")
        XCTAssertTrue(state.runs.isEmpty)
    }

    func testTextTypedToARunIsEchoedInItsOutput() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a"))]))
        state.typed(to: "a", text: "yes\n", eof: false)
        state.typed(to: "a", text: "", eof: true)
        XCTAssertEqual(state.runs[0].output, [.init(stream: "in", text: "yes\n^D\n")])
    }

    private func snapshotRun(_ text: String) throws -> TerminalRun {
        try decoded(runJSON("a").replacingOccurrences(of: #""output":[]"#, with: #""output":[{"stream":"out","text":"\#(text)"}]"#))
    }

    private func out(_ text: String) -> TerminalEvent { .output(run: "a", chunks: [.init(stream: "out", text: text)]) }

    func testTheSnapshotThatAlreadyHoldsAnOutputEventDropsIt() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try snapshotRun("hello\\n")]))
        state.applyHeld([out("hello\n"), out("more\n")])
        XCTAssertEqual(TerminalRules.textOf(state.runs[0].output), "hello\nmore\n")
    }

    func testTwoHeldEventsTheSnapshotHoldsAreEachDroppedOnce() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try snapshotRun("one\\ntwo\\n")]))
        state.applyHeld([out("one\n"), out("two\n"), out("three\n")])
        XCTAssertEqual(TerminalRules.textOf(state.runs[0].output), "one\ntwo\nthree\n")
    }

    func testARepeatedChunkTheSnapshotLacksIsKept() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try snapshotRun(".")]))
        state.applyHeld([out("."), out(".")])
        XCTAssertEqual(TerminalRules.textOf(state.runs[0].output), "..", "the snapshot holds one dot, so one of the two held dots is new")
    }

    func testAHeldStateEventThatComesFirstDoesNotMakeTheOutputRepeat() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try snapshotRun("one\\n")]))
        // The held state already ends with "two", so the output event after it is a repeat of that.
        state.applyHeld([.state(cwd: "/h", home: "/h", runs: [try snapshotRun("one\\ntwo\\n")]), out("two\n"), out("three\n")])
        XCTAssertEqual(TerminalRules.textOf(state.runs[0].output), "one\ntwo\nthree\n")
    }

    func testTheHoldDropsItsEventsPastTheCapAndSaysSo() {
        var hold = TerminalHold()
        for n in 0..<TerminalHold.cap { hold.add(.cwd("/\(n)")) }
        XCTAssertEqual(hold.events.count, TerminalHold.cap)
        XCTAssertFalse(hold.overflowed)
        hold.add(.cwd("/over"))
        XCTAssertTrue(hold.overflowed)
        XCTAssertTrue(hold.events.isEmpty)
        hold.add(.cwd("/after"))
        XCTAssertTrue(hold.events.isEmpty, "nothing is held for a snapshot that will be read again")
        hold.reset()
        hold.add(.cwd("/fresh"))
        XCTAssertEqual(hold.events, [.cwd("/fresh")])
        XCTAssertFalse(hold.overflowed)
    }

    func testOnlyAnUnreachableOrFailedServerIsAskedAgain() {
        XCTAssertTrue(TerminalFailure.isTemporary(GhostShellError.unreachable))
        XCTAssertTrue(TerminalFailure.isTemporary(GhostShellError.server(status: 503)))
        for error in [GhostShellError.server(status: 0), .server(status: 403), .server(status: 415), .refused(status: 400, message: "no terminal"),
                      .refused(status: 404, message: "no session"), .signedOut, .wrongPassword] {
            XCTAssertFalse(TerminalFailure.isTemporary(error), "\(error)")
        }
    }

    func testHeldEventsOfAnotherRunAreNotDropped() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try snapshotRun("x\\n"), try decoded(runJSON("b"))]))
        state.applyHeld([.output(run: "b", chunks: [.init(stream: "out", text: "x\n")])])
        XCTAssertEqual(TerminalRules.textOf(state.runs[1].output), "x\n")
    }

    func testClearKeepsWhatIsStillRunning() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a", running: false)), try decoded(runJSON("b"))]))
        state.apply(.cleared(runs: [try decoded(runJSON("b"))]))
        XCTAssertEqual(state.runs.map(\.id), ["b"])
        state.cleared(cwd: "/h/z", runs: [])
        XCTAssertEqual(state.cwd, "/h/z")
        XCTAssertTrue(state.runs.isEmpty)
    }

    func testTheInputPinsToTheRunItWasTypedAgainst() throws {
        var state = TerminalState()
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a"))]))
        state.setInput("y")
        XCTAssertEqual(state.sendTo, .init(run: "a"))
        state.apply(.state(cwd: "/h", home: "/h", runs: [try decoded(runJSON("a")), try decoded(runJSON("b"))]))
        XCTAssertEqual(TerminalRules.inputTarget(runs: state.runs, pin: state.sendTo).run?.id, "a")
        state.setInput("")
        XCTAssertNil(state.sendTo)
        XCTAssertEqual(TerminalRules.inputTarget(runs: state.runs, pin: state.sendTo).run?.id, "b")
    }

    // MARK: Requests

    private func json(_ data: Data) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]) }

    func testRunPostsTheCommandAndItsSource() async throws {
        TerminalStub.reset { _ in (200, #"{"run":\#(TerminalStateTests.runJSON("a"))}"#) }
        let client = await signedInClient()
        let run = try await client.runCommand(sessionID: "s1", command: "echo hi", source: .block)
        XCTAssertEqual(run.id, "a")
        let seen = try XCTUnwrap(TerminalStub.requests().first)
        XCTAssertEqual(seen.request.url?.absoluteString, "https://ghost.example.com/app/api/sessions/s1/terminal/run")
        XCTAssertEqual(seen.request.httpMethod, "POST")
        XCTAssertEqual(seen.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(seen.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertEqual(seen.request.value(forHTTPHeaderField: "Cookie"), "capcom=\(fakeToken)")
        let body = try json(seen.body)
        XCTAssertEqual(body["command"] as? String, "echo hi")
        XCTAssertEqual(body["source"] as? String, "block")
        XCTAssertEqual(body.count, 2)
    }

    func testInputStopClearAndTheSnapshotUseTheirRoutes() async throws {
        TerminalStub.reset { request in
            switch request.url?.lastPathComponent {
            case "input": return (200, #"{"ok":true}"#)
            case "stop": return (200, #"{"run":\#(TerminalStateTests.runJSON("a", running: false))}"#)
            case "clear": return (200, #"{"cwd":"/h","runs":[]}"#)
            default: return (200, #"{"cwd":"/h/x","home":"/h","runs":[\#(TerminalStateTests.runJSON("a"))]}"#)
            }
        }
        let client = await signedInClient()
        try await client.sendInput(sessionID: "s1", run: "a", text: "yes\n")
        try await client.sendInput(sessionID: "s1", run: "a", text: "", eof: true)
        let stopped = try await client.stopCommand(sessionID: "s1", run: "a")
        XCTAssertFalse(stopped.running)
        let cleared = try await client.clearTerminal(sessionID: "s1")
        XCTAssertEqual(cleared.cwd, "/h")
        let snapshot = try await client.terminalSnapshot(sessionID: "s1")
        XCTAssertEqual(snapshot.runs.count, 1)

        let seen = TerminalStub.requests()
        XCTAssertEqual(seen.map { $0.request.httpMethod ?? "" }, ["POST", "POST", "POST", "POST", "GET"])
        XCTAssertEqual(seen.map { $0.request.url?.path ?? "" }.map { String($0.split(separator: "/").suffix(2).joined(separator: "/")) },
                       ["terminal/input", "terminal/input", "terminal/stop", "terminal/clear", "s1/terminal"])
        let typed = try json(seen[0].body)
        XCTAssertEqual(typed["run"] as? String, "a")
        XCTAssertEqual(typed["text"] as? String, "yes\n")
        XCTAssertEqual(typed["eof"] as? Bool, false)
        XCTAssertEqual(try json(seen[1].body)["eof"] as? Bool, true)
        XCTAssertEqual(try json(seen[2].body)["run"] as? String, "a")
        XCTAssertEqual(try json(seen[3].body).count, 0, "clear sends an empty JSON object")
        XCTAssertNil(seen[4].request.value(forHTTPHeaderField: "Origin"))
    }

    func testASessionIdWithASlashIsRefusedBeforeItIsSent() async {
        TerminalStub.reset { _ in (200, "{}") }
        let client = await signedInClient()
        do {
            _ = try await client.runCommand(sessionID: "a/b", command: "ls", source: .panel)
            XCTFail("sent")
        } catch {
            XCTAssertEqual(error as? GhostShellError, .badPath("a/b"))
        }
        XCTAssertTrue(TerminalStub.requests().isEmpty)
    }

    func testARefusalCarriesTheServersWords() async {
        for (status, step, words) in [(403, TerminalFailure.Step.run, "Cross-site request refused."), (415, .run, "Send JSON."),
                                      (409, .run, "The session's folder does not exist on this Mac."), (409, .input, "That command is not taking input."),
                                      (404, .stop, "No such command in this session."), (429, .run, "Too many commands are running. Wait for one to finish.")] {
            TerminalStub.reset { _ in (status, #"{"error":"\#(words)"}"#) }
            let client = await signedInClient()
            do {
                _ = try await client.runCommand(sessionID: "s1", command: "ls", source: .panel)
                XCTFail("answered \(status)")
            } catch {
                XCTAssertEqual(TerminalFailure.words(error, step: step), words, "\(status)")
            }
        }
        TerminalStub.reset { _ in (409, "") }
        let client = await signedInClient()
        do {
            _ = try await client.runCommand(sessionID: "s1", command: "ls", source: .panel)
            XCTFail("answered 409")
        } catch {
            XCTAssertEqual(TerminalFailure.words(error, step: .run), "The session's folder does not exist on this Mac.", "a 409 with no body")
        }
        XCTAssertEqual(TerminalFailure.words(GhostShellError.unreachable, step: .run), GhostShellError.unreachable.localizedDescription)
    }
}

/// These talk to a real scratch server started by `apple/scripts/test.mjs`. Without one every test here is skipped.
final class TerminalIntegrationTests: XCTestCase {
    private func signedIn() async throws -> (GhostShellClient, String) {
        let env = ProcessInfo.processInfo.environment
        guard let text = env["GS_SCRATCH_ADDRESS"], let file = env["GS_SCRATCH_PASSWORD_FILE"] else { throw XCTSkip("No scratch server. Run apple/scripts/test.mjs.") }
        let address = try XCTUnwrap(ServerAddress(text))
        let password = try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let client = GhostShellClient(address: address, store: MemoryTokenStore())
        try await client.signIn(password: password)
        let index = try await client.sessionIndex()
        // A command runs in the session's folder, which the seeded sessions name but nothing creates.
        try FileManager.default.createDirectory(atPath: "/private/tmp/claude-501/capcom-test-cwd/swift-app", withIntermediateDirectories: true)
        return (client, try XCTUnwrap(index.rows.first?.id))
    }

    func testAColouredCommandRunsAndItsOutputComesBack() async throws {
        let (client, id) = try await signedIn()
        let started = try await client.runCommand(sessionID: id, command: #"printf '\033[31mred\033[0m'"#, source: .panel)
        XCTAssertTrue(started.running || started.exitCode == 0)
        var run = started
        for _ in 0..<50 where run.running {
            try await Task.sleep(for: .milliseconds(100))
            let snapshot = try await client.terminalSnapshot(sessionID: id)
            run = try XCTUnwrap(snapshot.runs.first { $0.id == started.id })
        }
        XCTAssertFalse(run.running)
        XCTAssertEqual(run.exitCode, 0)
        XCTAssertEqual(TerminalRules.textOf(run.output), "\u{1B}[31mred\u{1B}[0m")
        let drawn = TerminalAnsi.render(run.output)
        XCTAssertEqual(drawn.lines.first?.first?.text, "red")
        XCTAssertEqual(drawn.lines.first?.first?.look.fg, .palette(1))
        _ = try await client.clearTerminal(sessionID: id)
    }

    func testAnInputToAFinishedRunIsRefusedWithA409() async throws {
        let (client, id) = try await signedIn()
        let started = try await client.runCommand(sessionID: id, command: "true", source: .panel)
        let finished = try await Task.sleep(for: .milliseconds(500))
        _ = finished
        do {
            try await client.sendInput(sessionID: id, run: try XCTUnwrap(started.id), text: "late\n")
            XCTFail("the server took input for a finished command")
        } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 409, message: "That command is not taking input."))
            XCTAssertEqual(TerminalFailure.words(error, step: .input), "That command is not taking input.")
        }
        _ = try await client.clearTerminal(sessionID: id)
    }

    func testARunningCommandIsStoppedAndAnUnknownRunIsRefusedWith404() async throws {
        let (client, id) = try await signedIn()
        let started = try await client.runCommand(sessionID: id, command: "sleep 30", source: .panel)
        XCTAssertTrue(started.running)
        let stopped = try await client.stopCommand(sessionID: id, run: try XCTUnwrap(started.id))
        XCTAssertEqual(stopped.id, started.id)
        XCTAssertTrue(stopped.stopped)
        do {
            _ = try await client.stopCommand(sessionID: id, run: "no-such-run")
            XCTFail("the server stopped a run it does not have")
        } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 404, message: "No such command in this session."))
            XCTAssertEqual(TerminalFailure.words(error, step: .stop), "No such command in this session.")
        }
        try await Task.sleep(for: .milliseconds(300))
        let left = try await client.clearTerminal(sessionID: id)
        XCTAssertFalse(left.runs.contains { $0.id == started.id && $0.running })
    }
}
