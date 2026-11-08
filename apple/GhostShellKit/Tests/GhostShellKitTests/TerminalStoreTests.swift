import XCTest
@testable import GhostShellKit
@testable import GhostShellScreens

private func run(_ id: String, text: String = "") -> String {
    let output = text.isEmpty ? "[]" : #"[{"stream":"out","text":"\#(text)"}]"#
    return #"{"id":"\#(id)","command":"ls","cwd":"/h/x","source":"panel","startedAt":1000,"endedAt":null,"exitCode":null,"signal":null,"stopped":false,"running":true,"truncated":false,"delivered":null,"output":\#(output)}"#
}

private func snapshot(_ text: String = "") -> (status: Int, body: String) {
    (200, #"{"cwd":"/h/x","home":"/h","runs":[\#(run("a", text: text))]}"#)
}

@MainActor
final class TerminalStoreTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com/app")!

    private func makeStore() async -> (TerminalStore, ChatContext) {
        let tokens = MemoryTokenStore()
        await tokens.save(String(repeating: "ab12", count: 16), for: address)
        let client = GhostShellClient(address: address, store: tokens, protocols: [TerminalStub.self])
        let chat = ChatContext(sessionID: "s1", client: client)
        let store = TerminalStore(chat: chat)
        store.retryAfter = .milliseconds(20)
        return (store, chat)
    }

    private func reads() -> Int { TerminalStub.requests().filter { $0.request.httpMethod == "GET" }.count }

    private func wait(_ what: String, until done: () -> Bool) async throws {
        for _ in 0..<300 where !done() { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(done(), what)
    }

    /// A read that never comes cannot be waited for, so this watches a short window (several retry periods) for one.
    private func assertNoMoreReads(than count: Int, _ what: String) async throws {
        for _ in 0..<8 {
            try await Task.sleep(for: .milliseconds(25))
            XCTAssertEqual(reads(), count, what)
        }
    }

    private func publishOutputs(_ n: Int, to chat: ChatContext) {
        for _ in 0..<n {
            chat.publish(SSEEvent(name: "terminal", data: #"{"type":"output","run":"a","chunks":[{"stream":"out","text":"x"}]}"#))
        }
    }

    func testAnUnreachableOrFailedReadIsTriedAgainUntilItWorks() async throws {
        TerminalStub.reset { _ in TerminalStub.requests().count < 3 ? (503, "") : snapshot() }
        let (store, chat) = await makeStore()
        store.start()
        try await wait("loaded") { store.state.ready }
        XCTAssertEqual(reads(), 3)
        XCTAssertEqual(store.state.error, "")
        chat.close()
    }

    func testARefusalIsNotTriedAgain() async throws {
        TerminalStub.reset { _ in (400, #"{"error":"This session has no terminal."}"#) }
        let (store, chat) = await makeStore()
        store.start()
        try await wait("refused") { !store.state.error.isEmpty }
        try await assertNoMoreReads(than: 1, "a refusal is final")
        XCTAssertEqual(store.state.error, "This session has no terminal.")
        chat.close()
    }

    func testARefusalClearsWhatWasHeldSoTheNextStartReadsOnce() async throws {
        let gate = DispatchSemaphore(value: 0)
        let count = Locked(0)
        TerminalStub.reset { _ in
            if count.next() == 1 { _ = gate.wait(timeout: .now() + 10); return (400, #"{"error":"This session has no terminal."}"#) }
            return snapshot("fresh\\n")
        }
        let (store, chat) = await makeStore()
        store.start()
        publishOutputs(TerminalHold.cap + 1, to: chat)
        try await wait("held past the cap") { store.hold.overflowed }
        gate.signal()
        try await wait("refused") { !store.state.error.isEmpty }
        XCTAssertFalse(store.hold.overflowed)
        XCTAssertTrue(store.hold.events.isEmpty)
        store.start()
        try await wait("loaded") { store.state.ready }
        XCTAssertEqual(reads(), 2, "the refused read, then one more")
        chat.close()
    }

    func testTheReadStopsWhenTheChatCloses() async throws {
        TerminalStub.reset { _ in (503, "") }
        let (store, chat) = await makeStore()
        store.start()
        try await wait("retrying") { reads() >= 2 }
        chat.close()
        try await Task.sleep(for: .milliseconds(50))
        try await assertNoMoreReads(than: reads(), "the chat is closed")
    }

    func testTheReadStopsWhenTheStoreIsStopped() async throws {
        TerminalStub.reset { _ in (503, "") }
        let (store, chat) = await makeStore()
        store.start()
        try await wait("retrying") { reads() >= 2 }
        store.stop()
        try await Task.sleep(for: .milliseconds(50))
        let settled = reads()
        try await assertNoMoreReads(than: settled, "the store is stopped")
        store.start()
        try await assertNoMoreReads(than: settled, "a stopped store does not start again")
        chat.close()
    }

    func testMoreEventsThanTheHoldKeepsMeansASecondFreshRead() async throws {
        let gate = DispatchSemaphore(value: 0)
        let count = Locked(0)
        TerminalStub.reset { _ in
            // The first read waits for the test to feed the events, so they all arrive while it is out.
            if count.next() == 1 { _ = gate.wait(timeout: .now() + 10); return snapshot("old\\n") }
            return snapshot("fresh\\n")
        }
        let (store, chat) = await makeStore()
        store.start()
        publishOutputs(TerminalHold.cap + 1, to: chat)
        try await wait("held past the cap") { store.hold.overflowed }
        gate.signal()
        try await wait("loaded") { store.state.ready }
        XCTAssertEqual(reads(), 2)
        XCTAssertEqual(TerminalRules.textOf(store.state.runs[0].output), "fresh\n", "none of the dropped events is applied to the stale snapshot")
        chat.close()
    }

    func testACommandOverTheLimitIsRefusedBeforeItIsSent() async throws {
        TerminalStub.reset { _ in (200, "{}") }
        let (store, chat) = await makeStore()
        let words = await store.run(String(repeating: "x", count: TerminalRules.maxCommand + 1), source: .panel)
        XCTAssertEqual(words, "That command is too long to run.")
        XCTAssertTrue(TerminalStub.requests().isEmpty)
        XCTAssertTrue(store.state.runs.isEmpty)
        chat.close()
    }
}

private final class Locked: @unchecked Sendable {
    private var value: Int
    private let lock = NSLock()
    init(_ value: Int) { self.value = value }
    func next() -> Int { lock.lock(); defer { lock.unlock() }; value += 1; return value }
}
