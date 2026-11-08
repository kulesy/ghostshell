import Foundation

// Ported from public/ui/group-rules.js, sub-panel-rules.js, sub-rules.js, pull-rules.js and pull-url.js, so a group's cards read the same in the app and on the page.
// Every rule here is pure. The server's rows are the index's, and `now` is passed in so a test can fix the clock.

/// The color a state, a next step or a pull request status is drawn in. The page colors the same words by the same names.
public enum GroupTone: String, Hashable, Sendable { case needs, error, working, ready, quiet, idle }

/// The parts of a group's list, most urgent first. Archived sessions are not in the index, so the list never shows that part.
public enum GroupBucket: String, CaseIterable, Hashable, Sendable {
    case needs, working, recent, idle, archived

    public var label: String {
        switch self {
        case .needs: "Waiting on you"
        case .working: "Working"
        case .recent: "Recent activity"
        case .idle: "Idle"
        case .archived: "Archived"
        }
    }

    /// The parts the list draws.
    public static let shown: [GroupBucket] = [.needs, .working, .recent, .idle]
}

/// A session and the sessions below it, to any depth, in the order the list shows them.
public struct SubLine: Hashable, Sendable, Identifiable {
    public var row: SessionRow
    public var subs: [SubLine]
    public var id: String { row.id }

    public init(row: SessionRow, subs: [SubLine] = []) { (self.row, self.subs) = (row, subs) }
}

/// How a list of sessions adds up. Archived sessions are left out of the counts.
public struct GroupRoll: Hashable, Sendable {
    public var total = 0, needs = 0, working = 0, recent = 0, idle = 0
    public init() {}
}

/// What the owner does next about a session, as the line under its pill.
public struct NextStep: Hashable, Sendable {
    public enum Source: Hashable, Sendable { case pending, error, pull, ask, working, said, done }
    public var text: String
    public var tone: GroupTone?
    public var source: Source
}

public struct StatePill: Hashable, Sendable {
    public var label: String
    public var tone: GroupTone
}

/// What a pull request asks of the owner. `you` is true when it is the owner's move.
public struct PullLine: Hashable, Sendable {
    public var you: Bool
    public var text: String
    public var tone: GroupTone
}

/// A group or one of Home's built-in sections, as its chat sees it.
public struct GroupTarget: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var isSection: Bool
    public var chat: GroupChat?
    /// The top level sessions it holds, as the sidebar lists them, each with its family under it.
    public var sessions: [SessionRow]

    public var kind: String { isSection ? "Section" : "Group" }
}

/// What a group's screen shows: its chat when the list has the group, and else why not.
public enum GroupPane: Hashable, Sendable {
    case unloaded
    case unsupported(kind: String)
    case missing(kind: String)
    case ready(GroupTarget)
}

/// A map that remembers the order its entries were stored in, so the oldest can be dropped. A reading on screen is never dropped, or it would be asked for again.
public struct Kept<Value: Sendable>: Sendable {
    public private(set) var values: [String: Value] = [:]
    private var order: [String] = []

    public init() {}
    public subscript(id: String) -> Value? { values[id] }
    public var count: Int { values.count }

    public mutating func set(_ id: String, _ value: Value) {
        order.removeAll { $0 == id }
        order.append(id)
        values[id] = value
    }

    public mutating func trim(keeping drawn: Set<String>, max: Int = GroupRules.kept) {
        for id in order where values.count > max && !drawn.contains(id) {
            values[id] = nil
        }
        order.removeAll { values[$0] == nil }
    }
}

/// What the server last said of one session's pull requests, and the stamp of the row it was read for.
public struct PullKept: Hashable, Sendable {
    public var stamp: String
    public var at: Date
    public var pulls: [PullStatus]
    public var settling: Bool

    public init(stamp: String, at: Date, pulls: [PullStatus], settling: Bool) { (self.stamp, self.at, self.pulls, self.settling) = (stamp, at, pulls, settling) }
}

public enum GroupRules {
    /// A session that is not archived, waiting or working counts as recent when it was written to within this long.
    public static let recentWindow: TimeInterval = 24 * 3600
    /// The most ids the server's summaries and pulls routes answer at once.
    public static let maxIDs = 60
    /// The most summaries and pull answers kept.
    public static let kept = 300
    /// How long a pull answer is trusted, and the most sessions asked about.
    public static let pullFresh: TimeInterval = 60
    public static let mostSessions = 120
    public static let waiting = "waiting on you"

    // MARK: Which group

