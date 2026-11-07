import Foundation

// Routine and scheduled-session endpoints. Every write asks for the server's `{error, problems}` refusals, so a 400 or 409 reaches the screen as a
// `ServerRefusal`. A read that fails is a `GhostShellError` as everywhere else.
extension GhostShellClient {
    // MARK: Routines

    /// All routines, each with its next run and any skip, retry or problem the server reports.
    public func routines() async throws -> RoutineList {
        try await get("api/routines")
    }

    /// One routine's prompt, for the edit form. `error` is set when the file could not be read.
    public func routinePrompt(id: String) async throws -> RoutinePrompt {
        try await get(try routinePath(id, "prompt"))
    }

    /// Adds a routine from a draft's `request()`. Returns the routine as the server stored it.
    @discardableResult
    public func addRoutine(_ request: RoutineRequest) async throws -> RoutineSummary {
        try await write("POST", "api/routines", request, as: RoutineReply.self).routine
    }

    /// Saves only what `request(against:)` found changed. An empty request makes no call and returns nil.
    @discardableResult
    public func editRoutine(id: String, _ request: RoutineRequest) async throws -> RoutineSummary? {
        if request.isEmpty { return nil }
        return try await write("PATCH", try routinePath(id), request, as: RoutineReply.self).routine
    }

    /// Removes a routine. Its prompt file is left where it is.
    public func deleteRoutine(id: String) async throws {
        _ = try await data("DELETE", try routinePath(id), refusals: true)
    }

    /// Runs a routine now, and says which session it started. A routine that is still running refuses with a 409.
    public func runRoutine(id: String) async throws -> RoutineStarted {
        try await write("POST", try routinePath(id, "run"), EmptyBody(), as: RoutineStarted.self)
    }

    /// Pauses or resumes a routine. Resuming re-arms it from now.
    @discardableResult
    public func setRoutineEnabled(id: String, _ enabled: Bool) async throws -> RoutineSummary {
        try await write("POST", try routinePath(id, "enabled"), EnabledBody(enabled: enabled), as: RoutineReply.self).routine
    }

    /// The next three fires of a schedule, or the reason it never fires. A half-typed schedule is an ordinary answer, not an error.
    public func schedulePreview(cron: String, jitterSeconds: Int = 0) async throws -> SchedulePreview {
        try await get("api/schedule", query: [URLQueryItem(name: "cron", value: cron), URLQueryItem(name: "jitter", value: String(jitterSeconds))])
    }

    // MARK: Scheduled sessions

    /// All one-off scheduled sessions, pending and finished.
    public func scheduledSessions() async throws -> ScheduledList {
        try await get("api/scheduled")
    }

    @discardableResult
    public func addScheduled(_ request: ScheduledRequest) async throws -> ScheduledSummary {
        try await write("POST", "api/scheduled", request, as: ScheduledReply.self).scheduled
    }

    /// Edits a pending session with only what changed. An empty request makes no call and returns nil.
    @discardableResult
    public func editScheduled(id: String, _ request: ScheduledRequest) async throws -> ScheduledSummary? {
        if request.isEmpty { return nil }
        return try await write("PATCH", try scheduledPath(id), request, as: ScheduledReply.self).scheduled
    }

    /// Calls a pending session off. It stays in the list as cancelled.
    @discardableResult
    public func cancelScheduled(id: String) async throws -> ScheduledSummary {
        try await write("POST", try scheduledPath(id, "cancel"), EmptyBody(), as: ScheduledReply.self).scheduled
    }

    /// Starts a pending session now, and says which session it started.
    public func startScheduled(id: String) async throws -> ScheduledStarted {
        try await write("POST", try scheduledPath(id, "start"), EmptyBody(), as: ScheduledStarted.self)
    }

    public func deleteScheduled(id: String) async throws {
        _ = try await data("DELETE", try scheduledPath(id), refusals: true)
    }

    // MARK: Form helpers

    /// Folders the form offers: the home folder first, then recent ones that still exist.
    public func folders() async throws -> [String] {
        let list: FolderList = try await get("api/folders")
        return list.folders
    }

    /// What Default means for a folder's model, effort and mode.
    public func folderDefaults(cwd: String) async throws -> FolderDefaults {
        try await get("api/defaults", query: [URLQueryItem(name: "cwd", value: cwd)])
    }

    /// Which parts of this feature the server has. A server that predates one leaves it out, so the screens hide that field.
    public func serverFeatures() async throws -> ServerFeatures {
        let reply: FeatureReply = try await get("api/sessions")
        return reply.features
    }

    // MARK: Inside

    private func write<R: Decodable & Sendable>(_ method: String, _ path: String, _ body: some Encodable & Sendable, as: R.Type) async throws -> R {
        let reply = try await data(method, path, body: try JSONEncoder().encode(body), contentType: "application/json", refusals: true)
        do { return try JSONDecoder().decode(R.self, from: reply) } catch { throw GhostShellError.server(status: 0) }
    }

    // An id is a word of letters, digits, `_` and `-`, which is all the server accepts, so nothing else is put in a path.
    private func routinePath(_ id: String, _ action: String? = nil) throws -> String { try itemPath("api/routines", id, action) }
    private func scheduledPath(_ id: String, _ action: String? = nil) throws -> String { try itemPath("api/scheduled", id, action) }
    private func itemPath(_ root: String, _ id: String, _ action: String?) throws -> String {
        guard !id.isEmpty, id.unicodeScalars.allSatisfy({ $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0) || $0 == "_" || $0 == "-") }) else {
            throw GhostShellError.badPath(id)
        }
        return action.map { "\(root)/\(id)/\($0)" } ?? "\(root)/\(id)"
    }
}

private struct EmptyBody: Encodable, Sendable {}
private struct EnabledBody: Encodable, Sendable { let enabled: Bool }

private struct RoutineReply: Decodable, Sendable { let routine: RoutineSummary }
private struct ScheduledReply: Decodable, Sendable { let scheduled: ScheduledSummary }
