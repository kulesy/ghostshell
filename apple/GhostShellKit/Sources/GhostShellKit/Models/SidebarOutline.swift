import Foundation

// The sidebar's rules with no UI in them, so the Mac, iPhone and Watch lists share one answer. They follow the page (public/ui/tree.js,
// sessions-list.js, search-rules.js), which sorts every list A to Z by title and keeps the server's order only for groups and earlier runs.

/// A section or group in the list. Routines hold `buckets`, every other section holds `rows`.
public struct OutlineSection: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable { case routines, pinned, group, started, ungrouped, other }
    /// The id the fold is kept under: `routines`, `pinned`, `started`, `ungrouped`, `other`, or the group's id.
    public var id: String
    public var title: String
    public var kind: Kind
    public var group: SessionGroup?
    public var rows: [SessionRow] = []
    public var buckets: [RoutineBucket] = []
    /// What the heading's badge says: every row with its nested ones, or for Routines the number of routines.
    public var count: Int
}

/// A routine that has never run, so the index has no row for it. Issue 92 reads these from `/api/routines`.
public struct IdleRoutine: Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var heading: String?
    public init(id: String, title: String, heading: String? = nil) { (self.id, self.title, self.heading) = (id, title, heading) }
}

/// The loose routines (`heading` nil) or the routines under one sub-heading, then the idle ones.
public struct RoutineBucket: Hashable, Sendable, Identifiable {
    public var heading: String?
    public var routines: [OutlineRoutine]
    public var idle: [IdleRoutine] = []
    /// The fold id the page uses for a sub-heading.
    public var id: String { heading.map { "routine-heading:\($0)" } ?? "routines-loose" }
}

public struct OutlineRoutine: Hashable, Sendable, Identifiable {
    public var id: String
    /// The latest run, titled with the routine's title.
    public var latest: SessionRow
    /// Older runs, newest first, as the server sent them.
    public var earlier: [SessionRow]
}

/// What a folded family shows in place of its head's own mark.
public struct FamilyNote: Hashable, Sendable {
    /// The most urgent nested mark when it outranks the head's, else nil.
    public var dot: SessionDot?
    public var label: String
}

public struct SearchHits: Hashable, Sendable {
    public var sessions: [SessionRow] = []
    /// Live hits that sit under another session.
    public var subSessions: [SessionRow] = []
    public var archived: [SessionRow] = []
    public init(sessions: [SessionRow] = [], subSessions: [SessionRow] = [], archived: [SessionRow] = []) {
        (self.sessions, self.subSessions, self.archived) = (sessions, subSessions, archived)
    }
}

/// What a view's lamp says: a session in it needs you, or is working.
public enum ViewLamp: Hashable, Sendable { case waiting, working }

/// Which view holds a session, so opening it can switch the sidebar there.
public enum ViewHolder: Hashable, Sendable {
    /// A project id, or nil for Home.
    case view(String?)
    /// Pinned rows show in every view, so nothing switches.
    case everyView
    case none
}

public enum SidebarOutline {
    public static let untitled = "Untitled session"
    public static let searchCap = 50

    // MARK: Order

    /// A to Z by title as `localeCompare` does it, untitled last, ties by id. Nested rows are ordered the same way.
    public static func titleOrder(_ rows: [SessionRow]) -> [SessionRow] {
        rows.map { row in
            var copy = row
            copy.children = titleOrder(row.children)
            return copy
        }
        .sorted(by: before)
    }

    private static func titled(_ row: SessionRow) -> String? { row.title.isEmpty || row.title == untitled ? nil : row.title }

    private static func before(_ a: SessionRow, _ b: SessionRow) -> Bool {
        switch (titled(a), titled(b)) {
        case (nil, nil): return a.id < b.id
        case (nil, _): return false
        case (_, nil): return true
        case let (x?, y?):
            let order = x.compare(y, locale: .current)
            return order == .orderedSame ? a.id < b.id : order == .orderedAscending
        }
    }

    // MARK: Views and sections

    /// The view to draw: the chosen project while the index still has it, else Home (nil).
    public static func view(_ chosen: String?, in index: SessionIndex) -> String? {
        chosen.flatMap { id in index.projects.contains { $0.id == id } ? id : nil }
    }

    /// What the view lists, in order. Home has Routines, Pinned, its groups, Started here, Ungrouped and Terminal and other.
    /// A project has Pinned and its groups. Only groups show when empty.
    /// `idleRoutines` are routines with no runs, which sit in Routines beside the ones that have run.
    public static func sections(_ index: SessionIndex, view chosen: String?, idleRoutines: [IdleRoutine] = []) -> [OutlineSection] {
        let shown = view(chosen, in: index)
        let groups = index.groups.filter { view($0.project, in: index) == shown }.map { group in
            let rows = titleOrder(group.sessions)
            return OutlineSection(id: group.id, title: group.name, kind: .group, group: group, rows: rows, count: withKids(rows).count)
        }
        func loose(_ id: String, _ title: String, _ kind: OutlineSection.Kind, _ list: [SessionRow]) -> [OutlineSection] {
            let rows = titleOrder(list)
            return rows.isEmpty ? [] : [OutlineSection(id: id, title: title, kind: kind, rows: rows, count: withKids(rows).count)]
        }
        let pinned = loose("pinned", "Pinned", .pinned, index.pinned)
        guard shown == nil else { return pinned + groups }
        return routines(index, idle: idleRoutines) + pinned + groups + loose("started", "Started here", .started, index.started)
            + loose("ungrouped", "Ungrouped", .ungrouped, index.ungrouped) + loose("other", "Terminal and other", .other, index.other)
    }

