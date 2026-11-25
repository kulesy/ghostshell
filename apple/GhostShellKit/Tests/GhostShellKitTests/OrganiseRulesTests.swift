import XCTest
@testable import GhostShellKit

final class OrganiseRulesTests: XCTestCase {
    private func row(_ id: String, group: String? = nil, parent: String? = nil, pinned: Bool = false, state: SessionState = .idle, source: String? = "desktop",
                     routine: String? = nil, children: [SessionRow] = []) -> SessionRow {
        SessionRow(id: id, title: id, state: state, pinned: pinned, group: group, parent: parent, routine: routine, source: source, children: children)
    }

    // Home: Pinned p; group g1 holds a (with child a1 running); a project p1 holds g2 with b; two loose sessions.
    private var index: SessionIndex {
        let a = row("a", group: "g1", children: [row("a1", parent: "a", state: .working)])
        return SessionIndex(
            projects: [SessionProject(id: "p1", name: "Website")],
            pinned: [row("p", pinned: true)],
            groups: [SessionGroup(id: "g1", name: "Release", sessions: [a]), SessionGroup(id: "g2", name: "Site", project: "p1", sessions: [row("b", group: "g2")])],
            started: [row("s", source: "capcom")],
            ungrouped: [row("u")],
            features: nil)
    }

    func testCleanCollapsesWhiteSpace() {
        XCTAssertEqual(OrganiseRules.clean("  a \n  b\t"), "a b")
        XCTAssertEqual(OrganiseRules.clean("   "), "")
    }

    func testMoveToLeavesOutTheOwnPlaceAndAddsTheLooseHome() {
        let index = index
        let labels = OrganiseRules.sessionTargets(index, OrganiseRules.find(index, "a")!).map(\.id)
        XCTAssertEqual(labels, ["pinned", "project:Website", "ungrouped"], "g1 is its own place, and a desktop session goes back to Ungrouped")
        let loose = OrganiseRules.sessionTargets(index, OrganiseRules.find(index, "u")!).map(\.id)
        XCTAssertEqual(loose, ["pinned", "project:Website", "g1"], "a loose session has no loose place to move to")
        let pinned = OrganiseRules.sessionTargets(index, OrganiseRules.find(index, "p")!).map(\.id)
        XCTAssertEqual(pinned, ["project:Website", "g1", "ungrouped"])
    }

    func testADropThatChangesNothingIsRecognised() {
        let index = index
        let a = OrganiseRules.find(index, "a")!
        XCTAssertTrue(OrganiseRules.staysPut(index, a, section: "g1"))
        XCTAssertFalse(OrganiseRules.staysPut(index, a, section: "g2"))
        XCTAssertFalse(OrganiseRules.staysPut(index, a, section: "pinned"))
        XCTAssertTrue(OrganiseRules.staysPut(index, OrganiseRules.find(index, "p")!, section: "pinned"))
        XCTAssertTrue(OrganiseRules.staysPut(index, OrganiseRules.find(index, "u")!, section: "ungrouped"))
        XCTAssertFalse(OrganiseRules.staysPut(index, OrganiseRules.find(index, "a1")!, section: "g1"), "a nested session moves out even into its own group")
    }

    func testNestingRules() {
        let index = index
        let a = OrganiseRules.find(index, "a")!
        let u = OrganiseRules.find(index, "u")!
        XCTAssertTrue(OrganiseRules.nestsNothing(index, a, under: "a"), "onto itself")
        XCTAssertTrue(OrganiseRules.nestsNothing(index, a, under: "a1"), "onto its own child")
        XCTAssertTrue(OrganiseRules.nestsNothing(index, OrganiseRules.find(index, "a1")!, under: "a"), "into the family it is in")
        XCTAssertFalse(OrganiseRules.nestsNothing(index, u, under: "a1"), "onto a nested row nests under its head")
        XCTAssertTrue(OrganiseRules.nestsNothing(index, u, under: "gone"))
        XCTAssertEqual(OrganiseRules.nestTargets(index, OrganiseRules.find(index, "b")!).map(\.id), [], "only the rows of its own list are offered")
        XCTAssertEqual(OrganiseRules.nestTargets(index, a).map(\.id), [])
        XCTAssertEqual(OrganiseRules.refuseNest(index, ["a"], under: "a1"), OrganiseRules.nestSelf)
        XCTAssertNil(OrganiseRules.refuseNest(index, ["u"], under: "a"))
    }

    func testSeveralSessionsArchiveTheTopmostAndMoveTheCarried() {
        let index = index
        XCTAssertEqual(OrganiseRules.topmost(index, ["a", "a1", "u"]).map(\.id), ["a", "u"])
        XCTAssertEqual(OrganiseRules.carried(index, ["a", "a1", "u"]).map(\.id), ["a", "u"], "a1 travels with a")
    }

