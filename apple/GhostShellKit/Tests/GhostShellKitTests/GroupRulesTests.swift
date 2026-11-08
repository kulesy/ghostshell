import XCTest
@testable import GhostShellKit

final class GroupRulesTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000_000)
    private func ago(_ hours: Double) -> Date { now.addingTimeInterval(-hours * 3600) }
    private func row(_ id: String, _ state: SessionState = .idle, dot: SessionDot? = nil, hours: Double = 100, parent: String? = nil, archived: Bool = false, children: [SessionRow] = []) -> SessionRow {
        SessionRow(id: id, title: id, state: state, dot: dot, lastActivityAt: ago(hours), archived: archived, parent: parent, children: children)
    }

    func testBucketsFollowStateThenRecency() {
        XCTAssertEqual(GroupRules.bucket(of: row("a", .waiting), now: now), .needs)
        XCTAssertEqual(GroupRules.bucket(of: row("a", .idle, dot: .awaiting), now: now), .needs)
        XCTAssertEqual(GroupRules.bucket(of: row("a", .working), now: now), .working)
        XCTAssertEqual(GroupRules.bucket(of: row("a", .active), now: now), .recent)
        XCTAssertEqual(GroupRules.bucket(of: row("a", .idle, hours: 23), now: now), .recent)
        XCTAssertEqual(GroupRules.bucket(of: row("a", .idle, hours: 25), now: now), .idle)
        XCTAssertEqual(GroupRules.bucket(of: row("a", .working, archived: true), now: now), .archived)
    }

    func testALineIsPlacedByTheMostUrgentSessionUnderIt() {
        let rows = [row("head"), row("kid", .waiting, parent: "head"), row("calm", hours: 1), row("busy", .working)]
        let lines = ["head", "calm", "busy"].map { id in SubLine(row: rows.first { $0.id == id }!, subs: GroupRules.tree(rows, under: id, now: now)) }
        XCTAssertEqual(GroupRules.ordered(lines, now: now).map(\.id), ["head", "busy", "calm"])
        let parts = GroupRules.parts(lines, now: now)
        XCTAssertEqual(parts[.needs]?.map(\.id), ["head"])
        XCTAssertEqual(parts[.working]?.map(\.id), ["busy"])
        XCTAssertEqual(parts[.recent]?.map(\.id), ["calm"])
        XCTAssertNil(parts[.idle])
    }

    func testALineWithARepeatedIdIsOrderedNotCrashed() {
        let lines = [SubLine(row: row("a"), subs: []), SubLine(row: row("a", .waiting), subs: [])]
        XCTAssertEqual(GroupRules.ordered(lines, now: now).count, 2)
    }

    func testAChipFolderTakesTheRecordThenTheInputThenTheSessionAndSkipsEmptyStrings() {
        XCTAssertEqual(GroupRules.chipFolder(record: "/r", input: "/i", session: "/s"), "/r")
        XCTAssertEqual(GroupRules.chipFolder(record: "", input: "/i", session: "/s"), "/i")
        XCTAssertEqual(GroupRules.chipFolder(record: nil, input: "", session: "/s"), "/s")
        XCTAssertEqual(GroupRules.chipFolder(record: nil, input: nil, session: ""), "")
    }

    func testDescendantsEndOnALoop() {
        let rows = [row("a", parent: "b"), row("b", parent: "a"), row("c", parent: "a")]
        XCTAssertEqual(Set(GroupRules.descendants(rows, of: "a").map(\.id)), ["b", "c"])
        XCTAssertEqual(GroupRules.tree(rows, under: "a", now: now).map(\.id), ["b", "c"].sorted { $0 < $1 })
    }

    func testRollupLeavesOutArchivedAndEmptyParts() {
        let rows = [row("a", .waiting), row("b", .working), row("c"), row("d", .waiting, archived: true)]
        let roll = GroupRules.tally(rows, now: now)
        XCTAssertEqual(roll.total, 3)
        XCTAssertEqual(GroupRules.rollupLine(roll), "3 sub sessions, 1 waiting on you, 1 working")
        XCTAssertEqual(GroupRules.rollupLine(GroupRules.tally([row("c")], now: now)), "1 sub session")
        XCTAssertEqual(GroupRules.rollupLine(roll, noun: "session"), "3 sessions, 1 waiting on you, 1 working")
        XCTAssertEqual(GroupRules.rollupLine(GroupRoll()), "")
    }

    func testSplitWaitingFindsTheWords() {
        XCTAssertEqual(GroupRules.splitWaiting("3 sessions, 1 waiting on you, 1 working").words, "waiting on you")
        XCTAssertEqual(GroupRules.splitWaiting("3 sessions").words, "")
    }

    func testPillReadsStateBeforeDot() {
        XCTAssertEqual(GroupRules.pill(row("a", .waiting)).label, "Waiting on you")
        XCTAssertEqual(GroupRules.pill(row("a", .idle, dot: .error)).label, "Failed")
        XCTAssertEqual(GroupRules.pill(row("a", .working)).tone, .working)
        XCTAssertEqual(GroupRules.pill(row("a", .idle, dot: .ready)).label, "Unread")
        XCTAssertEqual(GroupRules.pill(row("a")).label, "Idle")
    }

    func testNextStepFollowsTheRuleOrder() {
        let none = SessionSummary(line: "Did a thing.", ask: "")
        XCTAssertNil(GroupRules.nextStep(row("a"), heard: nil, pull: nil))
        XCTAssertEqual(GroupRules.nextStep(row("a", .waiting), heard: none, pull: nil)?.text, "Open it, it's waiting on you")
        let two = SessionSummary(pending: [PendingLine(tool: "Bash", summary: "npm test"), PendingLine(tool: "Edit", summary: "x")])
        XCTAssertEqual(GroupRules.nextStep(row("a", .waiting), heard: two, pull: nil)?.text, "Approve Bash: npm test (and 1 more)")
        let question = SessionSummary(pending: [PendingLine(tool: "AskUserQuestion", summary: "Which one?")])
        XCTAssertEqual(GroupRules.nextStep(row("a", .waiting), heard: question, pull: nil)?.text, "Answer its question: Which one?")
        XCTAssertEqual(GroupRules.nextStep(row("a", .idle, dot: .error), heard: none, pull: nil)?.tone, .error)
        let asking = SessionSummary(line: "x", ask: "Shall I go on?")
        XCTAssertEqual(GroupRules.nextStep(row("a", .idle, dot: .ready), heard: asking, pull: nil)?.text, "Answer its question: Shall I go on?")
        XCTAssertEqual(GroupRules.nextStep(row("a", .idle), heard: SessionSummary(line: "x", ask: "I can go on."), pull: nil)?.text, "Reply to its offer: I can go on.")
        XCTAssertEqual(GroupRules.nextStep(row("a", .working), heard: none, pull: nil)?.text, "Nothing yet, it's working")
        XCTAssertEqual(GroupRules.nextStep(row("a"), heard: none, pull: nil)?.text, "Nothing, it's done")
        XCTAssertEqual(GroupRules.nextStep(row("a"), heard: none, pull: PullStatus(url: "u", review: "required"))?.text, "Nothing for now")
        // An old server sends no ask, so the first sentence stands in.
        let old = SessionSummary(line: "Fixed it.", ask: nil)
        XCTAssertEqual(GroupRules.nextStep(row("a"), heard: old, pull: nil), NextStep(text: "Fixed it.", tone: nil, source: .said))
    }

    func testAPullRequestThatNeedsTheOwnerWinsOverAnIdleSession() {
        let pull = PullStatus(url: "u", asked: true)
        let step = GroupRules.nextStep(row("a"), heard: SessionSummary(), pull: pull)
        XCTAssertEqual(step?.text, "Review the pull request")
        XCTAssertEqual(step?.source, .pull)
    }

    func testPullLines() {
        func line(_ pull: PullStatus, _ state: SessionState = .idle) -> PullLine { GroupRules.pullLine(pull, row("a", state)) }
        XCTAssertEqual(line(PullStatus(url: "u", state: "merged")).text, "Merged, nothing to do")
        XCTAssertEqual(line(PullStatus(url: "u", state: "closed")).tone, .quiet)
        XCTAssertEqual(line(PullStatus(url: "u", asked: true)).you, true)
        XCTAssertEqual(line(PullStatus(url: "u", review: "approved", checks: "passing")).text, "Merge the pull request")
        XCTAssertEqual(line(PullStatus(url: "u", review: "changes", conflicts: true)).text, "Ask the session to deal with the requested changes and the conflicts")
        XCTAssertEqual(line(PullStatus(url: "u", checks: "failing", threads: 2)).tone, .error)
        XCTAssertEqual(line(PullStatus(url: "u", checks: "failing", threads: 1), .working).text, "The session is dealing with the 1 unresolved comment and the failing checks")
        XCTAssertEqual(line(PullStatus(url: "u", checks: "running")).text, "Waiting on checks to finish")
        XCTAssertEqual(line(PullStatus(url: "u", mine: false, review: "approved")).text, "Approved, nothing asked of you")
        XCTAssertEqual(line(PullStatus(url: "u", requested: 1)).text, "Waiting on a reviewer")
        XCTAssertEqual(line(PullStatus(url: "u", state: "draft")).text, "Still a draft")
        XCTAssertEqual(line(PullStatus(url: "u", mine: nil)).text, "Open")
        XCTAssertEqual(line(PullStatus(url: "u", mine: false)).text, "Open, nothing asked of you")
        XCTAssertEqual(line(PullStatus(url: "u")).text, "Open, no review asked for yet")
    }

    func testOnlyPlainPullURLsAreLinks() {
        XCTAssertTrue(GroupRules.isPullURL("https://github.com/kulesy/ghostshell/pull/106"))
        for bad in ["http://github.com/a/b/pull/1", "https://github.com/a/b/pull/0", "https://github.com/a/b/pull/1?x=1", "https://github.com/a/b/issues/1", "javascript:alert(1)", "https://github.com/a/../pull/1"] {
            XCTAssertFalse(GroupRules.isPullURL(bad), bad)
        }
        let ok = PullStatus(url: "https://github.com/a/b/pull/2")
        XCTAssertEqual(GroupRules.mainPull([PullStatus(url: "nope"), ok])?.url, ok.url)
        XCTAssertNil(GroupRules.mainPull(nil))
    }

    func testPullsOverlayMovesASessionIntoWaiting() {
        let r = row("a")
        var known = Kept<PullKept>()
        known.set("a", PullKept(stamp: GroupRules.stamp(r), at: now, pulls: [PullStatus(url: "u", asked: true)], settling: false))
        let needs = GroupRules.needs([r, row("b")], known: known)
        XCTAssertEqual(needs, ["a"])
        XCTAssertEqual(GroupRules.bucket(of: GroupRules.withPulls(r, needs), now: now), .needs)
        XCTAssertEqual(GroupRules.withPulls(row("a", archived: true), needs).dot, nil)
    }

    func testStampsDecideWhatIsAskedAgain() {
        let r = row("a", .working)
        XCTAssertTrue(GroupRules.stamp(r).hasSuffix(":working"))
        XCTAssertEqual(GroupRules.staleIDs([r, r, row("b")], stamps: { $0 == "a" ? GroupRules.stamp(r) : nil }), ["b"])
        var known = Kept<PullKept>()
        XCTAssertTrue(GroupRules.wantsPulls(r, known["a"], now: now))
        known.set("a", PullKept(stamp: GroupRules.stamp(r), at: now, pulls: [], settling: false))
        XCTAssertFalse(GroupRules.wantsPulls(r, known["a"], now: now.addingTimeInterval(30)))
        XCTAssertTrue(GroupRules.wantsPulls(r, known["a"], now: now.addingTimeInterval(61)))
        known.set("a", PullKept(stamp: GroupRules.stamp(r), at: now, pulls: [], settling: true))
        XCTAssertTrue(GroupRules.wantsPulls(r, known["a"], now: now))
        XCTAssertTrue(GroupRules.wantsPulls(row("a", .idle), PullKept(stamp: GroupRules.stamp(r), at: now, pulls: [], settling: false), now: now))
    }

    func testBatchesAndTrim() {
        let ids = (0..<130).map(String.init)
        XCTAssertEqual(GroupRules.batches(ids).map(\.count), [60, 60, 10])
        var kept = Kept<Int>()
        for i in 0..<5 { kept.set("k\(i)", i) }
        kept.trim(keeping: ["k0"], max: 3)
        XCTAssertEqual(Set(kept.values.keys), ["k0", "k3", "k4"])
    }

    func testPanesNameWhyAGroupHasNoChat() {
        var index = SessionIndex()
        XCTAssertEqual(GroupRules.pane(nil, "g1"), .unloaded)
        XCTAssertEqual(GroupRules.pane(index, "g1"), .unsupported(kind: "Group"))
        index.features = SessionFeatures(groupSessions: true)
        XCTAssertEqual(GroupRules.pane(index, "g1"), .missing(kind: "Group"))
        XCTAssertEqual(GroupRules.pane(index, "pinned"), .unsupported(kind: "Section"))
        index.features = SessionFeatures(groupSessions: true, sectionSessions: true)
        XCTAssertEqual(GroupRules.pane(index, "pinned"), .missing(kind: "Section"))
    }
}
