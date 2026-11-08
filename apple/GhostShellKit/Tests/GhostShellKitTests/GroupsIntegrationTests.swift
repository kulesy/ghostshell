import XCTest
@testable import GhostShellKit

/// Reads from the scratch server `apple/scripts/test.mjs` starts, whose gh is a stub, so pulls come back empty.
final class GroupsIntegrationTests: XCTestCase {
    private func signedIn() async throws -> GhostShellClient {
        let env = ProcessInfo.processInfo.environment
        guard let text = env["GS_SCRATCH_ADDRESS"], let file = env["GS_SCRATCH_PASSWORD_FILE"] else { throw XCTSkip("No scratch server. Run apple/scripts/test.mjs.") }
        let address = try XCTUnwrap(ServerAddress(text))
        let password = try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let client = GhostShellClient(address: address, store: MemoryTokenStore())
        try await client.signIn(password: password)
        return client
    }

    func testSummariesAndPullsForTheSeededSessions() async throws {
        let client = try await signedIn()
        let index = try await client.sessionIndex()
        let ids = index.rows.map(\.id)
        XCTAssertFalse(ids.isEmpty)
        let found = try await client.summaries(ids: ids)
        XCTAssertFalse(found.isEmpty)
        XCTAssertTrue(found.values.allSatisfy { $0.ask != nil }, "a current server always sends ask")
        let detailed = try await client.summaries(ids: Array(ids.prefix(1)), detail: true)
        XCTAssertEqual(detailed.count, 1)
        let answer = try await client.pulls(ids: ids)
        XCTAssertTrue(answer.pulls.values.allSatisfy(\.isEmpty), "gh is stubbed")
        // Whatever came back must read as a card.
        for row in index.rows { _ = GroupRules.nextStep(row, heard: found[row.id], pull: nil) }
    }

    func testBookingAGroupSessionAndDismissingAMadeUpChip() async throws {
        let client = try await signedIn()
        var index = try await client.sessionIndex()
        guard index.features?.groupSessions == true else { throw XCTSkip("This server predates group chats.") }
        if index.groups.isEmpty {
            try await client.send("api/layout/group/add", json: ["name": "Integration group"])
            index = try await client.sessionIndex()
        }
        let group = try XCTUnwrap(index.groups.first, "the scratch server has a group")
        let id = try await client.groupSession(group.id)
        let again = try await client.groupSession(group.id)
        XCTAssertEqual(id, again, "booking twice finds the same chat")
        let after = try await client.sessionIndex()
        XCTAssertEqual(after.groups.first { $0.id == group.id }?.session?.id, id)
        XCTAssertEqual(GroupRules.groupOfChat(after, id)?.id, group.id)
        let chips = try await client.chips(sessionID: id)
        XCTAssertTrue(chips.isEmpty)
        let made = ChipRequest(sessionID: id, toolUseID: "toolu_made_up_\(UInt32.random(in: 0...999_999))", title: "Made up", tldr: "x", prompt: "p", cwd: nil, folder: "/tmp")
        let result = try await client.dismissChip(made)
        XCTAssertEqual(result.chip?.status, .dismissed)
        do { _ = try await client.dismissChip(made); XCTFail("a settled chip is refused") } catch GhostShellError.refused(let status, _, _, _) {
            XCTAssertEqual(status, 409)
        }
    }
}
