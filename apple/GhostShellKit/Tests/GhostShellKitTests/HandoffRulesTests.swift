import XCTest
@testable import GhostShellKit

final class HandoffRulesTests: XCTestCase {
    private func row(_ json: String) throws -> SessionRow {
        try JSONDecoder().decode(SessionRow.self, from: Data(json.utf8))
    }

    func testARowReadsTheHandoffFieldsAndLeavesThemOutWhenAbsent() throws {
        let cold = try row(#"{"id":"a","cold":true,"coldAt":1790000000000,"continues":"b","continuedIn":"c"}"#)
        XCTAssertTrue(cold.cold)
        XCTAssertEqual(cold.coldAt, Date(timeIntervalSince1970: 1_790_000_000))
        XCTAssertEqual(cold.continues, "b")
        XCTAssertEqual(cold.continuedIn, "c")
        let plain = try row(#"{"id":"a","cold":"yes","coldAt":"soon","continues":4}"#)
        XCTAssertFalse(plain.cold)
        XCTAssertNil(plain.coldAt)
        XCTAssertNil(plain.continues)
        XCTAssertNil(plain.continuedIn)
    }

    func testTheLinesNameWhatTheRowCarries() {
        XCTAssertEqual(HandoffRules.lines(for: nil), [])
        XCTAssertEqual(HandoffRules.lines(for: SessionRow(id: "a")), [])
        XCTAssertEqual(HandoffRules.lines(for: SessionRow(id: "a", cold: true)).map(\.text), ["Handoff saved, your next message starts a fresh session from it."])
        let at = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(HandoffRules.lines(for: SessionRow(id: "a", cold: true, coldAt: at), now: at).map(\.text), ["Handoff saved at \(ChatTime.sentAt(at, now: at)), your next message starts a fresh session from it."])
        let from = HandoffRules.lines(for: SessionRow(id: "a", continues: "b"))
        XCTAssertEqual(from.first?.opens, "b")
        XCTAssertEqual(from.first?.label, "Open the earlier session")
        let to = HandoffRules.lines(for: SessionRow(id: "a", continuedIn: "c"))
        XCTAssertEqual(to.first?.opens, "c")
        XCTAssertEqual(to.first?.label, "Open it")
    }

    func testAColdRowSaysSoInItsTooltip() {
        let tip = SidebarOutline.tooltip(SessionRow(id: "a", cwd: "/h/Projects/web", state: .idle, cold: true), home: "/h")
        XCTAssertTrue(tip.contains("Handoff saved"))
        XCTAssertFalse(SidebarOutline.tooltip(SessionRow(id: "a", cwd: "/h/Projects/web"), home: "/h").contains("Handoff saved"))
    }
}