    /// Home's built-in sections, in sidebar order. `pins` is true where a session started from the section's chat is pinned, and `starts` is false for a section whose chat cannot start one.
    public static let sections: [(id: String, name: String, pins: Bool, starts: Bool)] = [
        ("routines", "Routines", false, false), ("pinned", "Pinned", true, true), ("started", "Started here", false, true),
        ("ungrouped", "Ungrouped", false, true), ("other", "Terminal and other", false, false),
    ]

    public static func sectionName(_ id: String) -> String? { sections.first { $0.id == id }?.name }

    /// The top level rows of a section, as the sidebar draws them. A routine's runs come latest first, flattened.
    public static func sectionRows(_ index: SessionIndex, _ id: String) -> [SessionRow] {
        switch id {
        case "routines": index.routines.flatMap { ($0.latest.map { [$0] } ?? []) + $0.earlier }
        case "pinned": index.pinned
        case "started": index.started
        case "ungrouped": index.ungrouped
        case "other": index.other
        default: []
        }
    }

    public static func target(_ index: SessionIndex, _ id: String) -> GroupTarget? {
        if let name = sectionName(id) {
            guard let entry = index.sections.first(where: { $0.id == id }) else { return nil }
            return GroupTarget(id: id, name: name, isSection: true, chat: entry.session, sessions: sectionRows(index, id))
        }
        return index.groups.first { $0.id == id }.map { GroupTarget(id: $0.id, name: $0.name, isSection: false, chat: $0.session.map { GroupChat(id: $0.id, state: $0.state) }, sessions: $0.sessions) }
    }

    public static func pane(_ index: SessionIndex?, _ id: String) -> GroupPane {
        guard let index else { return .unloaded }
        let kind = sectionName(id) == nil ? "Group" : "Section"
        if index.features?.groupSessions != true || (kind == "Section" && index.features?.sectionSessions != true) { return .unsupported(kind: kind) }
        return target(index, id).map { .ready($0) } ?? .missing(kind: kind)
    }

    /// The group or section whose own chat this is, or nil.
    public static func groupOfChat(_ index: SessionIndex?, _ id: String) -> GroupTarget? {
        guard let index, !id.isEmpty else { return nil }
        if let entry = index.sections.first(where: { $0.session?.id == id }) { return target(index, entry.id) }
        return index.groups.first { $0.session?.id == id }.flatMap { target(index, $0.id) }
    }

    /// The words under an empty group.
    public static func emptyNote(_ target: GroupTarget) -> String {
        target.isSection ? "No sessions in this section right now." : "No sessions in this group yet. Move one in from its menu, or ask here to start one."
    }

    // MARK: Buckets

    public static func bucket(of row: SessionRow, now: Date = Date()) -> GroupBucket {
        if row.archived { return .archived }
        if row.state == .waiting || row.dot == .awaiting { return .needs }
        if row.state == .working { return .working }
        if row.state == .active { return .recent }
        if let at = row.lastActivityAt, now.timeIntervalSince(at) < recentWindow { return .recent }
        return .idle
    }

    private static func newestFirst(_ a: SessionRow, _ b: SessionRow) -> Bool {
        let (x, y) = (a.lastActivityAt ?? .distantPast, b.lastActivityAt ?? .distantPast)
        return x != y ? x > y : a.id < b.id
    }

    // MARK: Families

    /// The rows with the sessions nested under each, flat.
    public static func withKids(_ rows: [SessionRow]) -> [SessionRow] { rows.flatMap { [$0] + $0.children } }

    /// Every row the index lists, families flattened. The group chats' own sessions are not rows.
    public static func everyRow(_ index: SessionIndex) -> [SessionRow] { index.rows }

    private static func underParent(_ rows: [SessionRow]) -> [String: [SessionRow]] {
        var under: [String: [SessionRow]] = [:]
        for row in rows { if let parent = row.parent { under[parent, default: []].append(row) } }
        return under
    }

    /// Every session below `id` at any depth, nearest first. A session is met once, so a loop in the links ends the walk.
    public static func descendants(_ rows: [SessionRow], of id: String) -> [SessionRow] {
        let under = underParent(rows)
        var seen: Set<String> = [id]
        var found: [SessionRow] = []
        var queue = [id]
        while !queue.isEmpty {
            for row in under[queue.removeFirst()] ?? [] where seen.insert(row.id).inserted {
                found.append(row)
                queue.append(row.id)
            }
        }
        return found
    }

    private static func place(_ line: SubLine, now: Date) -> Int {
        ([GroupBucket.allCases.firstIndex(of: bucket(of: line.row, now: now)) ?? 4] + line.subs.map { place($0, now: now) }).min() ?? 4
    }

