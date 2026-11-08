import Foundation

// What the Routines page says, ported from public/ui/routine-rules.js with the page's own English. Times are words in the string's own offset, so a
// device in another zone reads the time the schedule means.

private let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
private let shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
private let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

private func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
private func clock(_ h: Int, _ m: Int) -> String { "\(pad(h)):\(pad(m))" }
private func and(_ items: [String]) -> String { items.count > 1 ? "\(items.dropLast().joined(separator: ", ")) and \(items.last!)" : items.first ?? "" }

private func ordinal(_ n: Int) -> String {
    if (11...13).contains(n % 100) { return "\(n)th" }
    return "\(n)\(["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0])"
}

private func isNumber(_ text: Substring) -> Bool { !text.isEmpty && text.allSatisfy { $0.isASCII && $0.isNumber } }

/// The values of a field made of numbers, lists and ranges, or nil for anything else, which includes a step.
private func numbers(_ text: String, _ min: Int, _ max: Int) -> [Int]? {
    var found = Set<Int>()
    for part in text.split(separator: ",", omittingEmptySubsequences: false) {
        let ends = part.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard ends.count <= 2, ends.allSatisfy(isNumber), let from = Int(ends[0]), let to = ends.count == 2 ? Int(ends[1]) : from else { return nil }
        guard from >= min, to <= max, from <= to else { return nil }
        found.formUnion(from...to)
    }
    return found.sorted()
}

private func daysOf(_ dow: String) -> String? {
    guard let values = numbers(dow, 0, 7) else { return nil }
    let list = Array(Set(values.map { $0 % 7 })).sorted { ($0 + 6) % 7 < ($1 + 6) % 7 }
    if list.isEmpty { return nil }
    if list.count == 7 { return "Every day" }
    if list == [1, 2, 3, 4, 5] { return "Weekdays" }
    if list == [6, 0] || list == [0, 6] { return "Weekends" }
    return list.count == 1 ? "\(days[list[0]])s" : and(list.map { shortDays[$0] })
}

private func timeOf(_ minute: String, _ hour: String) -> String? {
    let step: Int? = minute.hasPrefix("*/") && isNumber(minute.dropFirst(2)) ? Int(minute.dropFirst(2)) : nil
    if hour == "*", minute == "*" || step != nil {
        let every = minute == "*" ? 1 : step!
        if every == 1 { return "every minute" }
        return every > 0 && every < 60 && 60 % every == 0 ? "every \(every) minutes" : nil
    }
    guard let minutes = numbers(minute, 0, 59) else { return nil }
    if hour == "*" {
        guard minutes.count == 1 else { return nil }
        return minutes[0] == 0 ? "every hour, on the hour" : "every hour, at \(minutes[0]) \(minutes[0] == 1 ? "minute" : "minutes") past"
    }
    guard let hours = numbers(hour, 0, 23) else { return nil }
    let range = hour.split(separator: "-", omittingEmptySubsequences: false)
    if range.count == 2, range.allSatisfy(isNumber), hours.count > 3, minutes.count == 1 {
        return "every hour from \(clock(hours[0], minutes[0])) to \(clock(hours.last!, minutes[0]))"
    }
    let times = hours.flatMap { h in minutes.map { clock(h, $0) } }
    return times.count <= 6 ? "at \(and(times))" : nil
}

/// "12 min 17 s" for 737, in the units a person would say it in. Empty for none.
public func jitterWords(_ seconds: Int) -> String {
    let s = max(seconds, 0)
    return [(s / 3600, "h"), (s / 60 % 60, "min"), (s % 60, "s")].filter { $0.0 > 0 }.map { "\($0.0) \($0.1)" }.joined(separator: " ")
}

