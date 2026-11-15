import XCTest
@testable import GhostShellKit

/// Answers each route from a table and records what was asked. Nothing here reaches a network or a real server.
private final class Routes: URLProtocol, @unchecked Sendable {
    typealias Reply = (status: Int, headers: [String: String], body: String)
    nonisolated(unsafe) static var replies: [String: Reply] = [:]
    nonisolated(unsafe) static var seen: [(request: URLRequest, body: Data)] = []
    private static let lock = NSLock()

    static func reset(_ replies: [String: Reply]) {
        lock.lock(); defer { lock.unlock() }
        self.replies = replies
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
        let reply = Self.replies[request.url?.path ?? ""] ?? (404, [:], #"{"error":"Not found"}"#)
        Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

/// Gives fixed answers and records what it was asked to sign. `failure` is thrown instead, as the system sheet does when the person backs out.
private final class FixedCeremony: PasskeyCeremony, @unchecked Sendable {
    var failure: Error?
    private(set) var asked: [String] = []
    private(set) var challenges: [Data] = []
    private(set) var excluded: [Data] = []

    func assert(challenge: Data, rpId: String) async throws -> PasskeyAssertion {
        asked.append("assert \(rpId)"); challenges.append(challenge)
        if let failure { throw failure }
        return PasskeyAssertion(credentialID: Data("id".utf8), clientDataJSON: Data("client".utf8), authenticatorData: Data("auth".utf8), signature: Data("sig".utf8), userHandle: Data("user".utf8))
    }

    func register(challenge: Data, rpId: String, name: String, userID: Data, excluding: [Data]) async throws -> PasskeyRegistration {
        excluded = excluding
        asked.append("register \(rpId) \(name) \(String(decoding: userID, as: UTF8.self))"); challenges.append(challenge)
        if let failure { throw failure }
        return PasskeyRegistration(credentialID: Data("new-id".utf8), clientDataJSON: Data("new-client".utf8), attestationObject: Data("attest".utf8))
    }
}

final class PasskeyTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let token = String(repeating: "ab12", count: 16)

    private func client(_ address: ServerAddress? = nil) -> (GhostShellClient, MemoryTokenStore) {
        let store = MemoryTokenStore()
        return (GhostShellClient(address: address ?? self.address, store: store, protocols: [Routes.self]), store)
    }

    private func json(_ data: Data) throws -> [String: Any?] { try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any?]) }

