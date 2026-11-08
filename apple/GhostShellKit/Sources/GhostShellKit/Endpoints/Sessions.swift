import Foundation

// Session endpoints. A new area is a new file here, as an extension of GhostShellClient, so sessions working in parallel never share a file.
extension GhostShellClient {
    /// The session index. See SessionIndex for what it holds.
    public func sessionIndex() async throws -> SessionIndex {
        try await get("api/sessions")
    }

    /// Archived sessions, newest archived first. Search reads these. Opening one does not unarchive it.
    public func archivedSessions() async throws -> [SessionRow] {
        let list: ArchivedList = try await get("api/archived")
        return list.archived
    }

    /// The list, kept up to date. It reads `api/sessions` and never a session's own stream.
    public nonisolated func indexFeed() -> SessionIndexFeed {
        SessionIndexFeed { [self] in try await self.sessionIndex() }
    }

    /// One session's live events: `status`, `subagents`, `terminal`, `changed`, `outside` and the chat's own.
    ///
    /// NOTE: [7 Nov 2026] EK - Opening this stream marks the session read on the server. Open it only for the session on screen.
    public nonisolated func eventStream(sessionID: String) -> EventStream {
        EventStream { [self] in
            guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
            return try await self.openStream("api/sessions/\(sessionID)/events")
        }
    }
}

private struct ArchivedList: Decodable, Sendable {
    let archived: [SessionRow]
    private enum Key: String, CodingKey { case archived }
    init(from decoder: Decoder) throws { archived = lossy(try decoder.container(keyedBy: Key.self), .archived) }
}
