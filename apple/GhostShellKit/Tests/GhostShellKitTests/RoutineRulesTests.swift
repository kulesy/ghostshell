import XCTest
@testable import GhostShellKit

// Ported from test/routine-rules.test.mjs. The words must match the page's, so a case that reads differently here is a bug in the port.
final class RoutineRulesTests: XCTestCase {
    private func at(_ iso: String) -> Date { LocalTime(iso)!.date }
    private func time(_ iso: String) -> LocalTime { LocalTime(iso)! }
    private let now = LocalTime("2026-10-23T09:30:00+10:00")!.date
    private let sunday = LocalTime("2026-10-25T12:00:00+11:00")!.date

    func testPlainSchedulesAreSaidInWords() {
        let words: [String: String] = [
            "30 7 * * 1-5": "Weekdays at 07:30", "0 9 * * *": "Every day at 09:00", "0 8 * * 1": "Mondays at 08:00",
            "0 8 * * 1,3,5": "Mon, Wed and Fri at 08:00", "*/15 * * * *": "Every 15 minutes", "0 * * * *": "Every hour, on the hour",
            "0 9 1 * *": "The 1st of each month at 09:00", "* * * * *": "Every minute", "*/5 * * * 1-5": "Weekdays, every 5 minutes",
            "15 * * * *": "Every hour, at 15 minutes past", "0 9,17 * * *": "Every day at 09:00 and 17:00",
            "0 9-17 * * 1-5": "Weekdays, every hour from 09:00 to 17:00", "0 10 * * 0,6": "Weekends at 10:00", "0 10 * * 6,7": "Weekends at 10:00",
            "0 10 * * 0-6": "Every day at 10:00", "0 7 * * 7": "Sundays at 07:00", "5 6 1,15 * *": "The 1st and 15th of each month at 06:05",
            "0 8 2,3,22 * *": "The 2nd, 3rd and 22nd of each month at 08:00", "0 8 11,12,13 * *": "The 11th, 12th and 13th of each month at 08:00",
            "  30   7 *  * 1-5 ": "Weekdays at 07:30", "0 0 * * 2-4": "Tue, Wed and Thu at 00:00", "0 0-23 * * *": "Every hour from 00:00 to 23:00",
        ]
        for (cron, said) in words { XCTAssertEqual(scheduleWords(cron), said, cron) }
    }

    func testAScheduleThatIsNotAPlainShapeHasNoWords() {
        for cron in ["0 9 * 6 *", "0 9 1 * 1", "*/7 * * * *", "*/90 * * * *", "0 */2 * * *", "0-30 9 * * *", "0 9 * * 8", "0 24 * * *", "60 9 * * *",
                     "0 9 * *", "0 9 * * * *", "", "nonsense", "@daily", "0 9 32 * *", "0,5,10,15,20,25,30 9 * * *"] {
            XCTAssertNil(scheduleWords(cron), cron)
        }
    }

    func testJitterIsSaidInPlainUnitsAndAddedAfterTheSchedule() {
        XCTAssertEqual(jitterWords(737), "12 min 17 s")
        XCTAssertEqual(jitterWords(45), "45 s")
        XCTAssertEqual(jitterWords(60), "1 min")
        XCTAssertEqual(jitterWords(3600), "1 h")
        XCTAssertEqual(jitterWords(3725), "1 h 2 min 5 s")
        XCTAssertEqual(jitterWords(0), "")
        XCTAssertEqual(scheduleWords("30 7 * * 1-5", jitterSeconds: 737), "Weekdays at 07:30, plus 12 min 17 s")
        XCTAssertEqual(scheduleWords("*/15 * * * *", jitterSeconds: 30), "Every 15 minutes, plus 30 s")
        XCTAssertEqual(scheduleWords("30 7 * * 1-5", jitterSeconds: 0), "Weekdays at 07:30")
        XCTAssertNil(scheduleWords("nonsense", jitterSeconds: 737))
    }

    func testAFireTimeIsReadInTheClockTheServerWrote() {
        XCTAssertEqual(fireTime(time("2026-10-23T07:42:17+10:00"), now: now), "Today, 07:42")
        XCTAssertEqual(fireTime(time("2026-10-23T23:59:59+10:00"), now: now), "Today, 23:59")
        XCTAssertEqual(fireTime(time("2026-10-24T07:42:17+10:00"), now: now), "Tomorrow, 07:42")
        XCTAssertEqual(fireTime(time("2026-10-22T18:05:00+10:00"), now: now), "Yesterday, 18:05")
        XCTAssertEqual(fireTime(time("2026-10-30T07:42:17+10:00"), now: now), "Fri 30 Oct, 07:42")
        XCTAssertEqual(fireTime(time("2026-10-25T00:00:00+10:00"), now: now), "Sun 25 Oct, 00:00")
        XCTAssertEqual(fireTime(time("2027-01-04T09:00:00+11:00"), now: now), "Mon 4 Jan 2027, 09:00")
    }

