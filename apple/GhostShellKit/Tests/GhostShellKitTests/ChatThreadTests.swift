import XCTest
@testable import GhostShellKit

final class ChatThreadTests: XCTestCase {
    private func tool(_ id: String, _ name: String = "Read", status: ToolStatus = .pending, input: JSONValue = .object([:])) -> ChatItem {
        ChatItem(body: .tool(ToolCall(id: id, name: name, summary: "", input: input, status: status, output: nil, images: [])))
    }
    private func result(_ id: String, _ status: ToolStatus = .ok, _ output: String = "done") -> ChatItem {
        ChatItem(body: .result(ToolResult(toolID: id, status: status, output: output, images: [])))
    }
    private func said(_ id: String, _ text: String) -> ChatItem { ChatItem(body: .assistant(msgID: id, text: text)) }
    private func thought(_ text: String = "hm") -> ChatItem { ChatItem(body: .thinking(msgID: "t", text: text)) }
    private func path(_ p: String) -> JSONValue { .object(["file_path": .string(p)]) }

    private func call(_ item: ChatItem) -> ToolCall {
        guard case .tool(let c) = item.body else { fatalError("not a tool") }
        return c
    }

    func testResultSettlesItsToolAndIsNotAnItem() {
        var t = ChatThread()
        t.absorb([tool("a"), result("a", .failed, "boom")])
        XCTAssertEqual(t.items.count, 1)
        XCTAssertEqual(call(t.items[0]).status, .failed)
        XCTAssertEqual(call(t.items[0]).output, "boom")
    }

    func testResultInALaterBatchSettlesTheEarlierTool() {
        var t = ChatThread()
        t.absorb([tool("a")])
        t.absorb([result("a")])
        XCTAssertEqual(call(t.items[0]).status, .ok)
    }

    func testBlocksOfOneMessageJoinAndAnotherMessageDoesNot() {
        var t = ChatThread()
        t.absorb([said("m1", "one"), said("m1", "two"), said("m2", "three")])
        XCTAssertEqual(t.items.count, 2)
        guard case .assistant(_, let text) = t.items[0].body else { return XCTFail() }
        XCTAssertEqual(text, "one\n\ntwo")
    }

    func testKeysAreStableWhenAnItemGrows() {
        var t = ChatThread()
        t.absorb([said("m1", "one")])
        let key = t.items[0].key
        t.absorb([said("m1", "two")])
        XCTAssertEqual(t.items[0].key, key)
        XCTAssertEqual(Set(t.items.map(\.key)).count, t.items.count)
    }

    func testPrependPutsOlderFirstAndSettlesAnOrphanedResult() {
        var t = ChatThread()
        t.absorb([result("a", .ok, "late"), said("m2", "newer")])
        XCTAssertEqual(t.items.count, 1)
        t.prepend([tool("a"), said("m1", "older")])
        XCTAssertEqual(t.items.count, 3)
        XCTAssertEqual(call(t.items[0]).output, "late")
        XCTAssertEqual(Set(t.items.map(\.key)).count, 3)
    }

    func testPrependJoinsAMessageCutByTheChunkBoundary() {
        var t = ChatThread()
        t.absorb([said("m1", "second half")])
        t.prepend([said("m1", "first half")])
        XCTAssertEqual(t.items.count, 1)
        guard case .assistant(_, let text) = t.items[0].body else { return XCTFail() }
        XCTAssertEqual(text, "first half\n\nsecond half")
    }

    // MARK: Folding

    private func keyed(_ items: [ChatItem]) -> [ChatItem] {
        var t = ChatThread()
        t.absorb(items)
        return t.items
    }

    func testARunWithAToolFoldsAndThinkingAloneStaysARow() {
        let rows = ChatFold.display(keyed([said("m", "hi"), thought(), tool("a"), thought(), said("n", "bye"), thought()]))
        XCTAssertEqual(rows.count, 4)
        guard case .group(let g) = rows[1] else { return XCTFail("expected a group") }
        XCTAssertEqual(g.rows.count, 3)
        guard case .item = rows[3] else { return XCTFail("a lone thought stays a row") }
    }

    func testQuestionsChipsChaptersAndWidgetsEndARun() {
        let widget = tool("w", "mcp__capcom__show_widget", input: .object(["widget_code": .string("<b>")]))
        let bare = tool("v", "mcp__capcom__show_widget")
        let rows = ChatFold.display(keyed([tool("a"), tool("q", "AskUserQuestion"), tool("b", "mcp__capcom__spawn_task"), tool("c", "mcp__capcom__mark_chapter"), widget, bare]))
        XCTAssertEqual(rows.map { if case .group = $0 { "g" } else { "i" } }, ["g", "i", "i", "i", "i", "g"])
    }

