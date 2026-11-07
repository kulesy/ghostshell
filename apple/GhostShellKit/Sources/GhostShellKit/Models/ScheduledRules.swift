import Foundation

// What the Scheduled sessions page and Home's Scheduled section say, ported from public/ui/scheduled-rules.js. Times are the Mac's, as the server writes them.

/// How long until a time, in a few words: "in 3 days", "in 5 h", "in 12 min", "in under a minute", or "due now" once it has passed. Empty for no time.
public func untilWords(_ time: LocalTime?, now: Date = Date()) -> String {
    guard let time else { return "" }
    let seconds = time.date.timeIntervalSince(now)
    if seconds <= 0 { return "due now" }
    let minutes = Int(floor(seconds / 60))
    if minutes < 1 { return "in under a minute" }
    if minutes < 60 { return "in \(minutes) min" }
    if minutes < 1440 { return "in \(minutes / 60) h" }
    let days = minutes / 1440
    return "in \(days) \(days == 1 ? "day" : "days")"
}

public struct ScheduledNote: Hashable, Sendable {
    public enum Tone: Hashable, Sendable { case problem, warning }
    public var text: String
    public var tone: Tone?
}

/// What a row under its title says in Home: when a pending one starts, or why one that did not start is still here, with the tone to show it in.
public func noteOf(_ s: ScheduledSummary, now: Date = Date()) -> ScheduledNote {
    if s.status == "skipped" { return ScheduledNote(text: (s.lastError ?? "").isEmpty ? "Skipped" : "Skipped: \(s.lastError!)", tone: .problem) }
    if let problem = s.problem, !problem.isEmpty { return ScheduledNote(text: problem, tone: .problem) }
    if let retry = s.retry { return ScheduledNote(text: retryWords(retry, now: now), tone: .warning) }
    return ScheduledNote(text: "Starts \(fireTime(s.at, now: now))", tone: nil)
}

/// What the page says of an entry: the status, and for a pending one when it starts in words.
public func statusWords(_ s: ScheduledSummary, now: Date = Date()) -> String {
    switch s.status {
    case "started": "Started"
    case "skipped": "Skipped"
    case "cancelled": "Cancelled"
    case "pending": "Starts \(untilWords(s.at, now: now))"
    default: "Unknown status"
    }
}

/// The entries Home shows: those still to start, and those that were skipped, which stay with their reason until they are deleted. One the server found
/// a problem with stays too, such as a start that left no session.
public func inSidebar(_ list: [ScheduledSummary]) -> [ScheduledSummary] {
    list.filter { $0.status == "pending" || $0.status == "skipped" || !($0.problem ?? "").isEmpty }
}

private func byTime(_ a: ScheduledSummary, _ b: ScheduledSummary) -> Int {
    let (x, y) = (a.at?.date.timeIntervalSince1970 ?? 0, b.at?.date.timeIntervalSince1970 ?? 0)
    return x != y ? (x < y ? -1 : 1) : titleCompare(a.title.isEmpty ? a.id : a.title, b.title.isEmpty ? b.id : b.title).rawValue
}

/// The page's order: what is still to start, soonest first, then the rest, latest first.
public func ordered(_ list: [ScheduledSummary]) -> [ScheduledSummary] {
    list.filter { $0.status == "pending" }.sorted { byTime($0, $1) < 0 } + list.filter { $0.status != "pending" }.sorted { byTime($1, $0) < 0 }
}

/// Which menu items an entry in this state takes: only a pending one can start, change or be called off, and any can be deleted.
public func takes(_ s: ScheduledSummary) -> (start: Bool, edit: Bool, cancel: Bool) { (s.isPending, s.isPending, s.isPending) }

public func deleteDetail(_ s: ScheduledSummary) -> String {
    s.isPending ? "It will not start." : (s.sessionId ?? "").isEmpty ? "It is removed from this list." : "The session it started stays in the list."
}
