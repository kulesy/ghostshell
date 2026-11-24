import Foundation

/// How far a session's send_session goes with no card. The page's three values: `family`, `project` and `any`.
/// An unknown word fails the decode, so it reads as a failed load and is never shown as one of the three.
public enum SendReach: String, Hashable, Sendable, Codable, CaseIterable {
    case family, project
    case anySession = "any"
}

private struct ReachReply: Decodable, Sendable { var sendReach: SendReach }
private struct ReachBody: Encodable, Sendable { var sendReach: SendReach }

// NOTE: [24 Nov 2026] EK - Never call setSendReach from a test or a script against a real server. The value decides which sessions can message each other with no card,
// so only the owner's own choice in the Settings control may write it. Tests use a stub or a scratch server.
extension GhostShellClient {
    public func sendReach() async throws -> SendReach {
        let reply: ReachReply = try await get("api/settings")
        return reply.sendReach
    }

    /// Answers with the value the server now holds.
    public func setSendReach(_ reach: SendReach) async throws -> SendReach {
        let reply: ReachReply = try await post("api/settings", json: ReachBody(sendReach: reach))
        return reply.sendReach
    }
}
