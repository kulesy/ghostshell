import XCTest
@testable import GhostShellKit

/// Answers every request from a closure and records what was asked. Nothing here reaches a network or a real server.
private final class Echo: URLProtocol, @unchecked Sendable {
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
        let response = HTTPURLResponse(url: request.url!, statusCode: result.status, httpVersion: nil, headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(result.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class GroupClientTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let token = String(repeating: "ab12", count: 16)

    fileprivate func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(token, for: address)
        return GhostShellClient(address: address, store: store, protocols: [Echo.self])
    }

    fileprivate func sent() throws -> (request: URLRequest, json: [String: Any?]) {
        let last = try XCTUnwrap(Echo.requests().last)
        return (last.request, (try? JSONSerialization.jsonObject(with: last.body) as? [String: Any?]) ?? [:])
    }

    func testBookingReturnsTheSessionID() async throws {
        Echo.reset { _ in (200, #"{"id":"s-1"}"#) }
        let id = try await client().groupSession("pinned")
        XCTAssertEqual(id, "s-1")
        let (request, _) = try sent()
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/groups/pinned/session")
    }

    func testBookingRefusalKeepsTheServersWords() async throws {
        Echo.reset { _ in (400, #"{"error":"Nope."}"#) }
        do { _ = try await client().groupSession("g1"); XCTFail("should refuse") } catch GhostShellError.refused(let status, let message, _, _) {
            XCTAssertEqual(status, 400)
            XCTAssertEqual(message, "Nope.")
        }
    }

    func testSummariesAreBatchedAtSixtyAndAskForDetail() async throws {
        Echo.reset { _ in (200, #"{"summaries":{"a":{"line":"Hi","ask":"","at":1000,"pending":[{"tool":"Bash","summary":"ls"}]},"b":{"line":"x"}}}"#) }
        let ids = (0..<130).map { "s\($0)" }
        let found = try await client().summaries(ids: ids, detail: true)
        let seen = Echo.requests()
        XCTAssertEqual(seen.count, 3)
        let counts = seen.map { ($0.request.url?.query ?? "").components(separatedBy: "&").first.map { $0.components(separatedBy: "%2C").count + $0.components(separatedBy: ",").count - 1 } ?? 0 }
        XCTAssertEqual(counts, [60, 60, 10])
        XCTAssertTrue(seen.allSatisfy { ($0.request.url?.query ?? "").contains("detail=1") })
        XCTAssertEqual(found["a"]?.pending, [PendingLine(tool: "Bash", summary: "ls")])
        XCTAssertEqual(found["a"]?.ask, "")
        XCTAssertNil(found["b"]?.ask, "a server that sends no ask is an old one")
    }

    func testSummariesRefuseAnOddID() async throws {
        Echo.reset { _ in (200, "{}") }
        do { _ = try await client().summaries(ids: ["a,b"]); XCTFail("should refuse") } catch GhostShellError.badPath {}
        XCTAssertTrue(Echo.requests().isEmpty)
    }

    func testPullsDecodeAndKeepSettling() async throws {
        Echo.reset { _ in (200, #"{"pulls":{"a":[{"kind":"pull","url":"https://github.com/o/r/pull/3","title":"T","repo":"o/r","number":3,"state":"open","mine":true,"asked":false,"requested":1,"review":"required","checks":"running","conflicts":false,"clean":true,"threads":2}]},"settling":true}"#) }
        let answer = try await client().pulls(ids: ["a"])
        XCTAssertTrue(answer.settling)
        let pull = try XCTUnwrap(answer.pulls["a"]?.first)
        XCTAssertEqual(pull.number, 3)
        XCTAssertEqual(pull.mine, true)
        XCTAssertEqual(pull.threads, 2)
        XCTAssertEqual(try sent().request.url?.path, "/api/pulls")
    }

    func testChipsListDecodes() async throws {
        Echo.reset { _ in (200, #"{"chips":[{"toolUseId":"t1","sessionId":"s","title":"T","tldr":"x","status":"started","startedId":"n1","opensIn":"Opens in Billing"},{"toolUseId":"t2","status":"zzz"}]}"#) }
        let chips = try await client().chips(sessionID: "s")
        XCTAssertEqual(chips.map(\.status), [.started, .other("zzz")])
        XCTAssertEqual(chips.first?.opensIn, "Opens in Billing")
        XCTAssertEqual(try sent().request.url?.path, "/api/sessions/s/chips")
    }

    func testChipStartAndDismissBodies() async throws {
        Echo.reset { _ in (200, #"{"id":"n1","chip":{"toolUseId":"t1","status":"started","startedId":"n1"}}"#) }
        let request = ChipRequest(sessionID: "s", toolUseID: "t1", title: "T", tldr: "x", prompt: "do it", cwd: nil, folder: "/work", model: "m", effort: nil)
        let result = try await client().startChip(request)
        XCTAssertEqual(result.id, "n1")
        XCTAssertEqual(result.chip?.status, .started)
        var (sentRequest, json) = try sent()
        XCTAssertEqual(sentRequest.url?.path, "/api/chips/start")
        XCTAssertEqual(json["sessionId"] as? String, "s")
        XCTAssertEqual(json["toolUseId"] as? String, "t1")
        XCTAssertEqual(json["confirmCwd"] as? String, "/work")
        XCTAssertEqual(json["prompt"] as? String, "do it")
        XCTAssertEqual(json["model"] as? String, "m")
        XCTAssertNil(json["cwd"] ?? nil, "an unnamed folder is left out, as the page leaves it")
        _ = try await client().dismissChip(request)
        (sentRequest, json) = try sent()
        XCTAssertEqual(sentRequest.url?.path, "/api/chips/dismiss")
    }

    func testAChipAlreadySettledIsARefusalWithTheWords() async throws {
        Echo.reset { _ in (409, #"{"error":"That chip was already started.","chip":{"toolUseId":"t1","status":"started"}}"#) }
        let request = ChipRequest(sessionID: "s", toolUseID: "t1", title: "", tldr: "", prompt: "", cwd: nil, folder: "/w")
        do { _ = try await client().startChip(request); XCTFail("should refuse") } catch GhostShellError.refused(let status, let message, _, _) {
            XCTAssertEqual(status, 409)
            XCTAssertEqual(message, "That chip was already started.")
        }
    }

    func testReplySendsTextWithNoMode() async throws {
        Echo.reset { _ in (200, #"{"status":"working"}"#) }
        try await client().sendReply("go on", to: "a")
        let (request, json) = try sent()
        XCTAssertEqual(request.url?.path, "/api/sessions/a/send")
        XCTAssertEqual(Set(json.keys), ["text"])
        XCTAssertEqual(json["text"] as? String, "go on")
    }

    func testReplyRefusalCarriesTheReason() async throws {
        Echo.reset { _ in (400, #"{"error":"Nothing to send."}"#) }
        do { try await client().sendReply("", to: "a"); XCTFail("should refuse") } catch GhostShellError.refused(_, let message, _, _) {
            XCTAssertEqual(message, "Nothing to send.")
        }
    }
}
