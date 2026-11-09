import Foundation

// NOTE: [8 Nov 2026] EK - These types mirror what the `summariesApi`, `pullsApi`, chip and group-session handlers in server.mjs send. Nothing there names this file, so check both when either moves.
// Decoding is lenient, so a field the server renames is dropped with no error and reads as empty.

/// One thing a session waits on: a tool to approve, or a question to answer.
public struct PendingLine: Hashable, Sendable, Decodable {
    public var tool: String
    public var summary: String
    private enum Key: String, CodingKey { case tool, summary }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        tool = c.value(.tool) ?? ""
        summary = c.value(.summary) ?? ""
    }
    public init(tool: String, summary: String) { (self.tool, self.summary) = (tool, summary) }
}

/// What the server heard of one session: its latest line, what it asks of the owner, and what it waits on.
public struct SessionSummary: Hashable, Sendable, Decodable {
    public var line: String
    /// Nil from a server that does not send `ask`. A current one sends an empty string for none.
    public var ask: String?
    public var at: Date?
    public var pending: [PendingLine]
    /// The full latest reply, only when asked for with detail.
    public var reply: String?

    private enum Key: String, CodingKey { case line, ask, at, pending, reply }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        line = c.value(.line) ?? ""
        ask = c.value(.ask)
        at = c.millis(.at)
        pending = c.list(.pending)
        reply = c.value(.reply)
    }
    public init(line: String = "", ask: String? = "", at: Date? = nil, pending: [PendingLine] = [], reply: String? = nil) {
        (self.line, self.ask, self.at, self.pending, self.reply) = (line, ask, at, pending, reply)
    }
}

/// A pull request a session made or was asked to look at, as lib/pulls.mjs answers.
public struct PullStatus: Hashable, Sendable, Decodable {
    public var kind: String
    public var url: String
    public var title: String
    public var repo: String
    public var number: Int
    /// open, draft, merged or closed.
    public var state: String
    /// Nil when the server does not know who the viewer is.
    public var mine: Bool?
    public var asked: Bool
    public var requested: Int
    public var review: String
    public var checks: String
    public var conflicts: Bool
    public var clean: Bool
    public var threads: Int?

    private enum Key: String, CodingKey { case kind, url, title, repo, number, state, mine, asked, requested, review, checks, conflicts, clean, threads }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        kind = c.value(.kind) ?? "pull"
        url = c.value(.url) ?? ""
        title = c.value(.title) ?? ""
        repo = c.value(.repo) ?? ""
        number = c.count(.number) ?? 0
        state = c.value(.state) ?? "open"
        mine = c.value(.mine)
        asked = c.value(.asked) ?? false
        requested = c.count(.requested) ?? 0
        review = c.value(.review) ?? ""
        checks = c.value(.checks) ?? "none"
        conflicts = c.value(.conflicts) ?? false
        clean = c.value(.clean) ?? false
        threads = c.count(.threads)
    }
    public init(url: String, state: String = "open", number: Int = 1, title: String = "", repo: String = "", mine: Bool? = true, asked: Bool = false, requested: Int = 0,
                review: String = "", checks: String = "none", conflicts: Bool = false, clean: Bool = true, threads: Int? = nil) {
        (kind, self.url, self.title, self.repo, self.number, self.state, self.mine, self.asked) = ("pull", url, title, repo, number, state, mine, asked)
        (self.requested, self.review, self.checks, self.conflicts, self.clean, self.threads) = (requested, review, checks, conflicts, clean, threads)
    }
}

public struct PullAnswer: Hashable, Sendable, Decodable {
    public var pulls: [String: [PullStatus]]
    /// True while the server is still reading GitHub for some of them, so the caller asks again soon.
    public var settling: Bool
    private enum Key: String, CodingKey { case pulls, settling }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let raw = (try? c.decode([String: [Lossy<PullStatus>]].self, forKey: .pulls)) ?? [:]
        pulls = raw.mapValues { $0.compactMap(\.value) }
        settling = c.value(.settling) ?? false
    }
    public init(pulls: [String: [PullStatus]] = [:], settling: Bool = false) { (self.pulls, self.settling) = (pulls, settling) }
}

public enum ChipStatus: Hashable, Sendable, ServerWord {
    case open, started, dismissed
    case other(String)
    public init(word: String) {
        self = switch word { case "open": .open; case "started": .started; case "dismissed": .dismissed; default: .other(word) }
    }
}

/// A "start a session" card a chat made, and what became of it.
public struct ChipRecord: Hashable, Sendable, Decodable {
    public var toolUseId: String
    public var sessionId: String
    public var title: String
    public var tldr: String
    public var status: ChipStatus
    public var startedId: String?
    /// Where the session opens, worded by the server, e.g. "Opens in Billing".
    public var opensIn: String?
    public var group: String?
    public var cwd: String?
    public var model: String?
    public var effort: String?
    public var prompt: String

    private enum Key: String, CodingKey { case toolUseId, sessionId, title, tldr, status, startedId, opensIn, group, cwd, model, effort, prompt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        toolUseId = try c.decode(String.self, forKey: .toolUseId)
        sessionId = c.value(.sessionId) ?? ""
        title = c.value(.title) ?? ""
        tldr = c.value(.tldr) ?? ""
        status = c.value(.status) ?? .open
        startedId = c.value(.startedId)
        opensIn = c.value(.opensIn)
        group = c.value(.group)
        cwd = c.value(.cwd)
        model = c.value(.model)
        effort = c.value(.effort)
        prompt = c.value(.prompt) ?? ""
    }
    public init(toolUseId: String, sessionId: String = "", title: String = "", tldr: String = "", status: ChipStatus = .open, startedId: String? = nil, opensIn: String? = nil,
                group: String? = nil, cwd: String? = nil, model: String? = nil, effort: String? = nil, prompt: String = "") {
        (self.toolUseId, self.sessionId, self.title, self.tldr, self.status, self.startedId) = (toolUseId, sessionId, title, tldr, status, startedId)
        (self.opensIn, self.group, self.cwd, self.model, self.effort, self.prompt) = (opensIn, group, cwd, model, effort, prompt)
    }
}

