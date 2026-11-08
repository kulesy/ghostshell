import XCTest
@testable import GhostShellKit

private actor Script {
    var calls = 0
    var results: [Result<SessionIndex, GhostShellError>]
    init(_ results: [Result<SessionIndex, GhostShellError>]) { self.results = results }
    func next() throws -> SessionIndex {
        calls += 1
        let result = results.count > 1 ? results.removeFirst() : results[0]
        return try result.get()
    }
}

final class FeedTests: XCTestCase {
    private func index(_ ids: String...) -> SessionIndex { SessionIndex(started: ids.map { SessionRow(id: $0) }) }

    private func collect(_ feed: SessionIndexFeed, count: Int) async -> [FeedUpdate] {
        var seen: [FeedUpdate] = []
        for await update in feed.updates {
            seen.append(update)
            if seen.count == count { break }
        }
        return seen
    }

    func testEmitsOnChangeOnly() async {
        let script = Script([.success(index("a")), .success(index("a")), .success(index("a")), .success(index("a", "b"))])
        let feed = SessionIndexFeed(interval: .milliseconds(5)) { try await script.next() }
        await feed.resume()
        let seen = await collect(feed, count: 3)
        await feed.stop()
        XCTAssertEqual(seen, [.connection(.live), .index(index("a")), .index(index("a", "b"))])
    }

    func testReportsUnreachableThenLiveAgain() async {
        let script = Script([.failure(.unreachable), .success(index("a"))])
        let feed = SessionIndexFeed(interval: .milliseconds(5)) { try await script.next() }
        await feed.resume()
        let seen = await collect(feed, count: 3)
        await feed.stop()
        XCTAssertEqual(seen, [.connection(.unreachable), .connection(.live), .index(index("a"))])
    }

    func testSignedOutEndsTheFeed() async {
        let script = Script([.failure(.signedOut)])
        let feed = SessionIndexFeed(interval: .milliseconds(5)) { try await script.next() }
        await feed.resume()
        let seen = await collect(feed, count: 5)
        XCTAssertEqual(seen, [])
    }

    func testPauseStopsLookingAndResumeLooksAtOnce() async throws {
        let script = Script([.success(index("a"))])
        let feed = SessionIndexFeed(interval: .milliseconds(5)) { try await script.next() }
        await feed.resume()
        try await Task.sleep(for: .milliseconds(60))
        await feed.pause()
        try await Task.sleep(for: .milliseconds(30))
        let paused = await script.calls
        try await Task.sleep(for: .milliseconds(60))
        let still = await script.calls
        XCTAssertGreaterThan(paused, 1)
        XCTAssertEqual(paused, still)
        await feed.resume()
        try await Task.sleep(for: .milliseconds(30))
        let later = await script.calls
        await feed.stop()
        XCTAssertGreaterThan(later, still)
    }

    func testAnOlderLookAnsweringLateDoesNotPutTheOldIndexBack() async throws {
        let order = Script([.success(index("old")), .success(index("new"))])
        let feed = SessionIndexFeed(interval: .seconds(60)) {
            let first = await order.calls == 0
            let found = try await order.next()
            if first { try await Task.sleep(for: .milliseconds(80)) }
            return found
        }
        let slow = Task { await feed.refresh() }
        try await Task.sleep(for: .milliseconds(20))
        await feed.refresh()
        await slow.value
        await feed.stop()
        let seen = await collect(feed, count: 2)
        XCTAssertEqual(seen, [.connection(.live), .index(index("new"))])
    }
}
