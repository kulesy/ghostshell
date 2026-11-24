import XCTest
@testable import GhostShellKit

/// Mirrors the chipAccount cases in test/account-pick-rules.test.mjs.
final class ChipAccountRulesTests: XCTestCase {
    private func account(_ id: String, _ name: String, signedOut: Bool = false, chromeOn: String? = nil) -> Account {
        let extra = (signedOut ? #","signedOut":true"# : "") + (chromeOn.map { #","chromeOn":"\#($0)""# } ?? "")
        return try! JSONDecoder().decode(Account.self, from: Data(#"{"id":"\#(id)","name":"\#(name)"\#(extra)}"#.utf8))
    }
    private var main: Account { account("main", "Main") }
    private var second: Account { account("second", "Second") }
    private let active = ChipAccountCard(account: "main", from: "active")
    private let group = ChipAccountCard(account: "second", from: "group", fromName: "Loose", choices: ["main": .init(account: "main"), "second": .init(account: "second")])

    func testNoLineWithOneAccountNoCardOrNothingToName() {
        XCTAssertNil(chipAccount(card: active, accounts: [main]))
        XCTAssertNil(chipAccount(card: nil, accounts: [main, second], named: "second"))
        XCTAssertNil(chipAccount(card: active, accounts: nil))
    }

    func testAChipWithNoAccountFollowsThePinsAndPostsNullWithTheAccountItConfirms() {
        let line = chipAccount(card: active, accounts: [main, second])!
        XCTAssertEqual([line.state.rawValue, line.by.rawValue, line.line, line.replaces], ["ok", "pins", "Starts on Main, the active account.", ""])
        XCTAssertTrue(line.ok)
        XCTAssertEqual(line.post, ChipAccountPost(account: nil, confirmAccount: "main"))
        let pinned = chipAccount(card: group, accounts: [main, second])!
        XCTAssertEqual(pinned.line, "Starts on Second, pinned to the group Loose.")
        XCTAssertEqual(pinned.post, ChipAccountPost(account: nil, confirmAccount: "second"))
    }

    func testThePickWinsOverTheChipAndTheChipWinsOverThePins() {
        let chip = chipAccount(card: group, accounts: [main, second], named: "main")!
        XCTAssertEqual([chip.by.rawValue, chip.id], ["chip", "main"])
        XCTAssertEqual(chip.post, ChipAccountPost(account: "main", confirmAccount: "main"))
        let picked = chipAccount(card: group, accounts: [main, second], named: "main", pick: .account("second"))!
        XCTAssertEqual([picked.by.rawValue, picked.id, picked.line], ["pick", "second", "Starts on Second, picked here."])
        let follow = chipAccount(card: group, accounts: [main, second], named: "main", pick: .follow)!
        XCTAssertEqual([follow.by.rawValue, follow.id], ["pins", "second"])
        XCTAssertEqual(follow.post, ChipAccountPost(account: nil, confirmAccount: "second"))
    }

    func testAChipThatNamesAnotherAccountThanItsPlacesPinSaysItReplacesThePin() {
        var withOverflow = group
        withOverflow.overflow = "main"
        let replaced = chipAccount(card: withOverflow, accounts: [main, second], named: "main")!
        XCTAssertEqual(replaced.replaces, "It does not follow the pin to Second on the group Loose, or its overflow to Main. It has no overflow account.")
        XCTAssertTrue(replaced.ok)
        XCTAssertEqual(chipAccount(card: group, accounts: [main, second], named: "second")!.replaces, "")
        XCTAssertEqual(chipAccount(card: active, accounts: [main, second], named: "second")!.replaces, "", "the active account is not a pin")
    }

    func testTheCardNamesTheHolderOfAPinByKindAndName() {
        func line(_ from: String, _ name: String?) -> String { chipAccount(card: ChipAccountCard(account: "second", from: from, fromName: name), accounts: [main, second])!.line }
        XCTAssertEqual(line("project", "Work"), "Starts on Second, pinned to the project Work.")
        XCTAssertEqual(line("session", "Maker"), "Starts on Second, pinned to the session \u{201C}Maker\u{201D}.")
        XCTAssertEqual(line("session", nil), "Starts on Second, pinned to the session it opens under.")
    }

    func testAPinTheAccountSpilledOffSaysWhichAccountItRunsOn() {
        let card = ChipAccountCard(account: "main", from: "group", fromName: "Loose", spill: "second")
        let line = chipAccount(card: card, accounts: [main, second])!
        XCTAssertEqual(line.line, "Starts on Main. Second, pinned to the group Loose, is out of usage, so it starts on Main until Second resets.")
        XCTAssertEqual(line.post, ChipAccountPost(account: nil, confirmAccount: "main"))
        let unlisted = chipAccount(card: ChipAccountCard(account: "main", from: "active", spill: "gone"), accounts: [main, second])!
        XCTAssertTrue(unlisted.line.contains("an account that is no longer listed, the active account, is out of usage"))
    }

    func testASpillOfAChosenAccountComesFromItsChoice() {
        let card = ChipAccountCard(account: "main", from: "active", choices: ["second": .init(account: "main", spill: "second")])
        let line = chipAccount(card: card, accounts: [main, second], named: "second")!
        XCTAssertEqual(line.id, "main")
        XCTAssertEqual(line.post, ChipAccountPost(account: "second", confirmAccount: "main"))
        XCTAssertEqual(line.line, "Starts on Main. Second, chosen by this chip, is out of usage, so it starts on Main until Second resets.")
    }

    func testASignedOutAccountStopsStartAndARemovedOneStopsItWithNoSignInState() {
        let out = chipAccount(card: active, accounts: [main, account("second", "Second", signedOut: true)], named: "second")!
        XCTAssertEqual([out.state.rawValue, out.id, out.line], ["signedOut", "second", "Second, chosen by this chip, is signed out. Sign it in, or pick another account."])
        XCTAssertFalse(out.ok)
        let activeOut = chipAccount(card: active, accounts: [account("main", "Main", signedOut: true), second])!
        XCTAssertEqual(activeOut.state, .signedOut)
        XCTAssertFalse(activeOut.ok)
        let named = chipAccount(card: active, accounts: [main, second], named: "gone")!
        XCTAssertEqual([named.state.rawValue, named.line], ["removed", "The account this chip names is no longer listed. Pick another."])
        XCTAssertFalse(named.ok)
        let pinned = chipAccount(card: ChipAccountCard(account: "gone", from: "group", fromName: "Loose"), accounts: [main, second])!
        XCTAssertEqual([pinned.state.rawValue, pinned.line], ["removed", "The pin it opens under is to an account that is no longer listed. Pick another."])
        XCTAssertEqual(chipAccount(card: ChipAccountCard(account: "gone", from: "group", blocked: "Blocked words."), accounts: [main, second])!.line, "Blocked words.")
    }

    func testTheMenuFollowsThePinsFirstListsEachAccountAndChecksTheCurrentChoice() {
        let accounts = [main, second]
        let pins = chipAccountItems(accounts: accounts, card: group, line: chipAccount(card: group, accounts: accounts)!)
        XCTAssertEqual(pins.map(\.label), ["Follow the pins", "Main", "Second"])
        XCTAssertEqual(pins.filter(\.checked).map(\.label), ["Follow the pins"])
        XCTAssertEqual(pins[0].value, "Second", "follow the pins runs as the account the pins give")
        let chosen = chipAccountItems(accounts: accounts, card: group, line: chipAccount(card: group, accounts: accounts, named: "main")!)
        XCTAssertEqual(chosen.filter(\.checked).map(\.label), ["Main"])
        XCTAssertEqual(chosen[0].pick, .follow)
        XCTAssertTrue(chosen[0].picks)
        XCTAssertFalse(chosen[1].picks, "the current choice has nothing to pick")
    }

    func testAMenuCannotPickASignedOutAccountButKeepsItWhenItIsTheChoice() {
        let accounts = [main, account("second", "Second", signedOut: true, chromeOn: nil)]
        let free = chipAccountItems(accounts: accounts, card: active, line: chipAccount(card: active, accounts: accounts)!)
        XCTAssertEqual(free[2].value, "Signed out")
        XCTAssertTrue(free[2].disabled)
        XCTAssertFalse(free[2].picks)
        let held = chipAccountItems(accounts: accounts, card: active, line: chipAccount(card: active, accounts: accounts, named: "second")!)
        XCTAssertEqual([held[2].checked, held[2].disabled], [true, false])
        let gone = chipAccountItems(accounts: [main, second], card: active, line: chipAccount(card: active, accounts: [main, second], named: "gone")!)
        XCTAssertEqual(gone.last?.label, "Removed account")
        XCTAssertEqual(gone.last?.picks, false)
    }

    func testThePinsKeyChangesWhenAGroupProjectOrSessionPinOrOverflowDoesAndNotOtherwise() {
        func index(group g: (String?, String?) = (nil, nil), project p: String? = nil, pin: String? = nil) -> SessionIndex {
            func field(_ k: String, _ v: String?) -> String { v.map { #","\#(k)":"\#($0)""# } ?? "" }
            let json = #"{"projects":[{"id":"p","name":"P"\#(field("account", p))}],"groups":[{"id":"g","name":"G"\#(field("account", g.0))\#(field("overflow", g.1)),"sessions":[{"id":"a"\#(field("accountPin", pin))}]}]}"#
            return try! JSONDecoder().decode(SessionIndex.self, from: Data(json.utf8))
        }
        XCTAssertEqual(pinsKey(nil), "")
        XCTAssertEqual(pinsKey(index()), pinsKey(index()))
        let keys = Set([index(), index(group: ("second", nil)), index(project: "second"), index(group: (nil, "main")), index(pin: "second")].map { pinsKey($0) })
        XCTAssertEqual(keys.count, 5)
    }
}
