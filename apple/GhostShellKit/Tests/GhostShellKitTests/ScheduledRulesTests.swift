import XCTest
@testable import GhostShellKit

// Ported from test/scheduled-rules.test.mjs.
final class ScheduledRulesTests: XCTestCase {
    private let now = LocalTime("2026-10-30T10:00:00+10:00")!.date

    private func entry(_ id: String = "one", status: String = "pending", at: String = "2026-10-31T09:00:00+10:00", group: String? = nil, lastError: String? = nil,
                       problem: String? = nil, retry: RoutineRetry? = nil, sessionId: String? = nil) -> ScheduledSummary {
        ScheduledSummary(id: id, title: "One", at: LocalTime(at), cwd: "/work", prompt: "Do it.", group: group, status: status, sessionId: sessionId, lastError: lastError, retry: retry, problem: problem)
    }

    func testHowLongUntilATimeIsAFewWords() {
        func until(_ iso: String) -> String { untilWords(LocalTime(iso), now: now) }
        XCTAssertEqual(until("2026-10-30T10:00:30+10:00"), "in under a minute")
        XCTAssertEqual(until("2026-10-30T10:12:00+10:00"), "in 12 min")
        XCTAssertEqual(until("2026-10-30T15:00:00+10:00"), "in 5 h")
        XCTAssertEqual(until("2026-10-31T10:00:00+10:00"), "in 1 day")
        XCTAssertEqual(until("2026-11-02T10:00:00+10:00"), "in 3 days")
        XCTAssertEqual(until("2026-10-30T09:59:59+10:00"), "due now")
        XCTAssertEqual(untilWords(nil, now: now), "")
    }

    func testARowInHomeSaysWhenItStartsOrWhyItDidNot() {
        XCTAssertEqual(noteOf(entry(), now: now), ScheduledNote(text: "Starts Tomorrow, 09:00", tone: nil))
        XCTAssertEqual(noteOf(entry(status: "skipped", lastError: "It was 14 h late."), now: now), ScheduledNote(text: "Skipped: It was 14 h late.", tone: .problem))
        XCTAssertEqual(noteOf(entry(status: "skipped"), now: now), ScheduledNote(text: "Skipped", tone: .problem))
        XCTAssertEqual(noteOf(entry(problem: "That folder is gone."), now: now), ScheduledNote(text: "That folder is gone.", tone: .problem))
        let retry = RoutineRetry(fireAt: LocalTime("2026-10-30T09:00:00+10:00"), tries: 1, nextAt: LocalTime("2026-10-30T10:10:00+10:00"))
        XCTAssertEqual(noteOf(entry(retry: retry), now: now), ScheduledNote(text: "Retrying, next try at 10:10", tone: .warning))
    }

    func testThePageSaysTheStatusOfAnEntry() {
        XCTAssertEqual(statusWords(entry(), now: now), "Starts in 23 h")
        XCTAssertEqual(["started", "skipped", "cancelled"].map { statusWords(entry(status: $0), now: now) }, ["Started", "Skipped", "Cancelled"])
    }

    func testHomeShowsPendingAndSkippedOnly() {
        let list = ["pending", "started", "skipped", "cancelled"].map { entry($0, status: $0) }
        XCTAssertEqual(inSidebar(list).map(\.id), ["pending", "skipped"])
    }

    func testThePageListsPendingSoonestFirstThenTheRestLatestFirst() {
        let list = [entry("later", at: "2026-11-02T09:00:00+10:00"), entry("old", status: "started", at: "2026-10-01T09:00:00+10:00"),
                    entry("sooner", at: "2026-10-31T09:00:00+10:00"), entry("newer", status: "skipped", at: "2026-10-20T09:00:00+10:00")]
        XCTAssertEqual(ordered(list).map(\.id), ["sooner", "later", "newer", "old"])
    }

    func testOnlyAPendingEntryCanBeStartedChangedOrCalledOff() {
        XCTAssertTrue(takes(entry()) == (true, true, true))
        for status in ["started", "skipped", "cancelled"] { XCTAssertTrue(takes(entry(status: status)) == (false, false, false), status) }
        XCTAssertEqual(deleteDetail(entry()), "It will not start.")
        XCTAssertEqual(deleteDetail(entry(status: "started", sessionId: "s1")), "The session it started stays in the list.")
    }

    func testTheGroupsOfferedStartWithNoneAndKeepAGroupThatHasGone() throws {
        let groups = try JSONDecoder().decode([SessionGroup].self, from: Data("[{\"id\":\"cg-work\",\"name\":\"Work\"}]".utf8))
        XCTAssertEqual(groupChoices(groups, current: ""), [Choice("", "No group"), Choice("cg-work", "Work")])
        XCTAssertEqual(groupChoices([], current: "cg-old").last, Choice("cg-old", "A group that has been deleted"))
    }

