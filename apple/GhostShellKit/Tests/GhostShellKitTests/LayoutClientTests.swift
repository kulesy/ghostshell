import XCTest
@testable import GhostShellKit

/// Answers every request from a closure and records what was asked. Nothing here reaches a network or a real server.
private final class LayoutStub: URLProtocol, @unchecked Sendable {
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

final class LayoutClientTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let token = String(repeating: "cd34", count: 16)

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(token, for: address)
        return GhostShellClient(address: address, store: store, protocols: [LayoutStub.self])
    }

    /// The body with its keys sorted, so a test can name it as one string. A `null` shows as `null`.
    private func sent(_ call: (request: URLRequest, body: Data)) throws -> String {
        let object = try JSONSerialization.jsonObject(with: call.body)
        return String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    private func lines() throws -> [String] {
        try LayoutStub.requests().map { "\($0.request.httpMethod ?? "") \($0.request.url?.path ?? "") \(try sent($0))" }
    }

    func testSessionCallsSendThePagesRequests() async throws {
        LayoutStub.reset { _ in (200, #"{"stopped":false,"subs":0}"#) }
        let client = await client()
        try await client.renameSession("s1", title: "New title")
        try await client.pinSession("s1")
        try await client.moveSession("s1", group: "g1")
        try await client.moveSession("s1", group: nil)
        try await client.nestSession("s1", parent: "s2")
        try await client.nestSession("s1", parent: nil)
        try await client.archiveSession("s1")
        try await client.archiveSession("s1", archived: false)
        try await client.archiveSession("s1", stop: false)
        try await client.stopSession("s1")
        XCTAssertEqual(try lines(), [
            #"POST /api/layout/rename {"id":"s1","title":"New title"}"#,
            #"POST /api/layout/pin {"id":"s1","pinned":true}"#,
            #"POST /api/layout/move {"group":"g1","id":"s1"}"#,
            #"POST /api/layout/move {"group":null,"id":"s1"}"#,
            #"POST /api/layout/nest {"id":"s1","parent":"s2"}"#,
            #"POST /api/layout/nest {"id":"s1","parent":null}"#,
            #"POST /api/layout/archive {"archived":true,"id":"s1"}"#,
            #"POST /api/layout/archive {"archived":false,"id":"s1"}"#,
            #"POST /api/layout/archive {"archived":true,"id":"s1","stop":false}"#,
            #"POST /api/sessions/s1/stop {}"#,
        ])
    }

    func testPinningASessionToAnAccount() async throws {
        LayoutStub.reset { _ in (200, #"{"kind":"session","id":"s1","account":"work"}"#) }
        let client = await client()
        try await client.pinAccount(id: "s1", account: "work")
        try await client.pinAccount(id: "s1", account: nil)
        try await client.pinAccount(.group, id: "g1", account: "work")
        XCTAssertEqual(try lines(), [
            #"POST /api/layout/account {"account":"work","id":"s1","kind":"session"}"#,
            #"POST /api/layout/account {"account":null,"id":"s1","kind":"session"}"#,
            #"POST /api/layout/account {"account":"work","id":"g1","kind":"group"}"#,
        ])
    }

    func testSeveralSessionsAtOnce() async throws {
        LayoutStub.reset { _ in (200, #"{"undo":"u-1","count":2}"#) }
        let client = await client()
        let toGroup = try await client.placeSessions(["a", "b"], to: .group("g1"))
        _ = try await client.placeSessions(["a", "b"], to: .group(nil))
        _ = try await client.placeSessions(["a", "b"], to: .pinned)
        _ = try await client.placeSessions(["a", "b"], to: .parent("p"))
        _ = try await client.placeSessions(["a", "b"], to: .parent(nil))
        XCTAssertEqual(toGroup.count, 2)
        XCTAssertEqual(toGroup.undo, "u-1")
        XCTAssertEqual(try lines(), [
            #"POST /api/layout/many {"ids":["a","b"],"to":{"group":"g1"}}"#,
            #"POST /api/layout/many {"ids":["a","b"],"to":{"group":null}}"#,
            #"POST /api/layout/many {"ids":["a","b"],"to":{"pinned":true}}"#,
            #"POST /api/layout/many {"ids":["a","b"],"to":{"parent":"p"}}"#,
            #"POST /api/layout/many {"ids":["a","b"],"to":{"parent":null}}"#,
        ])
    }

    func testGroupAndProjectCalls() async throws {
        LayoutStub.reset { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/add") { return (200, #"{"id":"made-1","name":"Made"}"#) }
            if path.hasSuffix("/group/remove") { return (200, #"{"stopped":true}"#) }
            return (200, "{}")
        }
        let client = await client()
        let group = try await client.addGroup(name: "Release", project: "p1")
        _ = try await client.addGroup(name: "Loose", project: nil)
        try await client.renameGroup("g1", name: "Ship")
        try await client.moveGroup("g1", project: "p1")
        try await client.moveGroup("g1", project: nil)
        try await client.orderGroup("g1", .before, beside: "g2")
        try await client.orderGroup("g1", .after, beside: "g3")
        let removed = try await client.removeGroup("g1")
        let project = try await client.addProject(name: "Website")
        try await client.renameProject("p1", name: "Site")
        try await client.removeProject("p1")
        XCTAssertEqual(group.id, "made-1")
        XCTAssertEqual(project.name, "Made")
        XCTAssertTrue(removed.stopped)
        XCTAssertEqual(try lines(), [
            #"POST /api/layout/group/add {"name":"Release","project":"p1"}"#,
            #"POST /api/layout/group/add {"name":"Loose","project":null}"#,
            #"POST /api/layout/group/rename {"id":"g1","name":"Ship"}"#,
            #"POST /api/layout/group/move {"id":"g1","project":"p1"}"#,
            #"POST /api/layout/group/move {"id":"g1","project":null}"#,
            #"POST /api/layout/group/order {"before":"g2","id":"g1"}"#,
            #"POST /api/layout/group/order {"after":"g3","id":"g1"}"#,
            #"POST /api/layout/group/remove {"id":"g1"}"#,
            #"POST /api/layout/project/add {"name":"Website"}"#,
            #"POST /api/layout/project/rename {"id":"p1","name":"Site"}"#,
            #"POST /api/layout/project/remove {"id":"p1"}"#,
        ])
    }

    func testEveryCallCarriesOriginAndTheCookie() async throws {
        LayoutStub.reset { _ in (200, #"{"id":"p-1","name":"Website"}"#) }
        let client = await client()
        try await client.pinSession("s1")
        _ = try await client.addProject(name: "Website")
        for call in LayoutStub.requests() {
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Cookie"), "capcom=\(token)")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        }
    }

    func testArchiveReplyDefaultsAndTheStoppedCount() async throws {
        LayoutStub.reset { _ in (200, #"{"stopped":true,"subs":2}"#) }
        let reply = try await (await client()).archiveSession("s1")
        XCTAssertTrue(reply.stopped)
        XCTAssertEqual(reply.stoppedCount, 1)
        XCTAssertEqual(reply.subs, 2)
    }

    func testARefusalCarriesTheServersWords() async throws {
        LayoutStub.reset { _ in (409, #"{"error":"A chat is running."}"#) }
        let client = await client()
        do {
            try await client.archiveSession("s1", stop: false)
            XCTFail("a 409 should throw")
        } catch let GhostShellError.refused(status, message) {
            XCTAssertEqual(status, 409)
            XCTAssertEqual(message, "A chat is running.")
        }
        LayoutStub.reset { _ in (400, #"{"error":"That name is taken."}"#) }
        do {
            _ = try await client.addGroup(name: "Same", project: nil)
            XCTFail("a 400 should throw")
        } catch {
            XCTAssertEqual(error.localizedDescription, "That name is taken.")
        }
    }

    func testAnIDThatIsNotSafeInAPathIsRefusedBeforeSending() async throws {
        LayoutStub.reset { _ in (200, "{}") }
        do {
            try await (await client()).stopSession("../x")
            XCTFail("a path id with a slash should be refused")
        } catch {
            XCTAssertTrue(LayoutStub.requests().isEmpty)
        }
    }
}
