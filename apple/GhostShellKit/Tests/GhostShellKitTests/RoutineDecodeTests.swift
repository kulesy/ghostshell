import XCTest
@testable import GhostShellKit

final class RoutineDecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }

    func testARoutineListDecodesEveryField() throws {
        let list = try decode(RoutineList.self, """
        {"routines":[{"id":"morning","title":"Morning","heading":"Reports","cron":"30 7 * * 1-5","jitterSeconds":737,"file":"/state/routines/morning.md","cwd":"/work",
          "model":"claude-opus-5-5","effort":null,"mode":"plan","account":"second","enabled":true,"armedAt":"2026-10-23T07:00:00+11:00","lastRunAt":"2026-10-24T07:42:00+11:00",
          "lastSessionId":"s1","lastError":null,"skipped":{"fireAt":"2026-10-22T07:42:17+11:00","at":"2026-10-22T07:43:00+11:00","reason":"busy"},
          "retry":{"fireAt":"2026-10-25T11:45:00+11:00","tries":2,"nextAt":"2026-10-25T12:05:00+11:00"},"running":true,"next":"2026-10-26T07:42:17+11:00","problem":"bad cron"}],
         "problem":"routines.json cannot be read"}
        """)
        let r = try XCTUnwrap(list.routines.first)
        XCTAssertEqual([r.id, r.title, r.heading, r.cron, r.cwd, r.model, r.mode, r.account], ["morning", "Morning", "Reports", "30 7 * * 1-5", "/work", "claude-opus-5-5", "plan", "second"])
        XCTAssertEqual(r.jitterSeconds, 737)
        XCTAssertNil(r.effort)
        XCTAssertTrue(r.enabled && r.running)
        XCTAssertEqual(r.next?.iso, "2026-10-26T07:42:17+11:00")
        XCTAssertEqual(r.next?.offsetMinutes, 660)
        XCTAssertEqual(r.skipped?.reason, "busy")
        XCTAssertEqual(r.retry?.tries, 2)
        XCTAssertEqual(r.problem, "bad cron")
        XCTAssertEqual(list.problem, "routines.json cannot be read")
    }

    func testARoutineWithOddFieldsStillDecodesAndOneBadEntryDoesNotLoseTheList() throws {
        let list = try decode(RoutineList.self, """
        {"routines":[{"id":"a","jitterSeconds":"x","next":"soon","enabled":"yes"},{"nope":1},{"id":"b","title":"B"}]}
        """)
        XCTAssertEqual(list.routines.map(\.id), ["a", "b"])
        XCTAssertEqual(list.routines[0].title, "a")
        XCTAssertEqual(list.routines[0].jitterSeconds, 0)
        XCTAssertNil(list.routines[0].next)
        XCTAssertFalse(list.routines[0].enabled)
        XCTAssertEqual(try decode(RoutineList.self, "{}").routines, [])
    }

    func testAPromptDecodes() throws {
        let p = try decode(RoutinePrompt.self, "{\"file\":\"/a.md\",\"text\":\"Hi\",\"ours\":false}")
        XCTAssertEqual([p.file, p.text], ["/a.md", "Hi"])
        XCTAssertEqual(p.ours, false)
        XCTAssertEqual(p.kind, .file)
        XCTAssertEqual(try decode(RoutinePrompt.self, "{\"file\":\"/a.md\",\"text\":\"\",\"error\":\"Cannot read /a.md.\"}").error, "Cannot read /a.md.")
    }

    func testASchedulePreviewDecodes() throws {
        let ok = try decode(SchedulePreview.self, "{\"next\":[\"2026-10-26T07:42:17+11:00\",\"2026-10-27T07:44:00+11:00\"],\"problem\":null}")
        XCTAssertEqual(ok.next.count, 2)
        XCTAssertNil(ok.problem)
        let bad = try decode(SchedulePreview.self, "{\"next\":[],\"problem\":\"Use five fields.\"}")
        XCTAssertEqual(bad.problem, "Use five fields.")
    }

    func testAScheduledListDecodes() throws {
        let list = try decode(ScheduledList.self, """
        {"scheduled":[{"id":"one","title":"One","at":"2026-10-31T09:00:00+10:00","cwd":"/work","prompt":"Do it.","model":null,"group":"cg-work","groupName":"Work","status":"pending","running":false},
        {"id":"two","status":"weird"}],"problem":null}
        """)
        XCTAssertEqual(list.scheduled.map(\.id), ["one", "two"])
        XCTAssertTrue(list.scheduled[0].isPending)
        XCTAssertEqual(list.scheduled[0].groupName, "Work")
        XCTAssertEqual(list.scheduled[1].status, "weird")
        XCTAssertFalse(list.scheduled[1].isPending)
    }

    func testRepliesDecode() throws {
        XCTAssertEqual(try decode(RoutineStarted.self, "{\"sessionId\":\"s9\",\"routine\":{\"id\":\"a\"}}").routine?.id, "a")
        XCTAssertEqual(try decode(ScheduledStarted.self, "{\"sessionId\":\"s9\"}").sessionId, "s9")
        XCTAssertEqual(try decode(FolderList.self, "{\"folders\":[\"/home\",\"/work\"]}").folders, ["/home", "/work"])
        let d = try decode(FolderDefaults.self, "{\"model\":\"claude-opus-5-5\",\"shownModel\":\"Opus\",\"effort\":null,\"mode\":\"plan\"}")
        XCTAssertEqual([d.model, d.shownModel, d.mode], ["claude-opus-5-5", "Opus", "plan"])
        XCTAssertEqual(try decode(FeatureReply.self, "{\"features\":{\"routineEdits\":true,\"scheduled\":true}}").features.routineEdits, true)
        XCTAssertFalse(try decode(FeatureReply.self, "{}").features.routineFiles)
    }

    func testARefusalBodyDecodes() throws {
        let body = Data("{\"error\":\"Nothing was saved.\",\"problems\":{\"cwd\":\"No such folder.\",\"cron\":\"Use five fields.\"}}".utf8)
        let refusal = try XCTUnwrap(ServerRefusal(status: 400, body: body))
        XCTAssertEqual(refusal.status, 400)
        XCTAssertEqual(refusal.message, "Nothing was saved.")
        XCTAssertEqual(refusal.problems, ["cwd": "No such folder.", "cron": "Use five fields."])
        XCTAssertEqual(refusal.errorDescription, "Nothing was saved.")
        let plain = try XCTUnwrap(ServerRefusal(status: 409, body: Data("{\"error\":\"Still running.\"}".utf8)))
        XCTAssertEqual(plain.problems, [:])
        XCTAssertNil(ServerRefusal(status: 500, body: Data("<html>".utf8)))
        XCTAssertNil(ServerRefusal(status: 400, body: Data("{\"error\":\"\"}".utf8)))
    }

    func testLocalTimeKeepsTheOriginalStringAndOffset() throws {
        let t = try XCTUnwrap(LocalTime("2026-10-16T07:42:17+11:00"))
        XCTAssertEqual(t.iso, "2026-10-16T07:42:17+11:00")
        XCTAssertEqual([t.hour, t.minute, t.offsetMinutes], [7, 42, 660])
        XCTAssertEqual(LocalTime("2026-10-16T07:42:17Z")?.offsetMinutes, 0)
        XCTAssertEqual(LocalTime("2026-10-16T07:42:17-05:30")?.offsetMinutes, -330)
        XCTAssertNil(LocalTime("2026-10-16T07:42")?.offsetMinutes)
        XCTAssertEqual(LocalTime("2026-10-16T00:00:00Z")!.date.timeIntervalSince(LocalTime("2026-10-16T11:00:00+11:00")!.date), 0)
    }
}
