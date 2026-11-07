import Foundation

/// A regular expression compiled once. The patterns are literals in this folder, so a bad one is a bug found by the first test.
struct Rx: @unchecked Sendable {
    let re: NSRegularExpression
    init(_ pattern: String, _ options: NSRegularExpression.Options = []) { re = try! NSRegularExpression(pattern: pattern, options: options) }

    /// The capture groups of the first match, with "" for a group that did not take part. Nil when nothing matches.
    func groups(_ text: String) -> [String]? {
        guard let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (0..<m.numberOfRanges).map { Range(m.range(at: $0), in: text).map { String(text[$0]) } ?? "" }
    }

    func matches(_ text: String) -> Bool { re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil }

    func replacing(_ text: String, with template: String) -> String {
        re.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
}

/// The small text rules the page shares between its rows (format.js), so a chat reads the same here.
public enum ChatText {
    public static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String { "\(n) \(n == 1 ? one : (many ?? one + "s"))" }

    /// "12s", "3m 05s", "1h 02m".
    public static func duration(ms: Int) -> String {
        let s = max(0, ms / 1000)
        if s < 60 { return "\(s)s" }
        let m = s / 60
        return m < 60 ? "\(m)m \(String(format: "%02d", s % 60))s" : "\(m / 60)h \(String(format: "%02d", m % 60))m"
    }

    /// 950 is "950", 1200 is "1.2k", 14300 is "14k".
    public static func tokenCount(_ n: Int) -> String {
        if n < 1000 { return String(n) }
        if n < 10_000 { return String(format: "%.1f", Double(n) / 1000).replacingOccurrences(of: ".0", with: "") + "k" }
        return "\(Int((Double(n) / 1000).rounded()))k"
    }

    private static let modelNamed = Rx(#"(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?"#, .caseInsensitive)
    private static let modelAlias = Rx(#"^(opus|sonnet|haiku|fable)(\[1m\])?$"#, .caseInsensitive)

    public static func modelLabel(_ model: String) -> String {
        let long = model.lowercased().hasSuffix("[1m]") ? " (1M)" : ""
        func cap(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }
        if let g = modelNamed.groups(model) { return "\(cap(g[1])) \(g[2])\(g[3].isEmpty ? "" : "." + g[3])\(long)" }
        if let g = modelAlias.groups(model) { return "\(cap(g[1]))\(long)" }
        return model
    }

    /// Text as an HTML parser would show it: CR and CRLF become LF.
    public static func lf(_ text: String) -> String { text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n") }

    private static let stars = Rx(#"[*`]+"#)
    private static let hashes = Rx(#"^#+\s*"#, .anchorsMatchLines)
    private static let space = Rx(#"\s+"#)

    /// The start of a block of thinking, on one line.
    public static func preview(_ text: String) -> String {
        let flat = space.replacing(hashes.replacing(stars.replacing(text, with: ""), with: ""), with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return String(flat.prefix(160))
    }

    // MARK: Tool names

    private static let chrome = Rx(#"^mcp__claude[-_]in[-_]chrome__"#, .caseInsensitive)
    private static let uuid = Rx(#"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"#, .caseInsensitive)
    private static let serverID = Rx(#"^mcp__(.+)__"#)
    private static let mcpPrefix = Rx(#"^mcp__.+__"#)
    private static let separators = Rx(#"[_-]+"#)

    /// A Chrome tool's own name within its server, such as "navigate", or nil for any other tool.
    public static func chromeTool(_ name: String) -> String? {
        guard let m = chrome.re.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)), let r = Range(m.range, in: name) else { return nil }
        return String(name[r.upperBound...])
    }

    public static func toolLabel(_ name: String) -> String {
        (chromeTool(name) ?? mcpPrefix.replacing(name, with: "")).replacingOccurrences(of: "_", with: " ")
    }

    /// The MCP server a tool comes from as the page names it, or "" for a built-in tool or Capcom's own.
    public static func serverLabel(_ name: String, connectors: [String: String] = [:]) -> String {
        if chromeTool(name) != nil { return "Chrome" }
        let id = serverID.groups(name)?[1] ?? ""
        if id.hasPrefix("ccd_") { return "Desktop" }
        if id == "capcom" { return "" }
        if uuid.matches(id) { return connectors[id].flatMap { $0.isEmpty ? nil : $0 } ?? "connector" }
        let trimmed = id.hasPrefix("claude_ai_") ? String(id.dropFirst(10)) : id
        return separators.replacing(trimmed, with: " ").trimmingCharacters(in: .whitespaces)
    }

    public static func fullToolLabel(_ name: String, connectors: [String: String] = [:]) -> String {
        [serverLabel(name, connectors: connectors), toolLabel(name)].filter { !$0.isEmpty }.joined(separator: " ")
    }

    // MARK: Quotes

    public struct Quote: Hashable, Sendable {
        /// The session's title, "" for another session with no title, or nil for a quote with no From line.
        public var from: String?
        public var text: String
    }

    private static let fromLine = Rx(#"^From (?:the session "(.*)"|another session):$"#)

    /// The quotes a message opens with (`> ` lines, each block with an optional From line) and the rest of the text.
    public static func splitQuotes(_ text: String) -> (quotes: [Quote], text: String) {
        let lines = lf(text).components(separatedBy: "\n")
        var quotes: [Quote] = []
        var at = 0
        while at < lines.count {
            let from = fromLine.groups(lines[at])
            let start = from == nil ? at : at + 1
            guard start < lines.count, lines[start].hasPrefix(">") else { break }
            var end = start
            while end < lines.count, lines[end].hasPrefix(">") { end += 1 }
            let body = lines[start..<end].map { $0.hasPrefix("> ") ? String($0.dropFirst(2)) : String($0.dropFirst(1)) }.joined(separator: "\n")
            quotes.append(Quote(from: from.map { $0[1] }, text: body))
            at = end
            while at < lines.count, lines[at].trimmingCharacters(in: .whitespaces).isEmpty { at += 1 }
        }
        return quotes.isEmpty ? ([], text) : (quotes, lines[at...].joined(separator: "\n"))
    }
}

/// When a message was sent, as the page words it (sentAt in format.js).
public enum ChatTime {
    /// "3:05 PM" today, "Yesterday, 3:05 PM", "Tue, 3:05 PM" within six days, else "5 Nov, 3:05 PM" with the year added in another year.
    /// It counts from midnight, so the text never says "5 min ago" and never goes stale during a day.
    public static func sentAt(_ at: Date, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
        let clock = at.formatted(style.hour().minute())
        if calendar.isDate(at, inSameDayAs: now) { return clock }
        let today = calendar.startOfDay(for: now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        let day: String
        if calendar.isDate(at, inSameDayAs: yesterday) { day = "Yesterday" }
        else if today.timeIntervalSince(at) < 6 * 86_400 { day = at.formatted(style.weekday(.abbreviated)) }
        else if calendar.component(.year, from: at) == calendar.component(.year, from: now) { day = at.formatted(style.day().month(.abbreviated)) }
        else { day = at.formatted(style.day().month(.abbreviated).year()) }
        return "\(day), \(clock)"
    }

    /// How long until the next local midnight, which is when the words of a time can change.
    public static func untilMidnight(from now: Date = Date(), calendar: Calendar = .current) -> TimeInterval {
        let next = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now.addingTimeInterval(86_400)
        return max(1, next.timeIntervalSince(now))
    }
}
