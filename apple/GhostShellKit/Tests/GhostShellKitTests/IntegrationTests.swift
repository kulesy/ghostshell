import XCTest
@testable import GhostShellKit

/// These talk to a real scratch server started by `apple/scripts/test.mjs`, which passes its address and password file in the environment.
/// Without them every test here is skipped, so a plain `swift test` runs the unit tests only.
final class IntegrationTests: XCTestCase {
    private struct Scratch { let address: ServerAddress; let password: String }

    private func scratch(_ addressKey: String = "GS_SCRATCH_ADDRESS", _ fileKey: String = "GS_SCRATCH_PASSWORD_FILE") throws -> Scratch {
        let env = ProcessInfo.processInfo.environment
        guard let text = env[addressKey], let file = env[fileKey] else { throw XCTSkip("No scratch server. Run apple/scripts/test.mjs.") }
        let address = try XCTUnwrap(ServerAddress(text))
        let password = try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        return Scratch(address: address, password: password)
    }

    private func signedIn(_ server: Scratch, store: TokenStore = MemoryTokenStore()) async throws -> GhostShellClient {
        let client = GhostShellClient(address: server.address, store: store)
        try await client.signIn(password: server.password)
        return client
    }

    // The server wants `"account": null` to clear a pin, and a Swift optional would leave the key out.
    private struct Pin: Encodable, Sendable {
        var id: String
        private enum Key: String, CodingKey { case kind, id, account }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Key.self)
            try c.encode("session", forKey: .kind)
            try c.encode(id, forKey: .id)
            try c.encodeNil(forKey: .account)
        }
    }

    private func firstID(_ client: GhostShellClient) async throws -> String {
        let index = try await client.sessionIndex()
        return try XCTUnwrap(index.rows.first?.id)
    }

    private actor Tally {
        var bytes = 0
        var ended: String?
        func add() { bytes += 1 }
        func end(_ why: String) { ended = why }
    }

    /// The result of `work`, or nil when it has not finished in time.
    private func within<T: Sendable>(seconds: Int, _ work: @escaping @Sendable () async -> T) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await work() }
            group.addTask { try? await Task.sleep(for: .seconds(seconds)); return nil }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private func savedToken(_ store: MemoryTokenStore, _ server: Scratch) async throws -> String {
        let token = await store.token(for: server.address)
        return try XCTUnwrap(token)
    }

    func testSignInThenTheIndexDecodes() async throws {
        let server = try scratch()
        let client = try await signedIn(server)
        let index = try await client.sessionIndex()
        XCTAssertFalse(index.rows.isEmpty, "the scratch server seeds sessions")
        XCTAssertTrue(index.rows.allSatisfy { !$0.id.isEmpty && !$0.title.isEmpty })
        let times = index.rows.compactMap { $0.sortAt ?? $0.lastActivityAt }
        XCTAssertEqual(times, times.sorted(by: >), "newest first")
    }

    func testTheArchivedListDecodes() async throws {
        let client = try await signedIn(try scratch())
        let archived = try await client.archivedSessions()
        XCTAssertTrue(archived.allSatisfy { !$0.id.isEmpty })
    }

    func testAWrongPasswordIsWrong() async throws {
        let server = try scratch()
        let client = GhostShellClient(address: server.address, store: MemoryTokenStore())
        do { try await client.signIn(password: "not the password"); XCTFail("signed in") } catch { XCTAssertEqual(error as? GhostShellError, .wrongPassword) }
    }

    func testTenWrongPasswordsLockSignInAndTheRightOneIsRefused() async throws {
        let server = try scratch("GS_LOCK_ADDRESS", "GS_LOCK_PASSWORD_FILE")
        let client = GhostShellClient(address: server.address, store: MemoryTokenStore())
        var seen: [GhostShellError] = []
        for _ in 0..<12 {
            do { try await client.signIn(password: "wrong"); XCTFail("signed in") } catch { seen.append(error as? GhostShellError ?? .unreachable) }
            if seen.last == .locked { break }
        }
        XCTAssertEqual(seen.last, .locked)
        XCTAssertTrue(seen.dropLast().allSatisfy { $0 == .wrongPassword })
        do { try await client.signIn(password: server.password); XCTFail("signed in while locked") } catch { XCTAssertEqual(error as? GhostShellError, .locked) }
    }

    // The route pins a session to an account and takes strictOrigin, which refuses a request with no Origin. The client always sends one.
    func testAnOwnerRouteAcceptsTheClientsOriginAndRefusesNone() async throws {
        let server = try scratch()
        let store = MemoryTokenStore()
        let client = try await signedIn(server, store: store)
        let id = try await firstID(client)
        try await client.send("api/layout/account", json: Pin(id: id))

        // The same route with no Origin, to show the route is strict and the pass above came from the header.
        let token = try await savedToken(store, server)
        var bare = URLRequest(url: try server.address.url(for: "api/layout/account"))
        bare.httpMethod = "POST"
        bare.setValue("application/json", forHTTPHeaderField: "Content-Type")
        bare.setValue("capcom=\(token)", forHTTPHeaderField: "Cookie")
        bare.httpBody = try JSONEncoder().encode(Pin(id: id))
        let (_, response) = try await URLSession(configuration: .ephemeral).data(for: bare)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 403)
    }

    func testSignOutRevokesTheTokenOnTheServer() async throws {
        let server = try scratch()
        let store = MemoryTokenStore()
        let client = try await signedIn(server, store: store)
        let copy = MemoryTokenStore()
        await copy.save(try await savedToken(store, server), for: server.address)
        let other = GhostShellClient(address: server.address, store: copy)
        _ = try await other.sessionIndex()

        await client.signOut()
        let gone = await store.token(for: server.address)
        XCTAssertNil(gone)
        do { _ = try await other.sessionIndex(); XCTFail("the revoked token still worked") } catch { XCTAssertEqual(error as? GhostShellError, .signedOut) }
        let left = await copy.token(for: server.address)
        XCTAssertNil(left, "a 401 clears the token")
    }

    func testTheEventStreamSendsStatus() async throws {
        let server = try scratch()
        let client = try await signedIn(server)
        let id = try await firstID(client)
        let events = client.eventStream(sessionID: id).events()
        let name: String? = await withTaskGroup(of: String?.self) { group in
            group.addTask { for await event in events { if event.name == "status" { return event.name } }; return nil }
            group.addTask { try? await Task.sleep(for: .seconds(10)); return nil }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        XCTAssertEqual(name, "status")
    }

    func testTheMessagesRouteReadsATranscriptBothWays() async throws {
        let server = try scratch()
        let client = try await signedIn(server)
        let id = try await firstID(client)
        let page = try await client.messages(sessionID: id)
        XCTAssertFalse(page.hasEarlier, "a two-line transcript has nothing before it")
        XCTAssertEqual(page.start, 0)
        XCTAssertGreaterThan(page.end, 0)
        let kinds = page.items.map { item -> String in
            switch item.body {
            case .user: "user"
            case .assistant: "assistant"
            default: "other"
            }
        }
        XCTAssertEqual(kinds, ["user", "assistant"])
        if case .assistant(_, let text) = page.items.last?.body { XCTAssertEqual(text, "Done.") } else { XCTFail("the last item is not the reply") }

        let nothing = try await client.messages(sessionID: id, after: page.end)
        XCTAssertTrue(nothing.items.isEmpty, "nothing is newer than the end")
        XCTAssertFalse(nothing.reset)
        let none = try await client.messages(sessionID: id, before: page.start)
        XCTAssertTrue(none.items.isEmpty, "nothing is older than the start")
        XCTAssertFalse(none.hasEarlier)
    }

    func testTheFeedReportsTheListThenStopsOnSignOut() async throws {
        let server = try scratch()
        let store = MemoryTokenStore()
        let client = try await signedIn(server, store: store)
        let copy = MemoryTokenStore()
        await copy.save(try await savedToken(store, server), for: server.address)
        let revoker = GhostShellClient(address: server.address, store: copy)

        let feed = client.indexFeed()
        await feed.resume()
        var sawIndex = false
        for await update in feed.updates {
            if case .index(let index) = update { sawIndex = !index.rows.isEmpty; break }
        }
        XCTAssertTrue(sawIndex)

        // The token is revoked on the server, so the next poll gets a 401.
        await revoker.signOut()
        let ended = await within(seconds: 20) { for await _ in feed.updates {}; return true }
        XCTAssertEqual(ended, true, "the feed ends after the token is revoked")
        // The sign-in put .signedIn first, so this reads on until the token is gone.
        let state = await within(seconds: 5) { () -> AuthState? in for await change in client.authChanges where change == .signedOut { return change }; return nil }
        XCTAssertEqual(state ?? nil, .signedOut)
    }

    // The server sends a keep-alive every 20 seconds, so a stream that is idle for 25 must still be open.
    func testAStreamHeldOpenIdleFor25SecondsDoesNotDrop() async throws {
        let server = try scratch()
        let client = try await signedIn(server)
        let id = try await firstID(client)
        let stream = try await client.openStream("api/sessions/\(id)/events")
        let tally = Tally()
        let reader = Task {
            do { for try await _ in stream { await tally.add() }; await tally.end("finished") } catch { await tally.end("\(error)") }
        }
        try await Task.sleep(for: .seconds(3))
        let early = await tally.bytes
        try await Task.sleep(for: .seconds(22))
        let ended = await tally.ended
        let late = await tally.bytes
        reader.cancel()
        XCTAssertNil(ended, "the stream ended: \(ended ?? "")")
        XCTAssertGreaterThan(early, 0, "the snapshot arrived")
        XCTAssertGreaterThan(late, early, "a keep-alive arrived while idle")
    }

    // A seeded session has no running chat here, so the server answers 409 and the client throws it rather than calling it answered elsewhere.
    func testAnAnswerToASessionThatIsNotRunningIsA409() async throws {
        let server = try scratch()
        let client = try await signedIn(server)
        let id = try await firstID(client)
        do { _ = try await client.decide(sessionID: id, requestID: "no-such-request", .allow); XCTFail("the server took a decision for a chat that is not running") } catch {
            switch error as? GhostShellError {
            case .server(status: 409)?, .refused(status: 409, _)?: break
            default: XCTFail("expected a 409, got \(error)")
            }
        }
    }

    private struct NewChat: Encodable, Sendable { var cwd: String; var text: String; var model: String; var mode: String }
    private struct Started: Decodable, Sendable { var id: String }

    // Runs only against a server made with `node apple/scripts/test-server.mjs --claude`, which GS_CLAUDE_ADDRESS and GS_CLAUDE_PASSWORD_FILE name.
    // A real Haiku chat asks to run a command, the client allows it, and a second answer to the same request is "answered elsewhere".
    func testARealPermissionPromptIsAllowedAndThenGone() async throws {
        let server = try scratch("GS_CLAUDE_ADDRESS", "GS_CLAUDE_PASSWORD_FILE")
        let client = try await signedIn(server)
        let started: Started = try await client.post("api/new", json: NewChat(
            cwd: "/private/tmp/claude-501/capcom-test-cwd/swift-app", text: "Run the shell command `touch approved.txt` and then reply with the word done.", model: "haiku", mode: "manual"))
        let events = client.eventStream(sessionID: started.id).events()
        let prompt: PendingApproval? = await within(seconds: 90) {
            for await raw in events {
                if case .approval(let p) = ChatEvent(raw) { return p }
                if raw.name == "status", let status = try? raw.decode(ChatStatus.self), let p = status.pending.first { return p }
            }
            return nil
        } ?? nil
        let asked = try XCTUnwrap(prompt, "the chat never asked")
        XCTAssertEqual(asked.tool, "Bash")
        XCTAssertEqual(Approvals.parts(of: asked).title, "Bash wants to run a command")

        let first = try await client.decide(sessionID: started.id, requestID: asked.requestID, .allow)
        XCTAssertEqual(first, .resolved)
        let again = try await client.decide(sessionID: started.id, requestID: asked.requestID, .allow)
        XCTAssertEqual(again, .answeredElsewhere, "the request is no longer pending")
    }

    func testAnAddressNobodyListensOnIsUnreachable() async throws {
        _ = try scratch()
        let client = GhostShellClient(address: try XCTUnwrap(ServerAddress("http://127.0.0.1:9")), store: MemoryTokenStore())
        do { try await client.signIn(password: "x"); XCTFail("signed in") } catch { XCTAssertEqual(error as? GhostShellError, .unreachable) }
    }
}

/// Runs only when GS_KEYCHAIN_TEST names a service made for this run, so it never reads an item another build made.
final class KeychainTests: XCTestCase {
    func testRoundTripInTheRunsOwnService() async throws {
        guard let service = ProcessInfo.processInfo.environment["GS_KEYCHAIN_TEST"], service.hasPrefix("gs-test-") else { throw XCTSkip("Not asked to touch the Keychain.") }
        let store = KeychainTokenStore(service: service)
        let a = ServerAddress("http://localhost:4310")!
        let b = ServerAddress("https://other.example.com")!
        var found = await store.token(for: a)
        XCTAssertNil(found)
        await store.save("first-fake-value", for: a)
        await store.save("second-fake-value", for: a)
        await store.save("other-fake-value", for: b)
        found = await store.token(for: a)
        XCTAssertEqual(found, "second-fake-value")
        found = await store.token(for: b)
        XCTAssertEqual(found, "other-fake-value")
        await store.clear(for: a)
        await store.clear(for: b)
        found = await store.token(for: a)
        XCTAssertNil(found)
        found = await store.token(for: b)
        XCTAssertNil(found)
    }
}