    func testManyTargetsAndTheWriteTheyMean() {
        let index = index
        let rows = [OrganiseRules.find(index, "u")!, OrganiseRules.find(index, "s")!]
        let places = OrganiseRules.manyTargets(index, rows)
        XCTAssertEqual(places.map(\.id), ["pinned", "project:Website", "g1"], "both are loose already, so no loose place is offered")
        XCTAssertEqual(OrganiseRules.target(index, section: "pinned"), .pinned)
        XCTAssertEqual(OrganiseRules.target(index, section: "g1"), .group("g1"))
        XCTAssertEqual(OrganiseRules.target(index, section: "ungrouped"), .group(nil))
    }

    func testAWriteThatChangesNothingIsSkipped() {
        let index = index
        XCTAssertTrue(OrganiseRules.changesNothing(index, ["p"], .pinned))
        XCTAssertFalse(OrganiseRules.changesNothing(index, ["p", "u"], .pinned))
        XCTAssertTrue(OrganiseRules.changesNothing(index, ["u", "s"], .parent(nil)))
        XCTAssertFalse(OrganiseRules.changesNothing(index, ["a1"], .parent(nil)))
        XCTAssertTrue(OrganiseRules.changesNothing(index, ["a"], .parent("a")))
        XCTAssertFalse(OrganiseRules.changesNothing(index, ["u"], .parent("a")))
        XCTAssertTrue(OrganiseRules.changesNothing(index, ["a"], .group("g1")))
    }

    func testGroupsMoveToHomeOrAProject() {
        let projects = [SessionProject(id: "p1", name: "Website"), SessionProject(id: "p2", name: "Docs")]
        XCTAssertEqual(OrganiseRules.moveTargets(projects, SessionGroup(id: "g", name: "G")).map(\.label), ["Move to Website", "Move to Docs"])
        let inside = OrganiseRules.moveTargets(projects, SessionGroup(id: "g", name: "G", project: "p1"))
        XCTAssertEqual(inside.map(\.label), ["Move to Home", "Move to Docs"])
        XCTAssertNil(inside[0].project)
        XCTAssertEqual(OrganiseRules.groups(index, view: nil).map(\.id), ["g1"])
        XCTAssertEqual(OrganiseRules.groups(index, view: "p1").map(\.id), ["g2"])
    }

    func testTheWordsBeforeADelete() {
        let index = index
        XCTAssertEqual(OrganiseRules.deleteDetail(index.groups[0]), "2 sessions become ungrouped. No session is deleted.")
        XCTAssertEqual(OrganiseRules.deleteDetail(SessionGroup(id: "e", name: "E")), "It has no sessions.")
        let chat = SessionGroup(id: "c", name: "C", session: row("chat", state: .working))
        XCTAssertEqual(OrganiseRules.deleteDetail(chat), "It has no sessions. Its chat is working, so it stops, and is hidden with its transcript kept. No session is deleted.")
        XCTAssertEqual(OrganiseRules.deleteDetail(index.projects[0], in: index), "Its group moves to Home. No group, routine or session is deleted.")
        XCTAssertEqual(OrganiseRules.deleteDetail(SessionProject(id: "x", name: "X"), in: index), "It has no groups.")
        var routined = index
        routined.routineProjects = ["a": "x"]
        XCTAssertEqual(OrganiseRules.deleteDetail(SessionProject(id: "x", name: "X"), in: routined), "Its routine moves to Home. No group, routine or session is deleted.")
        routined.routineProjects = ["a": "p1", "b": "p1"]
        XCTAssertEqual(OrganiseRules.deleteDetail(index.projects[0], in: routined), "Its group and 2 routines move to Home. No group, routine or session is deleted.")
    }

    func testTheWordsBeforeAnArchive() {
        XCTAssertEqual(OrganiseRules.stopQuestion(subs: 0, itself: true), OrganiseRules.stopDetail)
        XCTAssertTrue(OrganiseRules.stopQuestion(subs: 2, itself: true).hasPrefix("It and 2 sub sessions under it are running"))
        XCTAssertTrue(OrganiseRules.stopQuestion(subs: 1, itself: false).hasPrefix("1 sub session is running"))
        XCTAssertTrue(OrganiseRules.batchStopDetail(running: 3).hasPrefix("3 of them are running."))
        XCTAssertEqual(OrganiseRules.archiveNote(archived: 3, total: 3, stopped: 1, subs: 2), "Archived 3 sessions and 2 sub sessions, and stopped 1.")
        XCTAssertEqual(OrganiseRules.archiveNote(archived: 1, total: 1, subs: 2, name: "Ship it"), "Archived \u{201C}Ship it\u{201D} and 2 sub sessions.")
        XCTAssertEqual(OrganiseRules.archiveNote(archived: 1, total: 1), "Archived 1 session.")
        XCTAssertEqual(OrganiseRules.archiveNote(archived: 0, total: 2, reason: "Nope"), "Not archived: Nope.")
        XCTAssertEqual(OrganiseRules.archiveNote(archived: 1, total: 2, reason: "Nope"), "Archived 1 of 2 sessions. Not archived: Nope.")
    }