    /// True when a project has no groups, which the sidebar words as "No groups yet" rather than "No sessions found".
    public static func hasNoGroups(_ index: SessionIndex, view chosen: String?) -> Bool {
        guard let shown = view(chosen, in: index) else { return false }
        return !index.groups.contains { view($0.project, in: index) == shown }
    }

    private static func routines(_ index: SessionIndex, idle: [IdleRoutine]) -> [OutlineSection] {
        let all = index.routines.compactMap { run -> (title: String, routine: OutlineRoutine, heading: String?)? in
            guard var latest = run.latest else { return nil }
            latest.title = run.title ?? latest.title
            return (latest.title, OutlineRoutine(id: run.name, latest: latest, earlier: run.earlier), clean(run.heading))
        }
        // A run that is pinned or in a group still counts, as the page's unrunRoutines has it.
        let ran = Set(all.map(\.routine.id)).union(index.rows.compactMap(\.routine))
        let idle = idle.filter { !ran.contains($0.id) }.sorted { a, b in
            let order = headingOrder(a.title, b.title)
            return order == .orderedSame ? a.id < b.id : order == .orderedAscending
        }
        guard !all.isEmpty || !idle.isEmpty else { return [] }
        let ordered = all.sorted { before($0.routine.latest, $1.routine.latest) }
        let named = Set(ordered.compactMap(\.heading) + idle.compactMap { clean($0.heading) }).sorted { headingOrder($0, $1) == .orderedAscending }
        let buckets = ([nil] + named).map { heading in
            RoutineBucket(heading: heading, routines: ordered.filter { $0.heading == heading }.map(\.routine), idle: idle.filter { clean($0.heading) == heading })
        }
        return [OutlineSection(id: "routines", title: "Routines", kind: .routines, buckets: buckets.filter { !$0.routines.isEmpty || !$0.idle.isEmpty }, count: all.count + idle.count)]
    }

