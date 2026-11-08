import Foundation

/// A field of a request body in one of three states. A PATCH leaves an omitted key alone, clears a null one to Default and sets a value, so an
/// optional would lose the difference.
public enum Field<Value: Hashable & Sendable>: Hashable, Sendable {
    case omitted
    case null
    case value(Value)

    var isOmitted: Bool { self == .omitted }
}

extension KeyedEncodingContainer {
    mutating func put<T: Encodable & Hashable & Sendable>(_ field: Field<T>, _ key: Key) throws {
        switch field {
        case .omitted: break
        case .null: try encodeNil(forKey: key)
        case .value(let value): try encode(value, forKey: key)
        }
    }
}

private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

/// The empty string is Default, which the server stores as null.
private func orNull(_ text: String) -> Field<String> { text.isEmpty ? .null : .value(text) }

private func same(_ a: String, _ b: String?) -> Bool { a.isEmpty == (b ?? "").isEmpty && (a.isEmpty || a == b) }

// MARK: Routines

/// A routine's body for `POST api/routines` (every field) or `PATCH api/routines/<id>` (only what changed). `cron` and `jitterSeconds` are sent only
/// when the person changed them, because a changed one re-arms an enabled routine. `jitterSeconds` goes as a JSON integer.
public struct RoutineRequest: Encodable, Hashable, Sendable {
    public var title: Field<String> = .omitted
    public var heading: Field<String> = .omitted
    public var cron: Field<String> = .omitted
    public var jitterSeconds: Field<Int> = .omitted
    public var cwd: Field<String> = .omitted
    public var model: Field<String> = .omitted
    public var effort: Field<String> = .omitted
    public var mode: Field<String> = .omitted
    public var account: Field<String> = .omitted
    public var enabled: Field<Bool> = .omitted
    public var prompt: Field<String> = .omitted
    public var file: Field<String> = .omitted

    public init() {}

    /// Nothing to save, so no request is made.
    public var isEmpty: Bool { self == RoutineRequest() }

    private enum Key: String, CodingKey { case title, heading, cron, jitterSeconds, cwd, model, effort, mode, account, enabled, prompt, file }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.put(title, .title)
        try c.put(heading, .heading)
        try c.put(cron, .cron)
        try c.put(jitterSeconds, .jitterSeconds)
        try c.put(cwd, .cwd)
        try c.put(model, .model)
        try c.put(effort, .effort)
        try c.put(mode, .mode)
        try c.put(account, .account)
        try c.put(enabled, .enabled)
        try c.put(prompt, .prompt)
        try c.put(file, .file)
    }
}

public enum PromptKind: Hashable, Sendable { case text, file }

/// A routine and its prompt as they were loaded, for a draft to be compared with.
public struct RoutineBaseline: Hashable, Sendable {
    public var routine: RoutineSummary
    public var kind: PromptKind
    public var file: String
    public var prompt: String

    public init(_ routine: RoutineSummary, prompt: RoutinePrompt) {
        (self.routine, kind, file, self.prompt) = (routine, prompt.kind, prompt.file, prompt.text)
    }
}

extension RoutinePrompt {
    /// A prompt on a file elsewhere is one the server says is not its own. An older server that copies it on save says where to, and has no file choice.
    public var kind: PromptKind { ours == false && (copyTo ?? "").isEmpty ? .file : .text }
}

/// The routine form's fields as text, the way a person edits them. `request(against:)` turns it into the body to send.
public struct RoutineDraft: Hashable, Sendable {
    public var title = ""
    public var heading = ""
    public var cron = ""
    public var jitterSeconds = "0"
    public var cwd = ""
    public var model = ""
    public var effort = ""
    public var mode = ""
    public var account = ""
    public var promptKind = PromptKind.text
    public var file = ""
    public var prompt = ""
    public var enabled = true

    /// A new routine: the home folder, switched on, Default for the selects, no jitter, and GhostShell's own text.
    public init(home: String) { cwd = home }

    /// An edit: filled from the routine and its prompt. The text of a file elsewhere fills the box too, for a switch to GhostShell's own text.
    public init(_ routine: RoutineSummary, prompt loaded: RoutinePrompt) {
        (title, heading, cron, jitterSeconds, cwd) = (routine.title, routine.heading ?? "", routine.cron, String(routine.jitterSeconds), routine.cwd)
        (model, effort, mode, account) = (routine.model ?? "", routine.effort ?? "", routine.mode ?? "", routine.account ?? "")
        (promptKind, file, prompt, enabled) = (loaded.kind, loaded.kind == .file ? loaded.file : "", loaded.text, routine.enabled)
    }

    /// What is wrong before anything is sent, keyed by the API's field name. The jitter must be a whole number of seconds from 0 to 86399, as the page checks.
    public var localProblems: [String: String] { jitterOf(jitterSeconds) == nil ? ["jitterSeconds": jitterProblem] : [:] }

