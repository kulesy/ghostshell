import Foundation

// NOTE: [8 Nov 2026] EK - These calls follow the routine and scheduled handlers in server.mjs, with lib/routines.mjs and lib/scheduled.mjs behind them.
// A refused write is `GhostShellError.refused`, with the server's `problems` for a form field. If a route, body or reply moves there, it moves here.
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
        (try await post("api/routines", json: request) as RoutineReply).routine
    }

    /// Saves only what `request(against:)` found changed. An empty request makes no call and returns nil.
    @discardableResult
    public func editRoutine(id: String, _ request: RoutineRequest) async throws -> RoutineSummary? {
        if request.isEmpty { return nil }
        return (try await patch(try routinePath(id), request) as RoutineReply).routine
    }

    /// Removes a routine. Its prompt file is left where it is.
    public func deleteRoutine(id: String) async throws {
        _ = try await data("DELETE", try routinePath(id))
    }

    /// Runs a routine now, and says which session it started. A routine that is still running refuses with a 409.
    public func runRoutine(id: String) async throws -> RoutineStarted {
        try await post(try routinePath(id, "run"), json: EmptyBody())
    }

    /// Pauses or resumes a routine. Resuming re-arms it from now.
    @discardableResult
    public func setRoutineEnabled(id: String, _ enabled: Bool) async throws -> RoutineSummary {
        (try await post(try routinePath(id, "enabled"), json: EnabledBody(enabled: enabled)) as RoutineReply).routine
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
        (try await post("api/scheduled", json: request) as ScheduledReply).scheduled
    }

    /// Edits a pending session with only what changed. An empty request makes no call and returns nil.
    @discardableResult
    public func editScheduled(id: String, _ request: ScheduledRequest) async throws -> ScheduledSummary? {
        if request.isEmpty { return nil }
        return (try await patch(try scheduledPath(id), request) as ScheduledReply).scheduled
    }

    /// Calls a pending session off. It stays in the list as cancelled.
    @discardableResult
    public func cancelScheduled(id: String) async throws -> ScheduledSummary {
        (try await post(try scheduledPath(id, "cancel"), json: EmptyBody()) as ScheduledReply).scheduled
    }

    /// Starts a pending session now, and says which session it started.
    public func startScheduled(id: String) async throws -> ScheduledStarted {
        try await post(try scheduledPath(id, "start"), json: EmptyBody())
    }

    public func deleteScheduled(id: String) async throws {
        _ = try await data("DELETE", try scheduledPath(id))
    }

    // MARK: Form helpers

    /// Folders the form offers: the home folder first, then recent ones that still exist.
    public func folders() async throws -> [String] {
        let list: FolderList = try await get("api/folders")
        return list.folders
    }

    /// Which parts of this feature the server has. A server that predates one leaves it out, so the screens hide that field.
    public func serverFeatures() async throws -> ServerFeatures {
        let reply: FeatureReply = try await get("api/sessions")
        return reply.features
    }

    // MARK: Inside

    private func patch<R: Decodable & Sendable>(_ path: String, _ body: some Encodable & Sendable) async throws -> R {
        try decode(try await data("PATCH", path, body: try JSONEncoder().encode(body), contentType: "application/json"))
    }

    // An id is a word of letters, digits, `_` and `-`, which is all the server accepts, so nothing else is put in a path.
    private func routinePath(_ id: String, _ action: String? = nil) throws -> String { try itemPath("api/routines", id, action) }
    private func scheduledPath(_ id: String, _ action: String? = nil) throws -> String { try itemPath("api/scheduled", id, action) }
    private func itemPath(_ root: String, _ id: String, _ action: String?) throws -> String {
        let id = try pathID(id)
        return action.map { "\(root)/\(id)/\($0)" } ?? "\(root)/\(id)"
    }
}

private struct EmptyBody: Encodable, Sendable {}
private struct EnabledBody: Encodable, Sendable { let enabled: Bool }

private struct RoutineReply: Decodable, Sendable { let routine: RoutineSummary }
private struct ScheduledReply: Decodable, Sendable { let scheduled: ScheduledSummary }
