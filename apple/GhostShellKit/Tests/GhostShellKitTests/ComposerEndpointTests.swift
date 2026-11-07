import XCTest
@testable import GhostShellKit

/// Answers every request from a closure and records it. Its own copy, so these tests never share state with ClientTests.
private final class ComposerStub: URLProtocol, @unchecked Sendable {
    typealias Reply = @Sendable (URLRequest) -> (status: Int, body: String)
    nonisolated(unsafe) static var reply: Reply = { _ in (200, "{}") }
    nonisolated(unsafe) static var seen: [(request: URLRequest, body: Data)] = []
    private static let lock = NSLock()

    static func reset(_ reply: @escaping Reply) {
        lock.lock(); defer { lock.unlock() }
        self.reply = reply
        seen = []
    }
    static func last() -> (request: URLRequest, body: Data)? { lock.lock(); defer { lock.unlock() }; return seen.last }
    static func count() -> Int { lock.lock(); defer { lock.unlock() }; return seen.count }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 4096); if n <= 0 { break }; body.append(buffer, count: n) }
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

final class ComposerEndpointTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let token = String(repeating: "ab12", count: 16)

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(token, for: address)
        return GhostShellClient(address: address, store: store, protocols: [ComposerStub.self])
    }

    private func json(_ data: Data?) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(data)) as? [String: Any])
    }

    private static let status = #"{"state":"working","running":true,"mode":"plan","model":"claude-opus-5-5","effort":"high","fast":false}"#

    func testSendLeavesOutEmptyListsAndReadsTheStatus() async throws {
        ComposerStub.reset { _ in (200, #"{"state":"working","running":true,"mode":"plan","unarchived":true}"#) }
        let reply = try await client().sendMessage(OutgoingMessage(text: "hi", mode: "plan"), to: "abc-1")
        let sent = try XCTUnwrap(ComposerStub.last())
        XCTAssertEqual(sent.request.url?.path, "/api/sessions/abc-1/send")
        XCTAssertEqual(sent.request.httpMethod, "POST")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertEqual(try json(sent.body).keys.sorted(), ["mode", "text"])
        XCTAssertEqual(reply.status.state, .working)
        XCTAssertEqual(reply.status.mode, "plan")
        XCTAssertTrue(reply.unarchived)
    }

    func testSendCarriesImagesAndFiles() async throws {
        ComposerStub.reset { _ in (200, ComposerEndpointTests.status) }
        let message = OutgoingMessage(text: "see", images: [OutgoingImage(mediaType: "image/png", data: "AAAA")], files: ["f1", "f2"])
        let reply = try await client().sendMessage(message, to: "s")
        XCTAssertFalse(reply.unarchived)
        let body = try json(ComposerStub.last()?.body)
        XCTAssertEqual(body["files"] as? [String], ["f1", "f2"])
        XCTAssertEqual((body["images"] as? [[String: String]])?.first, ["mediaType": "image/png", "data": "AAAA"])
        XCTAssertNil(body["mode"])
    }

    func testARefusedSendKeepsTheServersSentence() async throws {
        ComposerStub.reset { _ in (400, #"{"error":"Image 2 is not a PNG, JPEG, GIF or WebP."}"#) }
        do { _ = try await client().sendMessage(OutgoingMessage(text: "x"), to: "s"); XCTFail("sent") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 400, message: "Image 2 is not a PNG, JPEG, GIF or WebP."))
            XCTAssertEqual(ComposerWords.failure(error), "Image 2 is not a PNG, JPEG, GIF or WebP.")
        }
    }

    func testARefusalWithNoSentenceFallsBackToTheStatusError() async throws {
        ComposerStub.reset { _ in (409, "") }
        do { _ = try await client().stop(sessionID: "s"); XCTFail("stopped") } catch {
            XCTAssertEqual(error as? GhostShellError, .server(status: 409))
            XCTAssertEqual(ComposerWords.failure(error), "That session is not running here.")
        }
    }

    func testStopPostsAnEmptyObject() async throws {
        ComposerStub.reset { _ in (200, ComposerEndpointTests.status) }
        let result = try await client().stop(sessionID: "s1")
        XCTAssertEqual(ComposerStub.last()?.request.url?.path, "/api/sessions/s1/stop")
        XCTAssertEqual(String(decoding: ComposerStub.last()?.body ?? Data(), as: UTF8.self), "{}")
        XCTAssertEqual(result.effort, "high")
    }

    func testThePickersPostTheirOwnKey() async throws {
        let c = await client()
        ComposerStub.reset { _ in (200, #"{"mode":"auto"}"#) }
        try await c.setMode("auto", sessionID: "s")
        XCTAssertEqual(ComposerStub.last()?.request.url?.path, "/api/sessions/s/mode")
        XCTAssertEqual(try json(ComposerStub.last()?.body) as? [String: String], ["mode": "auto"])
        ComposerStub.reset { _ in (200, ComposerEndpointTests.status) }
        _ = try await c.setModel("claude-haiku-5-5", sessionID: "s")
        XCTAssertEqual(try json(ComposerStub.last()?.body) as? [String: String], ["model": "claude-haiku-5-5"])
        _ = try await c.setEffort("max", sessionID: "s")
        XCTAssertEqual(try json(ComposerStub.last()?.body) as? [String: String], ["effort": "max"])
        _ = try await c.setFast(true, sessionID: "s")
        XCTAssertEqual(ComposerStub.last()?.request.url?.path, "/api/sessions/s/fast")
        XCTAssertEqual(try json(ComposerStub.last()?.body)["fast"] as? Bool, true)
    }

    func testASessionIdWithASlashIsRefusedBeforeASend() async throws {
        ComposerStub.reset { _ in (200, ComposerEndpointTests.status) }
        do { _ = try await client().stop(sessionID: "a/b"); XCTFail("stopped") } catch { XCTAssertEqual(error as? GhostShellError, .badPath("a/b")) }
        XCTAssertEqual(ComposerStub.count(), 0)
    }

    func testCommandsAndModelsAskAboutASessionOrAFolder() async throws {
        ComposerStub.reset { _ in (200, #"{"commands":[{"name":"compact","description":"Shrink","hint":"[focus]","aliases":["c"]},{"name":"help"}]}"#) }
        let c = await client()
        let commands = try await c.commands(.session("s9"))
        XCTAssertEqual(commands.map(\.name), ["compact", "help"])
        XCTAssertEqual(commands[0].aliases, ["c"])
        XCTAssertEqual(commands[1].hint, "")
        XCTAssertEqual(try json(ComposerStub.last()?.body) as? [String: String], ["id": "s9"])
        ComposerStub.reset { _ in (200, #"{"models":[{"id":"claude-x-1","label":"X 1","fast":true},{"id":"claude-y-1"}]}"#) }
        let models = try await c.models(.folder("/work"))
        XCTAssertEqual(ComposerStub.last()?.request.url?.path, "/api/models")
        XCTAssertEqual(try json(ComposerStub.last()?.body) as? [String: String], ["cwd": "/work"])
        XCTAssertEqual(models, [ListedModel(id: "claude-x-1", label: "X 1", fast: true), ListedModel(id: "claude-y-1", label: "claude-y-1")])
    }

    func testUploadSendsRawBytesWithAPercentEncodedName() async throws {
        ComposerStub.reset { _ in (200, #"{"id":"u1","name":"my notes é.txt","type":"text/plain","size":5}"#) }
        let file = try await client().uploadFile(Data("hello".utf8), name: "my notes é.txt", type: "text/plain")
        let sent = try XCTUnwrap(ComposerStub.last())
        XCTAssertEqual(sent.request.url?.path, "/api/uploads")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "x-file-name"), "my%20notes%20%C3%A9.txt")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Content-Type"), "text/plain")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Cookie"), "capcom=\(token)")
        XCTAssertEqual(String(decoding: sent.body, as: UTF8.self), "hello")
        XCTAssertEqual(file.id, "u1")
        XCTAssertEqual(file.size, 5)
    }

    func testAnExtraHeaderCannotReplaceTheCookieOrOriginOrCarryAControlCharacter() async throws {
        ComposerStub.reset { _ in (200, "{}") }
        let c = await client()
        for headers in [["Cookie": "capcom=x"], ["origin": "https://evil.example"], ["Content-Type": "text/html"], ["x-a": "b\r\nX-Evil: 1"], ["bad name": "v"], ["": "v"]] {
            do { _ = try await c.data("POST", "api/uploads", body: Data("x".utf8), contentType: "text/plain", headers: headers); XCTFail("sent \(headers)") } catch {
                XCTAssertTrue(error is GhostShellError)
            }
        }
        XCTAssertEqual(ComposerStub.count(), 0)
    }

    func testUploadLimitsAreNilWhenTheServerHasNoRoute() async throws {
        ComposerStub.reset { _ in (200, #"{"maxBytes":31457280,"maxFiles":10}"#) }
        let limits = await client().uploadLimits()
        XCTAssertEqual(limits, UploadLimits(maxBytes: 31_457_280, maxFiles: 10))
        ComposerStub.reset { _ in (404, "") }
        let none = await client().uploadLimits()
        XCTAssertNil(none)
    }

    func testNewSessionSendsOnlyWhatWasChanged() async throws {
        ComposerStub.reset { _ in (200, #"{"id":"new-1"}"#) }
        let id = try await client().startSession(NewSessionRequest(cwd: "/work", message: OutgoingMessage(text: "go", mode: "auto")))
        XCTAssertEqual(id, "new-1")
        XCTAssertEqual(ComposerStub.last()?.request.url?.path, "/api/new")
        XCTAssertEqual(try json(ComposerStub.last()?.body).keys.sorted(), ["cwd", "mode", "text"])
        _ = try await client().startSession(NewSessionRequest(cwd: "/work", message: OutgoingMessage(text: "go", mode: "plan", files: ["f"]), model: "m", effort: "low", fast: false))
        let body = try json(ComposerStub.last()?.body)
        XCTAssertEqual(body.keys.sorted(), ["cwd", "effort", "fast", "files", "mode", "model", "text"])
        XCTAssertNil(body["account"])
        XCTAssertNil(body["group"])
        XCTAssertNil(body["parent"])
    }

    func testFoldersAndDefaults() async throws {
        ComposerStub.reset { _ in (200, #"{"folders":["/home","/work"]}"#) }
        let folders = try await client().folders()
        XCTAssertEqual(folders, ["/home", "/work"])
        ComposerStub.reset { _ in (200, #"{"mode":"plan","model":null,"shownModel":"claude-opus-5-5","effort":"high"}"#) }
        let defaults = try await client().defaults(cwd: "/a b&c")
        XCTAssertEqual(ComposerStub.last()?.request.url?.query, "cwd=/a%20b%26c")
        XCTAssertEqual(defaults, SessionDefaults(mode: "plan", model: nil, shownModel: "claude-opus-5-5", effort: "high"))
    }
}
