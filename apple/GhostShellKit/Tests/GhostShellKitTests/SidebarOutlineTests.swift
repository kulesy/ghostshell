import XCTest
@testable import GhostShellKit

final class SidebarOutlineTests: XCTestCase {
    private func row(_ id: String, _ title: String, dot: SessionDot? = nil, state: SessionState = .idle, children: [SessionRow] = [], at: Double = 0, cwd: String = "", branch: String = "", routine: String? = nil) -> SessionRow {
        SessionRow(id: id, title: title, cwd: cwd, branch: branch, state: state, dot: dot, lastActivityAt: at > 0 ? Date(timeIntervalSince1970: at) : nil, routine: routine, children: children)
    }

    private func index(_ json: String) throws -> SessionIndex { try JSONDecoder().decode(SessionIndex.self, from: Data(json.utf8)) }

    // Home has a group, a project has another, a routine has two sub-headings, and one family is nested.
    private let sample = """
    {
      "projects": [{"id": "p1", "name": "Alpha"}, {"id": "p2", "name": "Beta"}],
      "pinned": [{"id": "pin", "title": "Pinned one"}],
      "groups": [
        {"id": "g-z", "name": "Zed", "project": null, "sessions": [
          {"id": "b", "title": "banana"}, {"id": "a2", "title": "Apple"}, {"id": "none", "title": "Untitled session"},
          {"id": "a1", "title": "Apple"}, {"title": "bad"},
          {"id": "fam", "title": "Cherry", "children": [{"id": "k2", "title": "zulu", "parent": "fam"}, {"id": "k1", "title": "alpha", "parent": "fam"}]}]},
        {"id": "g-a", "name": "Alpha group", "project": "p1", "sessions": [{"id": "pa", "title": "In the project"}]},
        {"id": "g-gone", "name": "Lost", "project": "deleted", "sessions": []},
        {"id": "g-empty", "name": "Empty", "project": "p2", "sessions": []}
      ],
      "routines": [
        {"name": "r-b", "title": "Backup", "latest": {"id": "rb1", "title": "x", "routine": "r-b"}, "earlier": [{"id": "rb0"}, {"id": "ra0"}]},
        {"name": "r-a", "heading": "Weekly", "latest": {"id": "ra1", "title": "Audit", "routine": "r-a"}, "earlier": []},
        {"name": "r-c", "heading": "10 Daily", "title": "Check", "latest": {"id": "rc1", "title": "y"}, "earlier": []},
        {"name": "r-d", "heading": "2 Daily", "title": "Deploy", "latest": {"id": "rd1", "title": "z"}, "earlier": []}
      ],
      "started": [{"id": "s1", "title": "Started"}],
      "ungrouped": [], "other": [{"id": "o1", "title": "Terminal"}]
    }
    """

    func testOrdersAToZWithUntitledLastAndTiesByIdAndKeepsServerOrderOfGroups() throws {
        let home = SidebarOutline.sections(try index(sample), view: nil)
        let zed = try XCTUnwrap(home.first { $0.id == "g-z" })
        XCTAssertEqual(zed.rows.map(\.id), ["a1", "a2", "b", "fam", "none"])
        XCTAssertEqual(zed.rows.first { $0.id == "fam" }?.children.map(\.id), ["k1", "k2"])
        XCTAssertEqual(home.filter { $0.kind == .group }.map(\.id), ["g-z", "g-gone"])
    }

