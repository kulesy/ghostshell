import Foundation

// NOTE: [8 Nov 2026] EK - These types mirror lib/routines.mjs, lib/scheduled.mjs and the `routinesApi` and scheduled handlers in server.mjs.
// Decoding is lenient, as in SessionIndex.swift: a missing or renamed field reads as empty and never fails the whole list.

extension KeyedDecodingContainer {
    func lenient<T: Decodable>(_ key: Key) -> T? { try? decode(T.self, forKey: key) }
}

/// A fire the scheduler passed over, such as a run that was still working. The server keeps the last one until the next run.
public struct RoutineSkip: Hashable, Sendable, Decodable {
    public var fireAt: LocalTime?
    public var at: LocalTime?
    public var reason: String

    private enum Key: String, CodingKey { case fireAt, at, reason }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        fireAt = c.lenient(.fireAt)
        at = c.lenient(.at)
        reason = try c.decode(String.self, forKey: .reason)
    }
    public init(fireAt: LocalTime? = nil, at: LocalTime? = nil, reason: String) { (self.fireAt, self.at, self.reason) = (fireAt, at, reason) }
}

/// A start that failed and is queued to try again.
public struct RoutineRetry: Hashable, Sendable, Decodable {
    public var fireAt: LocalTime?
    public var tries: Int
    public var nextAt: LocalTime?

    private enum Key: String, CodingKey { case fireAt, tries, nextAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        fireAt = c.lenient(.fireAt)
        tries = c.lenient(.tries) ?? 0
        nextAt = c.lenient(.nextAt)
    }
    public init(fireAt: LocalTime? = nil, tries: Int = 0, nextAt: LocalTime? = nil) { (self.fireAt, self.tries, self.nextAt) = (fireAt, tries, nextAt) }
}

/// A routine as `api/routines` lists it. `cron` and `jitterSeconds` are the saved values, kept as the server wrote them.
public struct RoutineSummary: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var title: String
    public var heading: String?
    public var cron: String
    public var jitterSeconds: Int
    public var file: String
    public var cwd: String
    public var model: String?
    public var effort: String?
    public var mode: String?
    public var account: String?
    public var enabled: Bool
    public var armedAt: LocalTime?
    public var lastRunAt: LocalTime?
    public var lastSessionId: String?
    public var lastError: String?
    public var skipped: RoutineSkip?
    public var retry: RoutineRetry?
    public var running: Bool
    public var next: LocalTime?
    public var problem: String?

    private enum Key: String, CodingKey {
        case id, title, heading, cron, jitterSeconds, file, cwd, model, effort, mode, account, enabled, armedAt, lastRunAt, lastSessionId, lastError, skipped, retry, running, next, problem
    }

    /// Only the id is required. The title falls back to the id, as the server's does.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.lenient(.title) ?? id
        heading = c.lenient(.heading)
        cron = c.lenient(.cron) ?? ""
        jitterSeconds = c.lenient(.jitterSeconds) ?? 0
        file = c.lenient(.file) ?? ""
        cwd = c.lenient(.cwd) ?? ""
        model = c.lenient(.model)
        effort = c.lenient(.effort)
        mode = c.lenient(.mode)
        account = c.lenient(.account)
        enabled = c.lenient(.enabled) ?? false
        armedAt = c.lenient(.armedAt)
        lastRunAt = c.lenient(.lastRunAt)
        lastSessionId = c.lenient(.lastSessionId)
        lastError = c.lenient(.lastError)
        skipped = c.lenient(.skipped)
        retry = c.lenient(.retry)
        running = c.lenient(.running) ?? false
        next = c.lenient(.next)
        problem = c.lenient(.problem)
    }

    public init(id: String, title: String? = nil, heading: String? = nil, cron: String = "", jitterSeconds: Int = 0, file: String = "", cwd: String = "",
                model: String? = nil, effort: String? = nil, mode: String? = nil, account: String? = nil, enabled: Bool = false, armedAt: LocalTime? = nil,
                lastRunAt: LocalTime? = nil, lastSessionId: String? = nil, lastError: String? = nil, skipped: RoutineSkip? = nil, retry: RoutineRetry? = nil,
                running: Bool = false, next: LocalTime? = nil, problem: String? = nil) {
        (self.id, self.title, self.heading, self.cron, self.jitterSeconds, self.file, self.cwd) = (id, title ?? id, heading, cron, jitterSeconds, file, cwd)
        (self.model, self.effort, self.mode, self.account, self.enabled, self.armedAt) = (model, effort, mode, account, enabled, armedAt)
        (self.lastRunAt, self.lastSessionId, self.lastError, self.skipped, self.retry) = (lastRunAt, lastSessionId, lastError, skipped, retry)
        (self.running, self.next, self.problem) = (running, next, problem)
    }
}