    func testTitleCountsDistinctFilesAndCommands() {
        let rows = keyed([thought(), tool("a", input: path("/x/a")), tool("b", input: path("/x/a")), tool("c", input: path("/x/b")), tool("d", "Bash"), tool("e", "Bash")])
        let s = ChatFold.summarize(rows)
        XCTAssertEqual(s.title, "Thought, read 2 files, ran 2 commands")
    }

    func testTitleForOtherKinds() {
        XCTAssertEqual(ChatFold.summarize(keyed([tool("a", "Grep")])).title, "Searched 1 time")
        XCTAssertEqual(ChatFold.summarize(keyed([tool("a", "TodoWrite")])).title, "Updated the to-do list")
        XCTAssertEqual(ChatFold.summarize(keyed([tool("a", "mcp__claude-in-chrome__navigate"), tool("b", "mcp__x__y")])).title, "Used Chrome 1 time, used 1 tool")
        XCTAssertEqual(ChatFold.summarize(keyed([tool("a", "Task"), tool("b", "Task")])).title, "Started 2 agents")
    }

    func testNoteAndStatus() {
        let running = ChatFold.summarize(keyed([tool("a", status: .pending), tool("b", status: .failed)]))
        XCTAssertEqual(running.note, "running")
        XCTAssertEqual(running.status, .pending)
        let bad = ChatFold.summarize(keyed([tool("a", status: .failed), tool("b", status: .denied), tool("c", status: .failed), tool("d", status: .ok)]))
        XCTAssertEqual(bad.note, "2 failed, 1 denied")
        XCTAssertEqual(bad.status, .failed)
        XCTAssertEqual(ChatFold.summarize(keyed([tool("a", status: .ok)])).note, "")
    }

    func testLineCountsForEdits() {
        let edit = tool("a", "Edit", status: .ok, input: .object(["file_path": .string("/x"), "old_string": .string("a\nb\nc"), "new_string": .string("a\nB\nc\nd")]))
        let write = tool("b", "Write", status: .ok, input: .object(["file_path": .string("/y"), "content": .string("1\n2\n3\n")]))
        let failed = tool("c", "Edit", status: .failed, input: .object(["file_path": .string("/z"), "old_string": .string("a"), "new_string": .string("b\nc")]))
        let s = ChatFold.summarize(keyed([edit, write, failed]))
        XCTAssertTrue(s.edited)
        XCTAssertEqual(s.added, 3 + 3)
        XCTAssertEqual(s.removed, 2)
        XCTAssertEqual(s.title, "Edited 3 files")
    }

    func testLineDeltaTrimsTheUnchangedHeadAndTail() {
        XCTAssertEqual(ChatFold.lineDelta("a\nb\nc", "a\nx\nc").0, 1)
        XCTAssertEqual(ChatFold.lineDelta("a\nb\nc", "a\nx\nc").1, 1)
        XCTAssertEqual(ChatFold.lineDelta(nil, "a\nb").0, 2)
        XCTAssertEqual(ChatFold.lineDelta("same", "same").0, 0)
    }

    func testOldBashPairReadsAsOne() {
        let first = ChatItem(body: .bash(BashRun(command: "ls", stdout: "a", stderr: "")))
        let second = ChatItem(body: .bash(BashRun(command: "", stdout: "b", stderr: "e")))
        let rows = ChatFold.display(keyed([first, second]))
        XCTAssertEqual(rows.count, 1)
        guard case .item(let item) = rows[0], case .bash(let run) = item.body else { return XCTFail() }
        XCTAssertEqual([run.command, run.stdout, run.stderr], ["ls", "ab", "e"])
    }

    // MARK: Words

    func testStepNamesTheCallStillWaiting() {
        let work = [ChatWork.Tool(name: "Read", summary: "a.swift")]
        XCTAssertEqual(ChatFold.activity(ChatWork(tools: work)).doing, "Reading")
        XCTAssertEqual(ChatFold.doingNow(ChatWork(tools: work)), "Reading a file")
        XCTAssertEqual(ChatFold.doingNow(ChatWork(thinking: true)), "Thinking")
        XCTAssertEqual(ChatFold.doingNow(nil), "Working")
        XCTAssertEqual(ChatFold.doingNow(ChatWork(tools: [work[0], work[0]])), "Running 2 tools")
        let rows = keyed([tool("a", "Bash", status: .pending), tool("b", "Read", status: .ok)])
        XCTAssertEqual(ChatFold.step(rows), "Running a command")
        XCTAssertEqual(ChatFold.step([]), "")
    }

    func testGroupStartIsTheFirstTimedRow() {
        var a = thought(), b = thought()
        b.at = Date(timeIntervalSince1970: 50)
        a.at = nil
        XCTAssertEqual(ChatFold.start(of: [a, b]), Date(timeIntervalSince1970: 50))
    }
}
