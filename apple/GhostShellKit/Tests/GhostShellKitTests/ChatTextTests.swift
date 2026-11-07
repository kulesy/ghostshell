import XCTest
@testable import GhostShellKit

final class ChatTextTests: XCTestCase {
    func testDurationAndTokens() {
        XCTAssertEqual(ChatText.duration(ms: 12_400), "12s")
        XCTAssertEqual(ChatText.duration(ms: 185_000), "3m 05s")
        XCTAssertEqual(ChatText.duration(ms: 3_720_000), "1h 02m")
        XCTAssertEqual(ChatText.tokenCount(950), "950")
        XCTAssertEqual(ChatText.tokenCount(1200), "1.2k")
        XCTAssertEqual(ChatText.tokenCount(14_300), "14k")
    }

    func testModelLabel() {
        XCTAssertEqual(ChatText.modelLabel("claude-opus-4-5"), "Opus 4.5")
        XCTAssertEqual(ChatText.modelLabel("claude-haiku-5"), "Haiku 5")
        XCTAssertEqual(ChatText.modelLabel("sonnet[1m]"), "Sonnet (1M)")
        XCTAssertEqual(ChatText.modelLabel("mystery"), "mystery")
    }

    func testToolNames() {
        XCTAssertEqual(ChatText.fullToolLabel("mcp__claude-in-chrome__navigate"), "Chrome navigate")
        XCTAssertEqual(ChatText.fullToolLabel("mcp__capcom__show_widget"), "show widget")
        XCTAssertEqual(ChatText.fullToolLabel("mcp__claude_ai_Google_Drive__search_files"), "Google Drive search files")
        let id = "0123abcd-0123-4abc-8abc-0123456789ab"
        XCTAssertEqual(ChatText.serverLabel("mcp__\(id)__x", connectors: [id: "Notion"]), "Notion")
        XCTAssertEqual(ChatText.serverLabel("mcp__\(id)__x"), "connector")
        XCTAssertEqual(ChatText.serverLabel("Read"), "")
    }

    func testPreviewIsOneCleanLine() {
        XCTAssertEqual(ChatText.preview("## Plan\n**bold** and `code`\n\n more"), "Plan bold and code more")
        XCTAssertEqual(ChatText.preview(String(repeating: "a", count: 300)).count, 160)
    }

    func testQuotes() {
        let (quotes, rest) = ChatText.splitQuotes("From the session \"Build\":\n> one\n> two\n\nanswer")
        XCTAssertEqual(quotes, [ChatText.Quote(from: "Build", text: "one\ntwo")])
        XCTAssertEqual(rest, "answer")
        XCTAssertEqual(ChatText.splitQuotes("no quote").quotes.count, 0)
        XCTAssertNil(ChatText.splitQuotes("> bare").quotes.first?.from)
    }

    // MARK: Time

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Australia/Brisbane")!
        return c
    }
    private func date(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
    private let en = Locale(identifier: "en_AU")

    func testTimeWording() {
        let now = date("2026-11-08T15:00:00+10:00")
        func text(_ s: String) -> String { ChatTime.sentAt(date(s), now: now, calendar: calendar, locale: en) }
        XCTAssertTrue(text("2026-11-08T09:05:00+10:00").hasSuffix("9:05 am") || text("2026-11-08T09:05:00+10:00").lowercased().contains("9:05"))
        XCTAssertFalse(text("2026-11-08T09:05:00+10:00").contains(","))
        XCTAssertTrue(text("2026-11-07T23:30:00+10:00").hasPrefix("Yesterday, "))
        XCTAssertTrue(text("2026-11-04T10:00:00+10:00").contains(","))
        XCTAssertTrue(text("2026-11-04T10:00:00+10:00").hasPrefix("Wed"))
        XCTAssertTrue(text("2026-10-20T10:00:00+10:00").hasPrefix("20 Oct, "))
        XCTAssertTrue(text("2025-10-20T10:00:00+10:00").contains("2025"))
    }

    func testMidnightTimer() {
        let now = date("2026-11-08T23:59:00+10:00")
        XCTAssertEqual(ChatTime.untilMidnight(from: now, calendar: calendar), 60, accuracy: 0.5)
    }
}
