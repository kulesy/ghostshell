import XCTest
@testable import GhostShellKit

// Ported from the requestOf cases in test/routine-rules.test.mjs. A request is compared as the JSON the server would read, because the difference
// between a missing key, null and a value is the whole point.
final class RoutineDraftTests: XCTestCase {
    private let routine = RoutineSummary(id: "morning", title: "Morning", cron: "30 7 * * 1-5", jitterSeconds: 737, file: "/state/routines/morning.md", cwd: "/work",
                                         model: "claude-opus-5-5", effort: nil, mode: "plan", enabled: false)
    private let own = RoutinePrompt(file: "/state/routines/morning.md", text: "Do it.", ours: true)
    private let elsewhere = RoutinePrompt(file: "/Users/you/prompts/daily-scrum.md", text: "Run the scrum.", ours: false)

    private func baseline(_ r: RoutineSummary? = nil, _ p: RoutinePrompt? = nil) -> RoutineBaseline { RoutineBaseline(r ?? routine, prompt: p ?? own) }
    private func draft(_ r: RoutineSummary? = nil, _ p: RoutinePrompt? = nil) -> RoutineDraft { RoutineDraft(r ?? routine, prompt: p ?? own) }
    private func sent(_ d: RoutineDraft, _ b: RoutineBaseline?) throws -> NSDictionary { try json(d.request(against: b)) as NSDictionary }
    private func edit(_ d: RoutineDraft, _ b: RoutineBaseline? = nil) throws -> NSDictionary { try sent(d, b ?? baseline()) }

    func testANewFormStartsInHomeSwitchedOnWithDefaultsAndNoJitter() {
        let d = RoutineDraft(home: "/Users/me")
        XCTAssertEqual([d.title, d.heading, d.cron, d.jitterSeconds, d.cwd, d.model, d.effort, d.mode, d.account, d.file, d.prompt],
                       ["", "", "", "0", "/Users/me", "", "", "", "", "", ""])
        XCTAssertEqual(d.promptKind, .text)
        XCTAssertTrue(d.enabled)
    }

    func testAnEditFormIsFilledFromTheRoutineWithNullAsDefault() {
        let d = draft()
        XCTAssertEqual([d.title, d.heading, d.cron, d.jitterSeconds, d.cwd, d.model, d.effort, d.mode, d.account, d.file, d.prompt],
                       ["Morning", "", "30 7 * * 1-5", "737", "/work", "claude-opus-5-5", "", "plan", "", "", "Do it."])
        XCTAssertEqual(d.promptKind, .text)
        XCTAssertFalse(d.enabled)
    }

    func testARoutineOnAFileElsewhereOpensOnItsPathWithTheTextReady() {
        let d = draft(nil, elsewhere)
        XCTAssertEqual(d.promptKind, .file)
        XCTAssertEqual(d.file, "/Users/you/prompts/daily-scrum.md")
        XCTAssertEqual(d.prompt, "Run the scrum.")
        let b = baseline(nil, elsewhere)
        XCTAssertEqual(b.kind, .file)
        XCTAssertEqual(b.file, "/Users/you/prompts/daily-scrum.md")
        XCTAssertEqual(baseline().kind, .text)
    }

    func testAPromptFromAServerThatCopiesOnSaveStaysText() {
        let old = RoutinePrompt(file: "/somewhere/SKILL.md", text: "Old.", ours: false, copyTo: "/state/routines/morning.md")
        XCTAssertEqual(draft(nil, old).promptKind, .text)
        XCTAssertEqual(baseline(nil, old).kind, .text)
    }

    func testANewRoutineSendsEveryFieldWithDefaultAsNull() throws {
        var d = RoutineDraft(home: "/work")
        d.title = "  Morning  "
        d.cron = "30  7 * * 1-5"
        d.prompt = "Do it.\n"
        XCTAssertEqual(try sent(d, nil), ["title": "Morning", "cron": "30 7 * * 1-5", "jitterSeconds": 0, "cwd": "/work", "model": NSNull(), "effort": NSNull(), "mode": NSNull(),
                                          "enabled": true, "prompt": "Do it.\n"] as NSDictionary)
    }