    func testTodayIsTheMacsToday() {
        let late = at("2026-10-22T23:30:00Z")
        XCTAssertEqual(fireTime(time("2026-10-23T07:42:00+10:00"), now: late), "Today, 07:42")
        XCTAssertEqual(fireTime(time("2026-10-24T07:42:00+10:00"), now: late), "Tomorrow, 07:42")
        XCTAssertEqual(fireTime(time("2026-10-22T20:00:00-05:00"), now: at("2026-10-23T03:00:00Z")), "Today, 20:00")
        XCTAssertEqual(fireTime(time("2026-10-23T00:10:00Z"), now: at("2026-10-23T23:50:00Z")), "Today, 00:10")
    }

    func testATimeWithNoOffsetIsReadInTheDevicesDay() {
        let noon = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 23, hour: 12))!
        XCTAssertEqual(fireTime(time("2026-10-23T07:42:00"), now: noon), "Today, 07:42")
        XCTAssertEqual(fireTime(time("2026-10-24T07:42"), now: noon), "Tomorrow, 07:42")
        XCTAssertEqual(fireTime(nil, now: now), "")
        XCTAssertNil(LocalTime("tomorrow"))
        XCTAssertNil(LocalTime("2026-10-23"))
        XCTAssertNil(LocalTime(""))
    }

    func testTheListGoesByTitleIgnoringCaseAndCountingNumbers() {
        func r(_ id: String, _ title: String? = nil) -> RoutineSummary { RoutineSummary(id: id, title: title) }
        let list = [r("c", "weekly report"), r("b", "Check 10"), r("a", "check 2"), r("e", "Morning"), r("d", "Morning"), r("f", "Archive")]
        XCTAssertEqual(routinesByTitle(list).map(\.id), ["f", "a", "b", "d", "e", "c"])
        XCTAssertEqual(routinesByTitle([r("zed"), r("alpha", "Mid")]).map(\.id), ["alpha", "zed"])
        XCTAssertEqual(routinesByTitle([]), [])
    }

    func testDeleteSaysWhereThePromptFileStays() {
        XCTAssertEqual(deleteDetail(RoutineSummary(id: "a", file: "/state/routines/a.md")),
                       "It stops running. Its earlier runs stay in the list, and its prompt file stays at /state/routines/a.md.")
    }

    func testThePromptHintSaysWhoEditsAndWhatASwitchLeavesBehind() {
        XCTAssertEqual(promptHint(.text), "GhostShell keeps the text in its own folder, and you edit it here.")
        XCTAssertEqual(promptHint(.text, was: .text), promptHint(.text))
        XCTAssertEqual(promptHint(.text, was: .file), "GhostShell keeps the text in its own folder, and you edit it here. The file stays as it is.")
        XCTAssertEqual(promptHint(.file), "GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell.")
        XCTAssertEqual(promptHint(.file, was: .file), promptHint(.file))
        XCTAssertEqual(promptHint(.file, was: .text), "GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell. GhostShell's own copy stays in its folder.")
    }

    func testAJitterIsAWholeNumberOfSecondsFrom0To86399() {
        XCTAssertEqual(jitterOf("737"), 737)
        XCTAssertEqual(jitterOf(" 12 "), 12)
        XCTAssertEqual(jitterOf(""), 0)
        XCTAssertEqual(jitterOf("86399"), 86399)
        for bad in ["86400", "-1", "1.5", "abc", "1e3", "0x10"] { XCTAssertNil(jitterOf(bad), bad) }
    }

    func testSelectsOfferDefaultFirstAndKeepAValueTheListsDoNotHold() {
        XCTAssertEqual(modelChoices(current: "").map(\.value), ["", "claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5[1m]"])
        XCTAssertEqual(modelChoices(current: "").first?.label, "Default")
        XCTAssertEqual(modelChoices(current: "claude-opus-5-5[1m]").count, 6)
        XCTAssertEqual(modelChoices(current: "claude-opus-4-8").last, Choice("claude-opus-4-8", "Opus 4.8"))
        XCTAssertEqual(effortChoices(current: nil).map(\.value), ["", "low", "medium", "high", "xhigh", "max"])
        XCTAssertEqual(effortChoices(current: "turbo").last, Choice("turbo", "turbo"))
        XCTAssertEqual(modeChoices().first, Choice("", "Default"))
        XCTAssertEqual(modeChoices(current: "plan").count, modeChoices().count)
    }

    func testASkippedFireSaysWhichRunItWasAndWhy() {
        XCTAssertEqual(skippedWords(RoutineSkip(fireAt: time("2026-10-22T07:42:17+10:00"), at: time("2026-10-22T07:43:00+10:00"), reason: "the previous run is still working"), now: now),
                       "Skipped the run due yesterday, 07:42: the previous run is still working.")
        XCTAssertEqual(skippedWords(RoutineSkip(fireAt: time("2026-10-30T07:42:17+10:00"), reason: "5 h late, over the 12 h limit"), now: now),
                       "Skipped the run due Fri 30 Oct, 07:42: 5 h late, over the 12 h limit.")
        XCTAssertEqual(skippedWords(RoutineSkip(reason: "busy"), now: now), "Skipped the run: busy.")
        XCTAssertEqual(skippedWords(nil, now: now), "")
    }

    // MARK: Routines with no run

    private func index(_ json: String) throws -> SessionIndex { try JSONDecoder().decode(SessionIndex.self, from: Data(json.utf8)) }
    private func row(_ id: String, _ routine: String?) -> String { "{\"id\":\"\(id)\"" + (routine.map { ",\"routine\":\"\($0)\"" } ?? "") + "}" }
    private let morning = RoutineSummary(id: "morning", title: "Morning", enabled: true)
    private let evening = RoutineSummary(id: "evening", title: "Evening", enabled: true)

    func testARoutineWithNoRunAnywhereIsOneTheSidebarDrawsWithNoRun() throws {
        XCTAssertEqual(unrunRoutines(try index("{}"), [morning, evening]).map(\.id), ["evening", "morning"])
    }

    func testARunThatIsPinnedInAGroupNestedOrAmongTheRoutinesCountsAsARow() throws {
        let pinned = try index("{\"pinned\":[\(row("s1", "morning"))]}")
        XCTAssertEqual(unrunRoutines(pinned, [morning, evening]).map(\.id), ["evening"])
        let nested = try index("{\"groups\":[{\"id\":\"g\",\"name\":\"G\",\"sessions\":[\(row("s1", "morning"))]}],\"started\":[{\"id\":\"host\",\"children\":[\(row("s2", "evening"))]}]}")
        XCTAssertEqual(unrunRoutines(nested, [morning, evening]), [])
        let runs = try index("{\"routines\":[{\"name\":\"morning\",\"latest\":\(row("s2", "morning")),\"earlier\":[\(row("s1", "morning"))]}]}")
        XCTAssertEqual(unrunRoutines(runs, [morning, evening]).map(\.id), ["evening"])
    }

    func testARoutineWhoseRunsWereAllArchivedHasNoRowAndKeepsItsLastRun() throws {
        let archived = RoutineSummary(id: "morning", title: "Morning", enabled: true, lastRunAt: time("2026-10-24T07:42:00+11:00"))
        XCTAssertEqual(unrunRoutines(try index("{}"), [archived]).first?.lastRunAt?.iso, "2026-10-24T07:42:00+11:00")
    }

    func testTheRoutinesWithNoRunComeInTitleOrderAndTheInputIsKept() throws {
        let list = [RoutineSummary(id: "c", title: "weekly report"), RoutineSummary(id: "a", title: "Check 10"), RoutineSummary(id: "b", title: "check 2")]
        XCTAssertEqual(unrunRoutines(try index("{}"), list).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(list.map(\.id), ["c", "a", "b"])
    }

    func testNothingIsDrawnBeforeBothTheIndexAndTheRoutinesHaveArrived() throws {
        XCTAssertEqual(unrunRoutines(try index("{}"), nil), [])
        XCTAssertEqual(unrunRoutines(try index("{}"), []), [])
        XCTAssertEqual(unrunRoutines(nil, [morning]), [])
    }

    func testARunRowWithNoRoutineDoesNotHideARoutine() throws {
        let ix = try index("{\"started\":[\(row("s1", nil)),\(row("s2", nil))]}")
        XCTAssertEqual(unrunRoutines(ix, [morning]).map(\.id), ["morning"])
    }

    // MARK: Words for a last run

    func testALastRunIsSaidInMinutesHoursAndDaysThenByItsDate() {
        XCTAssertEqual(ago(time("2026-10-25T11:59:40+11:00"), now: sunday), "just now")
        XCTAssertEqual(ago(time("2026-10-25T11:48:00+11:00"), now: sunday), "12 min ago")
        XCTAssertEqual(ago(time("2026-10-25T09:00:00+11:00"), now: sunday), "3 h ago")
        XCTAssertEqual(ago(time("2026-10-24T11:00:00+11:00"), now: sunday), "1 day ago")
        XCTAssertEqual(ago(time("2026-10-21T12:00:00+11:00"), now: sunday), "4 days ago")
        XCTAssertEqual(ago(time("2026-10-12T07:42:00+11:00"), now: sunday), "12 Oct")
        XCTAssertEqual(ago(time("2025-10-12T07:42:00+11:00"), now: sunday), "12 Oct 2025")
        XCTAssertEqual(ago(time("2026-10-26T07:42:00+11:00"), now: sunday), "just now")
        XCTAssertEqual(ago(nil, now: sunday), "")
    }

    func testTheQuietPartOfARoutineSaysOffWhenItLastRanOrThatItHasNot() {
        let m = RoutineSummary(id: "morning", title: "Morning", enabled: true)
        func with(_ f: (inout RoutineSummary) -> Void) -> RoutineSummary { var r = m; f(&r); return r }
        XCTAssertEqual(idleWords(m, now: sunday), "Hasn't run yet")
        XCTAssertEqual(idleWords(with { $0.lastRunAt = time("2026-10-25T11:48:00+11:00") }, now: sunday), "Last run 12 min ago")
        XCTAssertEqual(idleWords(with { $0.lastRunAt = time("2026-10-12T07:42:00+11:00") }, now: sunday), "Last run 12 Oct")
        XCTAssertEqual(idleWords(with { $0.enabled = false }, now: sunday), "Off")
        XCTAssertEqual(idleWords(with { $0.enabled = false; $0.lastRunAt = time("2026-10-25T11:48:00+11:00") }, now: sunday), "Off")
        let failed = with { $0.lastRunAt = time("2026-10-25T11:48:00+11:00"); $0.lastError = "Cannot read /tmp/gone.md." }
        XCTAssertEqual(idleWords(failed, now: sunday), "Couldn't start 12 min ago")
        XCTAssertEqual(idleWords({ var r = failed; r.lastSessionId = "abc"; return r }(), now: sunday), "Last run 12 min ago")
        XCTAssertEqual(idleWords({ var r = failed; r.enabled = false; return r }(), now: sunday), "Off")
    }

    func testAQueuedRetrySaysWhenTheNextTryIs() {
        func retry(_ next: String?) -> RoutineRetry { RoutineRetry(fireAt: time("2026-10-25T11:45:00+11:00"), tries: 2, nextAt: next.flatMap { LocalTime($0) }) }
        XCTAssertEqual(retryWords(retry("2026-10-25T12:05:30+11:00"), now: sunday), "Retrying, next try at 12:05")
        XCTAssertEqual(retryWords(retry("2026-10-26T00:05:00+11:00"), now: sunday), "Retrying, next try tomorrow at 00:05")
        XCTAssertEqual(retryWords(retry("2026-10-27T00:05:00+11:00"), now: sunday), "Retrying, next try Tue 27 Oct at 00:05")
        XCTAssertEqual(retryWords(RoutineRetry(), now: sunday), "Retrying")
        XCTAssertEqual(retryWords(retry("soon"), now: sunday), "Retrying")
        XCTAssertEqual(retryWords(retry("2026-10-25T11:59:00+11:00"), now: sunday), "Retrying, next try soon")
        XCTAssertEqual(retryWords(retry("2026-10-25T12:00:00+11:00"), now: sunday), "Retrying, next try soon")
    }

    func testAnIdleRoutineQueuedToRetrySaysSoAndItsTipIsWhatTheLastTrySaid() {
        let queued = RoutineSummary(id: "morning", title: "Morning", enabled: true, lastRunAt: time("2026-10-25T11:48:00+11:00"), lastError: "spawn claude ENOENT",
                                    retry: RoutineRetry(fireAt: time("2026-10-25T11:48:00+11:00"), tries: 1, nextAt: time("2026-10-25T12:01:00+11:00")))
        XCTAssertEqual(idleWords(queued, now: sunday), "Retrying, next try at 12:01")
        XCTAssertEqual(retryTip(queued), "The last try said: spawn claude ENOENT")
        var off = queued; off.enabled = false
        XCTAssertEqual(idleWords(off, now: sunday), "Off")
        XCTAssertNil(retryTip(off))
        var none = queued; none.retry = nil
        XCTAssertEqual(idleWords(none, now: sunday), "Couldn't start 12 min ago")
        XCTAssertNil(retryTip(none))
    }

    func testTheGroupsSuggestedAreEachOnceInNameOrder() {
        func r(_ id: String, _ heading: String?) -> RoutineSummary { RoutineSummary(id: id, heading: heading) }
        XCTAssertEqual(headingNames([r("1", "Reports"), r("2", nil), r("3", nil), r("4", "inbox"), r("5", "Reports"), r("6", "Archive 10"), r("7", "Archive 2")]),
                       ["Archive 2", "Archive 10", "inbox", "Reports"])
        XCTAssertEqual(headingNames([]), [])
    }
}