    private func options(rpId: String = "ghost.example.com") -> Routes.Reply {
        (200, [:], #"{"options":{"challenge":"c3R1Yi1jaGFsbGVuZ2U","rpId":"\#(rpId)"},"why":""}"#)
    }

    // MARK: Encoding

    func testBase64URLHasNoPaddingOrPlusAndSlash() {
        let bytes = Data([0xfb, 0xff, 0xfe, 0x01])
        XCTAssertEqual(Base64URL.encode(bytes), "-__-AQ")
        XCTAssertEqual(Base64URL.decode("-__-AQ"), bytes)
        XCTAssertEqual(Base64URL.decode("c3R1Yi1jaGFsbGVuZ2U"), Data("stub-challenge".utf8))
        XCTAssertNil(Base64URL.decode("not base64!"))
    }

    func testAssertionEncodesAsThePageSendsIt() throws {
        let made = PasskeyAssertion(credentialID: Data([1, 2]), clientDataJSON: Data("c".utf8), authenticatorData: Data("a".utf8), signature: Data("s".utf8), userHandle: Data("u".utf8))
        let body = try json(JSONEncoder().encode(made))
        XCTAssertEqual(body["id"] as? String, "AQI")
        let response = try XCTUnwrap(body["response"] as? [String: Any?])
        XCTAssertEqual(response["clientDataJSON"] as? String, "Yw")
        XCTAssertEqual(response["authenticatorData"] as? String, "YQ")
        XCTAssertEqual(response["signature"] as? String, "cw")
        XCTAssertEqual(response["userHandle"] as? String, "dQ")
        XCTAssertEqual(Set(response.keys), ["clientDataJSON", "authenticatorData", "signature", "userHandle"])
    }

    func testAssertionWithNoUserHandleSendsNull() throws {
        var made = PasskeyAssertion(credentialID: Data(), clientDataJSON: Data(), authenticatorData: Data(), signature: Data(), userHandle: nil)
        made.credentialID = Data([1])
        let text = String(decoding: try JSONEncoder().encode(made), as: UTF8.self)
        XCTAssertTrue(text.contains(#""userHandle":null"#), text)
    }

    func testRegistrationEncodesAsThePageSendsIt() throws {
        let made = PasskeyRegistration(credentialID: Data([1, 2]), clientDataJSON: Data("c".utf8), attestationObject: Data("o".utf8))
        let body = try json(JSONEncoder().encode(made))
        XCTAssertEqual(body["id"] as? String, "AQI")
        let response = try XCTUnwrap(body["response"] as? [String: Any?])
        XCTAssertEqual(response["clientDataJSON"] as? String, "Yw")
        XCTAssertEqual(response["attestationObject"] as? String, "bw")
        XCTAssertEqual(Set(response.keys), ["clientDataJSON", "attestationObject"])
    }

    // MARK: Refusals

    func testDomainMustMatchTheAddressExactly() throws {
        let support = PasskeySupport(ceremony: FixedCeremony(), domain: " Ghost.Example.com ")
        XCTAssertTrue(support.allows(address))
        for other in ["https://other.example.com", "https://ghost.example.com:8443", "https://sub.ghost.example.com"] {
            XCTAssertFalse(support.allows(try XCTUnwrap(ServerAddress(other))), other)
        }
        XCTAssertFalse(PasskeySupport(ceremony: FixedCeremony(), domain: "").allows(address), "An empty domain is a build with no entitlement")
        XCTAssertTrue(PasskeySupport(ceremony: FixedCeremony(), domain: nil).allows(try XCTUnwrap(ServerAddress("http://127.0.0.1:4310"))), "Only the Debug stub has no domain")
    }

    func testCheckRefusesAnRpIdThatIsNotTheAddressHost() {
        let support = PasskeySupport(ceremony: FixedCeremony(), domain: "ghost.example.com")
        XCTAssertNoThrow(try support.check(rpId: "Ghost.Example.com", address: address))
        XCTAssertThrowsError(try support.check(rpId: "example.com", address: address)) { error in
            XCTAssertEqual((error as? GhostShellError)?.errorDescription, "The server's passkeys belong to another address than this one.")
        }
    }

    func testCheckRefusesAnAddressOutsideTheDomain() throws {
        let support = PasskeySupport(ceremony: FixedCeremony(), domain: "ghost.example.com")
        let other = try XCTUnwrap(ServerAddress("https://other.example.com"))
        XCTAssertThrowsError(try support.check(rpId: "other.example.com", address: other)) { error in
            XCTAssertEqual((error as? GhostShellError)?.errorDescription, "This app can use passkeys only at ghost.example.com. Sign in at that address.")
        }
    }

    // MARK: Sign in

    func testSignInAsksForOptionsSignsAndKeepsTheToken() async throws {
        Routes.reset(["/passkey-options": options(), "/passkey-login": (200, ["Set-Cookie": "capcom=\(token); Path=/; HttpOnly"], #"{"ok":true}"#)])
        let ceremony = FixedCeremony()
        let (client, store) = client()
        try await client.signIn(passkeyUsing: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
        let seen = Routes.requests()
        XCTAssertEqual(seen.map { $0.request.url?.path }, ["/passkey-options", "/passkey-login"])
        for call in seen {
            XCTAssertEqual(call.request.httpMethod, "POST")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
            XCTAssertNil(call.request.value(forHTTPHeaderField: "Cookie"), "Signing in has no token yet")
        }
        XCTAssertEqual(try json(seen[0].body)["origin"] as? String, "https://ghost.example.com")
        XCTAssertEqual(ceremony.asked, ["assert ghost.example.com"])
        XCTAssertEqual(ceremony.challenges, [Data("stub-challenge".utf8)])
        let login = try json(seen[1].body)
        XCTAssertEqual(login["id"] as? String, Base64URL.encode(Data("id".utf8)))
        XCTAssertEqual((login["response"] as? [String: Any?])?["userHandle"] as? String, Base64URL.encode(Data("user".utf8)))
        let saved = await store.token(for: address)
        XCTAssertEqual(saved, token)
    }

    func testSignInStopsBeforeTheSheetWhenTheServerNamesAnotherHost() async {
        Routes.reset(["/passkey-options": options(rpId: "example.com")])
        let ceremony = FixedCeremony()
        let (client, _) = client()
        do {
            try await client.signIn(passkeyUsing: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
            XCTFail("Expected a refusal")
        } catch {
            XCTAssertEqual((error as? GhostShellError)?.errorDescription, "The server's passkeys belong to another address than this one.")
        }
        XCTAssertEqual(ceremony.asked, [])
        XCTAssertEqual(Routes.requests().count, 1)
    }

    func testSignInOutsideTheDomainSendsNothing() async throws {
        Routes.reset([:])
        let ceremony = FixedCeremony()
        let other = try XCTUnwrap(ServerAddress("https://other.example.com"))
        let (client, _) = client(other)
        let offered = await client.offersPasskey(using: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
        XCTAssertFalse(offered)
        XCTAssertEqual(Routes.requests().count, 0, "A build that may not use passkeys here does not even ask")
    }

    func testBackingOutOfTheSheetIsACancellationAndSignsNothing() async {
        Routes.reset(["/passkey-options": options()])
        let ceremony = FixedCeremony()
        ceremony.failure = CancellationError()
        let (client, store) = client()
        do {
            try await client.signIn(passkeyUsing: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
            XCTFail("Expected a cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError, "\(error)")
        }
        XCTAssertEqual(Routes.requests().map { $0.request.url?.path }, ["/passkey-options"])
        let saved = await store.token(for: address)
        XCTAssertNil(saved)
    }

    func testARefusedPasskeyShowsTheServersWords() async {
        for status in [401, 429] {
            Routes.reset(["/passkey-options": options(), "/passkey-login": (status, [:], #"{"error":"That passkey is not known here."}"#)])
            let (client, store) = client()
            do {
                try await client.signIn(passkeyUsing: PasskeySupport(ceremony: FixedCeremony(), domain: "ghost.example.com"))
                XCTFail("Expected a refusal")
            } catch {
                XCTAssertEqual((error as? GhostShellError)?.errorDescription, "That passkey is not known here.", "\(status)")
            }
            let saved = await store.token(for: address)
            XCTAssertNil(saved)
        }
    }

    func testOffersPasskeyOnlyWhenTheServerGivesOptions() async {
        let support = PasskeySupport(ceremony: FixedCeremony(), domain: "ghost.example.com")
        Routes.reset(["/passkey-options": options()])
        var offered = await client().0.offersPasskey(using: support)
        XCTAssertTrue(offered)
        Routes.reset(["/passkey-options": (200, [:], #"{"options":null,"why":"No passkeys are added yet."}"#)])
        offered = await client().0.offersPasskey(using: support)
        XCTAssertFalse(offered)
        Routes.reset([:])
        offered = await client().0.offersPasskey(using: support)
        XCTAssertFalse(offered, "A server without the route offers none")
    }

    // MARK: Add

    func testAddingAPasskeyAsksForOptionsRegistersAndReturnsTheList() async throws {
        let registration = #"{"challenge":"c3R1Yi1jaGFsbGVuZ2U","rp":{"id":"ghost.example.com","name":"GhostShell"},"user":{"id":"dXNlci0x","name":"owner","displayName":"owner"},"excludeCredentials":[]}"#
        Routes.reset(["/api/passkeys/options": (200, [:], registration), "/api/passkeys": (200, [:], #"{"passkeys":[{"id":"pk-1","device":"iPhone","rpId":"ghost.example.com"}]}"#)])
        let ceremony = FixedCeremony()
        let (client, store) = client()
        await store.save(token, for: address)
        let list = try await client.addPasskey(using: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
        XCTAssertEqual(list.map(\.id), ["pk-1"])
        let seen = Routes.requests()
        XCTAssertEqual(seen.map { $0.request.url?.path }, ["/api/passkeys/options", "/api/passkeys"])
        for call in seen {
            XCTAssertEqual(call.request.httpMethod, "POST")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
            XCTAssertEqual(call.request.value(forHTTPHeaderField: "Cookie"), "capcom=\(token)")
        }
        XCTAssertEqual(try json(seen[0].body)["origin"] as? String, "https://ghost.example.com")
        XCTAssertEqual(ceremony.asked, ["register ghost.example.com owner user-1"])
        let sent = try json(seen[1].body)
        XCTAssertEqual(sent["id"] as? String, Base64URL.encode(Data("new-id".utf8)))
        XCTAssertEqual((sent["response"] as? [String: Any?])?["attestationObject"] as? String, Base64URL.encode(Data("attest".utf8)))
    }

    func testAddingPassesTheServersExistingCredentialsToTheSheet() async throws {
        let registration = #"{"challenge":"c3R1Yi1jaGFsbGVuZ2U","rp":{"id":"ghost.example.com","name":"GhostShell"},"user":{"id":"dXNlci0x","name":"owner"},"excludeCredentials":[{"type":"public-key","id":"a25vd24tMQ"},{"type":"public-key","id":"a25vd24tMg"}]}"#
        Routes.reset(["/api/passkeys/options": (200, [:], registration), "/api/passkeys": (200, [:], #"{"passkeys":[]}"#)])
        let ceremony = FixedCeremony()
        let (client, store) = client()
        await store.save(token, for: address)
        _ = try await client.addPasskey(using: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
        XCTAssertEqual(ceremony.excluded, [Data("known-1".utf8), Data("known-2".utf8)])
    }

    func testAddingStopsBeforeTheSheetWhenTheServerNamesAnotherHost() async throws {
        let registration = #"{"challenge":"c3R1Yi1jaGFsbGVuZ2U","rp":{"id":"example.com","name":"GhostShell"},"user":{"id":"dXNlci0x","name":"owner"}}"#
        Routes.reset(["/api/passkeys/options": (200, [:], registration)])
        let ceremony = FixedCeremony()
        let (client, store) = client()
        await store.save(token, for: address)
        do {
            _ = try await client.addPasskey(using: PasskeySupport(ceremony: ceremony, domain: "ghost.example.com"))
            XCTFail("Expected a refusal")
        } catch {
            XCTAssertEqual((error as? GhostShellError)?.errorDescription, "The server's passkeys belong to another address than this one.")
        }
        XCTAssertEqual(ceremony.asked, [])
    }
}
