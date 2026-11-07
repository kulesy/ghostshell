import Foundation

// Session endpoints. A new area is a new file here, as an extension of GhostShellClient, so sessions working in parallel never share a file.
extension GhostShellClient {
    /// The session index. See SessionIndex for what it holds.
    public func sessionIndex() async throws -> SessionIndex {
        try await get("api/sessions")
    }

    /// The list, kept up to date. It reads `api/sessions` and never a session's own stream.
    public nonisolated func indexFeed() -> SessionIndexFeed {
        SessionIndexFeed { [self] in try await self.sessionIndex() }
    }

    /// One session's live events: `status`, `subagents`, `terminal`, `changed`, `outside` and the chat's own.
    ///
    /// NOTE: [7 Nov 2026] EK - The server marks a session read when its events stream opens (`events()` in server.mjs). Open this only for a
    /// session the person is looking at, never per row and never for the list.
    public nonisolated func eventStream(sessionID: String) -> EventStream {
        EventStream { [self] in
            guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
            return try await self.openStream("api/sessions/\(sessionID)/events")
        }
    }
}