/// A schedule in plain words, or nil when it is not one of the plain shapes, so the screen shows the cron alone rather than a wrong sentence.
public func scheduleWords(_ cron: String, jitterSeconds: Int = 0) -> String? {
    let fields = cron.split(whereSeparator: \.isWhitespace).map(String.init)
    guard fields.count == 5 else { return nil }
    let (minute, hour, dom, month, dow) = (fields[0], fields[1], fields[2], fields[3], fields[4])
    guard month == "*" else { return nil }
    var day: String?
    if dom == "*" {
        day = daysOf(dow == "*" ? "0-6" : dow)
    } else if dow == "*" {
        day = numbers(dom, 1, 31).map { "The \(and($0.map(ordinal))) of each month" }
    }
    guard let day, let time = timeOf(minute, hour) else { return nil }
    let base = day == "Every day" && time.hasPrefix("every") ? time.prefix(1).uppercased() + time.dropFirst() : "\(day)\(time.hasPrefix("at ") ? " " : ", ")\(time)"
    let jitter = jitterWords(jitterSeconds)
    return jitter.isEmpty ? base : "\(base), plus \(jitter)"
}

/// "Today, 07:42", "Tomorrow, 07:42", "Yesterday, 07:42" or "Fri 24 Oct, 07:42", with the year only when it is not this one. It reads the clock as the Mac
/// wrote it. A time with no offset is read in the device's zone. Empty for no time.
public func fireTime(_ time: LocalTime?, now: Date = Date()) -> String {
    guard let time else { return "" }
    let offset = time.offsetMinutes ?? TimeZone.current.secondsFromGMT(for: now) / 60
    let today = Int(floor((now.timeIntervalSince1970 + Double(offset * 60)) / 86_400))
    let wanted = LocalTime.days(time.year, time.month, time.day)
    let at = clock(time.hour, time.minute)
    switch wanted - today {
    case 0: return "Today, \(at)"
    case 1: return "Tomorrow, \(at)"
    case -1: return "Yesterday, \(at)"
    default:
        let year = time.year == LocalTime.civil(today).year ? "" : " \(time.year)"
        return "\(shortDays[LocalTime.weekday(wanted)]) \(time.day) \(months[time.month - 1])\(year), \(at)"
    }
}

private func inSentence(_ text: String) -> String {
    ["Today,", "Tomorrow,", "Yesterday,"].contains { text.hasPrefix($0) } ? text.prefix(1).lowercased() + text.dropFirst() : text
}

/// What the scheduler recorded when it passed over a fire: "Skipped the run due yesterday, 07:42: the previous run is still working."
public func skippedWords(_ skipped: RoutineSkip?, now: Date = Date()) -> String {
    guard let skipped else { return "" }
    let due = fireTime(skipped.fireAt, now: now)
    return "Skipped the run\(due.isEmpty ? "" : " due \(inSentence(due))"): \(skipped.reason)."
}

/// A failed start that is queued to run again: "Retrying, next try at 07:43", with the day before the time when it is not today.
public func retryWords(_ retry: RoutineRetry, now: Date = Date()) -> String {
    guard let next = retry.nextAt else { return "Retrying" }
    // Past its time, the try is held back by a restart, a run still working or the limit.
    if next.date <= now { return "Retrying, next try soon" }
    let parts = fireTime(next, now: now).components(separatedBy: ", ")
    let on = parts[0] == "Today" ? "" : "\(["Tomorrow", "Yesterday"].contains(parts[0]) ? parts[0].lowercased() : parts[0]) "
    return "Retrying, next try \(on)at \(parts[1])"
}

/// What a queued retry's row says on hover, which is what the last try said, or nil when nothing is queued.
public func retryTip(_ routine: RoutineSummary) -> String? {
    routine.enabled && routine.retry != nil && !(routine.lastError ?? "").isEmpty ? "The last try said: \(routine.lastError!)" : nil
}

/// How long ago a run was, in a few words: "12 min ago", "3 h ago", "2 days ago", then the date as the Mac wrote it. Empty for no time.
public func ago(_ time: LocalTime?, now: Date = Date()) -> String {
    guard let time else { return "" }
    let minutes = max(0, Int(floor(now.timeIntervalSince(time.date) / 60)))
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes) min ago" }
    if minutes < 1440 { return "\(minutes / 60) h ago" }
    if minutes < 7 * 1440 {
        let n = minutes / 1440
        return "\(n) \(n == 1 ? "day" : "days") ago"
    }
    return "\(time.day) \(months[time.month - 1])\(time.year == Calendar.current.component(.year, from: now) ? "" : " \(time.year)")"
}

