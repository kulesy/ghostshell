import XCTest
@testable import GhostShellKit

/// Answers every request from a closure and records what was asked. The token in these tests is fake.
final class Stub: URLProtocol, @unchecked Sendable {
    typealias Reply = @Sendable (URLRequest) -> (status: Int, headers: [String: String], body: String, redirectTo: URL?)
    nonisolated(unsafe) static var reply: Reply = { _ in (200, [:], "{}", nil) }
    nonisolated(unsafe) static var seen: [URLRequest] = []
    private static let lock = NSLock()

    static func reset(_ reply: @escaping Reply) {
        lock.lock(); defer { lock.unlock() }
        self.reply = reply
        seen = []
    }
    static func requests() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return seen }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        Self.lock.lock()
        Self.seen.append(request)
        let answer = Self.reply
        Self.lock.unlock()
        let result = answer(request)
        let url = request.url!
        if let target = result.redirectTo {
            let redirect = HTTPURLResponse(url: url, statusCode: 303, httpVersion: nil, headerFields: ["Location": target.absoluteString])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: target), redirectResponse: redirect)
            // A refused redirect leaves the 3xx as the answer, as a network protocol would deliver it.
            client?.urlProtocol(self, didReceive: redirect, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if result.status == -1 {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: result.status, httpVersion: nil, headerFields: result.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(result.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class ClientTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com/app")!
    private let fakeToken = String(repeating: "ab12", count: 16)

    private func client(_ store: TokenStore = MemoryTokenStore()) -> GhostShellClient {
        GhostShellClient(address: address, store: store, protocols: [Stub.self])
    }

    private func signedIn(_ store: MemoryTokenStore) async {
        await store.save(fakeToken, for: address)
    }

    // URLSession hands a stubbed request its body as a stream.
    private func bodyOf(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 256)
        while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 256); if n <= 0 { break }; data.append(buffer, count: n) }
        return data
    }

    private struct Ping: Codable, Sendable, Equatable { var ok: Bool }

    func testSignInSendsAFormAndKeepsTheCookieToken() async throws {
        Stub.reset { _ in (303, ["Set-Cookie": "capcom=\(String(repeating: "ab12", count: 16)); Path=/; HttpOnly"], "", nil) }
        let store = MemoryTokenStore()
        let client = client(store)
        try await client.signIn(password: "p&ss=w+rd é")
        let request = try XCTUnwrap(Stub.requests().first)
        XCTAssertEqual(request.url?.absoluteString, "https://ghost.example.com/app/login")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        let body = bodyOf(request)
        XCTAssertEqual(String(decoding: body, as: UTF8.self), "password=p%26ss%3Dw%2Brd%20%C3%A9")
        let saved = await store.token(for: address)
        XCTAssertEqual(saved, fakeToken)
    }

    func testFormEncodingKeepsSymbols() {
        XCTAssertEqual(FormEncoding.encode("a+b&c=d e~f-g_h.i"), "a%2Bb%26c%3Dd%20e~f-g_h.i")
    }

    func testWrongPasswordLockedUnreachableAndServerError() async {
        let cases: [(Int, String, GhostShellError)] = [
            (401, "<p>Wrong password</p>", .wrongPassword),
            (401, "<p>Too many tries. Wait 15 minutes.</p>", .locked),
            (429, "", .locked),
            (-1, "", .unreachable),
            (500, "", .server(status: 500)),
            (303, "", .server(status: 303)),
        ]
        for (status, body, expected) in cases {
            Stub.reset { _ in (status, [:], body, nil) }
            do { try await client().signIn(password: "x"); XCTFail("no error for \(status)") } catch { XCTAssertEqual(error as? GhostShellError, expected, "\(status)") }
        }
    }

    func testACookieWithOddCharactersIsNotAccepted() async {
        Stub.reset { _ in (303, ["Set-Cookie": "capcom=bad value\r\nX: y; Path=/"], "", nil) }
        do { try await client().signIn(password: "x"); XCTFail("accepted") } catch { XCTAssertEqual(error as? GhostShellError, .server(status: 303)) }
    }

    func testCallsCarryTheCookieAndOriginOnlyOnWrites() async throws {
        Stub.reset { _ in (200, [:], "{\"ok\":true}", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        let got: Ping = try await client.get("api/ping")
        XCTAssertEqual(got, Ping(ok: true))
        let posted: Ping = try await client.post("api/ping", json: Ping(ok: false))
        XCTAssertEqual(posted, Ping(ok: true))
        let requests = Stub.requests()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Cookie"), "capcom=\(fakeToken)")
        XCTAssertNil(requests[0].value(forHTTPHeaderField: "Origin"))
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testAnUnsignedCallSendsNothing() async {
        Stub.reset { _ in (200, [:], "{}", nil) }
        let result: Result<Ping, Error> = await { do { return .success(try await client().get("api/ping")) } catch { return .failure(error) } }()
        XCTAssertEqual(Stub.requests().count, 0)
        if case .failure(let error) = result { XCTAssertEqual(error as? GhostShellError, .signedOut) } else { XCTFail("sent") }
    }

    func testA401ClearsTheTokenAndSaysSignedOut() async throws {
        Stub.reset { _ in (401, [:], "", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        var changes = client.authChanges.makeAsyncIterator()
        do { let _: Ping = try await client.get("api/ping"); XCTFail("answered") } catch { XCTAssertEqual(error as? GhostShellError, .signedOut) }
        let state = await changes.next()
        XCTAssertEqual(state, .signedOut)
        let left = await store.token(for: address)
        XCTAssertNil(left)
    }

    func testARedirectIsNeverFollowed() async throws {
        let evil = URL(string: "https://evil.example.org/steal")!
        Stub.reset { request in
            request.url?.host == "evil.example.org" ? (200, [:], "{}", nil) : (302, [:], "", evil)
        }
        let store = MemoryTokenStore()
        await signedIn(store)
        do { let _: Ping = try await client(store).get("api/ping"); XCTFail("followed") } catch { XCTAssertEqual(error as? GhostShellError, .server(status: 303)) }
        XCTAssertTrue(Stub.requests().allSatisfy { $0.url?.host == "ghost.example.com" })
        XCTAssertEqual(Stub.requests().count, 1)
    }

    func testARedirectOnAStreamIsNeverFollowed() async throws {
        let evil = URL(string: "https://evil.example.org/steal")!
        Stub.reset { request in
            request.url?.host == "evil.example.org" ? (200, [:], "event: status\ndata: 1\n\n", nil) : (302, [:], "", evil)
        }
        let store = MemoryTokenStore()
        await signedIn(store)
        do { _ = try await client(store).openStream("api/sessions/abc/events"); XCTFail("followed") } catch { XCTAssertEqual(error as? GhostShellError, .server(status: 303)) }
        XCTAssertTrue(Stub.requests().allSatisfy { $0.url?.host == "ghost.example.com" })
        XCTAssertEqual(Stub.requests().count, 1)
    }

    func testTheLoginRedirectIsReadAsTheAnswer() async throws {
        let token = fakeToken
        Stub.reset { request in
            request.url?.path.hasSuffix("/login") == true ? (303, ["Set-Cookie": "capcom=\(token); Path=/", "Location": "/app/"], "", nil) : (200, [:], "{}", nil)
        }
        try await client().signIn(password: "x")
        XCTAssertEqual(Stub.requests().count, 1)
    }

    func testAnUndecodableAnswerIsAServerError() async {
        Stub.reset { _ in (200, [:], "not json", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        do { let _: Ping = try await client(store).get("api/ping"); XCTFail("decoded") } catch { XCTAssertEqual(error as? GhostShellError, .server(status: 0)) }
    }

    func testSignOutForgetsHereEvenWhenTheServerIsUnreachable() async throws {
        Stub.reset { _ in (-1, [:], "", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        await client.signOut()
        let left = await store.token(for: address)
        XCTAssertNil(left)
        let request = try XCTUnwrap(Stub.requests().first)
        XCTAssertEqual(request.url?.path, "/app/logout")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
    }

    func testATokenIsKeptPerAddress() async {
        let store = MemoryTokenStore()
        await store.save(fakeToken, for: address)
        let other = ServerAddress("https://other.example.com")!
        let found = await store.token(for: other)
        XCTAssertNil(found)
    }

    func testAnImplausibleStoredTokenIsForgottenAndRestoreIsFalse() async {
        let store = MemoryTokenStore()
        await store.save("bad\r\nX-Evil: 1", for: address)
        let restored = await client(store).restore()
        XCTAssertFalse(restored)
        let left = await store.token(for: address)
        XCTAssertNil(left)
        await store.save(fakeToken, for: address)
        let again = await client(store).restore()
        XCTAssertTrue(again)
    }

    func testDataSendsADeleteWithTheCookieAndOrigin() async throws {
        Stub.reset { _ in (200, [:], "", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        _ = try await client(store).data("DELETE", "api/things/42")
        let request = try XCTUnwrap(Stub.requests().first)
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.absoluteString, "https://ghost.example.com/app/api/things/42")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "capcom=\(fakeToken)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
    }

    func testDataSendsRawBytesWithTheirContentTypeAndReturnsBytes() async throws {
        Stub.reset { _ in (200, [:], "\u{1}raw reply", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        let upload = Data([0xFF, 0x00, 0x10, 0x80])
        let reply = try await client(store).data("PATCH", "api/files", query: [URLQueryItem(name: "path", value: "/a b/c.bin"), URLQueryItem(name: "name", value: "c.bin")],
                                                 body: upload, contentType: "application/octet-stream")
        XCTAssertEqual(reply, Data("\u{1}raw reply".utf8))
        let request = try XCTUnwrap(Stub.requests().first)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(request.url?.query, "path=/a%20b/c.bin&name=c.bin")
        XCTAssertEqual(bodyOf(request), upload)
    }

    func testDataRefusesAControlCharacterInTheContentTypeAndAnOddMethod() async {
        Stub.reset { _ in (200, [:], "", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        for type in ["text/plain\r\nCookie: capcom=x", "text/plain\n", "a\u{0}b", "a\u{7F}b"] {
            do { _ = try await client.data("POST", "api/x", body: Data([1]), contentType: type); XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(type)) }
        }
        do { _ = try await client.data("GET\r\nX: y", "api/x"); XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath("GET\r\nX: y")) }
        XCTAssertEqual(Stub.requests().count, 0)
    }

    func testAnImplausibleStoredTokenIsNeverPutInAHeader() async {
        Stub.reset { _ in (200, [:], "{}", nil) }
        let store = MemoryTokenStore()
        await store.save("bad\r\nX-Evil: 1", for: address)
        do { let _: Ping = try await client(store).get("api/ping"); XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .signedOut) }
        XCTAssertEqual(Stub.requests().count, 0)
    }

    func testTheEventsPathRefusesAnOddID() async {
        Stub.reset { _ in (200, [:], "", nil) }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        for id in ["", "a/b", "../x"] {
            let stream = client.eventStream(sessionID: id)
            var count = 0
            for await _ in stream.events() { count += 1 }
            XCTAssertEqual(count, 0, id)
        }
        XCTAssertEqual(Stub.requests().count, 0)
    }

    func testAJSONErrorSentenceReachesTheCallerCleanedAndCapped() async throws {
        let long = String(repeating: "x", count: 400)
        Stub.reset { request in
            switch request.url?.lastPathComponent {
            case "clean": return (403, [:], #"{"error": "  This chat does not link\u0007 to that file.\n "}"#, nil)
            case "long": return (409, [:], #"{"error": "\#(long)"}"#, nil)
            default: return (500, [:], #"{"error": "   "}"#, nil)
            }
        }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        do { _ = try await client.data("GET", "api/clean"); XCTFail("sent") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 403, message: "This chat does not link to that file."))
            XCTAssertEqual(error.localizedDescription, "This chat does not link to that file.")
        }
        do { _ = try await client.data("GET", "api/long"); XCTFail("sent") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 409, message: String(long.prefix(300))))
        }
        do { _ = try await client.data("GET", "api/blank"); XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .server(status: 500)) }
    }

    func testAnErrorBodyThatIsNotJSONWithAStringErrorStaysAServerError() async throws {
        Stub.reset { request in
            switch request.url?.lastPathComponent {
            case "page": return (502, [:], "<html>Bad gateway</html>", nil)
            case "number": return (400, [:], #"{"error": 7}"#, nil)
            default: return (404, [:], "[]", nil)
            }
        }
        let store = MemoryTokenStore()
        await signedIn(store)
        let client = client(store)
        for (name, status) in [("page", 502), ("number", 400), ("list", 404)] {
            do { _ = try await client.data("GET", "api/\(name)"); XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .server(status: status), name) }
        }
    }
}