    /// Lines that need the owner first, then working, recent and idle, judged by the most urgent session in the line and under it. Newest first in each part.
    public static func ordered(_ lines: [SubLine], now: Date = Date()) -> [SubLine] {
        let places = Dictionary(lines.map { ($0.id, place($0, now: now)) }, uniquingKeysWith: { first, _ in first })
        return lines.sorted { a, b in
            places[a.id] != places[b.id] ? places[a.id]! < places[b.id]! : newestFirst(a.row, b.row)
        }
    }

    /// The sessions nested under `id`, as lines.
    public static func tree(_ rows: [SessionRow], under id: String, now: Date = Date()) -> [SubLine] {
        let under = underParent(rows)
        var seen: Set<String> = [id]
        func build(_ parent: String) -> [SubLine] {
            var found: [SessionRow] = []
            for row in under[parent] ?? [] where seen.insert(row.id).inserted { found.append(row) }
            return ordered(found.map { SubLine(row: $0, subs: build($0.id)) }, now: now)
        }
        return build(id)
    }

    /// A session whose pull request waits on the owner counts as waiting on them. `needs` is a set of session ids.
    public static func withPulls(_ row: SessionRow, _ needs: Set<String>) -> SessionRow {
        guard needs.contains(row.id), !row.archived else { return row }
        var copy = row
        copy.dot = .awaiting
        return copy
    }

    private static func overlaid(_ rows: [SessionRow], _ needs: Set<String>) -> [SessionRow] { needs.isEmpty ? rows : rows.map { withPulls($0, needs) } }

    /// The sessions the roll-up counts: all of a group's, or all below a chat.
    public static func counted(_ index: SessionIndex, chat id: String, needs: Set<String> = []) -> [SessionRow] {
        if let target = groupOfChat(index, id) { return overlaid(withKids(target.sessions), needs) }
        return overlaid(descendants(index.rows, of: id), needs)
    }

    /// The cards of a group, the ones that need the owner first, each with its family under it.
    public static func lines(_ index: SessionIndex, _ target: GroupTarget, now: Date = Date(), needs: Set<String> = []) -> [SubLine] {
        let rows = overlaid(index.rows, needs)
        return ordered(target.sessions.map { SubLine(row: withPulls($0, needs), subs: tree(rows, under: $0.id, now: now)) }, now: now)
    }

    /// Lines into the parts of the list, each part keeping the order the lines came in.
    public static func parts(_ lines: [SubLine], now: Date = Date()) -> [GroupBucket: [SubLine]] {
        var parts: [GroupBucket: [SubLine]] = [:]
        for line in lines {
            let key = GroupBucket.allCases[place(line, now: now)]
            parts[GroupBucket.shown.contains(key) ? key : .idle, default: []].append(line)
        }
        return parts
    }

    /// The sessions a list of lines draws: the lines, and the lines inside each that is opened, at every depth.
    public static func drawn(_ lines: [SubLine], open: Set<String>) -> [SessionRow] {
        lines.flatMap { [$0.row] + (open.contains($0.id) ? drawn($0.subs, open: open) : []) }
    }

    // MARK: Roll-ups

    public static func tally(_ rows: [SessionRow], now: Date = Date()) -> GroupRoll {
        var roll = GroupRoll()
        for row in rows where !row.archived {
            roll.total += 1
            switch bucket(of: row, now: now) {
            case .needs: roll.needs += 1
            case .working: roll.working += 1
            case .recent: roll.recent += 1
            default: roll.idle += 1
            }
        }
        return roll
    }

    /// "3 sub sessions, 2 waiting on you, 1 working", leaving out a part with nothing in it. A group's chat counts "session".
    public static func rollupLine(_ roll: GroupRoll, noun: String = "sub session") -> String {
        guard roll.total > 0 else { return "" }
        return ([plural(roll.total, noun, "\(noun)s")] + [roll.needs > 0 ? "\(roll.needs) \(waiting)" : nil, roll.working > 0 ? "\(roll.working) working" : nil].compactMap { $0 }).joined(separator: ", ")
    }

    /// The roll-up of the sessions below `id` at any depth, as a card's foot says it.
    public static func rollup(_ rows: [SessionRow], of id: String, now: Date = Date()) -> String {
        rollupLine(tally(descendants(rows, of: id), now: now))
    }

    /// The line at the top of the list: a group's live sessions at every depth, called "session".
    public static func summaryLine(_ index: SessionIndex, chat id: String, now: Date = Date(), needs: Set<String> = []) -> String {
        rollupLine(tally(counted(index, chat: id, needs: needs), now: now), noun: groupOfChat(index, id) != nil ? "session" : "sub session")
    }