    // Case-insensitive and numeric, so "Job 2" comes before "Job 10".
    private static func headingOrder(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive, .numeric], range: nil, locale: Locale(identifier: "en"))
    }

    private static func clean(_ heading: String?) -> String? { heading.flatMap { $0.isEmpty ? nil : $0 } }

    private static func withKids(_ rows: [SessionRow]) -> [SessionRow] { rows.flatMap { [$0] + $0.children } }

    /// Which view holds a session. Routine runs and the loose lists are Home's.
    public static func holder(of id: String, in index: SessionIndex) -> ViewHolder {
        func has(_ rows: [SessionRow]) -> Bool { withKids(rows).contains { $0.id == id } }
        if has(index.pinned) { return .everyView }
        if let group = index.groups.first(where: { has($0.sessions) }) { return .view(view(group.project, in: index)) }
        return has(homeLoose(index)) ? .view(nil) : .none
    }

    /// The rows Home holds outside any group and Pinned: every routine run, Started here, Ungrouped and Terminal and other.
    private static func homeLoose(_ index: SessionIndex) -> [SessionRow] {
        index.routines.flatMap { ($0.latest.map { [$0] } ?? []) + $0.earlier } + index.started + index.ungrouped + index.other
    }

    // MARK: Families

    private static let ranked: [SessionDot?] = [nil, .ready, .running, .error, .awaiting]

    /// How urgent a row's mark is. A row with no mark yet ranks by its state, and an archived row ranks 0.
    public static func rank(_ row: SessionRow) -> Int {
        guard !row.archived else { return 0 }
        let byState = switch row.state { case .waiting: 4; case .working: 2; default: 0 }
        return max(row.dot.flatMap { dot in ranked.firstIndex { $0 == dot } } ?? 0, byState)
    }

    /// The folded family's mark and fold label. The label is "N nested session(s)", plus what the most urgent ones need when one outranks the head.
    public static func familyNote(_ head: SessionRow) -> FamilyNote {
        let plain = nested(head.children.count)
        let top = head.children.map(rank).max() ?? 0
        guard top > rank(head) else { return FamilyNote(dot: nil, label: plain) }
        let tail = switch top {
        case 4: "\(head.children.filter { rank($0) == 4 }.count) waiting on you"
        case 2: working(head.children)
        case 3: "some failed"
        default: "some unread"
        }
        return FamilyNote(dot: ranked[top], label: "\(plain), \(tail)")
    }

    /// "N nested session(s)", the words for a family's children.
    public static func nested(_ count: Int) -> String { "\(count) nested session\(count == 1 ? "" : "s")" }

    // The page counts children whose state is working, and says "some working" when that is none.
    private static func working(_ kids: [SessionRow]) -> String {
        let n = kids.filter { $0.state == .working }.count
        return n > 0 ? "\(n) working" : "some working"
    }

    // MARK: Views

    /// Waiting if a session in the view needs you, else working if one runs. Pinned rows are left out because they show in every view.
    public static func lamp(of view: String?, in index: SessionIndex) -> ViewLamp? {
        let states = viewRows(view, in: index).map(\.state)
        return states.contains(.waiting) ? .waiting : states.contains(.working) ? .working : nil
    }

    /// The sessions in a project, nested ones included, as the page counts them.
    public static func count(of project: String, in index: SessionIndex) -> Int { viewRows(project, in: index).count }

    /// The lamp across the views other than `shown`: waiting if one needs you, else working if one runs.
    public static func othersLamp(shown: String?, in index: SessionIndex) -> ViewLamp? {
        let lamps = ([nil] + index.projects.map { Optional($0.id) }).filter { $0 != shown }.compactMap { lamp(of: $0, in: index) }
        return lamps.contains(.waiting) ? .waiting : lamps.contains(.working) ? .working : nil
    }

    private static func viewRows(_ view: String?, in index: SessionIndex) -> [SessionRow] {
        if view == nil {
            let homeGroups = index.groups.filter { self.view($0.project, in: index) == nil }.flatMap(\.sessions)
            return withKids(homeGroups + homeLoose(index))
        }
        return withKids(index.groups.filter { self.view($0.project, in: index) == view }.flatMap(\.sessions))
    }

    // MARK: Words

    /// "now", "5 min", a clock time today, "Yesterday", a weekday within six days, else "8 Nov". Nothing for a missing time.
    public static func when(_ date: Date?, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        guard let date, date.timeIntervalSince1970 > 0 else { return "" }
        let diff = now.timeIntervalSince(date)
        if diff < 60 { return "now" }
        if diff < 3600 { return "\(Int((diff / 60).rounded())) min" }
        let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
        if calendar.isDate(date, inSameDayAs: now) { return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, calendar: calendar, timeZone: calendar.timeZone)) }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) { return "Yesterday" }
        return diff < 6 * 86400 ? date.formatted(style.weekday(.abbreviated)) : date.formatted(style.day().month(.abbreviated))
    }

    /// "7s", "2m 05s", "1h 05m".
    public static func duration(ms: Double) -> String {
        let seconds = max(0, Int(ms / 1000))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        return minutes < 60 ? "\(minutes)m \(String(format: "%02d", seconds % 60))s" : "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m"
    }

    /// The repo name for a worktree, nothing for the home folder, else the last two folders with the home folder written `~`.
    public static func folderName(_ cwd: String, home: String = NSHomeDirectory()) -> String {
        let parts = cwd.split(separator: "/").map(String.init)
        if let at = parts.indices.first(where: { $0 > 0 && $0 + 2 < parts.count && parts[$0] == ".claude" && parts[$0 + 1] == "worktrees" }) { return parts[at - 1] }
        if cwd == home { return "" }
        let shown = !home.isEmpty && cwd.hasPrefix(home) ? "~" + cwd.dropFirst(home.count) : cwd
        return shown.split(separator: "/").suffix(2).joined(separator: "/")
    }

    /// The row's hover text: folder, branch, the mark in words, then when. The time is dropped when it is already the shown title, as on an earlier run.
    public static func tooltip(_ row: SessionRow, title: String? = nil, home: String = NSHomeDirectory(), now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let word = switch row.dot {
        case .awaiting?: "Needs input"
        case .error?: "Failed"
        case .ready?: "Unread"
        default: switch row.state { case .working: "working"; case .waiting: "needs you"; case .active: "active"; default: "" }
        }
        let at = when(row.lastActivityAt, now: now, calendar: calendar, locale: locale)
        return [[folderName(row.cwd, home: home), row.branch, word].filter { !$0.isEmpty }.joined(separator: " · "), at == (title ?? row.title) ? "" : at]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: Search

    /// Rows where every word is inside "title cwd branch routine". Live hits are newest first by last activity, and archived hits keep the order the server sent.
    public static func search(_ query: String, in index: SessionIndex, archived: [SessionRow]) -> SearchHits {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return SearchHits() }
        func hits(_ rows: [SessionRow]) -> [SessionRow] {
            rows.filter { row in
                let text = "\(row.title) \(row.cwd) \(row.branch) \(row.routine ?? "")".lowercased()
                return words.allSatisfy(text.contains)
            }
        }
        let newest = hits(index.rows).enumerated().sorted { a, b in
            let (x, y) = (a.element.lastActivityAt ?? .distantPast, b.element.lastActivityAt ?? .distantPast)
            return x != y ? x > y : a.offset < b.offset
        }.map(\.element)
        return SearchHits(sessions: Array(newest.filter { $0.parent == nil }.prefix(searchCap)), subSessions: Array(newest.filter { $0.parent != nil }.prefix(searchCap)),
                          archived: Array(hits(archived).prefix(searchCap)))
    }
}