/// The body of `api/routines`. `problem` is the server's own line when routines.json cannot be read.
public struct RoutineList: Hashable, Sendable, Decodable {
    public var routines: [RoutineSummary]
    public var problem: String?

    private enum Key: String, CodingKey { case routines, problem }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        routines = lossy(c, .routines)
        problem = c.lenient(.problem)
    }
    public init(routines: [RoutineSummary] = [], problem: String? = nil) { (self.routines, self.problem) = (routines, problem) }
}

/// A routine's prompt. `ours` is false when the file lives outside GhostShell's own routines folder. `error` is set when the file could not be read.
public struct RoutinePrompt: Hashable, Sendable, Decodable {
    public var file: String
    public var text: String
    public var ours: Bool?
    /// Only an older server sends this: where saving would copy a prompt that is not GhostShell's own.
    public var copyTo: String?
    public var error: String?

    private enum Key: String, CodingKey { case file, text, ours, copyTo, error }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        file = c.lenient(.file) ?? ""
        text = c.lenient(.text) ?? ""
        ours = c.lenient(.ours)
        copyTo = c.lenient(.copyTo)
        error = c.lenient(.error)
    }
    public init(file: String = "", text: String = "", ours: Bool? = true, copyTo: String? = nil, error: String? = nil) {
        (self.file, self.text, self.ours, self.copyTo, self.error) = (file, text, ours, copyTo, error)
    }
}

/// The reply of `api/schedule`: the next three fires, or the reason the schedule never fires. It reserves nothing.
public struct SchedulePreview: Hashable, Sendable, Decodable {
    public var next: [LocalTime]
    public var problem: String?

    private enum Key: String, CodingKey { case next, problem }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        next = lossy(c, .next)
        problem = c.lenient(.problem)
    }
    public init(next: [LocalTime] = [], problem: String? = nil) { (self.next, self.problem) = (next, problem) }
}

/// What Run now answers: the session it started and the routine as it now stands.
public struct RoutineStarted: Hashable, Sendable, Decodable {
    public var sessionId: String
    public var routine: RoutineSummary?
}

