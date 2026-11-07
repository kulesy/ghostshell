import XCTest
@testable import GhostShellKit

/// Reads from the scratch server `apple/scripts/test.mjs` starts. Only reads: update, force-restart, sign-in, switching and the rest are never called
/// here, because the server's restart helper runs `npm run restart` and a sign-in opens a browser on this Mac. Those buttons are tested against a stub.
final class AccountsIntegrationTests: XCTestCase {
    private func signedIn() async throws -> (GhostShellClient, ServerAddress) {
        let env = ProcessInfo.processInfo.environment
        guard let text = env["GS_SCRATCH_ADDRESS"], let file = env["GS_SCRATCH_PASSWORD_FILE"] else { throw XCTSkip("No scratch server. Run apple/scripts/test.mjs.") }
        let address = try XCTUnwrap(ServerAddress(text))
        let password = try String(contentsOfFile: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let client = GhostShellClient(address: address, store: MemoryTokenStore())
        try await client.signIn(password: password)
        return (client, address)
    }

    func testBannersAndAccountsDecode() async throws {
        let (client, _) = try await signedIn()
        let banners = try await client.banners()
        XCTAssertNotNil(banners.login, "the server always sends the login block")
        XCTAssertNotNil(banners.update)
        XCTAssertNotNil(banners.accounts)
        let list = try await client.accounts()
        XCTAssertFalse(list.accounts.isEmpty)
        XCTAssertEqual(list.accounts.filter(\.active).count, 1)
        XCTAssertTrue(list.accounts.allSatisfy { !$0.id.isEmpty && !$0.name.isEmpty })
        // The rules must draw whatever the server really sent.
        _ = bannerCards(banners)
        _ = list.accounts.map { signInLine($0) }
    }

    func testContextAndPlanForASeededSession() async throws {
        let (client, _) = try await signedIn()
        let index = try await client.sessionIndex()
        let id = try XCTUnwrap(index.rows.first?.id)
        let figure = try await client.context(sessionID: id, detail: .summary)
        // A seeded session has no running process, so the figure is from its transcript or there is none.
        XCTAssertTrue([.transcript, .none, .process].contains(figure.source), "source was \(figure.source)")
        if hasFigure(figure) { _ = readout(figure) }
        let plan = try await client.plan(sessionID: id)
        _ = planRows(plan.limits)
    }

    func testPasskeysListForTheScratchOrigin() async throws {
        let (client, address) = try await signedIn()
        let list = try await client.passkeys(origin: address.origin)
        XCTAssertTrue(list.passkeys.isEmpty)
    }
}
