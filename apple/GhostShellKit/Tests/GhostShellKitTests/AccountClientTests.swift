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

final class AccountClientTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let token = String(repeating: "ab12", count: 16)

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(token, for: address)
        return GhostShellClient(address: address, store: store, protocols: [Echo.self])
    }

    private func json(_ data: Data) throws -> [String: Any?] { try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any?]) }

    func testStrictPostsCarryOriginAndTheCookie() async throws {
        Echo.reset { _ in (200, #"{"accounts":[]}"#) }
        let client = await client()
        _ = try await client.addAccount(name: "Work")
        _ = try await client.setAutoSwitch(true)
        _ = try await client.seenAutoSwitch()
        let seen = Echo.requests()
        XCTAssertEqual(seen.count, 3)
        for call in seen {
            XCTAssertEqual(call.request.httpMethod, "POST")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Cookie"), "capcom=\(token)")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        }
        XCTAssertEqual(seen.map { $0.request.url?.path }, ["/api/accounts", "/api/accounts/auto", "/api/accounts/seen"])
        XCTAssertEqual(try json(seen[0].body)["name"] as? String, "Work")
        XCTAssertEqual(try json(seen[1].body)["on"] as? Bool, true)
    }

    func testRoutesAndBodies() async throws {
        Echo.reset { _ in (200, "{}") }
        let client = await client()
        _ = try await client.accounts()
        _ = try await client.signIn(account: "acc-1")
        _ = try await client.rename(account: "acc-1", name: "Home")
        _ = try await client.use(account: "acc-1", continue: "sess_2")
        _ = try await client.use(account: "acc-1")
        _ = try await client.refreshPlans()
        _ = try await client.chromeOpen()
        _ = try await client.chromeSeen()
        _ = try await client.banners()
        _ = try await client.bannerSignIn(account: "acc-1")
        _ = try await client.bannerSignIn(account: nil)
        _ = try await client.update()
        _ = try await client.forceRestart()
        let seen = Echo.requests()
        XCTAssertEqual(seen.map { "\($0.request.httpMethod ?? "") \($0.request.url?.path ?? "")" }, [
            "GET /api/accounts", "POST /api/accounts/acc-1/sign-in", "POST /api/accounts/acc-1/rename", "POST /api/accounts/acc-1/use", "POST /api/accounts/acc-1/use",
            "POST /api/accounts/plan", "POST /api/accounts/chrome-open", "POST /api/accounts/chrome-seen", "GET /api/banners", "POST /api/banners/sign-in",
            "POST /api/banners/sign-in", "POST /api/banners/update", "POST /api/banners/force-restart",
        ])
        XCTAssertEqual(try json(seen[2].body)["name"] as? String, "Home")
        XCTAssertEqual(try json(seen[3].body)["continue"] as? String, "sess_2")
        XCTAssertNil(try json(seen[4].body)["continue"] ?? nil, "no session, no key")
        XCTAssertEqual(try json(seen[9].body)["account"] as? String, "acc-1")
        XCTAssertNil(try json(seen[10].body)["account"] ?? nil)
        XCTAssertEqual(try json(seen[11].body).count, 0)
        XCTAssertEqual(seen[12].request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
    }

    func testContextPlanAndPasskeys() async throws {
        Echo.reset { request in
            request.url?.path == "/api/passkeys" ? (200, #"{"available":true,"passkeys":[]}"#)
                : request.url?.path == "/api/passkeys/remove" ? (200, #"{"passkeys":[{"id":"p2"}]}"#)
                : request.url?.path.hasSuffix("/context") == true ? (200, #"{"source":"none"}"#) : (200, #"{"limits":null}"#)
        }
        let client = await client()
        let figure = try await client.context(sessionID: "s_1", detail: .full)
        XCTAssertEqual(figure.source, .none)
        let plan = try await client.plan(sessionID: "s_1")
        XCTAssertNil(plan.limits)
        let list = try await client.passkeys(origin: "https://ghost.example.com")
        XCTAssertTrue(list.available)
        let left = try await client.removePasskey(id: "p1")
        XCTAssertEqual(left.map(\.id), ["p2"])
        let seen = Echo.requests()
        XCTAssertEqual(seen[0].request.url?.path, "/api/sessions/s_1/context")
        XCTAssertEqual(try json(seen[0].body)["detail"] as? String, "full")
        XCTAssertEqual(seen[1].request.url?.path, "/api/sessions/s_1/plan")
        XCTAssertEqual(seen[2].request.httpMethod, "GET")
        XCTAssertEqual(seen[2].request.url?.query, "origin=https://ghost.example.com")
        XCTAssertEqual(try json(seen[3].body)["id"] as? String, "p1")
        XCTAssertFalse(seen.contains { $0.request.url?.path.hasSuffix("/events") == true }, "the meter must never open the events stream")
    }

    func testAnIdThatCouldChangeThePathIsRefusedBeforeAnythingIsSent() async {
        Echo.reset { _ in (200, "{}") }
        let client = await client()
        for bad in ["", "..", "a/b", "a b", "a?x=1", "a#b", "../accounts", "é", "a%2Fb", "a\n"] {
            do { _ = try await client.signIn(account: bad); XCTFail("signIn accepted \(bad.debugDescription)") } catch GhostShellError.badPath {}
            catch { XCTFail("signIn: \(error) for \(bad.debugDescription)") }
            do { _ = try await client.context(sessionID: bad); XCTFail("context accepted \(bad.debugDescription)") } catch GhostShellError.badPath {}
            catch { XCTFail("context: \(error) for \(bad.debugDescription)") }
        }
        do { _ = try await client.use(account: "ok", continue: "a/b"); XCTFail("use accepted a bad session") } catch GhostShellError.badPath {} catch { XCTFail("\(error)") }
        do { _ = try await client.bannerSignIn(account: "a/b"); XCTFail("bannerSignIn accepted a bad id") } catch GhostShellError.badPath {} catch { XCTFail("\(error)") }
        do { _ = try await client.plan(sessionID: "../x"); XCTFail("plan accepted a bad id") } catch GhostShellError.badPath {} catch { XCTFail("\(error)") }
        XCTAssertEqual(Echo.requests().count, 0)
    }

    func testARefusalCarriesTheServersWords() async throws {
        Echo.reset { _ in (409, #"{"error":"That name is already used."}"#) }
        let client = await client()
        do { _ = try await client.addAccount(name: "Work"); XCTFail("expected a refusal") } catch let error as GhostShellError {
            XCTAssertEqual(error, .refused(status: 409, message: "That name is already used."))
            XCTAssertEqual(error.errorDescription, "That name is already used.")
        }
        Echo.reset { _ in (400, #"{"error":"Name too long."}"#) }
        do { _ = try await client.rename(account: "a", name: "x"); XCTFail() } catch let error as GhostShellError { XCTAssertEqual(error.errorDescription, "Name too long.") }
    }

    func testOtherFailuresKeepTheirOwnWords() async throws {
        let client = await client()
        for (status, body) in [(500, #"{"error":"boom"}"#), (404, #"{"error":"no"}"#), (409, "not json"), (400, #"{"error":""}"#)] {
            Echo.reset { _ in (status, body) }
            do { _ = try await client.banners(); XCTFail("expected a failure") } catch let error as GhostShellError {
                XCTAssertEqual(error, .server(status: status), "status \(status)")
            }
        }
    }
}
