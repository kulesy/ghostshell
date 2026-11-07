import XCTest
@testable import GhostShellKit

private actor Opens {
    var count = 0
    func bump() -> Int { count += 1; return count }
}

private func bytes(_ text: String, thenFail error: Error? = nil) -> AsyncThrowingStream<UInt8, Error> {
    AsyncThrowingStream { continuation in
        text.utf8.forEach { continuation.yield($0) }
        continuation.finish(throwing: error)
    }
}

final class EventStreamTests: XCTestCase {

    func testReopensAfterADropAndKeepsGoing() async {
        let opens = Opens()
        let stream = EventStream(delays: [.milliseconds(5)]) {
            switch await opens.bump() {
            case 1: return bytes("event: status\ndata: 1\n\nevent: half\nda", thenFail: GhostShellError.unreachable)
            case 2: throw GhostShellError.unreachable
            default: return bytes("event: status\ndata: 2\n\n")
            }
        }
        var names: [String] = []
        for await event in stream.events() {
            names.append(event.name + event.data)
            if names.count == 2 { break }
        }
        XCTAssertEqual(names, ["status1", "status2"])
        let count = await opens.count
        XCTAssertGreaterThanOrEqual(count, 3)
    }

    func testSignedOutEndsTheStreamWithoutReopening() async {
        let opens = Opens()
        let stream = EventStream(delays: [.milliseconds(5)]) {
            _ = await opens.bump()
            throw GhostShellError.signedOut
        }
        var seen = 0
        for await _ in stream.events() { seen += 1 }
        let count = await opens.count
        XCTAssertEqual(seen, 0)
        XCTAssertEqual(count, 1)
    }
}
