import XCTest
@testable import GhostShellKit

/// Answers every request from a closure and records what was asked. The token in these tests is fake.
private final class ApprovalStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var seen: [URLRequest] = []
    private static let lock = NSLock()

    static func reset(status: Int) {
        lock.lock(); defer { lock.unlock() }
        self.status = status
        seen = []
    }
    static func requests() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return seen }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        Self.lock.lock()
        Self.seen.append(request)
        let status = Self.status
        Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((status == 200 ? "{\"state\":\"idle\"}" : "{\"error\":\"Not now.\"}").utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class ApprovalsTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(String(repeating: "ab12", count: 16), for: address)
        return GhostShellClient(address: address, store: store, protocols: [ApprovalStub.self])
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 256)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 256); if n <= 0 { break }; data.append(buffer, count: n) }
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: The request

    func testEachDecisionPostsItsWordAndTheRequestID() async throws {
        let client = await client()
        let cases: [(ApprovalDecision, String)] = [(.allow, "allow"), (.always, "always"), (.deny, "deny")]
        for (decision, word) in cases {
            ApprovalStub.reset(status: 200)
            let outcome = try await client.decide(sessionID: "abc", requestID: "r1", decision)
            XCTAssertEqual(outcome, .resolved)
            let request = try XCTUnwrap(ApprovalStub.requests().first)
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "https://ghost.example.com/api/sessions/abc/approve")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
            let sent = try body(request)
            XCTAssertEqual(sent["requestId"] as? String, "r1")
            XCTAssertEqual(sent["decision"] as? String, word)
            XCTAssertNil(sent["answers"], "only an answer carries answers")
        }
    }

    func testAnAnswerCarriesItsAnswers() async throws {
        let client = await client()
        ApprovalStub.reset(status: 200)
        _ = try await client.decide(sessionID: "abc", requestID: "r2", .answer(["Which one?": "A, B"]))
        let sent = try body(try XCTUnwrap(ApprovalStub.requests().first))
        XCTAssertEqual(sent["decision"] as? String, "answer")
        XCTAssertEqual(sent["answers"] as? [String: String], ["Which one?": "A, B"])
    }

    func testA410IsAnsweredElsewhereAndOtherFailuresThrow() async throws {
        let client = await client()
        ApprovalStub.reset(status: 410)
        let outcome = try await client.decide(sessionID: "abc", requestID: "r1", .allow)
        XCTAssertEqual(outcome, .answeredElsewhere)
        let expected: [Int: GhostShellError] = [409: .refused(status: 409, message: "Not now."), 400: .refused(status: 400, message: "Not now."), 500: .server(status: 500)]
        for (status, failure) in expected {
            ApprovalStub.reset(status: status)
            do { _ = try await client.decide(sessionID: "abc", requestID: "r1", .allow); XCTFail("no error for \(status)") } catch {
                XCTAssertEqual(error as? GhostShellError, failure)
            }
        }
        XCTAssertEqual(Approvals.message(for: GhostShellError.refused(status: 409, message: "That session is not running here.")), "That session is not running here.")
        XCTAssertEqual(Approvals.message(for: GhostShellError.unreachable), GhostShellError.unreachable.errorDescription)
        XCTAssertEqual(Approvals.message(for: CancellationError()), "That did not go through. Try again.")
    }

    func testABadSessionIDIsRefusedBeforeAnyRequest() async {
        let client = await client()
        ApprovalStub.reset(status: 200)
        for id in ["", "a/b", "../x"] {
            do { _ = try await client.decide(sessionID: id, requestID: "r", .allow); XCTFail("sent for \(id)") } catch {
                XCTAssertEqual(error as? GhostShellError, .badPath(id))
            }
        }
        XCTAssertTrue(ApprovalStub.requests().isEmpty)
    }

    // MARK: Card parts

    private func prompt(_ tool: String, _ input: String, summary: String? = nil, label: String? = nil) throws -> PendingApproval {
        var json = "{\"requestId\":\"r\",\"tool\":\(try quote(tool)),\"input\":\(input)"
        if let summary { json += ",\"summary\":\(try quote(summary))" }
        if let label { json += ",\"label\":\(try quote(label))" }
        return try JSONDecoder().decode(PendingApproval.self, from: Data((json + "}").utf8))
    }

    private func quote(_ s: String) throws -> String { String(decoding: try JSONEncoder().encode(s), as: UTF8.self) }

    func testBashShowsTheWholeCommand() throws {
        let command = (1...80).map { "echo \($0)" }.joined(separator: "\n")
        let parts = Approvals.parts(of: try prompt("Bash", "{\"command\":\(try quote(command))}"))
        XCTAssertEqual(parts.title, "Bash wants to run a command")
        XCTAssertEqual(parts.fields, [.init(label: "Command", value: command)], "a command is never cut")
    }

    func testEditShowsThePathAndTheLinesBeforeAndAfter() throws {
        let parts = Approvals.parts(of: try prompt("Edit", "{\"old_string\":\"a\\nb\",\"new_string\":\"c\"}", summary: "src/x.js"))
        XCTAssertEqual(parts.title, "Edit wants to change")
        XCTAssertEqual(parts.path, "src/x.js")
        XCTAssertEqual(parts.diff, .init(removed: ["a", "b"], added: ["c"]))
        let long = (1...50).map(String.init).joined(separator: "\n")
        let clipped = Approvals.parts(of: try prompt("Edit", "{\"old_string\":\(try quote(long)),\"new_string\":\"\"}"))
        XCTAssertEqual(clipped.diff?.removed.count, 31, "30 lines and the note, as the page")
        XCTAssertEqual(clipped.diff?.removed.last, "... 20 more lines")
    }

    func testWriteClipsItsContentAsThePageDoes() throws {
        let content = (1...50).map(String.init).joined(separator: "\n")
        let parts = Approvals.parts(of: try prompt("Write", "{\"content\":\(try quote(content))}", summary: "a.txt"))
        XCTAssertEqual(parts.title, "Write wants to create or replace")
        XCTAssertTrue(try XCTUnwrap(parts.fields.first).value.hasSuffix("... 10 more lines"))
    }

    func testChromeToolsSayWhatTheyWillDo() throws {
        let nav = Approvals.parts(of: try prompt("mcp__claude-in-chrome__navigate", "{\"url\":\"https://example.com\",\"tabId\":12}"))
        XCTAssertEqual(nav.title, "Chrome wants to open a page")
        XCTAssertEqual(nav.fields, [.init(label: "URL", value: "https://example.com"), .init(label: "Tab", value: "12")])
        let click = Approvals.parts(of: try prompt("mcp__claude-in-chrome__computer", "{\"action\":\"left_click\",\"coordinate\":[10,20],\"tabId\":3}"))
        XCTAssertEqual(click.title, "Chrome wants to left_click on a page")
        XCTAssertEqual(click.fields.first { $0.label == "Where" }?.value, "10, 20")
        let other = Approvals.parts(of: try prompt("mcp__claude-in-chrome__read_page", "{\"tabId\":1,\"filter\":\"all\"}"))
        XCTAssertEqual(other.title, "Chrome wants to use read page")
        XCTAssertEqual(other.fields.map(\.label), ["filter", "tabId"])
    }

    func testAnMCPToolNamesItsSource() throws {
        let drive = Approvals.parts(of: try prompt("mcp__claude_ai_Google_Drive__search_files", "{\"query\":\"q\",\"empty\":\"\",\"n\":3}"))
        XCTAssertEqual(drive.title, "Google Drive wants to use search files")
        XCTAssertEqual(drive.fields, [.init(label: "n", value: "3"), .init(label: "query", value: "q")], "empty values are left out")
        let id = "0123abcd-0123-4abc-8abc-0123456789ab"
        XCTAssertEqual(Approvals.parts(of: try prompt("mcp__\(id)__x", "{}"), connectors: [id: "Notion"]).title, "Notion wants to use x")
        XCTAssertEqual(Approvals.parts(of: try prompt("mcp__\(id)__x", "{}")).title, "A connector wants to use x")
        XCTAssertEqual(Approvals.toolSource("mcp__capcom__dismiss_task"), "dismiss task")
    }

    func testAnyOtherToolUsesItsLabelAndAtMostEightFields() throws {
        let input = "{" + (1...12).map { "\"k\($0)\":\"v\"" }.joined(separator: ",") + "}"
        let parts = Approvals.parts(of: try prompt("Glob", input, label: "Glob"))
        XCTAssertEqual(parts.title, "Glob wants to run")
        XCTAssertEqual(parts.fields.count, 8)
        XCTAssertEqual(Approvals.parts(of: try prompt("Glob", "{}")).title, "Glob wants to run", "no label falls back to the tool name")
    }

    func testTheCapcomToolsAndSubagents() throws {
        XCTAssertEqual(Approvals.parts(of: try prompt("mcp__capcom__start_group_session", "{\"cwd\":\"/w\",\"title\":\"T\",\"prompt\":\"go\"}")).title,
                       "Claude wants to start a session in this group")
        XCTAssertEqual(Approvals.parts(of: try prompt("mcp__capcom__start_group_session", "{}"), place: "section").title, "Claude wants to start a session in this section")
        XCTAssertEqual(Approvals.parts(of: try prompt("mcp__capcom__archive_session", "{}", summary: "Build")).path, "Build")
        XCTAssertEqual(Approvals.parts(of: try prompt("Agent", "{\"description\":\"d\",\"prompt\":\"p\"}")).title, "Claude wants to start a subagent")
        XCTAssertEqual(Approvals.parts(of: try prompt("SendMessage", "{\"to\":\"x\",\"message\":\"m\"}")).fields.map(\.label), ["To", "Message"])
    }

    // MARK: Questions and plans

    private let askJSON = """
    {"questions":[
      {"question":"Which library?","header":"Library","multiSelect":false,"options":[{"label":"A","description":"first","preview":"code A"},{"label":"B"}]},
      {"question":"Which checks?","header":"Checks","multiSelect":true,"options":[{"label":"Lint"},{"label":"Types"},{"label":"Tests"}]}]}
    """

    func testQuestionsParse() throws {
        let ask = try prompt("AskUserQuestion", askJSON)
        XCTAssertEqual(Approvals.kind(of: ask), .question)
        let questions = Approvals.questions(of: ask)
        XCTAssertEqual(questions.map(\.question), ["Which library?", "Which checks?"])
        XCTAssertEqual(questions.map(\.multiSelect), [false, true])
        XCTAssertEqual(questions[0].header, "Library")
        XCTAssertEqual(questions[0].options[0], ApprovalOption(label: "A", description: "first", preview: "code A"))
        XCTAssertNil(questions[0].options[1].description)
    }

    func testPicksFollowTheRulesOfTheirKind() {
        var single = ApprovalPick()
        single.choose(1, multiSelect: false)
        single.choose(0, multiSelect: false)
        XCTAssertEqual(single.chosen, [0], "a second choice replaces the first")
        single.choose(0, multiSelect: false)
        XCTAssertEqual(single.chosen, [], "choosing it again clears it")
        single.choose(1, multiSelect: false)
        single.type("mine", multiSelect: false)
        XCTAssertEqual(single, ApprovalPick(chosen: [], other: "mine"), "typing clears the choice")
        single.choose(0, multiSelect: false)
        XCTAssertEqual(single, ApprovalPick(chosen: [0], other: ""), "choosing clears the text")

        var many = ApprovalPick()
        many.choose(2, multiSelect: true)
        many.choose(0, multiSelect: true)
        many.type("extra", multiSelect: true)
        XCTAssertEqual(many, ApprovalPick(chosen: [2, 0], other: "extra"), "choices add in order and typing keeps them")
        many.choose(2, multiSelect: true)
        XCTAssertEqual(many.chosen, [0])
    }

    func testAnswersJoinChosenLabelsThenOwnText() throws {
        let questions = Approvals.questions(of: try prompt("AskUserQuestion", askJSON))
        XCTAssertEqual(Approvals.answers(for: questions, picks: [ApprovalPick(), ApprovalPick()]), [:])
        let answers = Approvals.answers(for: questions, picks: [ApprovalPick(chosen: [1]), ApprovalPick(chosen: [2, 0], other: "  and docs ")])
        XCTAssertEqual(answers, ["Which library?": "B", "Which checks?": "Tests, Lint, and docs"])
        XCTAssertTrue(Approvals.isComplete(questions, answers: answers))
        let part = Approvals.answers(for: questions, picks: [ApprovalPick(other: "own"), ApprovalPick()])
        XCTAssertEqual(part, ["Which library?": "own"])
        XCTAssertFalse(Approvals.isComplete(questions, answers: part), "every question needs an answer")
        XCTAssertFalse(Approvals.isComplete([], answers: [:]))
        XCTAssertEqual(Approvals.answers(for: questions, picks: [ApprovalPick(chosen: [9]), ApprovalPick(other: "   ")]), [:], "a stale index and blank text answer nothing")
    }

    func testPlanDetection() throws {
        XCTAssertEqual(Approvals.kind(of: try prompt("ExitPlanMode", "{\"plan\":\"## Steps\\n1. one\"}")), .plan)
        XCTAssertEqual(Approvals.plan(of: try prompt("ExitPlanMode", "{\"plan\":\"x\"}")), "x")
        XCTAssertEqual(Approvals.kind(of: try prompt("ExitPlanMode", "{}")), .permission, "no plan text falls back to the plain card")
        XCTAssertEqual(Approvals.kind(of: try prompt("ExitPlanMode", "{\"plan\":\"\"}")), .permission)
        XCTAssertEqual(Approvals.kind(of: try prompt("Bash", "{\"plan\":\"x\"}")), .permission)
    }

    func testAllInputHoldsTheWholeCall() throws {
        XCTAssertEqual(Approvals.allInput(of: PendingApproval(requestID: "r", tool: "Bash")), "{}")
        let text = Approvals.allInput(of: try prompt("Bash", "{\"command\":\"ls\",\"timeout\":5}"))
        XCTAssertTrue(text.contains("\"command\": \"ls\"") && text.contains("\"timeout\": 5"))
    }
}
