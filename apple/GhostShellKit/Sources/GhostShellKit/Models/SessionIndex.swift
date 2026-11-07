import Foundation

// NOTE: [7 Nov 2026] EK - These types mirror the JSON of the `api/sessions` handler in server.mjs, which names this file in turn.
// Decoding here is lenient, so a field the server renames is dropped with no error and reads as empty.

/// What a session is doing, as the server words it. A word this app does not know is kept, never an error.
public enum SessionState: Hashable, Sendable, Decodable {
    case working, waiting, active, idle
    case other(String)

    public init(from decoder: Decoder) throws {
        let word = try decoder.singleValueContainer().decode(String.self)
        self = switch word {
        case "working": .working
        case "waiting": .waiting
        case "active": .active
        case "idle": .idle
        default: .other(word)
        }
    }
}

/// The mark the server wants beside a row. Absent means none.
public enum SessionDot: Hashable, Sendable, Decodable {
    case error, awaiting, running, ready
    case other(String)

    public init(from decoder: Decoder) throws {
        let word = try decoder.singleValueContainer().decode(String.self)
        self = switch word {
        case "error": .error
        case "awaiting": .awaiting
        case "running": .running
        case "ready": .ready
        default: .other(word)
        }
    }
}

public struct SessionRow: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var title: String
    public var cwd: String
    public var branch: String
    public var state: SessionState
    public var dot: SessionDot?
    public var lastActivityAt: Date?
    public var sortAt: Date?
    public var pinned: Bool
    public var archived: Bool
    public var group: String?
    public var parent: String?
    public var routine: String?
    public var children: [SessionRow]
    /// When the open turn began by this device's clock, present while a turn runs. The server sends how long it has run, so this is that long ago.
    public var turnStart: Date?

    private enum Key: String, CodingKey {
        case id, title, cwd, branch, state, dot, lastActivityAt, sortAt, pinned, archived, group, parent, routine, children, turnMs
    }

    /// Only the id is required. Anything else the server leaves out or words differently reads as empty.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        cwd = (try? c.decode(String.self, forKey: .cwd)) ?? ""
        branch = (try? c.decode(String.self, forKey: .branch)) ?? ""
        state = (try? c.decode(SessionState.self, forKey: .state)) ?? .other("")
        dot = try? c.decode(SessionDot.self, forKey: .dot)
        lastActivityAt = Self.date(c, .lastActivityAt)
        sortAt = Self.date(c, .sortAt)
        pinned = (try? c.decode(Bool.self, forKey: .pinned)) ?? false
        archived = (try? c.decode(Bool.self, forKey: .archived)) ?? false
        group = try? c.decode(String.self, forKey: .group)
        parent = try? c.decode(String.self, forKey: .parent)
        routine = try? c.decode(String.self, forKey: .routine)
        children = lossy(c, .children)
        turnStart = (try? c.decode(Double.self, forKey: .turnMs)).map { Date(timeIntervalSinceNow: -$0 / 1000) }
    }

    public init(id: String, title: String = "", cwd: String = "", branch: String = "", state: SessionState = .idle, dot: SessionDot? = nil,
                lastActivityAt: Date? = nil, sortAt: Date? = nil, pinned: Bool = false, archived: Bool = false, group: String? = nil,
                parent: String? = nil, routine: String? = nil, children: [SessionRow] = [], turnStart: Date? = nil) {
        (self.id, self.title, self.cwd, self.branch, self.state, self.dot) = (id, title, cwd, branch, state, dot)
        (self.lastActivityAt, self.sortAt, self.pinned, self.archived) = (lastActivityAt, sortAt, pinned, archived)
        (self.group, self.parent, self.routine, self.children, self.turnStart) = (group, parent, routine, children, turnStart)
    }

    // The server counts in milliseconds since 1970.
    private static func date(_ c: KeyedDecodingContainer<Key>, _ key: Key) -> Date? {
        (try? c.decode(Double.self, forKey: key)).map { Date(timeIntervalSince1970: $0 / 1000) }
    }
}

