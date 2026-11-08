import XCTest
@testable import GhostShellKit

/// Changes the layout of the scratch server `apple/scripts/test.mjs` starts, and puts it back. It never reaches a real server.
/// Without the scratch environment every test here is skipped.
final class LayoutIntegrationTests: XCTestCase {
    private func signedIn() async throws -> GhostShellClient {
        let env = ProcessInfo.processInfo.environment
        guard let text = env["GS_SCRATCH_ADDRESS"], let file = env["GS_SCRATCH_PASSWORD_FILE"] else { throw XCTSkip("No scratch server. Run apple/scripts/test.mjs.") }
        let address = try XCTUnwrap(ServerAddress(text))
        let password = try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let client = GhostShellClient(address: address, store: MemoryTokenStore())
        try await client.signIn(password: password)
        return client
    }

    func testAGroupIsMadeRenamedFilledAndDeleted() async throws {
        let client = try await signedIn()
        let made = try await client.addGroup(name: "Layout test group", project: nil)
        var cleaned = false
        defer { if !cleaned { Task { _ = try? await client.removeGroup(made.id) } } }

        var index = try await client.sessionIndex()
        XCTAssertEqual(index.groups.first { $0.id == made.id }?.name, "Layout test group")

        try await client.renameGroup(made.id, name: "Layout test renamed")
        index = try await client.sessionIndex()
        XCTAssertEqual(index.groups.first { $0.id == made.id }?.name, "Layout test renamed")

        let session = try XCTUnwrap(index.rows.first { $0.group == nil && $0.parent == nil && !$0.pinned })
        try await client.moveSession(session.id, group: made.id)
        index = try await client.sessionIndex()
        XCTAssertEqual(index.groups.first { $0.id == made.id }?.sessions.map(\.id), [session.id])

        _ = try await client.removeGroup(made.id)
        cleaned = true
        index = try await client.sessionIndex()
        XCTAssertNil(index.groups.first { $0.id == made.id })
        XCTAssertNil(index.rows.first { $0.id == session.id }?.group, "its session is ungrouped, not deleted")
    }

    func testPinAndNestAndTheBulkWrite() async throws {
        let client = try await signedIn()
        var index = try await client.sessionIndex()
        let free = index.rows.filter { $0.group == nil && $0.parent == nil && !$0.pinned && $0.routine == nil }
        let (a, b) = try (XCTUnwrap(free.first), XCTUnwrap(free.dropFirst().first))

        try await client.pinSession(a.id)
        index = try await client.sessionIndex()
        XCTAssertTrue(index.pinned.contains { $0.id == a.id })
        try await client.moveSession(a.id, group: nil)
        index = try await client.sessionIndex()
        XCTAssertFalse(index.pinned.contains { $0.id == a.id }, "a move to the loose list unpins")

        try await client.nestSession(b.id, parent: a.id)
        index = try await client.sessionIndex()
        XCTAssertEqual(OrganiseRules.find(index, b.id)?.parent, a.id)
        try await client.nestSession(b.id, parent: nil)
        index = try await client.sessionIndex()
        XCTAssertNil(OrganiseRules.find(index, b.id)?.parent)

        let reply = try await client.placeSessions([a.id, b.id], to: .pinned)
        XCTAssertEqual(reply.count, 2)
        index = try await client.sessionIndex()
        XCTAssertEqual(Set(index.pinned.map(\.id)).intersection([a.id, b.id]).count, 2)
        _ = try await client.placeSessions([a.id, b.id], to: .group(nil))
        index = try await client.sessionIndex()
        XCTAssertTrue(index.pinned.isEmpty || !index.pinned.contains { [a.id, b.id].contains($0.id) })
    }

    func testAProjectIsMadeRenamedAndRemoved() async throws {
        let client = try await signedIn()
        let made = try await client.addProject(name: "Layout test project")
        defer { Task { _ = try? await client.removeProject(made.id) } }
        let group = try await client.addGroup(name: "Layout test inside", project: made.id)
        try await client.renameProject(made.id, name: "Layout test project 2")
        var index = try await client.sessionIndex()
        XCTAssertEqual(index.projects.first { $0.id == made.id }?.name, "Layout test project 2")
        XCTAssertEqual(index.groups.first { $0.id == group.id }?.project, made.id)

        try await client.removeProject(made.id)
        index = try await client.sessionIndex()
        XCTAssertNil(index.projects.first { $0.id == made.id })
        XCTAssertNil(index.groups.first { $0.id == group.id }?.project, "its group moves to Home")
        _ = try await client.removeGroup(group.id)
    }

    func testTheServerRefusesAnEmptyNameInItsOwnWords() async throws {
        let client = try await signedIn()
        do {
            _ = try await client.addGroup(name: "   ", project: nil)
            XCTFail("an empty name should be refused")
        } catch let GhostShellError.refused(status, message) {
            XCTAssertEqual(status, 400)
            XCTAssertFalse(message.isEmpty)
        }
    }
}
