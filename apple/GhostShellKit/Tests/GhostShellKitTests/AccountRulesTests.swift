import XCTest
@testable import GhostShellKit

final class AccountRulesTests: XCTestCase {
    private var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.locale = Locale(identifier: "en_US_POSIX")
        return c
    }
    private func at(_ iso: String) -> Date { try! Date(iso, strategy: .iso8601) }
    private func decode<T: Decodable>(_ json: String) -> T { try! JSONDecoder().decode(T.self, from: Data(json.utf8)) }

    private let now = try! Date("2026-11-08T12:00:00Z", strategy: .iso8601)

    // MARK: Format

    func testNumberWords() {
        XCTAssertEqual(thousands(14_300), "14.3k")
        XCTAssertEqual(thousands(500), "0.5k")
        XCTAssertEqual(windowSize(300_000), "300k")
        XCTAssertEqual(windowSize(200_000), "200k")
        XCTAssertEqual(windowSize(1_000_000), "1M")
        XCTAssertEqual(windowSize(1_500_000), "1.5M")
        XCTAssertEqual(windowSize(128_500), "128.5k")
        XCTAssertEqual(grouped(1_234_567), "1,234,567")
    }

    func testEndWordsAndDaysLeft() {
        XCTAssertEqual(endWords(at("2026-11-06T09:36:00Z"), calendar: utc), "Fri 6 Nov, 09:36")
        XCTAssertEqual(daysLeft(at("2026-11-08T23:59:00Z"), now: now, calendar: utc), 0)
        XCTAssertEqual(daysLeft(at("2026-11-09T00:01:00Z"), now: now, calendar: utc), 1)
        XCTAssertEqual(daysLeft(at("2026-11-13T00:01:00Z"), now: now, calendar: utc), 5)
        XCTAssertEqual(daysLeft(at("2026-11-07T08:00:00Z"), now: now, calendar: utc), -1)
    }

    // MARK: Sign-in

    func testSignInLineAndNeedsSignIn() {
        let out: Account = decode(#"{"id":"a","signedOut":true}"#)
        let ends: Account = decode(#"{"id":"a","endsAt":\#(Int(at("2026-11-06T09:36:00Z").timeIntervalSince1970 * 1000))}"#)
        let plain: Account = decode(#"{"id":"a"}"#)
        XCTAssertEqual(signInLine(out), "Signed out")
        XCTAssertEqual(signInLine(plain), "Signed in")
        XCTAssertEqual(signInLine(ends, calendar: utc), "Signed in until Fri 6 Nov, 09:36")
        XCTAssertTrue(needsSignIn(out, now: now))
        XCTAssertFalse(needsSignIn(plain, now: now))
        let soon: Account = decode(#"{"id":"a","endsAt":\#(Int((now.timeIntervalSince1970 + 5 * 86_400) * 1000))}"#)
        let later: Account = decode(#"{"id":"a","endsAt":\#(Int((now.timeIntervalSince1970 + 5 * 86_400 + 60) * 1000))}"#)
        XCTAssertTrue(needsSignIn(soon, now: now), "five days is still soon")
        XCTAssertFalse(needsSignIn(later, now: now))
    }

    func testAccountWords() {
        let list: AccountList = decode(#"{"accounts":[{"id":"a","name":"Work","sameAs":"b","pinned":{"sessions":2,"groups":1},"chromeOn":"b"},{"id":"b","name":"Home"}]}"#)
        let a = list.accounts[0]
        XCTAssertEqual(sameAccountWords(a, in: list), "This is the same Claude account as Home. The browser approved the sign-in page with the account it already had. Sign in again and approve it with a different account.")
        XCTAssertEqual(sameAccountWords(list.accounts[1], in: list), "")
        XCTAssertEqual(waitingWords(a), "Approve the sign-in page in the browser on the Mac, with the Claude account you want for Work.")
        XCTAssertEqual(pinnedWords(a.pinned), "Pinned: 2 sessions, 1 group")
        XCTAssertEqual(pinnedWords(Pins(sessions: 1, routines: 1)), "Pinned: 1 session, 1 routine")
        XCTAssertEqual(pinnedWords(Pins()), "")
        XCTAssertEqual(pinnedChromeWords(a, in: list.accounts), "Chrome is on Home, so these can't reach it.")
        XCTAssertEqual(pinnedChromeWords(list.accounts[1], in: list.accounts), "")
        XCTAssertTrue(accountsLead(list).hasSuffix("A switch leaves pinned work on its account."))
        let one: AccountList = decode(#"{"accounts":[{"id":"a","pinned":{"sessions":2}}]}"#)
        XCTAssertFalse(accountsLead(one).contains("pinned work"))
        XCTAssertEqual(outWords(OutOfUsage.sample), "Out of usage: Back at 5pm")
        XCTAssertEqual([ChatState.idle, .working, .waiting, .other("x")].map(chatStateWords), ["Idle", "Working", "Waiting for approval", "x"])
        XCTAssertEqual(cleanName("  Work \n  account  "), "Work account")
    }

    // MARK: Banners

    func testLoginCard() {
        XCTAssertNil(loginCard(nil, now: now, calendar: utc))
        XCTAssertNil(loginCard(decode(#"{"visible":false,"signedOut":true}"#), now: now, calendar: utc))
        let out = loginCard(decode(#"{"visible":true,"signedOut":true}"#), now: now, calendar: utc)
        XCTAssertEqual(out?.title, "Claude is signed out")
        XCTAssertEqual(out?.text, "Every chat and routine fails until you sign in again.")
        XCTAssertEqual(out?.warning, true)
        XCTAssertEqual(out?.action, BannerAction(label: "Sign in on the Mac"))
        let named = loginCard(decode(#"{"visible":true,"signedOut":true,"account":"Work"}"#), now: now, calendar: utc)
        XCTAssertEqual(named?.title, "Work is signed out")
        XCTAssertEqual(named?.text, "Chats and routines on Work fail until you sign in again.")
    }

    func testLoginCardEnding() {
        func ends(_ iso: String, _ extra: String = "") -> BannerCard? {
            loginCard(decode(#"{"visible":true,"endsAt":\#(Int(at(iso).timeIntervalSince1970 * 1000))\#(extra)}"#), now: now, calendar: utc)
        }
        XCTAssertEqual(ends("2026-11-08T20:00:00Z")?.title, "Claude's sign-in ends today")
        XCTAssertEqual(ends("2026-11-09T08:00:00Z")?.title, "Claude's sign-in ends tomorrow")
        XCTAssertEqual(ends("2026-11-12T08:00:00Z", #","account":"Work""#)?.title, "Work's sign-in ends in 4 days")
        XCTAssertEqual(ends("2026-11-12T08:00:00Z")?.text, "It ends on Thu 12 Nov, 08:00. Chats and routines stop until you sign in again. Signing in now starts a fresh four weeks.")
        XCTAssertEqual(ends("2026-11-12T08:00:00Z")?.warning, false)
        let waiting = ends("2026-11-12T08:00:00Z", #","stage":"waiting""#)
        XCTAssertEqual(waiting?.action, BannerAction(label: "Waiting for the Mac", busy: true))
        XCTAssertEqual(waiting?.progress, "Approve the sign-in page in the browser on the Mac.")
        XCTAssertEqual(ends("2026-11-12T08:00:00Z", #","stage":"failed","problem":"No browser""#)?.problem, "No browser")
        XCTAssertEqual(ends("2026-11-12T08:00:00Z", #","stage":"idle","problem":"old""#)?.problem, "")
    }

    func testUpdateCard() {
        let two: UpdateNotice = decode(#"{"show":true,"kind":"update","count":2,"restart":true,"changes":[{"title":"A"},{"title":"B"}]}"#)
        let card = updateCard(two)
        XCTAssertEqual(card?.title, "2 merged changes are waiting")
        XCTAssertEqual(card?.text, "Updating restarts GhostShell once no chat is running.")
        XCTAssertEqual(card?.action, BannerAction(label: "Update and restart"))
        XCTAssertNil(card?.force)
        XCTAssertNil(updateCard(decode(#"{"show":false}"#)))
        XCTAssertNil(updateCard(nil))

        let page = updateCard(decode(#"{"show":true,"kind":"update","count":1,"restart":false}"#))
        XCTAssertEqual(page?.title, "1 merged change is waiting")
        XCTAssertEqual(page?.text, "These change only the page, so updating needs no restart.")
        XCTAssertEqual(page?.action?.label, "Update")

        let pulled = updateCard(decode(#"{"show":true,"kind":"pulled","count":4,"blocked":"Held until 09:45."}"#))
        XCTAssertEqual(pulled?.title, "Pulled, waiting for a restart")
        XCTAssertEqual(pulled?.text, "Restarting GhostShell once no chat is running.")
        XCTAssertEqual(pulled?.action, BannerAction(label: "Restart", busy: false, blocked: true))
        XCTAssertEqual(pulled?.progress, "Held until 09:45.")

        let many = updateCard(decode(#"{"show":true,"kind":"update","count":8,"changes":[{"title":"1"},{"title":"2"},{"title":"3"},{"title":"4"},{"title":"5"},{"title":"6"},{"title":"7"}]}"#))
        XCTAssertEqual(many?.changes.count, 5)
        XCTAssertEqual(many?.more, 3)
    }

    func testUpdateProgressWords() {
        func card(_ json: String) -> BannerCard? { updateCard(decode(json)) }
        XCTAssertEqual(card(#"{"show":true,"stage":"updating","count":1}"#)?.progress, "Updating.")
        XCTAssertEqual(card(#"{"show":true,"stage":"updating","count":1}"#)?.action, BannerAction(label: "Updating", busy: true))
        XCTAssertEqual(card(#"{"show":true,"stage":"restarting","count":1,"busy":1}"#)?.progress, "Restarting once 1 running chat finishes.")
        XCTAssertEqual(card(#"{"show":true,"stage":"restarting","count":1,"busy":3}"#)?.progress, "Restarting once 3 running chats finish.")
        XCTAssertEqual(card(#"{"show":true,"stage":"restarting","count":1,"busy":0}"#)?.progress, "Restarting now.")
        XCTAssertEqual(card(#"{"show":true,"stage":"restarting","count":1}"#)?.action, BannerAction(label: "Restarting", busy: true))
        XCTAssertEqual(card(#"{"show":true,"count":1,"force":true}"#)?.force, "Force restart")
        XCTAssertEqual(card(#"{"show":true,"count":1,"problem":"Pull failed"}"#)?.problem, "Pull failed")
    }

    func testForceQuestion() {
        func ask(_ json: String) -> String { forceQuestion(decode(json)) }
        XCTAssertEqual(ask(#"{"kind":"pulled","busy":0}"#), "No chat is running, so none will be cut.")
        XCTAssertEqual(ask(#"{"kind":"pulled","busy":1}"#), "1 running chat will be cut.")
        XCTAssertEqual(ask(#"{"kind":"update","busy":2,"count":3}"#), "2 running chats will be cut. The 3 merged changes will be pulled first.")
        XCTAssertEqual(ask(#"{"kind":"update","busy":0,"count":1,"blocked":"x"}"#),
                       "No chat is running, so none will be cut. The 1 merged change will be pulled first. This goes ahead inside the quiet window, which holds restarts until 09:45 on weekdays.")
    }

    func testAccountBannerCards() {
        let n: AccountsNotice = decode(#"{"out":{"text":"Back at 5pm","name":"Work","to":{"id":"b","name":"Home"}},"auto":{"from":{"id":"a","name":"Work"},"to":{"id":"b","name":"Home"}}}"#)
        let out = outCard(n)
        XCTAssertEqual(out?.title, "Work is out of usage")
        XCTAssertEqual(out?.text, "Back at 5pm")
        XCTAssertEqual(out?.action?.label, "Switch to Home")
        XCTAssertEqual(out?.warning, true)
        let auto = autoCard(n)
        XCTAssertEqual(auto?.title, "Switched to Home")
        XCTAssertEqual(auto?.text, "Work ran out of usage, so new messages now go to Home.")
        XCTAssertEqual(auto?.dismiss, "Dismiss")
        XCTAssertNil(outCard(decode(#"{"out":{"text":"x","name":"Work"}}"#)), "no account to go to, no button to show")
        XCTAssertNil(autoCard(decode(#"{"auto":{"to":{"id":"b","name":"Home"}}}"#)))
        XCTAssertNil(autoCard(nil))
    }

    func testChromeCard() {
        let elsewhere = chromeCard(decode(#"{"state":"elsewhere","to":{"id":"a","name":"Work"},"on":{"id":"b","name":"Home"},"email":"w@example.com","opened":true}"#))
        XCTAssertEqual(elsewhere?.title, "Chrome is still on Home")
        XCTAssertEqual(elsewhere?.text, "Chats on Work can't use Chrome until the Claude extension is on Work too.")
        XCTAssertEqual(elsewhere?.steps, ["Press Log out in the settings.", "Log in with w@example.com, picking it on the sign-in page."])
        XCTAssertEqual(elsewhere?.caution, "Logging out deletes the extension's saved shortcuts and scheduled tasks.")
        XCTAssertEqual(elsewhere?.warning, true)
        XCTAssertEqual(elsewhere?.progress, "Opened on the Mac. This clears once Chrome is on Work.")
        XCTAssertEqual(elsewhere?.action?.label, "Open in Chrome on the Mac")
        XCTAssertEqual(elsewhere?.dismiss, "Dismiss")

        let unknown = chromeCard(decode(#"{"state":"unknown","to":{"id":"a","name":"Work"}}"#))
        XCTAssertEqual(unknown?.title, "Check Chrome is on Work")
        XCTAssertEqual(unknown?.text, "Chrome may be closed, or on another account. Chats on Work reach Chrome only when the Claude extension is on Work too.")
        XCTAssertEqual(unknown?.steps, ["Open the settings. If Chrome was only closed, this banner clears.", "If it stays, press Log out, then log in with the Work account."])
        XCTAssertEqual(unknown?.warning, false)
        XCTAssertEqual(unknown?.progress, "")
        XCTAssertNil(chromeCard(decode(#"{"checking":true}"#)))
        XCTAssertNil(chromeCard(nil))
    }

    func testCardsStackInTheSidebarOrder() {
        let all: Banners = decode("""
        {"login":{"visible":true,"signedOut":true},"update":{"show":true,"count":1},
         "accounts":{"out":{"text":"x","name":"W","to":{"id":"b","name":"H"}},"auto":{"from":{"id":"a","name":"W"},"to":{"id":"b","name":"H"}}},
         "chrome":{"state":"unknown","to":{"id":"b","name":"H"}}}
        """)
        XCTAssertEqual(bannerCards(all, now: now, calendar: utc).map(\.kind), [.login, .out, .auto, .chrome, .update])
        XCTAssertEqual(bannerCards(decode("{}"), now: now, calendar: utc), [])
    }

    func testPollingRate() {
        XCTAssertEqual(bannerPollInterval(nil), 15)
        XCTAssertEqual(bannerPollInterval(decode("{}")), 15)
        XCTAssertEqual(bannerPollInterval(decode(#"{"login":{"stage":"waiting"}}"#)), 2)
        XCTAssertEqual(bannerPollInterval(decode(#"{"update":{"stage":"updating"}}"#)), 2)
        XCTAssertEqual(bannerPollInterval(decode(#"{"update":{"stage":"restarting"}}"#)), 2)
        XCTAssertEqual(bannerPollInterval(decode(#"{"chrome":{"checking":true}}"#)), 2)
        XCTAssertEqual(bannerPollInterval(decode(#"{"update":{"stage":"idle"}}"#)), 15)
    }

    func testKeptWhileRestarting() {
        let restarting: Banners = decode(#"{"update":{"show":true,"stage":"restarting","busy":3,"force":true,"count":1}}"#)
        let kept = keptWhileRestarting(restarting)
        XCTAssertEqual(kept.update?.busy, 0)
        XCTAssertEqual(kept.update?.force, false)
        XCTAssertEqual(updateCard(kept.update)?.progress, "Restarting now.")
        XCTAssertNil(updateCard(kept.update)?.force)
        let idle: Banners = decode(#"{"update":{"show":true,"stage":"idle","busy":3,"force":true}}"#)
        XCTAssertEqual(keptWhileRestarting(idle), idle)
    }

    // MARK: Context and plan

    func testReadoutWithAWindow() {
        let r = readout(decode(#"{"source":"process","total":45000,"window":200000,"autoCompactAt":160000}"#))
        XCTAssertEqual(r.fill, 22.5)
        XCTAssertEqual(r.tick, 80)
        XCTAssertEqual(r.pct, "23%")
        XCTAssertNil(r.text)
        XCTAssertFalse(r.warning)
        XCTAssertEqual(r.size, "45.0k of 200k tokens")
        XCTAssertEqual(r.exact, "45,000 of 200,000 tokens, 23% used")
        XCTAssertEqual(r.tip, "Context: 45.0k of 200k tokens, 23% used")
        XCTAssertEqual(r.label, "Context: 45,000 of 200,000 tokens, 23% used")
        XCTAssertEqual(r.line, "23% used · auto-compact at 80%")
    }

    func testReadoutWarnsNineTenthsOfTheWayToCompaction() {
        func warns(_ total: Int, _ compact: String = "160000") -> Bool {
            readout(decode(#"{"source":"process","total":\#(total),"window":200000,"autoCompactAt":\#(compact)}"#)).warning
        }
        XCTAssertFalse(warns(143_999))
        XCTAssertTrue(warns(144_000))
        // With auto-compact off the window itself is the limit.
        XCTAssertFalse(warns(179_999, "null"))
        XCTAssertTrue(warns(180_000, "null"))
        XCTAssertEqual(readout(decode(#"{"source":"process","total":1,"window":200000}"#)).line, "<1% used · auto-compact off")
        XCTAssertEqual(readout(decode(#"{"source":"process","total":0,"window":200000}"#)).pct, "0%")
    }

    func testReadoutWithoutAWindowShowsTheCount() {
        let r = readout(decode(#"{"source":"transcript","total":14300}"#))
        XCTAssertNil(r.fill)
        XCTAssertEqual(r.text, "14.3k")
        XCTAssertEqual(r.label, "Context: 14.3k tokens")
        XCTAssertEqual(r.exact, "14,300 tokens")
        XCTAssertNil(r.line)
        XCTAssertFalse(r.warning)
        XCTAssertTrue(r.label.contains(r.text ?? "?"), "the button shows the text, so its label has to contain it")
    }

    func testHasFigure() {
        XCTAssertTrue(hasFigure(decode(#"{"source":"process","total":1}"#)))
        XCTAssertTrue(hasFigure(decode(#"{"source":"transcript","total":1}"#)))
        XCTAssertFalse(hasFigure(decode(#"{"source":"none"}"#)))
        XCTAssertFalse(hasFigure(decode(#"{"source":"process"}"#)))
        XCTAssertFalse(hasFigure(nil))
    }

    func testContextParts() {
        let c: ContextFigure = decode("""
        {"source":"process","total":45000,"window":200000,"categories":[{"id":"msgs","name":"Messages","tokens":30000},{"id":"sys","name":"System prompt","tokens":5000}],
         "buffer":{"name":"Autocompact buffer","tokens":40000},"free":{"name":"Free space","tokens":115000}}
        """)
        let parts = contextParts(c)
        XCTAssertEqual(parts.used.map(\.name), ["Messages", "System prompt"])
        XCTAssertEqual(parts.used.map(\.size), ["30.0k", "5.0k"])
        XCTAssertEqual(parts.used.map(\.share), ["15.0%", "2.5%"])
        XCTAssertEqual(parts.rest.map(\.name), ["Free space", "Autocompact buffer"])
        let noWindow: ContextFigure = decode(#"{"source":"process","total":1,"categories":[{"id":"m","name":"Messages","tokens":10}]}"#)
        XCTAssertEqual(contextParts(noWindow).used.first?.share, "")
    }

    func testMergeContext() {
        let full: ContextFigure = decode(#"{"source":"process","total":45000,"window":200000,"autoCompactAt":160000,"categories":[{"id":"m","name":"Messages","tokens":1}],"free":{"name":"Free","tokens":2}}"#)
        let same: ContextFigure = decode(#"{"source":"process","total":45000,"window":200000,"autoCompactAt":160000}"#)
        let moved: ContextFigure = decode(#"{"source":"process","total":46000,"window":200000,"autoCompactAt":160000}"#)
        let transcript: ContextFigure = decode(#"{"source":"transcript","total":45000,"window":200000}"#)
        // A summary of the same count keeps the parts the last full count gave.
        XCTAssertEqual(mergeContext(held: full, reply: same, detail: .summary), full)
        // A new total drops them until the next full count.
        XCTAssertNil(mergeContext(held: full, reply: moved, detail: .summary).categories)
        // A full count that did not come from the process leaves the process figure alone.
        XCTAssertEqual(mergeContext(held: full, reply: transcript, detail: .full), full)
        XCTAssertEqual(mergeContext(held: full, reply: transcript, detail: .summary).source, .transcript)
        XCTAssertEqual(mergeContext(held: nil, reply: same, detail: .summary), same)
        XCTAssertEqual(mergeContext(held: full, reply: full, detail: .full), full)
    }

    func testShouldAskFull() {
        let bare: ContextFigure = decode(#"{"source":"process","total":45000,"window":200000}"#)
        let full: ContextFigure = decode(#"{"source":"process","total":45000,"window":200000,"categories":[{"id":"m","name":"Messages","tokens":1}]}"#)
        let transcript: ContextFigure = decode(#"{"source":"transcript","total":45000,"window":200000}"#)
        XCTAssertTrue(shouldAskFull(open: true, figure: bare, failedAt: nil))
        // A different total failed before, so this one is still asked.
        XCTAssertTrue(shouldAskFull(open: true, figure: bare, failedAt: 44000))
        // The same total failed, so it is not asked again until the total moves or the popover reopens.
        XCTAssertFalse(shouldAskFull(open: true, figure: bare, failedAt: 45000))
        XCTAssertFalse(shouldAskFull(open: false, figure: bare, failedAt: nil))
        XCTAssertFalse(shouldAskFull(open: true, figure: full, failedAt: nil))
        XCTAssertFalse(shouldAskFull(open: true, figure: transcript, failedAt: nil))
        XCTAssertFalse(shouldAskFull(open: true, figure: nil, failedAt: nil))
    }

    func testPlanLabels() {
        func label(_ json: String) -> String { planLabel(decode(json)) }
        XCTAssertEqual(label(#"{"kind":"session"}"#), "Current session")
        XCTAssertEqual(label(#"{"kind":"weekly_all"}"#), "Weekly · All models")
        XCTAssertEqual(label(#"{"kind":"weekly_scoped","scope":"Opus"}"#), "Weekly · Opus")
        XCTAssertEqual(label(#"{"kind":"other","group":"daily","scope":"Sonnet"}"#), "Daily · Sonnet")
        XCTAssertEqual(label(#"{"kind":"other","group":"daily"}"#), "Daily")
    }

    func testPlanReset() {
        XCTAssertEqual(planReset(at("2026-11-08T11:59:00Z"), now: now, calendar: utc), "Resets now")
        XCTAssertEqual(planReset(at("2026-11-08T12:00:30Z"), now: now, calendar: utc), "Resets in 1 min")
        XCTAssertEqual(planReset(at("2026-11-08T14:05:00Z"), now: now, calendar: utc), "Resets in 2 hr 5 min")
        XCTAssertEqual(planReset(at("2026-11-08T15:00:00Z"), now: now, calendar: utc), "Resets in 3 hr")
        XCTAssertEqual(planReset(at("2026-11-09T11:59:00Z"), now: now, calendar: utc), "Resets in 23 hr 59 min")
        XCTAssertEqual(planReset(at("2026-11-12T09:30:00Z"), now: now, calendar: utc), "Resets Thu 9:30 am")
        XCTAssertEqual(planReset(at("2026-11-12T00:05:00Z"), now: now, calendar: utc), "Resets Thu 12:05 am")
        XCTAssertEqual(planReset(at("2026-11-12T21:00:00Z"), now: now, calendar: utc), "Resets Thu 9:00 pm")
    }

    func testPlanRows() {
        let rows: [PlanLimit] = decode("""
        [{"kind":"session","percent":42,"severity":"normal","resetsAt":"2026-11-08T14:05:00Z"},
         {"kind":"weekly_all","percent":91,"severity":"warning"},{"kind":"weekly_scoped","scope":"Opus","percent":99,"severity":"critical"}]
        """)
        let view = planRows(rows, now: now, calendar: utc)
        XCTAssertEqual(view.map(\.label), ["Current session", "Weekly · All models", "Weekly · Opus"])
        XCTAssertEqual(view.map(\.severity), [nil, .warning, .critical])
        XCTAssertEqual(view[0].text, "42% used, resets in 2 hr 5 min")
        XCTAssertEqual(view[1].text, "91% used")
        XCTAssertNil(view[1].reset)
        XCTAssertEqual(Set(view.map(\.id)).count, 3)
        XCTAssertEqual(planRows(nil), [])
    }

    // MARK: Passkeys

    func testPasskeyWords() {
        let used = at("2026-11-08T01:00:00Z")
        XCTAssertEqual(lastUsedWords(nil, now: now, calendar: utc), "Never used")
        XCTAssertEqual(lastUsedWords(used, now: now, calendar: utc), "Used today")
        XCTAssertEqual(lastUsedWords(at("2026-11-07T23:00:00Z"), now: now, calendar: utc), "Used yesterday")
        XCTAssertEqual(lastUsedWords(at("2026-11-01T23:00:00Z"), now: now, calendar: utc), "Used 7 days ago")
        XCTAssertTrue(lastUsedWords(at("2026-09-01T23:00:00Z"), now: now, calendar: utc).hasPrefix("Used "))
        XCTAssertFalse(lastUsedWords(at("2026-09-01T23:00:00Z"), now: now, calendar: utc).contains("days ago"))
        XCTAssertEqual(passkeyDevice(Passkey(id: "p")), "Unknown browser")
        XCTAssertEqual(passkeyDevice(Passkey(id: "p", device: "Safari")), "Safari")
    }
}

private extension OutOfUsage {
    static var sample: OutOfUsage { try! JSONDecoder().decode(OutOfUsage.self, from: Data(#"{"text":"Back at 5pm","at":1}"#.utf8)) }
}