    func testHomeSectionsInOrderAndHideWhenEmptyExceptGroups() throws {
        let home = SidebarOutline.sections(try index(sample), view: nil)
        XCTAssertEqual(home.map(\.id), ["routines", "pinned", "g-z", "g-gone", "started", "other"])
        let bare = SidebarOutline.sections(try index(#"{"groups": [{"id": "g", "name": "G", "sessions": []}]}"#), view: nil)
        XCTAssertEqual(bare.map(\.id), ["g"])
        XCTAssertEqual(bare.first?.count, 0)
    }

    func testProjectViewHasPinnedAndItsGroupsOnlyAndAMissingProjectIsHome() throws {
        let ix = try index(sample)
        XCTAssertEqual(SidebarOutline.sections(ix, view: "p1").map(\.id), ["pinned", "g-a"])
        XCTAssertEqual(SidebarOutline.sections(ix, view: "p2").map(\.id), ["pinned", "g-empty"])
        XCTAssertEqual(SidebarOutline.sections(ix, view: "deleted"), SidebarOutline.sections(ix, view: nil))
        XCTAssertNil(SidebarOutline.view("deleted", in: ix))
        XCTAssertEqual(SidebarOutline.view("p2", in: ix), "p2")
        XCTAssertFalse(SidebarOutline.hasNoGroups(ix, view: "p1"))
        let none = try index(#"{"projects": [{"id": "p", "name": "P"}]}"#)
        XCTAssertTrue(SidebarOutline.hasNoGroups(none, view: "p"))
        XCTAssertFalse(SidebarOutline.hasNoGroups(none, view: nil))
        XCTAssertTrue(SidebarOutline.sections(none, view: "p").isEmpty)
    }

    func testCountsIncludeChildrenAndRoutinesCountRoutines() throws {
        let home = SidebarOutline.sections(try index(sample), view: nil)
        XCTAssertEqual(home.first { $0.id == "g-z" }?.count, 7)
        XCTAssertEqual(home.first { $0.id == "routines" }?.count, 4)
        XCTAssertEqual(home.first { $0.id == "pinned" }?.count, 1)
    }

    func testRoutinesAreOrderedByTheirTitleWithHeadingsByNameAndEarlierRunsKeepServerOrder() throws {
        let routines = try XCTUnwrap(SidebarOutline.sections(try index(sample), view: nil).first)
        XCTAssertEqual(routines.buckets.map(\.id), ["routines-loose", "routine-heading:2 Daily", "routine-heading:10 Daily", "routine-heading:Weekly"])
        let loose = try XCTUnwrap(routines.buckets.first)
        XCTAssertEqual(loose.routines.map(\.id), ["r-b"])
        XCTAssertEqual(loose.routines.first?.latest.title, "Backup")
        XCTAssertEqual(loose.routines.first?.earlier.map(\.id), ["rb0", "ra0"])
        XCTAssertEqual(routines.buckets.last?.routines.first?.latest.title, "Audit")
    }

    func testHolderNamesTheViewThatHoldsASession() throws {
        let ix = try index(sample)
        XCTAssertEqual(SidebarOutline.holder(of: "pa", in: ix), .view("p1"))
        XCTAssertEqual(SidebarOutline.holder(of: "k1", in: ix), .view(nil))
        XCTAssertEqual(SidebarOutline.holder(of: "rb0", in: ix), .view(nil))
        XCTAssertEqual(SidebarOutline.holder(of: "pin", in: ix), .everyView)
        XCTAssertEqual(SidebarOutline.holder(of: "missing", in: ix), .none)
    }

    func testAFoldedFamilyTakesTheMostUrgentNestedMark() {
        let head = row("h", "Head", dot: .ready, children: [row("a", "A", dot: .running, state: .working), row("b", "B", dot: .awaiting), row("c", "C", state: .waiting)])
        let note = SidebarOutline.familyNote(head)
        XCTAssertEqual(note.dot, .awaiting)
        XCTAssertEqual(note.label, "3 nested sessions, 2 waiting on you")
        XCTAssertEqual(SidebarOutline.familyNote(row("h", "H", dot: .awaiting, children: [row("a", "A", dot: .ready)])), FamilyNote(dot: nil, label: "1 nested session"))
        XCTAssertEqual(SidebarOutline.familyNote(row("h", "H", children: [row("a", "A", state: .working)])).label, "1 nested session, 1 working")
        XCTAssertEqual(SidebarOutline.familyNote(row("h", "H", children: [row("a", "A", dot: .error)])).label, "1 nested session, some failed")
        XCTAssertEqual(SidebarOutline.familyNote(row("h", "H", children: [row("a", "A", dot: .ready)])).label, "1 nested session, some unread")
    }

    func testRankOrdersTheMarksAndIgnoresArchivedRows() {
        let ranks = [nil, SessionDot.ready, .running, .error, .awaiting].map { SidebarOutline.rank(row("x", "x", dot: $0)) }
        XCTAssertEqual(ranks, [0, 1, 2, 3, 4])
        var old = row("x", "x", dot: .awaiting)
        old.archived = true
        XCTAssertEqual(SidebarOutline.rank(old), 0)
    }

    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private let en = Locale(identifier: "en_US")
    // Sunday 8 Nov 2026, 15:00 UTC.
    private let now = Date(timeIntervalSince1970: 1_794_150_000)

    func testWhenReadsLikeThePage() {
        func when(_ ago: Double?) -> String { SidebarOutline.when(ago.map { now.addingTimeInterval(-$0) }, now: now, calendar: calendar, locale: en) }
        XCTAssertEqual(when(nil), "")
        XCTAssertEqual(when(30), "now")
        XCTAssertEqual(when(5 * 60), "5 min")
        XCTAssertEqual(when(59.5 * 60), "60 min")
        XCTAssertEqual(when(3 * 3600).replacingOccurrences(of: "\u{202F}", with: " "), "12:00 PM")
        XCTAssertEqual(when(18 * 3600), "Yesterday")
        XCTAssertEqual(when(3 * 86400), "Thu")
        XCTAssertTrue(["Oct 29", "29 Oct"].contains(when(10 * 86400)))
    }

    func testDuration() {
        XCTAssertEqual(SidebarOutline.duration(ms: -5), "0s")
        XCTAssertEqual(SidebarOutline.duration(ms: 7_900), "7s")
        XCTAssertEqual(SidebarOutline.duration(ms: 125_000), "2m 05s")
        XCTAssertEqual(SidebarOutline.duration(ms: 3_900_000), "1h 05m")
    }

    func testFolderName() {
        let home = "/Users/eli"
        XCTAssertEqual(SidebarOutline.folderName("/Users/eli/Projects/agent-chat/.claude/worktrees/swift-sidebar", home: home), "agent-chat")
        XCTAssertEqual(SidebarOutline.folderName("/Users/eli", home: home), "")
        XCTAssertEqual(SidebarOutline.folderName("/Users/eli/Projects", home: home), "~/Projects")
        XCTAssertEqual(SidebarOutline.folderName("/Users/eli/Projects/tinacms/docs", home: home), "tinacms/docs")
        XCTAssertEqual(SidebarOutline.folderName("/srv/app", home: home), "srv/app")
        XCTAssertEqual(SidebarOutline.folderName("", home: home), "")
    }

    func testTooltipJoinsFolderBranchMarkAndTime() {
        let r = row("t", "Title", dot: .awaiting, at: now.timeIntervalSince1970 - 300, cwd: "/Users/eli/Projects/web", branch: "main")
        XCTAssertEqual(SidebarOutline.tooltip(r, home: "/Users/eli", now: now, calendar: calendar, locale: en), "Projects/web · main · Needs input · 5 min")
        let earlier = row("e", "5 min", at: now.timeIntervalSince1970 - 300)
        XCTAssertEqual(SidebarOutline.tooltip(earlier, home: "/h", now: now, calendar: calendar, locale: en), "")
    }

    func testSearchMatchesEveryWordInTitleCwdBranchAndRoutineNewestFirst() throws {
        let ix = SessionIndex(started: [
            row("old", "Fix upload", at: 100, cwd: "/work/site", branch: "main"),
            row("new", "Tidy", at: 300, cwd: "/work/site", branch: "fix/upload"),
            row("run", "Nightly", at: 200, routine: "upload-check"),
            row("miss", "Other", at: 400, cwd: "/work/site"),
        ])
        XCTAssertEqual(SidebarOutline.search("UPLOAD", in: ix, archived: []).sessions.map(\.id), ["new", "run", "old"])
        XCTAssertEqual(SidebarOutline.search("upload site", in: ix, archived: []).sessions.map(\.id), ["new", "old"])
        XCTAssertTrue(SidebarOutline.search("   ", in: ix, archived: []).sessions.isEmpty)
        let archived = [row("a1", "Old upload"), row("a2", "Old thing")]
        XCTAssertEqual(SidebarOutline.search("upload", in: ix, archived: archived).archived.map(\.id), ["a1"])
    }

    func testSearchCapsEachListAt50() {
        let many = (0..<80).map { row("s\($0)", "match \($0)", at: Double($0 + 1)) }
        let hits = SidebarOutline.search("match", in: SessionIndex(started: many), archived: many)
        XCTAssertEqual(hits.sessions.count, 50)
        XCTAssertEqual(hits.sessions.first?.id, "s79")
        XCTAssertEqual(hits.archived.count, 50)
        XCTAssertEqual(hits.archived.first?.id, "s0")
    }

    func testNewFieldsAreOptionalSoAnOldServerStillDecodes() throws {
        let old = try index(#"{"groups": [{"id": "g", "name": "G", "sessions": [{"id": "a"}]}], "routines": [{"name": "r", "latest": {"id": "l"}, "earlier": []}]}"#)
        XCTAssertTrue(old.projects.isEmpty)
        XCTAssertNil(old.groups.first?.project)
        XCTAssertNil(old.routines.first?.heading)
        XCTAssertNil(old.groups.first?.sessions.first?.turnStart)
    }

    func testNewFieldsDecodeWhenPresent() throws {
        let ix = try index(#"{"projects": [{"id": "p", "name": "P"}, {"id": "no name"}], "groups": [{"id": "g", "name": "G", "project": "p", "sessions": [{"id": "a", "turnMs": 5000}]}], "routines": [{"name": "r", "heading": "H", "latest": {"id": "l"}, "earlier": []}]}"#)
        XCTAssertEqual(ix.projects, [SessionProject(id: "p", name: "P")])
        XCTAssertEqual(ix.groups.first?.project, "p")
        XCTAssertEqual(ix.routines.first?.heading, "H")
        let start = try XCTUnwrap(ix.groups.first?.sessions.first?.turnStart)
        XCTAssertEqual(Date().timeIntervalSince(start), 5, accuracy: 1)
    }

    func testArchivedListDecodesThroughItsWrapperAndDropsOddEntries() async throws {
        let body = #"{"archived": [{"id": "a", "title": "Old", "cwd": "/x", "branch": "", "routine": null, "state": "idle", "lastActivityAt": 5000, "archivedAt": 6000, "archived": true}, {"title": "no id"}]}"#
        let address = ServerAddress("https://ghost.example.com")!
        let store = MemoryTokenStore()
        await store.save(String(repeating: "ab12", count: 16), for: address)
        let client = GhostShellClient(address: address, store: store, protocols: [ArchivedStub.self])
        ArchivedStub.body = body
        let rows = try await client.archivedSessions()
        XCTAssertEqual(rows.map(\.id), ["a"])
        XCTAssertEqual(rows.first?.archived, true)
        XCTAssertEqual(rows.first?.lastActivityAt, Date(timeIntervalSince1970: 5))
        XCTAssertEqual(ArchivedStub.path, "/api/archived")
    }
}

private final class ArchivedStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var body = "{}"
    nonisolated(unsafe) static var path = ""
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        Self.path = request.url?.path ?? ""
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}