    /// A text cut around "waiting on you", so the screen can color those words: before, the words or empty, after.
    public static func splitWaiting(_ text: String) -> (before: String, words: String, after: String) {
        guard let range = text.range(of: waiting) else { return (text, "", "") }
        return (String(text[..<range.lowerBound]), waiting, String(text[range.upperBound...]))
    }

    // MARK: Cards

    public static func pill(_ row: SessionRow) -> StatePill {
        if row.state == .waiting || row.dot == .awaiting { return StatePill(label: "Waiting on you", tone: .needs) }
        if row.dot == .error { return StatePill(label: "Failed", tone: .error) }
        if row.state == .working { return StatePill(label: "Working", tone: .working) }
        if row.dot == .ready { return StatePill(label: "Unread", tone: .ready) }
        return StatePill(label: "Idle", tone: .idle)
    }

    /// What the owner does next about a session, or nil while nothing has been heard of it. `pull` is its main pull request, if any. The first rule that fits wins.
    public static func nextStep(_ row: SessionRow, heard: SessionSummary?, pull: PullStatus?) -> NextStep? {
        guard let heard else { return nil }
        if row.state == .waiting {
            guard let first = heard.pending.first else { return NextStep(text: "Open it, it's waiting on you", tone: .needs, source: .pending) }
            let more = heard.pending.count > 1 ? " (and \(heard.pending.count - 1) more)" : ""
            let asks = first.tool == "AskUserQuestion"
            let what = (asks ? [first.summary] : [ChatText.fullToolLabel(first.tool), first.summary]).filter { !$0.isEmpty }.joined(separator: ": ")
            let text = asks ? "Answer its question\(what.isEmpty ? "" : ": \(what)")" : "Approve \(what.isEmpty ? "a request" : what)"
            return NextStep(text: text + more, tone: .needs, source: .pending)
        }
        if row.dot == .error { return NextStep(text: "Look at the error it stopped on", tone: .error, source: .error) }
        if let pull { let line = pullLine(pull, row); if line.you { return NextStep(text: line.text, tone: line.tone, source: .pull) } }
        let ask = heard.ask ?? ""
        let asked = ask.isEmpty ? nil : "\(ask.hasSuffix("?") ? "Answer its question" : "Reply to its offer"): \(ask)"
        // A session Desktop marks as awaiting has no live chat here, so nothing is pending for it.
        if row.dot == .awaiting, heard.ask != nil {
            return asked.map { NextStep(text: $0, tone: .needs, source: .ask) } ?? NextStep(text: "Open it, it's waiting on you", tone: .needs, source: .pending)
        }
        if row.state == .working || row.state == .active { return NextStep(text: "Nothing yet, it's working", tone: .working, source: .working) }
        if heard.ask == nil { return heard.line.isEmpty ? nil : NextStep(text: heard.line, tone: nil, source: .said) }
        if let asked { return NextStep(text: asked, tone: .ready, source: .ask) }
        let open = pull.map { $0.state != "merged" && $0.state != "closed" } ?? false
        return NextStep(text: open ? "Nothing for now" : "Nothing, it's done", tone: .quiet, source: .done)
    }

    // MARK: Pull requests

    /// The session's main pull request from its list: the first the card may link to.
    public static func mainPull(_ pulls: [PullStatus]?) -> PullStatus? { pulls?.first { isPullURL($0.url) } }

    private static let pullURL = #"^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\.{1,2}/)[A-Za-z0-9._-]{1,100}/pull/[1-9][0-9]{0,8}$"#

    /// Only the plain https://github.com/<owner>/<repo>/pull/<n> form is a link the card draws.
    public static func isPullURL(_ text: String) -> Bool { text.range(of: pullURL, options: .regularExpression) != nil }

    private static func phrase(_ n: Int) -> String { "the \(n) unresolved comment\(n == 1 ? "" : "s")" }
    private static func joined(_ parts: [String]) -> String { parts.count > 1 ? "\(parts.dropLast().joined(separator: ", ")) and \(parts.last!)" : parts.first ?? "" }

