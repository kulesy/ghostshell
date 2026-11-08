import XCTest
@testable import GhostShellKit

final class ModelTests: XCTestCase {
    private let sample = """
    {
      "station": "desk", "problem": null, "future": {"x": 1},
      "pinned": [{"id": "p1", "title": "Pinned one", "state": "idle", "dot": "ready", "lastActivityAt": 3000, "sortAt": 3000, "pinned": true,
                  "children": [{"id": "k1", "title": "Child", "state": "working", "dot": "running", "parent": "p1", "lastActivityAt": 9000}]}],
      "groups": [{"id": "g1", "name": "Work", "sessions": [{"id": "a1", "title": "In a group", "group": "g1", "state": "waiting", "dot": "awaiting", "sortAt": 5000}, {"title": "no id"}]}],
      "routines": [{"name": "nightly", "title": "Nightly", "latest": {"id": "r1", "title": "Run", "state": "idle", "sortAt": 1000, "routine": "nightly"}, "earlier": []}],
      "started": [{"id": "s1", "title": "Started", "state": "dreaming", "dot": "glowing", "cwd": "/tmp/x", "branch": "main", "lastActivityAt": 4000, "archived": false}],
      "ungrouped": [{"id": "u1"}],
      "other": "not a list"
    }
    """

    func testDecodesWhatThePlainListNeeds() throws {
        let index = try JSONDecoder().decode(SessionIndex.self, from: Data(sample.utf8))
        XCTAssertEqual(index.station, "desk")
        XCTAssertNil(index.problem)
        XCTAssertEqual(index.groups.first?.sessions.map(\.id), ["a1"])
        XCTAssertEqual(index.pinned.first?.children.first?.parent, "p1")
        XCTAssertEqual(index.started.first?.cwd, "/tmp/x")
        XCTAssertEqual(index.started.first?.branch, "main")
        XCTAssertEqual(index.started.first?.lastActivityAt, Date(timeIntervalSince1970: 4))
        XCTAssertEqual(index.routines.first?.latest?.routine, "nightly")
        XCTAssertTrue(index.other.isEmpty)
    }

    func testUnknownWordsAndMissingFieldsDoNotFail() throws {
        let index = try JSONDecoder().decode(SessionIndex.self, from: Data(sample.utf8))
        let started = try XCTUnwrap(index.started.first)
        XCTAssertEqual(started.state, .other("dreaming"))
        XCTAssertEqual(started.dot, .other("glowing"))
        let bare = try XCTUnwrap(index.ungrouped.first)
        XCTAssertEqual(bare.title, "")
        XCTAssertNil(bare.dot)
        XCTAssertNil(bare.lastActivityAt)
        XCTAssertFalse(bare.pinned)
    }

    func testAnEmptyBodyIsAnEmptyIndex() throws {
        let index = try JSONDecoder().decode(SessionIndex.self, from: Data("{}".utf8))
        XCTAssertEqual(index, SessionIndex())
        XCTAssertTrue(index.rows.isEmpty)
    }

    private let chatSample = """
    {
      "groups": [{"id": "g1", "name": "Work", "session": {"id": "c1", "title": "Work chat", "state": "waiting"}, "sessions": [{"id": "a1"}]}, {"id": "g2", "name": "Bare"}],
      "sections": [{"id": "pinned", "session": {"id": "c2", "state": "working"}}, {"id": "started"}, {"nope": 1}],
      "features": {"groupSessions": true, "sectionSessions": true, "subStatus": true, "pullStatus": true, "future": true}
    }
    """

    func testSectionsDecodeWithAndWithoutAChatAndSkipABadEntry() throws {
        let index = try JSONDecoder().decode(SessionIndex.self, from: Data(chatSample.utf8))
        XCTAssertEqual(index.sections.map(\.id), ["pinned", "started"])
        XCTAssertEqual(index.sections.first?.session, GroupChat(id: "c2", state: .working))
        XCTAssertNil(index.sections.last?.session)
    }

    func testAGroupsOwnChatBecomesTheTargetsChat() throws {
        let index = try JSONDecoder().decode(SessionIndex.self, from: Data(chatSample.utf8))
        XCTAssertEqual(index.groups.first?.session?.id, "c1")
        XCTAssertEqual(GroupRules.target(index, "g1")?.chat, GroupChat(id: "c1", state: .waiting))
        XCTAssertNil(index.groups.last?.session)
        XCTAssertNil(GroupRules.target(index, "g2")?.chat)
    }

    func testTheGroupFeatureFlagsDecodeAndAnUnsentOneReadsFalse() throws {
        let features = try XCTUnwrap(JSONDecoder().decode(SessionIndex.self, from: Data(chatSample.utf8)).features)
        XCTAssertTrue(features.groupSessions && features.sectionSessions && features.subStatus && features.pullStatus)
        XCTAssertFalse(features.many || features.groupEdits || features.groupRename || features.accountPins)
    }

    func testAMissingFeaturesObjectIsNilAndAnEmptyOneIsAllFalse() throws {
        XCTAssertNil(try JSONDecoder().decode(SessionIndex.self, from: Data("{}".utf8)).features)
        let empty = try XCTUnwrap(JSONDecoder().decode(SessionIndex.self, from: Data(#"{"features": {}}"#.utf8)).features)
        XCTAssertEqual(empty, SessionFeatures())
    }

    func testRowsListEverySessionOnceNewestFirst() throws {
        let index = try JSONDecoder().decode(SessionIndex.self, from: Data(sample.utf8))
        XCTAssertEqual(index.rows.map(\.id), ["k1", "a1", "s1", "p1", "r1", "u1"])
    }
}