/// A one-off session set to start at a time. `status` is `pending`, `started`, `skipped` or `cancelled`, and any other word is kept.
public struct ScheduledSummary: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var title: String
    public var at: LocalTime?
    public var cwd: String
    public var prompt: String
    public var model: String?
    public var effort: String?
    public var mode: String?
    public var group: String?
    /// Nil when the group is gone.
    public var groupName: String?
    public var status: String
    public var sessionId: String?
    public var startedAt: LocalTime?
    public var lastError: String?
    public var retry: RoutineRetry?
    public var running: Bool
    public var problem: String?

    public var isPending: Bool { status == "pending" }

    private enum Key: String, CodingKey {
        case id, title, at, cwd, prompt, model, effort, mode, group, groupName, status, sessionId, startedAt, lastError, retry, running, problem
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.lenient(.title) ?? id
        at = c.lenient(.at)
        cwd = c.lenient(.cwd) ?? ""
        prompt = c.lenient(.prompt) ?? ""
        model = c.lenient(.model)
        effort = c.lenient(.effort)
        mode = c.lenient(.mode)
        group = c.lenient(.group)
        groupName = c.lenient(.groupName)
        status = c.lenient(.status) ?? ""
        sessionId = c.lenient(.sessionId)
        startedAt = c.lenient(.startedAt)
        lastError = c.lenient(.lastError)
        retry = c.lenient(.retry)
        running = c.lenient(.running) ?? false
        problem = c.lenient(.problem)
    }

    public init(id: String, title: String? = nil, at: LocalTime? = nil, cwd: String = "", prompt: String = "", model: String? = nil, effort: String? = nil,
                mode: String? = nil, group: String? = nil, groupName: String? = nil, status: String = "pending", sessionId: String? = nil,
                startedAt: LocalTime? = nil, lastError: String? = nil, retry: RoutineRetry? = nil, running: Bool = false, problem: String? = nil) {
        (self.id, self.title, self.at, self.cwd, self.prompt, self.model, self.effort, self.mode) = (id, title ?? id, at, cwd, prompt, model, effort, mode)
        (self.group, self.groupName, self.status, self.sessionId, self.startedAt) = (group, groupName, status, sessionId, startedAt)
        (self.lastError, self.retry, self.running, self.problem) = (lastError, retry, running, problem)
    }
}

/// The body of `api/scheduled`.
public struct ScheduledList: Hashable, Sendable, Decodable {
    public var scheduled: [ScheduledSummary]
    public var problem: String?

    private enum Key: String, CodingKey { case scheduled, problem }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        scheduled = lossy(c, .scheduled)
        problem = c.lenient(.problem)
    }
    public init(scheduled: [ScheduledSummary] = [], problem: String? = nil) { (self.scheduled, self.problem) = (scheduled, problem) }
}

/// What Start now answers on a scheduled session.
public struct ScheduledStarted: Hashable, Sendable, Decodable {
    public var sessionId: String
    public var scheduled: ScheduledSummary?
}

struct FolderList: Decodable, Sendable {
    let folders: [String]
    private enum Key: String, CodingKey { case folders }
    init(from decoder: Decoder) throws { folders = (try? decoder.container(keyedBy: Key.self).decode([String].self, forKey: .folders)) ?? [] }
}

/// What a folder's Default model, effort and mode follow (`api/defaults`): Claude Desktop's settings for that folder.
public struct FolderDefaults: Hashable, Sendable, Decodable {
    public var model: String?
    public var shownModel: String?
    public var effort: String?
    public var mode: String?

    private enum Key: String, CodingKey { case model, shownModel, effort, mode }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        (model, shownModel, effort, mode) = (c.lenient(.model), c.lenient(.shownModel), c.lenient(.effort), c.lenient(.mode))
    }
}

/// The parts of `features` in `api/sessions` that decide which fields and pages a server offers. A server that leaves one out does not have it.
public struct ServerFeatures: Hashable, Sendable, Decodable {
    public var routineEdits = false
    public var routineFiles = false
    public var routineHeadings = false
    public var scheduled = false
    public var accountPins = false

    private enum Key: String, CodingKey { case routineEdits, routineFiles, routineHeadings, scheduled, accountPins }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        routineEdits = c.lenient(.routineEdits) ?? false
        routineFiles = c.lenient(.routineFiles) ?? false
        routineHeadings = c.lenient(.routineHeadings) ?? false
        scheduled = c.lenient(.scheduled) ?? false
        accountPins = c.lenient(.accountPins) ?? false
    }
    public init() {}
}

struct FeatureReply: Decodable, Sendable {
    let features: ServerFeatures
    private enum Key: String, CodingKey { case features }
    init(from decoder: Decoder) throws { features = (try? decoder.container(keyedBy: Key.self).decode(ServerFeatures.self, forKey: .features)) ?? ServerFeatures() }
}