    func testTheAccountMenuFollowsThePagesRules() throws {
        let list = try JSONDecoder().decode(AccountList.self, from: Data(#"{"accounts":[{"id":"work","name":"Work","chromeOn":"home"},{"id":"home","name":"Home"},{"id":"old","name":"Old","signedOut":true}]}"#.utf8)).accounts
        let on = SessionFeatures(accountPins: true)
        XCTAssertTrue(OrganiseRules.offersAccountPick(on, list, pin: nil))
        XCTAssertFalse(OrganiseRules.offersAccountPick(SessionFeatures(), list, pin: nil), "the server must pin")
        XCTAssertFalse(OrganiseRules.offersAccountPick(on, Array(list.prefix(1)), pin: nil), "one account is no choice")
        XCTAssertTrue(OrganiseRules.offersAccountPick(on, Array(list.prefix(1)), pin: "work"), "an existing pin always shows")
        XCTAssertFalse(OrganiseRules.offersAccountPick(on, nil, pin: nil), "accounts not read yet")

        let free = OrganiseRules.accountChoices(list, pin: nil, follows: "Home")
        XCTAssertEqual(free.map(\.label), ["Active account (Home)", "Work (no Chrome)", "Home", "Old (signed out)"])
        XCTAssertEqual(free.map(\.checked), [true, false, false, false])
        XCTAssertEqual(free.map(\.picks), [false, true, true, false], "a signed out account cannot be picked, nor the active line while it holds")

        let held = OrganiseRules.accountChoices(list, pin: "gone", follows: "")
        XCTAssertEqual(held.last?.label, "Removed account")
        XCTAssertEqual(held.first?.picks, true, "clearing is offered while pinned")
        let own = OrganiseRules.accountChoices(list, pin: "home", follows: "")
        XCTAssertEqual(own.filter(\.checked).map(\.id), ["home"])
        XCTAssertEqual(own.first { $0.id == "home" }?.picks, false, "the pinned account runs nothing")
        XCTAssertEqual(OrganiseRules.accountFollows(list, SessionRow(id: "s", account: "home")), "Home")
        XCTAssertEqual(OrganiseRules.accountFollows(list, SessionRow(id: "s", account: "home", accountPin: "work")), "")
        XCTAssertEqual(OrganiseRules.accountChromeNote(list), "Chrome is on Home, so work on another account can't reach it.")
    }

    private func accountList(_ json: String) throws -> [Account] { try JSONDecoder().decode(AccountList.self, from: Data(json.utf8)).accounts }

    func testTheLabelNamesTheAccountOnlyWhenThereIsAChoice() throws {
        let two = try accountList(#"{"accounts":[{"id":"work","name":"Work"},{"id":"home","name":"Home"}]}"#)
        XCTAssertEqual(OrganiseRules.accountLabel(two, "home"), "Home")
        XCTAssertEqual(OrganiseRules.accountLabel(Array(two.prefix(1)), "work"), "")
        XCTAssertEqual(OrganiseRules.accountLabel(nil, "work"), "")
        XCTAssertEqual(OrganiseRules.accountLabel(two, nil), "")
        XCTAssertEqual(OrganiseRules.accountLabel(two, "gone"), "")
    }

    func testADraftRunsOnItsPickThenItsGroupsPinThenItsProjectThenTheActiveAccount() throws {
        let list = try accountList(#"{"accounts":[{"id":"work","name":"Work"},{"id":"home","name":"Home","active":true},{"id":"lab","name":"Lab"}]}"#)
        let on = SessionFeatures(accountPins: true)
        let ix = SessionIndex(projects: [SessionProject(id: "p1", name: "Website", account: "lab")],
                              groups: [SessionGroup(id: "g1", name: "Release", account: "work"), SessionGroup(id: "g2", name: "Site", project: "p1"), SessionGroup(id: "g3", name: "Plain")],
                              features: on)
        XCTAssertEqual(OrganiseRules.draftAccount(ix, list, group: "g1", pick: "lab"), "lab", "its own pick wins")
        XCTAssertEqual(OrganiseRules.draftAccount(ix, list, group: "g1", pick: nil), "work", "the group's pin")
        XCTAssertEqual(OrganiseRules.draftAccount(ix, list, group: "g2", pick: nil), "lab", "the group's project")
        XCTAssertEqual(OrganiseRules.draftAccount(ix, list, group: "g3", pick: nil), "home", "nothing pinned, so the active account")
        XCTAssertEqual(OrganiseRules.draftAccount(ix, list, group: nil, pick: nil), "home")
        XCTAssertEqual(OrganiseRules.draftAccount(ix, list, group: "pinned", pick: nil), "home", "Pinned is a section, and its pin is set after the start")
        var off = ix
        off.features = nil
        XCTAssertEqual(OrganiseRules.draftAccount(off, list, group: "g1", pick: nil), "home", "a server that does not pin ignores the group's pin")
        XCTAssertNil(OrganiseRules.draftAccount(ix, nil, group: nil, pick: nil))
    }

    func testWhatTheComposerShowsForAChat() throws {
        let list = try accountList(#"{"accounts":[{"id":"work","name":"Work"},{"id":"home","name":"Home","active":true}]}"#)
        let on = SessionFeatures(accountPins: true)
        let own = SessionRow(id: "own", account: "work", accountPin: "work", accountOverflow: "home")
        let free = SessionRow(id: "free", account: "home")
        let chat = SessionRow(id: "chat", account: "work")
        let ix = SessionIndex(groups: [SessionGroup(id: "g1", name: "Release", sessions: [own, free], session: chat, account: "work")], features: on)

        let pinned = OrganiseRules.chatAccount(ix, list, id: "own")
        XCTAssertEqual(pinned, OrganiseRules.ChatAccount(offered: true, pin: "work", overflow: "home", shown: "work", follows: ""))
        let loose = OrganiseRules.chatAccount(ix, list, id: "free")
        XCTAssertEqual(loose, OrganiseRules.ChatAccount(offered: true, pin: nil, overflow: nil, shown: "home", follows: "Home"))
        let groupChat = OrganiseRules.chatAccount(ix, list, id: "chat")
        XCTAssertEqual(groupChat, OrganiseRules.ChatAccount(offered: false, pin: nil, overflow: nil, shown: "work", follows: ""), "a group's own chat shows its account and offers no pick")
        XCTAssertFalse(OrganiseRules.chatAccount(ix, nil, id: "own").offered, "accounts not read yet")
        XCTAssertFalse(OrganiseRules.chatAccount(ix, list, id: "missing").offered)

        let draft = OrganiseRules.chatAccount(ix, list, group: "g1", picked: nil)
        XCTAssertEqual(draft, OrganiseRules.ChatAccount(offered: true, pin: nil, overflow: nil, shown: "work", follows: "Work"))
        let picked = OrganiseRules.chatAccount(ix, list, group: "g1", picked: "home")
        XCTAssertEqual(picked, OrganiseRules.ChatAccount(offered: true, pin: "home", overflow: nil, shown: "home", follows: "Work"))
        let single = Array(list.prefix(1))
        XCTAssertFalse(OrganiseRules.chatAccount(ix, single, group: nil, picked: nil).offered, "one account is no choice")
    }

    func testTheSpillChoicesFollowThePagesRules() throws {
        let list = try accountList(#"{"accounts":[{"id":"work","name":"Work"},{"id":"home","name":"Home","chromeOn":"work"},{"id":"old","name":"Old","signedOut":true}]}"#)
        let none = try XCTUnwrap(OrganiseRules.accountSpill(list, pin: "work", overflow: nil))
        XCTAssertEqual(none.title, "If Work runs out")
        XCTAssertEqual(none.choices.map(\.label), ["Home (no Chrome)", "Old (signed out)", "Stay on Work"], "the pin is not its own overflow")
        XCTAssertEqual(none.choices.map(\.checked), [false, false, true])
        XCTAssertEqual(none.choices.map(\.picks), [true, false, false], "a signed out account cannot be picked, and staying is already chosen")
        XCTAssertEqual(none.choices.map(\.account), ["home", "old", nil])

        let spilling = try XCTUnwrap(OrganiseRules.accountSpill(list, pin: "work", overflow: "home"))
        XCTAssertEqual(spilling.choices.map(\.checked), [true, false, false])
        XCTAssertEqual(spilling.choices.map(\.picks), [false, false, true], "the chosen overflow runs nothing, and staying clears it")

        XCTAssertNil(OrganiseRules.accountSpill(list, pin: nil, overflow: nil))
        XCTAssertNil(OrganiseRules.accountSpill(list, pin: "gone", overflow: nil), "a pin to an account no longer listed has no name to spill from")
        XCTAssertNil(OrganiseRules.accountSpill(Array(list.prefix(1)), pin: "work", overflow: nil), "one account has nowhere to spill to")
    }
}
