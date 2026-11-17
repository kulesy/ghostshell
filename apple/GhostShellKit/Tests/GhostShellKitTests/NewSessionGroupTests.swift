import XCTest
@testable import GhostShellKit
@testable import GhostShellScreens

@MainActor
final class NewSessionGroupTests: XCTestCase {
    private func body(startingIn groups: [String?]) async throws -> [[String: Any]] {
        let address = ServerAddress("https://ghost.example.com")!
        let store = MemoryTokenStore()
        await store.save(String(repeating: "ab12", count: 16), for: address)
        let client = GhostShellClient(address: address, store: store, protocols: [Stub.self])
        Stub.reset { _ in (200, [:], #"{"id":"new-1"}"#, nil) }
        let model = ComposerModel.newSession(client: client, group: groups[0], refreshIndex: {}, started: { _ in })
        model.folder = "/work"
        var sent: [[String: Any]] = []
        for group in groups {
            model.group = group
            model.text = "go"
            await model.send()
            let request = try XCTUnwrap(Stub.requests().last)
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 1024); if n <= 0 { break }; data.append(buffer, count: n) }
            }
            sent.append(try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]))
        }
        return sent
    }

    func testTheGroupOfAScreenShownAgainIsTheOneThatIsSent() async throws {
        let sent = try await body(startingIn: [nil, "cg-1", nil])
        XCTAssertNil(sent[0]["group"])
        XCTAssertEqual(sent[1]["group"] as? String, "cg-1")
        XCTAssertNil(sent[2]["group"])
    }
}