public struct SessionGroup: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var name: String
    /// The project this group belongs to, or nil for Home.
    public var project: String?
    public var sessions: [SessionRow]

    private enum Key: String, CodingKey { case id, name, project, sessions }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        project = try? c.decode(String.self, forKey: .project)
        sessions = lossy(c, .sessions)
    }
}

public struct SessionProject: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var name: String
}

public struct RoutineRuns: Hashable, Sendable, Identifiable, Decodable {
    public var id: String { name }
    public var name: String
    public var title: String?
    /// The sub-heading this routine sits under in Routines, if any.
    public var heading: String?
    public var latest: SessionRow?
    public var earlier: [SessionRow]

    private enum Key: String, CodingKey { case name, title, heading, latest, earlier }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        name = try c.decode(String.self, forKey: .name)
        title = try? c.decode(String.self, forKey: .title)
        heading = try? c.decode(String.self, forKey: .heading)
        latest = try? c.decode(SessionRow.self, forKey: .latest)
        earlier = lossy(c, .earlier)
    }
}

/// The body of `api/sessions`: every list the server keeps, each row once in the list it belongs to.
public struct SessionIndex: Hashable, Sendable, Decodable {
    public var station: String
    public var problem: String?
    public var projects: [SessionProject]
    public var pinned: [SessionRow]
    public var groups: [SessionGroup]
    public var routines: [RoutineRuns]
    public var started: [SessionRow]
    public var ungrouped: [SessionRow]
    public var other: [SessionRow]

    private enum Key: String, CodingKey { case station, problem, projects, pinned, groups, routines, started, ungrouped, other }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        station = (try? c.decode(String.self, forKey: .station)) ?? ""
        problem = try? c.decode(String.self, forKey: .problem)
        projects = lossy(c, .projects)
        pinned = lossy(c, .pinned)
        groups = lossy(c, .groups)
        routines = lossy(c, .routines)
        started = lossy(c, .started)
        ungrouped = lossy(c, .ungrouped)
        other = lossy(c, .other)
    }

    public init(station: String = "", problem: String? = nil, projects: [SessionProject] = [], pinned: [SessionRow] = [], groups: [SessionGroup] = [], routines: [RoutineRuns] = [],
                started: [SessionRow] = [], ungrouped: [SessionRow] = [], other: [SessionRow] = []) {
        (self.station, self.problem, self.projects, self.pinned, self.groups, self.routines) = (station, problem, projects, pinned, groups, routines)
        (self.started, self.ungrouped, self.other) = (started, ungrouped, other)
    }

    /// Every session once, children included, newest first. The plain list reads this. Groups, pins and routines read the lists above.
    public var rows: [SessionRow] {
        var seen = Set<String>()
        var all: [SessionRow] = []
        func collect(_ row: SessionRow) {
            guard seen.insert(row.id).inserted else { return }
            all.append(row)
            row.children.forEach(collect)
        }
        pinned.forEach(collect)
        groups.forEach { $0.sessions.forEach(collect) }
        routines.forEach { run in ([run.latest].compactMap { $0 } + run.earlier).forEach(collect) }
        (started + ungrouped + other).forEach(collect)
        let when = { (row: SessionRow) in row.sortAt ?? row.lastActivityAt ?? .distantPast }
        // Newest first, and rows with the same time keep the order the server listed them in.
        return all.enumerated().sorted { a, b in when(a.element) != when(b.element) ? when(a.element) > when(b.element) : a.offset < b.offset }.map(\.element)
    }
}

// A row or list the app cannot read is left out, so one odd entry never empties the whole index.
private struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

func lossy<T: Decodable, K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> [T] {
    ((try? c.decode([Lossy<T>].self, forKey: key)) ?? []).compactMap(\.value)
}
