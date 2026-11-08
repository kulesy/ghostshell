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
    /// The app the session came from: `capcom`, `desktop` or `cli`. It decides which loose list the session goes back to.
    public var source: String?
    public var children: [SessionRow]
    /// When the open turn began by this device's clock, present while a turn runs. The server sends how long it has run, so this is that long ago.
    public var turnStart: Date?

    private enum Key: String, CodingKey {
        case id, title, cwd, branch, state, dot, lastActivityAt, sortAt, pinned, archived, group, parent, routine, source, children, turnMs
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
        lastActivityAt = c.millis(.lastActivityAt)
        sortAt = c.millis(.sortAt)
        pinned = (try? c.decode(Bool.self, forKey: .pinned)) ?? false
        archived = (try? c.decode(Bool.self, forKey: .archived)) ?? false
        group = try? c.decode(String.self, forKey: .group)
        parent = try? c.decode(String.self, forKey: .parent)
        routine = try? c.decode(String.self, forKey: .routine)
        source = try? c.decode(String.self, forKey: .source)
        children = lossy(c, .children)
        turnStart = (try? c.decode(Double.self, forKey: .turnMs)).map { Self.turnStart(ms: $0) }
    }

    public init(id: String, title: String = "", cwd: String = "", branch: String = "", state: SessionState = .idle, dot: SessionDot? = nil,
                lastActivityAt: Date? = nil, sortAt: Date? = nil, pinned: Bool = false, archived: Bool = false, group: String? = nil,
                parent: String? = nil, routine: String? = nil, source: String? = nil, children: [SessionRow] = [], turnStart: Date? = nil) {
        (self.id, self.title, self.cwd, self.branch, self.state, self.dot) = (id, title, cwd, branch, state, dot)
        (self.lastActivityAt, self.sortAt, self.pinned, self.archived) = (lastActivityAt, sortAt, pinned, archived)
        (self.group, self.parent, self.routine, self.source, self.children, self.turnStart) = (group, parent, routine, source, children, turnStart)
    }

    // The server sends how long the turn has run, so the start moves with every poll. Whole seconds keep two polls of one turn equal, and the feed skips an equal index.
    static func turnStart(ms: Double, now: Date = Date()) -> Date {
        Date(timeIntervalSince1970: (now.timeIntervalSince1970 - ms / 1000).rounded())
    }
}

public struct SessionGroup: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var name: String
    /// The project this group belongs to, or nil for Home.
    public var project: String?
    public var sessions: [SessionRow]
    /// The group's own chat, when it has one. Deleting the group stops it if it is running.
    public var session: SessionRow?

    private enum Key: String, CodingKey { case id, name, project, sessions, session }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        project = try? c.decode(String.self, forKey: .project)
        sessions = lossy(c, .sessions)
        session = try? c.decode(SessionRow.self, forKey: .session)
    }

    public init(id: String, name: String, project: String? = nil, sessions: [SessionRow] = [], session: SessionRow? = nil) {
        (self.id, self.name, self.project, self.sessions, self.session) = (id, name, project, sessions, session)
    }
}

public struct SessionProject: Hashable, Sendable, Identifiable, Decodable {
    public var id: String
    public var name: String
    public init(id: String, name: String) { (self.id, self.name) = (id, name) }
}

/// Which edits the server takes, so the app offers only those, as the page does. A flag the server does not send reads as false.
public struct SessionFeatures: Hashable, Sendable, Decodable {
    public var many: Bool
    public var groupEdits: Bool
    public var groupRename: Bool

    private enum Key: String, CodingKey { case many, groupEdits, groupRename }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        many = (try? c.decode(Bool.self, forKey: .many)) ?? false
        groupEdits = (try? c.decode(Bool.self, forKey: .groupEdits)) ?? false
        groupRename = (try? c.decode(Bool.self, forKey: .groupRename)) ?? false
    }
    public init(many: Bool = false, groupEdits: Bool = false, groupRename: Bool = false) { (self.many, self.groupEdits, self.groupRename) = (many, groupEdits, groupRename) }
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
    public var features: SessionFeatures?

    private enum Key: String, CodingKey { case station, problem, projects, pinned, groups, routines, started, ungrouped, other, features }
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
        features = try? c.decode(SessionFeatures.self, forKey: .features)
    }

    public init(station: String = "", problem: String? = nil, projects: [SessionProject] = [], pinned: [SessionRow] = [], groups: [SessionGroup] = [], routines: [RoutineRuns] = [],
                started: [SessionRow] = [], ungrouped: [SessionRow] = [], other: [SessionRow] = [], features: SessionFeatures? = nil) {
        (self.station, self.problem, self.projects, self.pinned, self.groups, self.routines) = (station, problem, projects, pinned, groups, routines)
        (self.started, self.ungrouped, self.other, self.features) = (started, ungrouped, other, features)
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
