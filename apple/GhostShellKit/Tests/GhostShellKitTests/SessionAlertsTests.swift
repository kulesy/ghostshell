import XCTest
@testable import GhostShellKit

final class SessionAlertsTests: XCTestCase {
    private func row(_ id: String, _ dot: SessionDot?, title: String = "", pinned: Bool = false, archived: Bool = false, routine: String? = nil) -> SessionRow {
        SessionRow(id: id, title: title, dot: dot, pinned: pinned, archived: archived, routine: routine)
    }

    private func plan(_ before: [String: SessionDot]?, _ rows: [SessionRow], _ filter: AlertFilter = AlertFilter(), onScreen: String? = nil) -> AlertPlan {
        SessionAlerts.plan(previous: before, rows: rows, filter: filter, onScreen: onScreen)
    }

    func testFirstLookRecordsABaselineAndAlertsNothing() {
        XCTAssertEqual(plan(nil, [row("a", .awaiting), row("b", .error), row("c", .ready)]), AlertPlan())
    }

    func testEachKindAlertsWhenTheMarkChangesIntoIt() {
        let result = plan(["a": .running, "b": .running, "c": .running], [row("a", .awaiting, title: "One"), row("b", .error, title: "Two"), row("c", .ready, title: "Three")])
        XCTAssertEqual(result.alerts.map(\.kind), [.needsYou, .failed, .finished])
        XCTAssertEqual(result.alerts.map(\.title), ["One", "Two", "Three"])
        XCTAssertEqual(result.alerts.map(\.kind.text), ["Needs you", "Failed", "Finished"])
        XCTAssertEqual(result.withdraw, [])
    }

    func testAMarkThatDidNotChangeAlertsOnlyOnce() {
        XCTAssertEqual(plan(["a": .awaiting], [row("a", .awaiting)]), AlertPlan())
    }

    func testARowFirstSeenAfterTheBaselineCountsAsComingFromNothing() {
        XCTAssertEqual(plan([:], [row("new", .ready)]).alerts.map(\.sessionID), ["new"])
        XCTAssertEqual(plan([:], [row("new", .running)]), AlertPlan())
    }

    func testAnEmptyTitleReadsUntitled() {
        XCTAssertEqual(plan([:], [row("a", .awaiting)]).alerts.first?.title, "Untitled")
    }

    func testEachEventHasItsOwnSwitch() {
        let rows = [row("a", .awaiting), row("b", .ready), row("c", .error)]
        XCTAssertEqual(plan([:], rows, AlertFilter(needsYou: false)).alerts.map(\.kind), [.finished, .failed])
        XCTAssertEqual(plan([:], rows, AlertFilter(finished: false)).alerts.map(\.kind), [.needsYou, .failed])
        XCTAssertEqual(plan([:], rows, AlertFilter(failed: false)).alerts.map(\.kind), [.needsYou, .finished])
    }

    func testPinnedOnlyAndRoutineRunsFilterSessions() {
        let rows = [row("plain", .ready), row("pin", .ready, pinned: true), row("run", .ready, routine: "nightly")]
        XCTAssertEqual(plan([:], rows).alerts.map(\.sessionID), ["plain", "pin", "run"])
        XCTAssertEqual(plan([:], rows, AlertFilter(pinnedOnly: true)).alerts.map(\.sessionID), ["pin"])
        XCTAssertEqual(plan([:], rows, AlertFilter(routineRuns: false)).alerts.map(\.sessionID), ["plain", "pin"])
    }

    func testArchivedRowsNeverAlert() {
        XCTAssertEqual(plan([:], [row("old", .ready, archived: true)]), AlertPlan())
    }

    func testTheSessionOnScreenIsSkippedAndOthersAreNot() {
        let result = plan([:], [row("open", .awaiting), row("other", .awaiting)], onScreen: "open")
        XCTAssertEqual(result.alerts.map(\.sessionID), ["other"])
    }

    func testWithdrawsWhenTheMarkLeavesTheAlertStates() {
        let result = plan(["a": .awaiting, "b": .ready, "c": .error, "d": .running], [row("a", nil), row("b", .running), row("c", nil), row("d", nil)])
        XCTAssertEqual(result.withdraw, ["a", "b", "c"])
        XCTAssertEqual(result.alerts, [])
    }

    func testWithdrawsWhenTheSessionDisappearsOrIsArchived() {
        XCTAssertEqual(plan(["gone": .ready, "quiet": .running], []).withdraw, ["gone"])
        XCTAssertEqual(plan(["a": .ready], [row("a", nil, archived: true)]).withdraw, ["a"])
    }

    func testANewAlertReplacesTheOldOneInsteadOfWithdrawing() {
        let result = plan(["a": .awaiting], [row("a", .ready)])
        XCTAssertEqual(result.alerts.map(\.kind), [.finished])
        XCTAssertEqual(result.withdraw, [])
    }

    func testAChangeToASwitchedOffKindWithdrawsTheOldAlert() {
        let result = plan(["a": .awaiting], [row("a", .ready)], AlertFilter(finished: false))
        XCTAssertEqual(result.alerts, [])
        XCTAssertEqual(result.withdraw, ["a"])
    }

    func testDotsKeepsOnlyRowsWithAMark() {
        XCTAssertEqual(SessionAlerts.dots([row("a", .ready), row("b", nil), row("c", .running)]), ["a": .ready, "c": .running])
    }

    func testWaitingCountCountsOnlyAwaiting() {
        XCTAssertEqual(SessionAlerts.waitingCount([row("a", .awaiting), row("b", .awaiting), row("c", .ready), row("d", .error), row("e", nil)]), 2)
        XCTAssertEqual(SessionAlerts.waitingCount([]), 0)
    }
}