    // MARK: Form

    private func local(_ hour: Int, _ minute: Int = 0, day: Int = 31) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        return c.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    func testANewFormStartsTomorrowAtNineAndSendsEveryField() throws {
        let clock = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 30, hour: 10))!
        var draft = ScheduledDraft(home: "/Users/me", now: clock)
        XCTAssertEqual(draft.at, local(9))
        XCTAssertEqual(draft.cwd, "/Users/me")
        XCTAssertEqual(draft.group, "")
        draft.title = " Look "
        draft.prompt = "Go."
        let body = try json(draft.request())
        XCTAssertEqual(Set(body.keys), ["title", "at", "cwd", "model", "effort", "mode", "group", "prompt"])
        XCTAssertEqual(body["title"] as? String, "Look")
        XCTAssertEqual(body["at"] as? String, localIso(local(9)))
        XCTAssertTrue(body["at"] is String && (body["at"] as! String).hasPrefix("2026-10-31T09:00:00"))
        XCTAssertTrue(body["model"] is NSNull && body["effort"] is NSNull && body["mode"] is NSNull && body["group"] is NSNull)
    }

    func testTheTimeCarriesTheDevicesOffset() {
        let sydney = TimeZone(identifier: "Australia/Sydney")!
        XCTAssertEqual(localIso(LocalTime("2026-11-09T09:00:00+11:00")!.date, in: sydney), "2026-11-09T09:00:00+11:00")
        XCTAssertEqual(localIso(LocalTime("2026-07-09T09:00:00+10:00")!.date, in: sydney), "2026-07-09T09:00:00+10:00")
        XCTAssertEqual(localIso(LocalTime("2026-11-09T09:00:00+05:30")!.date, in: TimeZone(secondsFromGMT: 19_800)!), "2026-11-09T09:00:00+05:30")
        XCTAssertEqual(localIso(LocalTime("2026-11-09T09:00:00-03:30")!.date, in: TimeZone(secondsFromGMT: -12_600)!), "2026-11-09T09:00:00-03:30")
    }

    func testAnEditSendsOnlyWhatChangedSoAPassedTimeIsNotCheckedAgain() throws {
        let was = entry(at: "2026-10-01T09:00:00+10:00", group: "cg-work")
        let draft = ScheduledDraft(was, now: now)
        XCTAssertTrue(draft.request(against: was).isEmpty)
        var renamed = draft
        renamed.title = "Two"
        renamed.group = ""
        let body = try json(renamed.request(against: was))
        XCTAssertEqual(Set(body.keys), ["title", "group"])
        XCTAssertEqual(body["title"] as? String, "Two")
        XCTAssertTrue(body["group"] is NSNull)
        var moved = draft
        moved.at = LocalTime("2026-11-05T08:30:00+10:00")!.date
        XCTAssertEqual(try json(moved.request(against: was)).keys.sorted(), ["at"])
    }

    func testTheTimeIsComparedToTheMinuteSoSecondsAreNeverResent() {
        let was = entry(at: "2026-10-31T09:00:42+10:00")
        var draft = ScheduledDraft(was, now: now)
        XCTAssertTrue(draft.request(against: was).isEmpty)
        draft.at = LocalTime("2026-10-31T09:01:00+10:00")!.date
        XCTAssertFalse(draft.request(against: was).isEmpty)
    }

    func testAnEditsPromptIsComparedTrimmed() {
        let was = entry()
        var draft = ScheduledDraft(was, now: now)
        draft.prompt = "  Do it.\n"
        XCTAssertTrue(draft.request(against: was).isEmpty)
        draft.prompt = "Do it twice."
        XCTAssertEqual(draft.request(against: was).prompt, .value("Do it twice."))
    }

    func testRefusedFieldsComeBackInTheFormsOrder() {
        let refusal = ServerRefusal(status: 400, message: "Nothing was saved.", problems: ["prompt": "Write a prompt.", "cwd": "No such folder.", "bogus": "x"])
        let found = refusal.fields(in: ServerRefusal.scheduledFields)
        XCTAssertEqual(found.map(\.field), ["cwd", "prompt"])
        XCTAssertEqual(found.first?.sentence, "No such folder.")
    }
}

/// A request body as the server would read it.
func json(_ request: some Encodable) throws -> [String: Any] {
    let data = try JSONEncoder().encode(request)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}