/// The quiet part of a routine's row in the sidebar: Off wins, then when it last ran, then that it has not. A try that failed before a session began
/// sets the time too, so an error with no session is a start that failed. One queued to retry says when it will.
public func idleWords(_ routine: RoutineSummary, now: Date = Date()) -> String {
    if !routine.enabled { return "Off" }
    if let retry = routine.retry { return retryWords(retry, now: now) }
    let last = ago(routine.lastRunAt, now: now)
    if last.isEmpty { return "Hasn't run yet" }
    return !(routine.lastError ?? "").isEmpty && (routine.lastSessionId ?? "").isEmpty ? "Couldn't start \(last)" : "Last run \(last)"
}

public func deleteDetail(_ routine: RoutineSummary) -> String {
    "It stops running. Its earlier runs stay in the list, and its prompt file stays at \(routine.file)."
}

/// What a server without routineFiles says of the prompt it loaded. A text that is not GhostShell's own is copied on the first save.
public func promptSource(_ prompt: RoutinePrompt) -> String {
    prompt.ours == false
        ? "Read from \(prompt.file). Saving copies it to \(prompt.copyTo ?? ""), and the file in Claude Desktop stays as it is."
        : "Read from and saved to \(prompt.file)"
}

// MARK: Order

/// The page's collator: case and accents ignored, digits counted as numbers.
func titleCompare(_ a: String, _ b: String) -> ComparisonResult {
    a.compare(b, options: [.caseInsensitive, .diacriticInsensitive, .numeric], range: nil, locale: Locale(identifier: "en"))
}

/// Title order, with the id breaking a tie.
public func routinesByTitle(_ routines: [RoutineSummary]) -> [RoutineSummary] {
    routines.sorted {
        let order = titleCompare($0.title.isEmpty ? $0.id : $0.title, $1.title.isEmpty ? $1.id : $1.title)
        return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
    }
}

/// The groups routines are in, each once, in name order. A routine with no row in the sidebar counts.
public func headingNames(_ routines: [RoutineSummary]) -> [String] {
    Set(routines.compactMap(\.heading).filter { !$0.isEmpty }).sorted { titleCompare($0, $1) == .orderedAscending }
}

/// The routines that have no row anywhere in the list, in title order. A run that is pinned, in a group or nested is still a run, so it counts.
/// Nothing is computed until both the index and the routines have arrived.
public func unrunRoutines(_ index: SessionIndex?, _ routines: [RoutineSummary]?) -> [RoutineSummary] {
    guard let index, let routines else { return [] }
    let seen = Set(index.rows.compactMap(\.routine).filter { !$0.isEmpty })
    return routinesByTitle(routines.filter { !seen.contains($0.id) })
}

// MARK: Form words

public let jitterProblem = "Use a whole number of seconds from 0 to 86399."

/// The jitter as a number, or nil when the text is not a whole number of seconds in range. Empty is 0.
public func jitterOf(_ text: String) -> Int? {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return 0 }
    guard isNumber(Substring(t)), let n = Int(t), n <= 86_399 else { return nil }
    return n
}

/// What the form says under the Prompt choice for the kind picked. `was` is the kind the routine was loaded on, or nil for a new routine.
public func promptHint(_ kind: PromptKind, was: PromptKind? = nil) -> String {
    if kind == .file {
        let read = "GhostShell reads the file at each run and never writes it, so you edit it outside GhostShell."
        return was == .text ? "\(read) GhostShell's own copy stays in its folder." : read
    }
    let own = "GhostShell keeps the text in its own folder, and you edit it here."
    return was == .file ? "\(own) The file stays as it is." : own
}
