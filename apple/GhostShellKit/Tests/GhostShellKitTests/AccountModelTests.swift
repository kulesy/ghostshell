import XCTest
@testable import GhostShellKit

final class AccountModelTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testAccountListDecodesEveryField() throws {
        let list: AccountList = try decode("""
        {"accounts":[{"id":"a1","name":"Work","stage":"waiting","signedOut":false,"endsAt":1788000000000,"problem":"","email":"w@example.com","planType":"Max",
          "sameAs":"a2","out":{"text":"Resets at 5pm","at":1787000000000},
          "plan":{"limits":[{"kind":"session","group":"session","percent":42,"resetsAt":"2026-11-08T10:00:00.000Z","scope":null,"severity":"warning"}],"at":1787000000000},
          "chromeOn":"a2","active":true,"first":true,"pinned":{"sessions":2,"groups":1,"projects":0,"routines":0},
          "chats":[{"id":"s1","title":"Fix it","state":"working"}]}],
         "autoSwitch":true,"auto":{"at":1787000000000,"from":{"id":"a1","name":"Work"},"to":{"id":"a2","name":"Home"}},
         "chrome":{"state":"elsewhere","to":{"id":"a1","name":"Work"},"on":{"id":"a2","name":"Home"},"email":"w@example.com","opened":true},"waiting":true}
        """)
        let a = try XCTUnwrap(list.accounts.first)
        XCTAssertEqual(a.stage, .waiting)
        XCTAssertEqual(a.endsAt, Date(timeIntervalSince1970: 1_788_000_000))
        XCTAssertEqual(a.email, "w@example.com")
        XCTAssertEqual(a.sameAs, "a2")
        XCTAssertEqual(a.out?.text, "Resets at 5pm")
        XCTAssertEqual(a.plan?.limits.first?.percent, 42)
        XCTAssertEqual(a.plan?.limits.first?.severity, .warning)
        XCTAssertNotNil(a.plan?.limits.first?.resetsAt)
        XCTAssertEqual(a.pinned.sessions, 2)
        XCTAssertEqual(a.chats.first?.state, .working)
        XCTAssertTrue(list.autoSwitch && list.waiting && a.active)
        XCTAssertEqual(list.auto?.to?.name, "Home")
        XCTAssertEqual(list.chrome?.state, .elsewhere)
        XCTAssertTrue(list.chrome?.opened ?? false)
    }

    func testMissingFieldsReadAsEmptyAndUnknownWordsAreKept() throws {
        let list: AccountList = try decode(#"{"accounts":[{"id":"a1","stage":"paused"},{"name":"no id"},{"id":"a3","chats":[{"id":"s","state":"asleep"},{"title":"no id"}]}],"extra":1}"#)
        XCTAssertEqual(list.accounts.map(\.id), ["a1", "a3"])
        XCTAssertEqual(list.accounts[0].stage, .other("paused"))
        XCTAssertEqual(list.accounts[0].name, "")
        XCTAssertFalse(list.accounts[0].signedOut)
        XCTAssertNil(list.accounts[0].endsAt)
        XCTAssertEqual(list.accounts[0].pinned, Pins())
        XCTAssertEqual(list.accounts[1].chats.map(\.state), [.other("asleep")])
        XCTAssertFalse(list.autoSwitch)
        XCTAssertNil(list.chrome)
    }

    func testPlanLimitReadsWholeNumbersWrittenAsFloatsAndKeepsUnknownSeverity() throws {
        let limit: PlanLimit = try decode(#"{"kind":"weekly_scoped","percent":87.0,"scope":"Opus","severity":"alarming"}"#)
        XCTAssertEqual(limit.percent, 87)
        XCTAssertEqual(limit.group, "")
        XCTAssertNil(limit.resetsAt)
        XCTAssertEqual(limit.severity, .other("alarming"))
        XCTAssertNotNil(try decode(#"{"kind":"session","percent":1,"resetsAt":"2026-11-08T10:00:00Z"}"#, as: PlanLimit.self).resetsAt)
    }

    func testBannersDecodeEveryKind() throws {
        let b: Banners = try decode("""
        {"login":{"signedOut":false,"endsAt":1788000000000,"stage":"failed","problem":"No browser","visible":true,"account":"Work","accountId":"a1"},
         "update":{"show":true,"kind":"update","stage":"restarting","count":3,"changes":[{"title":"One","url":"https://github.com/x/y/pull/1"},{"title":"Two","url":"javascript:alert(1)"}],
           "restart":true,"blocked":"","busy":2,"problem":"","force":true},
         "accounts":{"count":2,"out":{"text":"Out until 5pm","at":1787000000000,"name":"Work","to":{"id":"a2","name":"Home"}},"auto":null},
         "chrome":{"checking":true}}
        """)
        XCTAssertEqual(b.login?.stage, .failed)
        XCTAssertEqual(b.login?.accountId, "a1")
        XCTAssertEqual(b.update?.stage, .restarting)
        XCTAssertEqual(b.update?.busy, 2)
        XCTAssertEqual(b.update?.changes.first?.url?.absoluteString, "https://github.com/x/y/pull/1")
        XCTAssertNil(b.update?.changes.last?.url, "only an https link is offered")
        XCTAssertEqual(b.accounts?.out?.to?.id, "a2")
        XCTAssertNil(b.accounts?.auto)
        XCTAssertEqual(b.chrome?.checking, true)
        XCTAssertNil(b.chrome?.state)
    }

    func testEmptyBannersAndUnknownUpdateWords() throws {
        let none: Banners = try decode("{}")
        XCTAssertNil(none.login)
        XCTAssertNil(none.update)
        let odd: UpdateNotice = try decode(#"{"show":true,"kind":"rebase","stage":"thinking"}"#)
        XCTAssertEqual(odd.kind, .other("rebase"))
        XCTAssertEqual(odd.stage, .other("thinking"))
        XCTAssertEqual(odd.count, 0)
    }

    func testContextFigureNeedsOnlyASource() throws {
        let full: ContextFigure = try decode("""
        {"source":"process","total":45000,"window":200000,"autoCompactAt":160000,"model":"opus","at":1787000000000,"compacted":false,
         "categories":[{"id":"messages","name":"Messages","tokens":30000},{"name":"System prompt","tokens":5000.0}],
         "buffer":{"name":"Autocompact buffer","tokens":40000},"free":{"name":"Free space","tokens":115000}}
        """)
        XCTAssertEqual(full.categories?.map(\.id), ["messages", "System prompt"])
        XCTAssertEqual(full.categories?.last?.tokens, 5000)
        XCTAssertEqual(full.buffer?.tokens, 40000)
        let bare: ContextFigure = try decode(#"{"source":"transcript","total":900}"#)
        XCTAssertNil(bare.window)
        XCTAssertNil(bare.categories)
        XCTAssertEqual(try decode(#"{"source":"none"}"#, as: ContextFigure.self).source, .none)
        XCTAssertEqual(try decode(#"{"source":"dream"}"#, as: ContextFigure.self).source, .other("dream"))
        XCTAssertThrowsError(try decode(#"{"total":1}"#, as: ContextFigure.self))
    }

    func testPlanReplyAndPasskeys() throws {
        XCTAssertNil(try decode(#"{"limits":null}"#, as: PlanReply.self).limits)
        let reply: PlanReply = try decode(#"{"limits":[{"kind":"session","percent":10},{"nonsense":true}],"account":"Work"}"#)
        XCTAssertEqual(reply.limits?.count, 1)
        XCTAssertEqual(reply.account, "Work")
        let list: PasskeyList = try decode(#"{"available":true,"passkeys":[{"id":"p1","device":"Safari","rpId":"x.ts.net","created":"2026-11-01T00:00:00.000Z","used":null},{"id":"p2"}]}"#)
        XCTAssertTrue(list.available)
        XCTAssertEqual(list.passkeys.map(\.id), ["p1", "p2"])
        XCTAssertNil(list.passkeys[0].used)
        XCTAssertNotNil(list.passkeys[0].created)
        XCTAssertEqual(list.passkeys[1].device, "")
        XCTAssertEqual(try decode(#"{"passkeys":[]}"#, as: PasskeyList.self).available, false)
    }
}