    func testJitterGoesAsAJSONInteger() throws {
        var d = RoutineDraft(home: "/work")
        d.jitterSeconds = " 737 "
        let data = try JSONEncoder().encode(d.request())
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("\"jitterSeconds\":737"))
    }

    func testANewRoutineOnAFileSendsThePathAndNoText() throws {
        var d = RoutineDraft(home: "/work")
        (d.title, d.cron, d.promptKind, d.file, d.prompt) = ("Morning", "30 7 * * 1-5", .file, "  /Users/you/prompts/daily-scrum.md ", "left over")
        let body = try sent(d, nil)
        XCTAssertEqual(body["file"] as? String, "/Users/you/prompts/daily-scrum.md")
        XCTAssertNil(body["prompt"])
    }

    func testAnEditSendsOnlyWhatChanged() throws {
        var d = draft()
        XCTAssertTrue(try d.request(against: baseline()).isEmpty)
        d.title = "Evening"
        XCTAssertEqual(try edit(d), ["title": "Evening"] as NSDictionary)
        d = draft(); d.title = " Morning "
        XCTAssertTrue(try d.request(against: baseline()).isEmpty)
        d = draft(); d.cron = "30   7 * * 1-5"
        XCTAssertTrue(try d.request(against: baseline()).isEmpty)
        d = draft(); (d.cron, d.jitterSeconds) = ("0 8 * * *", "0")
        XCTAssertEqual(try edit(d), ["cron": "0 8 * * *", "jitterSeconds": 0] as NSDictionary)
        d = draft(); (d.cwd, d.model, d.effort, d.mode) = ("/other", "", "high", "")
        XCTAssertEqual(try edit(d), ["cwd": "/other", "model": NSNull(), "effort": "high", "mode": NSNull()] as NSDictionary)
        d = draft(); d.enabled = true
        XCTAssertEqual(try edit(d), ["enabled": true] as NSDictionary)
        d = draft(); d.prompt = "Do it twice."
        XCTAssertEqual(try edit(d), ["prompt": "Do it twice."] as NSDictionary)
    }

    func testAnEditNeverResendsTheScheduleItDidNotChange() throws {
        var d = draft()
        d.title = "Evening"
        let body = try edit(d)
        XCTAssertNil(body["cron"])
        XCTAssertNil(body["jitterSeconds"])
    }

    func testTextToTextSendsThePromptOnlyWhenItChangedAndNeverAFile() throws {
        var d = draft(); d.file = "/Users/you/ignored.md"
        XCTAssertTrue(try d.request(against: baseline()).isEmpty)
        d.prompt = "Changed."
        XCTAssertEqual(try edit(d), ["prompt": "Changed."] as NSDictionary)
    }

    func testFileToFileSendsThePathOnlyWhenItChangedAndNeverTheText() throws {
        let b = baseline(nil, elsewhere)
        var d = draft(nil, elsewhere)
        XCTAssertTrue(try d.request(against: b).isEmpty)
        d.title = "Evening"
        XCTAssertEqual(try sent(d, b), ["title": "Evening"] as NSDictionary)
        d = draft(nil, elsewhere); d.prompt = "Typed while it was hidden."
        XCTAssertTrue(try d.request(against: b).isEmpty)
        d = draft(nil, elsewhere); d.file = " /Users/you/prompts/weekly.md "
        XCTAssertEqual(try sent(d, b), ["file": "/Users/you/prompts/weekly.md"] as NSDictionary)
    }

    func testFileToTextAlwaysSendsThePromptEvenWhenItIsTheFilesOwn() throws {
        let b = baseline(nil, elsewhere)
        var d = draft(nil, elsewhere); d.promptKind = .text
        XCTAssertEqual(try sent(d, b), ["prompt": "Run the scrum."] as NSDictionary)
        d.prompt = "Rewritten."
        XCTAssertEqual(try sent(d, b), ["prompt": "Rewritten."] as NSDictionary)
    }

    func testTextToFileAlwaysSendsTheFileEvenWhenThePathIsEmpty() throws {
        var d = draft(); (d.promptKind, d.file) = (.file, "/Users/you/prompts/daily-scrum.md")
        XCTAssertEqual(try edit(d), ["file": "/Users/you/prompts/daily-scrum.md"] as NSDictionary)
        d.file = ""
        XCTAssertEqual(try edit(d), ["file": ""] as NSDictionary)
    }

    func testNoEditSendsBothAPromptAndAFile() throws {
        for prompt in [own, elsewhere] {
            for kind in [PromptKind.text, .file] {
                var d = draft(nil, prompt)
                (d.promptKind, d.file, d.prompt) = (kind, "/Users/you/prompts/other.md", "Another.")
                let body = try sent(d, baseline(nil, prompt))
                XCTAssertFalse(body["prompt"] != nil && body["file"] != nil, "\(prompt.ours == true ? "text" : "file") to \(kind)")
            }
        }
    }

    func testAnAccountIsSentOnANewRoutineOnlyWhenPickedAndOnAnEditOnlyWhenChanged() throws {
        var add = RoutineDraft(home: "/work")
        (add.title, add.cron, add.prompt) = ("Morning", "30 7 * * 1-5", "Do it.")
        XCTAssertNil(try sent(add, nil)["account"])
        add.account = "second"
        XCTAssertEqual(try sent(add, nil)["account"] as? String, "second")
        var pinned = routine; pinned.account = "second"
        var d = draft(pinned)
        XCTAssertEqual(d.account, "second")
        XCTAssertTrue(try d.request(against: baseline(pinned)).isEmpty)
        d.account = ""
        XCTAssertEqual(try sent(d, baseline(pinned)), ["account": NSNull()] as NSDictionary)
    }

    func testAGroupIsSentOnANewRoutineOnlyWhenTypedAndOnAnEditOnlyWhenChanged() throws {
        var add = RoutineDraft(home: "/work")
        (add.title, add.cron, add.prompt) = ("Morning", "30 7 * * 1-5", "Do it.")
        XCTAssertNil(try sent(add, nil)["heading"])
        add.heading = "   "
        XCTAssertNil(try sent(add, nil)["heading"])
        add.heading = " Reports "
        XCTAssertEqual(try sent(add, nil)["heading"] as? String, "Reports")
        XCTAssertTrue(try draft().request(against: baseline()).isEmpty)
        var grouped = routine; grouped.heading = "Reports"
        var d = draft(grouped)
        XCTAssertEqual(d.heading, "Reports")
        XCTAssertTrue(try d.request(against: baseline(grouped)).isEmpty)
        d.heading = " Reports "
        XCTAssertTrue(try d.request(against: baseline(grouped)).isEmpty)
        d.heading = "Inbox"
        XCTAssertEqual(try sent(d, baseline(grouped)), ["heading": "Inbox"] as NSDictionary)
        d.heading = ""
        XCTAssertEqual(try sent(d, baseline(grouped)), ["heading": NSNull()] as NSDictionary)
        var typed = draft(); typed.heading = "Reports"
        XCTAssertEqual(try edit(typed), ["heading": "Reports"] as NSDictionary)
    }

    func testABadJitterIsRefusedBeforeAnythingIsSent() {
        var d = draft(); d.jitterSeconds = "1.5"
        XCTAssertThrowsError(try d.request(against: baseline())) { error in
            let refusal = error as? ServerRefusal
            XCTAssertEqual(refusal?.problems["jitterSeconds"], jitterProblem)
        }
    }

    func testRefusedFieldsComeBackInTheFormsOrderAndIgnoreWhatItHasNoFieldFor() {
        let refusal = ServerRefusal(status: 400, message: "Nothing was saved.", problems: ["prompt": "Write the prompt.", "cwd": "No such folder.", "other": "x", "title": ""])
        let found = refusal.fields(in: ServerRefusal.routineFields)
        XCTAssertEqual(found.map(\.field), ["cwd", "prompt"])
        let both = ServerRefusal(status: 400, message: "x", problems: ["cron": "Bad.", "heading": "Unknown group.", "file": "Cannot read /nope.md.", "prompt": "Write it."])
        XCTAssertEqual(both.fields(in: ServerRefusal.routineFields).map(\.field), ["heading", "cron", "file", "prompt"])
    }
}