    /// With no baseline, a new routine's body with every field. With one, only what changed, so a folder that has since gone does not refuse a new title.
    /// The prompt goes as the text or as the path, never both. A switch of kind always sends the new kind, which is what moves the routine.
    /// The form checks `localProblems` first and sends nothing while it is not empty, so a jitter that cannot be read is left out here.
    public func request(against baseline: RoutineBaseline? = nil) -> RoutineRequest {
        let jitter = jitterOf(jitterSeconds)
        let title = trimmed(title)
        let heading = trimmed(heading)
        let cron = self.cron.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let cwd = trimmed(cwd)
        let path = trimmed(file)
        let text = promptKind == .text
        var r = RoutineRequest()
        guard let was = baseline?.routine, let baseline else {
            (r.title, r.cron, r.jitterSeconds, r.cwd) = (.value(title), .value(cron), .value(jitter ?? 0), .value(cwd))
            (r.model, r.effort, r.mode, r.enabled) = (orNull(model), orNull(effort), orNull(mode), .value(enabled))
            if !heading.isEmpty { r.heading = .value(heading) }
            if !account.isEmpty { r.account = .value(account) }
            if text { r.prompt = .value(prompt) } else { r.file = .value(path) }
            return r
        }
        if title != was.title { r.title = .value(title) }
        if !same(heading, was.heading) { r.heading = orNull(heading) }
        if cron != was.cron.split(whereSeparator: \.isWhitespace).joined(separator: " ") { r.cron = .value(cron) }
        if let jitter, jitter != was.jitterSeconds { r.jitterSeconds = .value(jitter) }
        if cwd != was.cwd { r.cwd = .value(cwd) }
        if !same(model, was.model) { r.model = orNull(model) }
        if !same(effort, was.effort) { r.effort = orNull(effort) }
        if !same(mode, was.mode) { r.mode = orNull(mode) }
        if !same(account, was.account) { r.account = orNull(account) }
        if enabled != was.enabled { r.enabled = .value(enabled) }
        if text, baseline.kind == .file || prompt != baseline.prompt { r.prompt = .value(prompt) }
        if !text, baseline.kind == .text || path != baseline.file { r.file = .value(path) }
        return r
    }
}

// MARK: Scheduled sessions

/// A scheduled session's body for `POST api/scheduled` (every field) or `PATCH api/scheduled/<id>` (only what changed).
public struct ScheduledRequest: Encodable, Hashable, Sendable {
    public var title: Field<String> = .omitted
    public var at: Field<String> = .omitted
    public var cwd: Field<String> = .omitted
    public var model: Field<String> = .omitted
    public var effort: Field<String> = .omitted
    public var mode: Field<String> = .omitted
    public var group: Field<String> = .omitted
    public var prompt: Field<String> = .omitted

    public init() {}

    public var isEmpty: Bool { self == ScheduledRequest() }

    private enum Key: String, CodingKey { case title, at, cwd, model, effort, mode, group, prompt }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.put(title, .title)
        try c.put(at, .at)
        try c.put(cwd, .cwd)
        try c.put(model, .model)
        try c.put(effort, .effort)
        try c.put(mode, .mode)
        try c.put(group, .group)
        try c.put(prompt, .prompt)
    }
}

/// `2026-11-09T09:00`: a time to the minute as the wall clock in `zone`, with no offset, as the web page sends it. The server reads that in its own zone, so
/// it applies its own daylight saving.
public func wallClock(_ date: Date, in zone: TimeZone) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    func two(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
    return "\(String(format: "%04d", p.year!))-\(two(p.month!))-\(two(p.day!))T\(two(p.hour!)):\(two(p.minute!))"
}

/// The scheduled form's fields. `at` is the instant picked, read as a wall clock in `zone`, the server's. It is compared with the saved one to the minute
/// so the seconds are never re-sent.
public struct ScheduledDraft: Hashable, Sendable {
    public var title = ""
    public var at: Date
    public let zone: TimeZone
    public var cwd = ""
    public var model = ""
    public var effort = ""
    public var mode = ""
    public var group = ""
    public var prompt = ""

    /// A new session: tomorrow at 09:00 in `zone` (the server's, or the device's when that is not known), and the home folder.
    public init(home: String, now: Date = Date(), zone: TimeZone = .current) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        self.zone = zone
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        at = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        cwd = home
    }

    /// An edit, in the zone offset the entry's time was saved with. An entry whose time cannot be read opens at `now`, and that time is sent because it
    /// differs from the saved one.
    public init(_ scheduled: ScheduledSummary, now: Date = Date()) {
        zone = scheduled.at?.offsetMinutes.flatMap { TimeZone(secondsFromGMT: $0 * 60) } ?? .current
        (title, at, cwd) = (scheduled.title, scheduled.at?.date ?? now, scheduled.cwd)
        (model, effort, mode, group, prompt) = (scheduled.model ?? "", scheduled.effort ?? "", scheduled.mode ?? "", scheduled.group ?? "", scheduled.prompt)
    }

    /// With no `was`, a new session's body with every field. With one, only what changed, so a folder that has since gone does not refuse a new title and
    /// a time that has passed is not checked again.
    public func request(against was: ScheduledSummary? = nil) -> ScheduledRequest {
        let title = trimmed(title)
        let cwd = trimmed(cwd)
        var r = ScheduledRequest()
        guard let was else {
            (r.title, r.at, r.cwd, r.prompt) = (.value(title), .value(wallClock(at, in: zone)), .value(cwd), .value(prompt))
            (r.model, r.effort, r.mode, r.group) = (orNull(model), orNull(effort), orNull(mode), orNull(group))
            return r
        }
        let minute = { (date: Date) in Int(floor(date.timeIntervalSince1970 / 60)) }
        if title != was.title { r.title = .value(title) }
        if was.at.map({ minute($0.date) }) != minute(at) { r.at = .value(wallClock(at, in: zone)) }
        if cwd != was.cwd { r.cwd = .value(cwd) }
        if !same(model, was.model) { r.model = orNull(model) }
        if !same(effort, was.effort) { r.effort = orNull(effort) }
        if !same(mode, was.mode) { r.mode = orNull(mode) }
        if !same(group, was.group) { r.group = orNull(group) }
        if trimmed(prompt) != trimmed(was.prompt) { r.prompt = .value(prompt) }
        return r
    }
}
