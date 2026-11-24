import XCTest
@testable import GhostShellKit
@testable import GhostShellScreens

/// Answers every request from a closure and records what was asked. Nothing here reaches a network or a real server, which matters because
/// a write to api/settings changes which sessions can message each other with no card.
private final class SettingsEcho: URLProtocol, @unchecked Sendable {
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

@MainActor
final class SettingsTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(String(repeating: "ab12", count: 16), for: address)
        return GhostShellClient(address: address, store: store, protocols: [SettingsEcho.self])
    }

    private func methods() -> [String] { SettingsEcho.requests().map { $0.request.httpMethod ?? "" } }

    func testTheFlagReadsAsFalseWhenTheServerLacksIt() throws {
        let on = try JSONDecoder().decode(SessionFeatures.self, from: Data(#"{"sendReach":true}"#.utf8))
        let off = try JSONDecoder().decode(SessionFeatures.self, from: Data(#"{"many":true}"#.utf8))
        XCTAssertTrue(on.sendReach)
        XCTAssertFalse(off.sendReach)
        XCTAssertFalse(SessionFeatures().sendReach)
    }

    func testTheChoiceWordsMatchThePage() {
        XCTAssertEqual(SendReach.allCases, [.family, .project, .anySession])
        XCTAssertEqual(SendReach.allCases.map(\.choiceName), ["Its own family", "Its own project", "Any session"])
        XCTAssertEqual(SendReach.allCases.filter(\.isDefault), [.family])
        XCTAssertEqual(SendReach.anySession.rawValue, "any")
    }

    func testReadingIsAGetAndAnUnknownWordIsAFailureNotAChoice() async throws {
        SettingsEcho.reset { _ in (200, #"{"sendReach":"project"}"#) }
        let client = await client()
        let reach = try await client.sendReach()
        XCTAssertEqual(reach, .project)
        XCTAssertEqual(methods(), ["GET"])
        XCTAssertEqual(SettingsEcho.requests().first?.request.url?.path, "/api/settings")

        SettingsEcho.reset { _ in (200, #"{"sendReach":"everyone"}"#) }
        do { _ = try await client.sendReach(); XCTFail("an unknown word was read as a choice") } catch GhostShellError.server(let status) { XCTAssertEqual(status, 0) } catch { XCTFail("\(error)") }
    }

    func testWritingIsAPostWithOriginAndTheChosenWord() async throws {
        SettingsEcho.reset { _ in (200, #"{"sendReach":"any"}"#) }
        let client = await client()
        let now = try await client.setSendReach(.anySession)
        XCTAssertEqual(now, .anySession)
        let call = try XCTUnwrap(SettingsEcho.requests().first)
        XCTAssertEqual(call.request.httpMethod, "POST")
        XCTAssertEqual(call.request.url?.path, "/api/settings")
        XCTAssertEqual(call.request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertEqual(call.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: call.body) as? [String: String], ["sendReach": "any"])
    }

    func testLoadingShowsTheServersChoiceAndPostsNothing() async {
        SettingsEcho.reset { _ in (200, #"{"sendReach":"project"}"#) }
        let state = SettingsState()
        await state.load(await client())
        XCTAssertEqual(state.shown, .project)
        XCTAssertEqual(state.saved, .project)
        XCTAssertEqual(methods(), ["GET"])
        XCTAssertEqual(state.problem, "")
    }

    func testALoadThatFailsShowsNoChoiceAndAnUnknownWordIsTheSame() async {
        SettingsEcho.reset { _ in (200, #"{"sendReach":"everyone"}"#) }
        let state = SettingsState()
        await state.load(await client())
        XCTAssertNil(state.shown)
        XCTAssertTrue(state.problem.hasPrefix("Could not load the settings: "))
        XCTAssertEqual(methods(), ["GET"])
    }

    func testPickingShowsTheChoiceAtOnceThenSaves() async {
        SettingsEcho.reset { request in request.httpMethod == "GET" ? (200, #"{"sendReach":"family"}"#) : (200, #"{"sendReach":"project"}"#) }
        let client = await client()
        let state = SettingsState()
        await state.load(client)
        await state.pick(.project, client)
        XCTAssertEqual(state.shown, .project)
        XCTAssertEqual(state.saved, .project)
        XCTAssertEqual(state.status, "Saved.")
        XCTAssertFalse(state.saving)
        XCTAssertEqual(methods(), ["GET", "POST"])
    }

    func testAChoiceThatIsAlreadyShownWritesNothing() async {
        SettingsEcho.reset { _ in (200, #"{"sendReach":"family"}"#) }
        let client = await client()
        let state = SettingsState()
        await state.load(client)
        await state.pick(.family, client)
        XCTAssertEqual(methods(), ["GET"])
    }

    func testARefusedSaveGoesBackToTheSavedChoiceWithTheServersWords() async {
        SettingsEcho.reset { request in request.httpMethod == "GET" ? (200, #"{"sendReach":"family"}"#) : (400, #"{"error":"sendReach is family, project or any."}"#) }
        let client = await client()
        let state = SettingsState()
        await state.load(client)
        await state.pick(.anySession, client)
        XCTAssertEqual(state.shown, .family)
        XCTAssertEqual(state.saved, .family)
        XCTAssertEqual(state.problem, "sendReach is family, project or any.")
        XCTAssertEqual(state.status, "")
        XCTAssertFalse(state.saving)
    }

    func testNothingIsPickedBeforeTheSettingsHaveLoaded() async {
        SettingsEcho.reset { _ in (200, #"{"sendReach":"any"}"#) }
        let state = SettingsState()
        await state.pick(.anySession, await client())
        XCTAssertEqual(SettingsEcho.requests().count, 0)
    }
}
