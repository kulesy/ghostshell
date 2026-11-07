import XCTest
@testable import GhostShellKit

final class SSEParserTests: XCTestCase {
    private func parse(_ text: String, chunk: Int = .max) -> [SSEEvent] {
        var parser = SSEParser()
        var events: [SSEEvent] = []
        let bytes = Array(text.utf8)
        var start = 0
        while start < bytes.count {
            let end = min(start + chunk, bytes.count)
            events += parser.feed(bytes[start..<end])
            start = end
        }
        return events
    }

    func testNamedEventWithJSON() throws {
        let events = parse("event: status\ndata: {\"state\":\"idle\"}\n\n")
        XCTAssertEqual(events, [SSEEvent(name: "status", data: "{\"state\":\"idle\"}")])
        struct Status: Decodable { var state: String }
        XCTAssertEqual(try events[0].decode(Status.self).state, "idle")
    }

    func testCommentsAreDropped() {
        XCTAssertEqual(parse(": keep-alive\n\nevent: a\n: inside\ndata: 1\n\n"), [SSEEvent(name: "a", data: "1")])
    }

    func testMultiLineDataJoinsWithNewlines() {
        XCTAssertEqual(parse("data: one\ndata: two\ndata:\ndata: four\n\n"), [SSEEvent(name: "message", data: "one\ntwo\n\nfour")])
    }

    func testAllLineEndings() {
        let expected = [SSEEvent(name: "a", data: "1"), SSEEvent(name: "b", data: "2")]
        XCTAssertEqual(parse("event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n"), expected)
        XCTAssertEqual(parse("event: a\rdata: 1\r\revent: b\rdata: 2\r\r"), expected)
        XCTAssertEqual(parse("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"), expected)
    }

    func testEveryChunkSizeGivesTheSameEvents() {
        let text = "event: status\r\ndata: {\"title\":\"caf\u{e9} \u{1F47B}\"}\r\n\r\n: ping\r\n\r\nevent: changed\ndata: {}\n\n"
        let whole = parse(text)
        XCTAssertEqual(whole.count, 2)
        for size in 1...9 { XCTAssertEqual(parse(text, chunk: size), whole, "chunk \(size)") }
    }

    func testAnEventWithNoDataIsNotDispatchedAndDoesNotLeak() {
        XCTAssertEqual(parse("event: lonely\n\ndata: x\n\n"), [SSEEvent(name: "message", data: "x")])
    }

    func testOnlyOneLeadingSpaceIsDropped() {
        XCTAssertEqual(parse("data:  two\n\n"), [SSEEvent(name: "message", data: " two")])
        XCTAssertEqual(parse("data:none\n\n"), [SSEEvent(name: "message", data: "none")])
    }

    func testAnUnfinishedEventWaits() {
        XCTAssertEqual(parse("event: a\ndata: 1\n"), [])
    }
}