/// What a chip's Start or Dismiss changed. `id` is the new session's, for a start.
public struct ChipResult: Hashable, Sendable, Decodable {
    public var id: String?
    public var chip: ChipRecord?
    private enum Key: String, CodingKey { case id, chip }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = c.value(.id)
        chip = c.value(.chip)
    }
}

/// The fields of a chip the web page sends back with Start or Dismiss. `cwd` is the folder the card named, if any, and `folder` the folder it showed, which the server checks.
public struct ChipRequest: Hashable, Sendable {
    public var sessionID: String
    public var toolUseID: String
    public var title: String
    public var tldr: String
    public var prompt: String
    public var cwd: String?
    public var folder: String
    public var model: String?
    public var effort: String?

    public init(sessionID: String, toolUseID: String, title: String, tldr: String, prompt: String, cwd: String?, folder: String, model: String? = nil, effort: String? = nil) {
        (self.sessionID, self.toolUseID, self.title, self.tldr, self.prompt, self.cwd, self.folder) = (sessionID, toolUseID, title, tldr, prompt, cwd, folder)
        (self.model, self.effort) = (model, effort)
    }
}

private struct SummariesReply: Decodable, Sendable {
    var summaries: [String: SessionSummary]
    private enum Key: String, CodingKey { case summaries }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let raw = (try? c.decode([String: Lossy<SessionSummary>].self, forKey: .summaries)) ?? [:]
        summaries = raw.compactMapValues(\.value)
    }
}

private struct ChipsReply: Decodable, Sendable {
    var chips: [ChipRecord]
    private enum Key: String, CodingKey { case chips }
    init(from decoder: Decoder) throws { chips = try decoder.container(keyedBy: Key.self).list(.chips) }
}

private struct BookedSession: Decodable, Sendable { var id: String }
private struct ChipBody: Encodable, Sendable {
    var sessionId, toolUseId, title, tldr, prompt, confirmCwd: String
    var cwd, model, effort: String?
}
private struct ReplyBody: Encodable, Sendable { var text: String }

extension GhostShellClient {
    /// Opens (or finds) the chat of a group or a section, and gives its session id. `id` is a group id or a section id such as `pinned`.
    public func groupSession(_ id: String) async throws -> String {
        let booked: BookedSession = try await post("api/groups/\(try pathID(id))/session", json: Empty())
        return booked.id
    }

    /// What the server heard of each session. The server answers at most 60 ids at once, so a longer list is asked for in batches.
    public func summaries(ids: [String], detail: Bool = false) async throws -> [String: SessionSummary] {
        var found: [String: SessionSummary] = [:]
        for batch in GroupRules.batches(ids) {
            let reply: SummariesReply = try await get("api/summaries", query: [URLQueryItem(name: "ids", value: try batch.map(pathID).joined(separator: ","))] + (detail ? [URLQueryItem(name: "detail", value: "1")] : []))
            found.merge(reply.summaries) { _, new in new }
        }
        return found
    }

    /// The pull requests of each session. `settling` is true while the server is still reading GitHub for some of them.
    public func pulls(ids: [String]) async throws -> PullAnswer {
        var answer = PullAnswer()
        for batch in GroupRules.batches(ids) {
            let reply: PullAnswer = try await get("api/pulls", query: [URLQueryItem(name: "ids", value: try batch.map(pathID).joined(separator: ","))])
            answer.pulls.merge(reply.pulls) { _, new in new }
            answer.settling = answer.settling || reply.settling
        }
        return answer
    }

    public func chips(sessionID: String) async throws -> [ChipRecord] {
        let reply: ChipsReply = try await get("api/sessions/\(try pathID(sessionID))/chips")
        return reply.chips
    }

    /// Starts the session a chip offers. A refusal with "already started" or "already dismissed" means another screen settled it first.
    public func startChip(_ chip: ChipRequest) async throws -> ChipResult { try await post("api/chips/start", json: body(chip)) }

    public func dismissChip(_ chip: ChipRequest) async throws -> ChipResult { try await post("api/chips/dismiss", json: body(chip)) }

    // NOTE: [8 Nov 2026] EK - Folds into `sendMessage` once https://github.com/kulesy/ghostshell/pull/106 lands, which sends this same body.
    // A reply with no mode is queued behind a card the session is waiting on, so the server says nothing of that here.
    /// Sends `text` to a session as the owner's next message.
    public func sendReply(_ text: String, to sessionID: String) async throws {
        try await send("api/sessions/\(try pathID(sessionID))/send", json: ReplyBody(text: text))
    }

    private func body(_ chip: ChipRequest) throws -> ChipBody {
        ChipBody(sessionId: try pathID(chip.sessionID), toolUseId: chip.toolUseID, title: chip.title, tldr: chip.tldr, prompt: chip.prompt, confirmCwd: chip.folder,
                 cwd: chip.cwd, model: chip.model, effort: chip.effort)
    }
}
