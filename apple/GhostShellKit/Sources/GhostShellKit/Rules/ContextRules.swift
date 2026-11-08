import Foundation

// Ported from public/ui/context-rules.js. Change them together.

public func hasFigure(_ c: ContextFigure?) -> Bool {
    guard let c else { return false }
    return (c.source == .process || c.source == .transcript) && c.total != nil
}

/// The ring, the bar and every line of words, from one figure. `fill` and `tick` are shares of the window from 0 to 100, or nil with no window.
/// With no window there is no ring, so the button shows `text` and its `label` has to contain it.
public struct ContextReadout: Hashable, Sendable {
    public var fill: Double?
    public var tick: Double?
    public var pct: String?
    public var text: String?
    public var warning: Bool
    public var size: String
    public var exact: String
    public var tip: String
    public var label: String
    public var line: String?
}

public func readout(_ c: ContextFigure) -> ContextReadout {
    let total = c.total ?? 0
    let window = c.window ?? 0
    let known = window != 0
    let fill: Double? = known ? min(100, Double(total) / Double(window) * 100) : nil
    let tick: Double? = known && (c.autoCompactAt ?? 0) != 0 ? min(100, Double(c.autoCompactAt ?? 0) / Double(window) * 100) : nil
    // Under half a percent rounds to 0%, which would read as empty.
    let pct: String? = fill.map { total > 0 && $0 < 0.5 ? "<1%" : "\(Int($0.rounded()))%" }
    // The meter turns amber nine tenths of the way to the point Claude compacts, or to the end of the window where it does not.
    let limit = c.autoCompactAt ?? c.window
    let exact = known ? "\(grouped(total)) of \(grouped(window)) tokens, \(pct ?? "") used" : "\(grouped(total)) tokens"
    let size = known ? "\(thousands(total)) of \(windowSize(window)) tokens" : "\(thousands(total)) tokens"
    let tip = "Context: \(known ? "\(size), \(pct ?? "") used" : size)"
    return ContextReadout(
        fill: fill, tick: tick, pct: pct,
        text: known ? nil : thousands(total),
        warning: (limit ?? 0) != 0 && Double(total) >= Double(limit ?? 0) * 0.9,
        size: size, exact: exact, tip: tip,
        label: known ? "Context: \(exact)" : tip,
        line: known ? "\(pct ?? "") used · \(tick.map { "auto-compact at \(Int($0.rounded()))%" } ?? "auto-compact off")" : nil)
}

/// Whether the open popover should ask for the full count: only while the parts are missing and the last full ask has not failed for this total.
public func shouldAskFull(open: Bool, figure: ContextFigure?, failedAt: Int?) -> Bool {
    guard open, let figure, figure.source == .process, figure.categories == nil, let total = figure.total else { return false }
    return failedAt != total
}

public struct ContextRow: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var size: String
    public var share: String
}

private func share(_ tokens: Int, _ window: Int?) -> String {
    guard let window, window != 0 else { return "" }
    return String(format: "%.1f%%", Double(tokens) / Double(window) * 100)
}

/// The rows of the table: what fills the window, and then the free space and the autocompact buffer, which are the rest of it.
public func contextParts(_ c: ContextFigure) -> (used: [ContextRow], rest: [ContextRow]) {
    func row(_ key: String, _ p: ContextPart) -> ContextRow { ContextRow(id: key, name: p.name, size: thousands(p.tokens), share: share(p.tokens, c.window)) }
    return ((c.categories ?? []).map { row($0.id, $0) }, [c.free, c.buffer].compactMap { $0 }.map { row($0.name, $0) })
}

/// The figure to keep once a reply arrives. A summary of the same total in the same window, with the same auto-compact point, keeps the parts the last full
/// count gave, so the table does not go back to loading. A full count that did not come from the process leaves the process figure as it was.
public func mergeContext(held: ContextFigure?, reply: ContextFigure, detail: ContextDetail) -> ContextFigure {
    let counted = reply.source == .process
    if !counted, detail == .full, let held, held.source == .process { return held }
    var next = reply
    if counted, detail != .full, let held, held.source == .process, held.categories != nil,
       held.total == reply.total, held.window == reply.window, held.autoCompactAt == reply.autoCompactAt {
        next.categories = held.categories
        next.buffer = held.buffer
        next.free = held.free
    }
    return held == next ? held ?? next : next
}

// MARK: Plan usage

private func capital(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

public func planLabel(_ row: PlanLimit) -> String {
    if row.kind == "session" { return "Current session" }
    if row.kind == "weekly_all" { return "Weekly · All models" }
    return [row.kind == "weekly_scoped" ? "Weekly" : capital(row.group), row.scope ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
}

/// A reset under a day away counts down. A later one gives the weekday and the clock.
public func planReset(_ resetsAt: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
    if resetsAt <= now { return "Resets now" }
    let minutes = Int((resetsAt.timeIntervalSince(now) / 60).rounded(.up))
    if minutes < 1440 {
        let hours = minutes / 60, rest = minutes % 60
        return "Resets in \([hours > 0 ? "\(hours) hr" : "", rest > 0 ? "\(rest) min" : ""].filter { !$0.isEmpty }.joined(separator: " "))"
    }
    let c = calendar.dateComponents([.weekday, .hour, .minute], from: resetsAt)
    let hour = (c.hour ?? 0) % 12 == 0 ? 12 : (c.hour ?? 0) % 12
    return "Resets \(dayNames[(c.weekday ?? 1) - 1]) \(hour):\(String(format: "%02d", c.minute ?? 0)) \((c.hour ?? 0) < 12 ? "am" : "pm")"
}

public struct PlanRow: Hashable, Sendable, Identifiable {
    public var id: String
    public var label: String
    public var percent: Int
    /// Nil for a normal row.
    public var severity: PlanSeverity?
    public var reset: String?
    public var text: String
}

public func planRows(_ rows: [PlanLimit]?, now: Date = Date(), calendar: Calendar = .current) -> [PlanRow] {
    (rows ?? []).enumerated().map { n, row in
        let reset = row.resetsAt.map { planReset($0, now: now, calendar: calendar) }
        return PlanRow(
            id: "\(row.kind)-\(row.scope ?? "")-\(n)", label: planLabel(row), percent: row.percent,
            severity: row.severity == .normal ? nil : row.severity, reset: reset,
            text: "\(row.percent)% used\(reset.map { ", \($0.prefix(1).lowercased() + $0.dropFirst())" } ?? "")")
    }
}
