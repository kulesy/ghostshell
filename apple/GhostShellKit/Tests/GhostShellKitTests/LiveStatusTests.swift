import XCTest
@testable import GhostShellKit

final class LiveStatusTests: XCTestCase {
    func testAStatusFrameReplacesEverything() {
        var status = ChatStatus(state: .working, pending: [PendingApproval(requestID: "a", tool: "Bash")])
        XCTAssertTrue(status.apply(.status(ChatStatus(mode: "plan"))))
        XCTAssertEqual(status, ChatStatus(mode: "plan"))
    }

    func testAnApprovalIsAddedOnceAndRemovedWhenResolved() {
        var status = ChatStatus()
        status.apply(.approval(PendingApproval(requestID: "a", tool: "Bash")))
        status.apply(.approval(PendingApproval(requestID: "b", tool: "Edit")))
        status.apply(.approval(PendingApproval(requestID: "a", tool: "Write")))
        XCTAssertEqual(status.pending.map(\.requestID), ["b", "a"])
        XCTAssertEqual(status.pending.last?.tool, "Write")
        status.apply(.approvalResolved(requestID: "b"))
        XCTAssertEqual(status.pending.map(\.requestID), ["a"])
    }

    func testAHoldIsReplacedByIDAndEnds() throws {
        let hold = try JSONDecoder().decode(ChatHold.self, from: Data(#"{"id":"h","cause":"widget"}"#.utf8))
        var status = ChatStatus()
        status.apply(.hold(hold))
        status.apply(.hold(hold))
        XCTAssertEqual(status.holds.map(\.id), ["h"])
        status.apply(.holdEnded(id: "h"))
        XCTAssertTrue(status.holds.isEmpty)
    }

    func testSettingsEventsChangeOnlyTheirField() {
        var status = ChatStatus(state: .working)
        status.apply(.mode("plan"))
        status.apply(.model("opus"))
        status.apply(.effort("high"))
        status.apply(.fast(true))
        XCTAssertEqual(status.mode, "plan")
        XCTAssertEqual(status.model, "opus")
        XCTAssertEqual(status.shownModel, "opus")
        XCTAssertEqual(status.effort, "high")
        XCTAssertTrue(status.fast)
        XCTAssertEqual(status.state, .working)
    }

    func testExitClearsWhatOnlyARunningChatCanHave() {
        var status = ChatStatus(state: .working, running: true, mode: "plan", pending: [PendingApproval(requestID: "a", tool: "Bash")])
        status.apply(.exit)
        XCTAssertEqual(status, ChatStatus(state: .idle, running: false, mode: "plan"))
    }

    func testStreamedTextLeavesTheStatusAlone() {
        let before = ChatStatus(state: .working, live: "Hel")
        for event: ChatEvent in [.delta("lo"), .think(id: "t", text: "x", done: false), .work(nil), .changed, .turnEnd(error: true, message: nil), .error("x"), .other(name: "new")] {
            var status = before
            XCTAssertFalse(status.apply(event))
            XCTAssertEqual(status, before)
        }
    }
}