    /// What the owner has to do about a pull request, or who the session waits on. `row` says whether the session is working on it. The first rule that fits wins.
    public static func pullLine(_ pull: PullStatus, _ row: SessionRow?) -> PullLine {
        func line(_ you: Bool, _ text: String, _ tone: GroupTone) -> PullLine { PullLine(you: you, text: text, tone: tone) }
        if pull.state == "merged" { return line(false, "Merged, nothing to do", .ready) }
        if pull.state == "closed" { return line(false, "Closed, nothing to do", .quiet) }
        if pull.asked { return line(true, "Review the pull request", .needs) }
        let approved = pull.review == "approved"
        let blocked = pull.checks == "failing"
        let mergeable = pull.state == "open" && pull.clean && !blocked && pull.checks != "running"
        if pull.mine == true, approved, mergeable { return line(true, "Merge the pull request", .needs) }
        let work = [pull.review == "changes" ? "the requested changes" : nil, pull.conflicts ? "the conflicts" : nil,
                    (pull.threads ?? 0) > 0 ? phrase(pull.threads ?? 0) : nil, blocked ? "the failing checks" : nil].compactMap { $0 }
        if pull.mine == true, !work.isEmpty {
            if row?.state == .working || row?.state == .active { return line(false, "The session is dealing with \(joined(work))", .working) }
            return line(true, "Ask the session to deal with \(joined(work))", blocked ? .error : .needs)
        }
        if pull.checks == "running" { return line(false, "Waiting on checks to finish", .working) }
        if approved {
            if !mergeable { return line(false, "Approved, but it cannot merge yet", .quiet) }
            return line(false, pull.mine == false ? "Approved, nothing asked of you" : "Approved", .quiet)
        }
        if pull.requested > 0 || pull.review == "required" { return line(false, "Waiting on a reviewer", .quiet) }
        if pull.state == "draft" { return line(false, "Still a draft", .quiet) }
        guard let mine = pull.mine else { return line(false, "Open", .quiet) }
        return line(false, mine ? "Open, no review asked for yet" : "Open, nothing asked of you", .quiet)
    }

    public static func needsOwner(_ pulls: [PullStatus]?, _ row: SessionRow) -> Bool { (pulls ?? []).contains { pullLine($0, row).you } }

    /// The ids of the sessions in `rows` that wait on the owner for a pull request, from what was last heard.
    public static func needs(_ rows: [SessionRow], known: Kept<PullKept>) -> Set<String> {
        Set(rows.filter { needsOwner(known[$0.id]?.pulls, $0) }.map(\.id))
    }

    // MARK: Stamps

    /// A session's reading is asked for again when it has moved or changed state, since what it waits on goes with its state.
    public static func stamp(_ row: SessionRow) -> String {
        "\(Int(((row.lastActivityAt ?? .distantPast).timeIntervalSince1970 * 1000).rounded())):\(row.state)"
    }

    /// The ids of `rows` whose summary is not kept, or was read at another stamp, each once.
    public static func staleIDs(_ rows: [SessionRow], stamps: (String) -> String?) -> [String] {
        var seen = Set<String>()
        return rows.filter { stamps($0.id) != stamp($0) && seen.insert($0.id).inserted }.map(\.id)
    }

    public static func wantsPulls(_ row: SessionRow, _ kept: PullKept?, now: Date = Date()) -> Bool {
        guard let kept else { return true }
        return kept.stamp != stamp(row) || kept.settling || now.timeIntervalSince(kept.at) > pullFresh
    }

    public static func pullsToAsk(_ rows: [SessionRow], known: Kept<PullKept>, now: Date = Date()) -> [String] {
        var seen = Set<String>()
        return rows.filter { wantsPulls($0, known[$0.id], now: now) && seen.insert($0.id).inserted }.map(\.id)
    }

    /// The sessions to ask about for the chat `id`: every live one the roll-up counts, which is more than the cards drawn, the newest first.
    public static func scope(_ index: SessionIndex, chat id: String, max: Int = mostSessions) -> [SessionRow] {
        Array(counted(index, chat: id).filter { !$0.archived }.sorted(by: newestFirst).prefix(max))
    }

    public static func batches(_ ids: [String], size: Int = maxIDs) -> [[String]] {
        stride(from: 0, to: ids.count, by: size).map { Array(ids[$0..<min($0 + size, ids.count)]) }
    }

    // MARK: Closing

    /// The folder a chip starts in and the folder the owner is shown. As the page picks it, an empty string counts as absent.
    public static func chipFolder(record: String?, input: String?, session: String) -> String {
        [record, input].lazy.compactMap { $0 }.first { !$0.isEmpty } ?? session
    }

    public static func isRunning(_ row: SessionRow) -> Bool { row.state == .working || row.state == .waiting }

    /// How many sessions below `id`, at any depth, are running or waiting on the owner, which archiving it would stop too.
    public static func runningBelow(_ rows: [SessionRow], _ id: String) -> Int { descendants(rows, of: id).filter(isRunning).count }

    public static let stopDetail = "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn."
}
