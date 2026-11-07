import Foundation

// NOTE: [8 Nov 2026] EK - These types mirror `itemsFromEntry` in lib/transcripts.mjs, `chat.status()` in lib/runner.mjs and the events() handler in server.mjs.
// Decoding is lenient: a kind, event or field this app does not know is kept as `.other` or read as empty, and never fails a page.

extension GhostShellClient {
    /// A page of a chat's messages. With neither argument, the tail. `before` is a byte offset and loads older items. `after` loads what came since.
    public func messages(sessionID: String, before: Int? = nil, after: Int? = nil) async throws -> ChatPage {
        guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
        var query: [URLQueryItem] = []
        if let before { query.append(URLQueryItem(name: "before", value: String(before))) }
        if let after { query.append(URLQueryItem(name: "after", value: String(after))) }
        return try await get("api/sessions/\(sessionID)/messages", query: query)
    }
}

// MARK: Items

public struct ChatFile: Hashable, Sendable {
    public var name: String
    public var type: String
    public var size: Int
    public var path: String
}

/// A picture the server holds. Its bytes are at `api/sessions/<id>/images/<ref>`.
public struct ChatImageRef: Hashable, Sendable {
    public var ref: String
    public var type: String
}

public enum ToolStatus: Hashable, Sendable {
    case pending, ok, failed, denied
    case other(String)

    init(_ word: String) {
        self = switch word {
        case "pending": .pending
        case "ok": .ok
        case "failed": .failed
        case "denied": .denied
        default: .other(word)
        }
    }

    public var word: String {
        switch self {
        case .pending: "running"
        case .ok: "ok"
        case .failed: "failed"
        case .denied: "denied"
        case .other(let w): w
        }
    }
}

public struct UserMessage: Hashable, Sendable {
    public var text: String
    public var files: [ChatFile]
    public var images: [ChatImageRef]
}

public struct ToolCall: Hashable, Sendable {
    public var id: String
    public var name: String
    public var summary: String
    public var input: JSONValue
    public var status: ToolStatus
    public var output: String?
    public var images: [ChatImageRef]

    /// A result takes over the status and output, and the pictures only when it has some.
    func settled(by result: ToolResult) -> ToolCall {
        var copy = self
        copy.status = result.status
        copy.output = result.output
        if !result.images.isEmpty { copy.images = result.images }
        return copy
    }
}

public struct ToolResult: Hashable, Sendable {
    public var toolID: String
    public var status: ToolStatus
    public var output: String
    public var images: [ChatImageRef]
}

public struct SystemNotice: Hashable, Sendable {
    public struct Detail: Hashable, Sendable { public var label: String; public var value: String }
    public var title: String
    public var text: String?
    public var output: String?
    public var state: String?
    public var details: [Detail]
}

public struct BashRun: Hashable, Sendable {
    public var command: String
    public var stdout: String
    public var stderr: String
}

/// One line of a chat as the server sends it. The thread gives it a `key` when it takes it in, and keeps that key for as long as the item lives.
public struct ChatItem: Hashable, Sendable, Identifiable {
    public enum Body: Hashable, Sendable {
        case user(UserMessage)
        case assistant(msgID: String, text: String)
        case thinking(msgID: String, text: String)
        case tool(ToolCall)
        case result(ToolResult)
        case system(SystemNotice)
        case bash(BashRun)
        case divider(String)
        case model(String)
        case routine(String)
        case scheduled(String)
        /// A kind this app does not know. It is never drawn.
        case other(kind: String)
    }

    public var key: String
    public var at: Date?
    public var body: Body
    public var id: String { key }

    public init(key: String = "", at: Date? = nil, body: Body) {
        (self.key, self.at, self.body) = (key, at, body)
    }
}

extension ChatItem: Decodable {
    private enum Key: String, CodingKey {
        case kind, at, text, files, images, msgId, id, name, summary, input, status, output, toolId, title, state, details, command, stdout, stderr, model
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let kind = (try? c.decode(String.self, forKey: .kind)) ?? ""
        key = ""
        at = (try? c.decode(String.self, forKey: .at)).flatMap(Self.date)
        func str(_ k: Key) -> String { (try? c.decode(String.self, forKey: k)) ?? "" }
        func opt(_ k: Key) -> String? { try? c.decode(String.self, forKey: k) }
        func list<T: Decodable>(_ k: Key, _ type: T.Type) -> [T] { ((try? c.decode([LossyItem<T>].self, forKey: k)) ?? []).compactMap(\.value) }
        switch kind {
        case "user":
            body = .user(UserMessage(text: str(.text), files: list(.files, FileWire.self).map(\.file), images: list(.images, ImageWire.self).map(\.image)))
        case "assistant": body = .assistant(msgID: str(.msgId), text: str(.text))
        case "thinking": body = .thinking(msgID: str(.msgId), text: str(.text))
        case "tool":
            body = .tool(ToolCall(id: str(.id), name: str(.name), summary: str(.summary), input: (try? c.decode(JSONValue.self, forKey: .input)) ?? .null,
                                  status: ToolStatus(opt(.status) ?? "pending"), output: opt(.output), images: list(.images, ImageWire.self).map(\.image)))
        case "result":
            body = .result(ToolResult(toolID: str(.toolId), status: ToolStatus(opt(.status) ?? "ok"), output: str(.output), images: list(.images, ImageWire.self).map(\.image)))
        case "system":
            body = .system(SystemNotice(title: str(.title), text: opt(.text), output: opt(.output), state: opt(.state),
                                        details: list(.details, DetailWire.self).map(\.detail)))
        case "bash": body = .bash(BashRun(command: str(.command), stdout: str(.stdout), stderr: str(.stderr)))
        case "divider": body = .divider(str(.text))
        case "model": body = .model(str(.model))
        case "routine": body = .routine(str(.name))
        case "scheduled": body = .scheduled(str(.name))
        default: body = .other(kind: kind)
        }
    }

    // Parsed without a shared formatter, so this stays Sendable under strict concurrency.
    static func date(_ text: String) -> Date? {
        (try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
            ?? (try? Date(text, strategy: Date.ISO8601FormatStyle()))
    }

    private struct FileWire: Decodable {
        let file: ChatFile
        enum K: String, CodingKey { case name, type, size, path }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            file = ChatFile(name: (try? c.decode(String.self, forKey: .name)) ?? "", type: (try? c.decode(String.self, forKey: .type)) ?? "",
                            size: Int((try? c.decode(Double.self, forKey: .size)) ?? 0), path: (try? c.decode(String.self, forKey: .path)) ?? "")
        }
    }

    private struct ImageWire: Decodable {
        let image: ChatImageRef
        enum K: String, CodingKey { case ref, type }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            image = ChatImageRef(ref: try c.decode(String.self, forKey: .ref), type: (try? c.decode(String.self, forKey: .type)) ?? "")
        }
    }

    private struct DetailWire: Decodable {
        let detail: SystemNotice.Detail
        enum K: String, CodingKey { case label, value }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            detail = SystemNotice.Detail(label: (try? c.decode(String.self, forKey: .label)) ?? "", value: (try? c.decode(String.self, forKey: .value)) ?? "")
        }
    }
}

// MARK: The messages route

public struct ChatSessionInfo: Hashable, Sendable {
    public var id: String
    public var title: String
    public var cwd: String
    public var branch: String
    public var source: String?
    public var routine: String?
    /// A claude.ai connector's id to its name, so a tool from one reads by name.
    public var connectors: [String: String]

    public init(id: String, title: String = "", cwd: String = "", branch: String = "", source: String? = nil, routine: String? = nil, connectors: [String: String] = [:]) {
        (self.id, self.title, self.cwd, self.branch, self.source, self.routine, self.connectors) = (id, title, cwd, branch, source, routine, connectors)
    }
}

extension ChatSessionInfo: Decodable {
    private enum Key: String, CodingKey { case id, title, cwd, branch, source, routine, connectors }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        cwd = (try? c.decode(String.self, forKey: .cwd)) ?? ""
        branch = (try? c.decode(String.self, forKey: .branch)) ?? ""
        source = try? c.decode(String.self, forKey: .source)
        routine = try? c.decode(String.self, forKey: .routine)
        connectors = (try? c.decode([String: String].self, forKey: .connectors)) ?? [:]
    }
}

public struct ChatPage: Sendable, Decodable {
    public var items: [ChatItem]
    /// Byte offsets into the transcript file. `before` takes `start` and `after` takes `end`.
    public var start: Int
    public var end: Int
    public var hasEarlier: Bool
    /// True when the reader was too far behind and this is a fresh tail, so it replaces the thread.
    public var reset: Bool
    public var fileLinks: Bool
    public var terminal: Bool
    public var session: ChatSessionInfo?

    public init(items: [ChatItem] = [], start: Int = 0, end: Int = 0, hasEarlier: Bool = false, reset: Bool = false, fileLinks: Bool = false, terminal: Bool = false, session: ChatSessionInfo? = nil) {
        (self.items, self.start, self.end, self.hasEarlier, self.reset, self.fileLinks, self.terminal, self.session) = (items, start, end, hasEarlier, reset, fileLinks, terminal, session)
    }

    private enum Key: String, CodingKey { case items, start, end, hasEarlier, reset, fileLinks, terminal, session }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        items = ((try? c.decode([LossyItem<ChatItem>].self, forKey: .items)) ?? []).compactMap(\.value)
        start = Int((try? c.decode(Double.self, forKey: .start)) ?? 0)
        end = Int((try? c.decode(Double.self, forKey: .end)) ?? 0)
        hasEarlier = (try? c.decode(Bool.self, forKey: .hasEarlier)) ?? false
        reset = (try? c.decode(Bool.self, forKey: .reset)) ?? false
        fileLinks = (try? c.decode(Bool.self, forKey: .fileLinks)) ?? false
        terminal = (try? c.decode(Bool.self, forKey: .terminal)) ?? false
        session = try? c.decode(ChatSessionInfo.self, forKey: .session)
    }
}

// MARK: Status and events

public enum ChatState: Hashable, Sendable, Decodable {
    case idle, working, waiting
    case other(String)

    public init(from decoder: Decoder) throws {
        let word = try decoder.singleValueContainer().decode(String.self)
        self = switch word {
        case "idle": .idle
        case "working": .working
        case "waiting": .waiting
        default: .other(word)
        }
    }
}

/// Claude's thinking as it is written. It stays until the transcript holds the saved block.
public struct ChatThink: Hashable, Sendable, Decodable {
    public var id: String
    public var text: String
    public var done: Bool

    public init(id: String, text: String, done: Bool) { (self.id, self.text, self.done) = (id, text, done) }
    private enum Key: String, CodingKey { case id, text, done }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        done = (try? c.decode(Bool.self, forKey: .done)) ?? false
    }
}

/// What a turn is doing right now, for the line under the thread.
public struct ChatWork: Hashable, Sendable, Decodable {
    public struct Tool: Hashable, Sendable, Decodable {
        public var id: String
        public var name: String
        public var summary: String
        public var loading: [String]

        private enum Key: String, CodingKey { case id, name, summary, loading }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Key.self)
            id = (try? c.decode(String.self, forKey: .id)) ?? ""
            name = (try? c.decode(String.self, forKey: .name)) ?? ""
            summary = (try? c.decode(String.self, forKey: .summary)) ?? ""
            loading = (try? c.decode([String].self, forKey: .loading)) ?? []
        }
        public init(id: String = "", name: String, summary: String = "", loading: [String] = []) { (self.id, self.name, self.summary, self.loading) = (id, name, summary, loading) }
    }

    public var thinking: Bool
    public var writing: Bool
    public var tools: [Tool]
    public var tokens: Int
    public var turnMs: Int
    /// Milliseconds since 1970.
    public var startedAt: Double?

    public init(thinking: Bool = false, writing: Bool = false, tools: [Tool] = [], tokens: Int = 0, turnMs: Int = 0, startedAt: Double? = nil) {
        (self.thinking, self.writing, self.tools, self.tokens, self.turnMs, self.startedAt) = (thinking, writing, tools, tokens, turnMs, startedAt)
    }

    private enum Key: String, CodingKey { case thinking, writing, tools, tokens, turnMs, startedAt }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        thinking = (try? c.decode(Bool.self, forKey: .thinking)) ?? false
        writing = (try? c.decode(Bool.self, forKey: .writing)) ?? false
        tools = ((try? c.decode([LossyItem<Tool>].self, forKey: .tools)) ?? []).compactMap(\.value)
        tokens = Int((try? c.decode(Double.self, forKey: .tokens)) ?? 0)
        turnMs = Int((try? c.decode(Double.self, forKey: .turnMs)) ?? 0)
        startedAt = try? c.decode(Double.self, forKey: .startedAt)
    }
}

/// A permission prompt or a question the session is waiting on. `AskUserQuestion` is a question.
public struct PendingApproval: Hashable, Sendable, Decodable, Identifiable {
    public var requestID: String
    public var tool: String
    public var label: String?
    public var input: JSONValue
    public var summary: String?
    public var description: String?
    public var suggestions: JSONValue?
    public var always: Bool
    public var at: Double?
    public var id: String { requestID }

    private enum Key: String, CodingKey { case requestId, tool, label, input, summary, description, suggestions, always, at }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        requestID = try c.decode(String.self, forKey: .requestId)
        tool = (try? c.decode(String.self, forKey: .tool)) ?? ""
        label = try? c.decode(String.self, forKey: .label)
        input = (try? c.decode(JSONValue.self, forKey: .input)) ?? .null
        summary = try? c.decode(String.self, forKey: .summary)
        description = try? c.decode(String.self, forKey: .description)
        suggestions = try? c.decode(JSONValue.self, forKey: .suggestions)
        always = (try? c.decode(Bool.self, forKey: .always)) ?? false
        at = try? c.decode(Double.self, forKey: .at)
    }

    public init(requestID: String, tool: String, input: JSONValue = .null, label: String? = nil, summary: String? = nil, description: String? = nil, always: Bool = false) {
        (self.requestID, self.tool, self.input, self.label, self.summary, self.description, self.always) = (requestID, tool, input, label, summary, description, always)
    }
}

/// A message from another session that the CLI is holding for approval.
public struct ChatHold: Hashable, Sendable, Decodable, Identifiable {
    public var id: String
    public var from: String
    public var cause: String
    public var at: Double?

    private enum Key: String, CodingKey { case id, from, cause, at }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        from = (try? c.decode(String.self, forKey: .from)) ?? ""
        cause = (try? c.decode(String.self, forKey: .cause)) ?? ""
        at = try? c.decode(Double.self, forKey: .at)
    }
}

/// `chat.status()` on the server, and the first frame of the event stream.
public struct ChatStatus: Hashable, Sendable, Decodable {
    public var state: ChatState
    public var running: Bool
    public var account: String?
    public var mode: String?
    public var model: String?
    public var shownModel: String?
    public var effort: String?
    public var fast: Bool
    /// The reply streamed so far.
    public var live: String
    public var think: ChatThink?
    public var work: ChatWork?
    public var lastError: String?
    public var pending: [PendingApproval]
    public var holds: [ChatHold]
    /// A turn run by another app, which the line under the thread also shows.
    public var outside: ChatWork?

    public init(state: ChatState = .idle, running: Bool = false, mode: String? = nil, model: String? = nil, live: String = "", think: ChatThink? = nil,
                work: ChatWork? = nil, pending: [PendingApproval] = [], holds: [ChatHold] = [], outside: ChatWork? = nil) {
        (self.state, self.running, self.mode, self.model, self.live, self.think, self.work, self.pending, self.holds, self.outside) = (state, running, mode, model, live, think, work, pending, holds, outside)
        (self.account, self.shownModel, self.effort, self.fast, self.lastError) = (nil, nil, nil, false, nil)
    }

    private enum Key: String, CodingKey { case state, running, account, mode, model, shownModel, effort, fast, live, think, work, lastError, pending, holds, outside }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        state = (try? c.decode(ChatState.self, forKey: .state)) ?? .idle
        running = (try? c.decode(Bool.self, forKey: .running)) ?? false
        account = try? c.decode(String.self, forKey: .account)
        mode = try? c.decode(String.self, forKey: .mode)
        model = try? c.decode(String.self, forKey: .model)
        shownModel = try? c.decode(String.self, forKey: .shownModel)
        effort = try? c.decode(String.self, forKey: .effort)
        fast = (try? c.decode(Bool.self, forKey: .fast)) ?? false
        live = (try? c.decode(String.self, forKey: .live)) ?? ""
        think = try? c.decode(ChatThink.self, forKey: .think)
        work = try? c.decode(ChatWork.self, forKey: .work)
        lastError = try? c.decode(String.self, forKey: .lastError)
        pending = ((try? c.decode([LossyItem<PendingApproval>].self, forKey: .pending)) ?? []).compactMap(\.value)
        holds = ((try? c.decode([LossyItem<ChatHold>].self, forKey: .holds)) ?? []).compactMap(\.value)
        outside = try? c.decode(ChatWork.self, forKey: .outside)
    }
}

public struct Subagent: Hashable, Sendable, Decodable, Identifiable {
    public enum State: Hashable, Sendable {
        case running, done, stopped, failed
        case other(String)
    }

    public var id: String
    public var type: String
    public var description: String
    public var model: String?
    public var state: State
    /// Milliseconds since 1970.
    public var startedAt: Double?
    public var endedAt: Double?
    /// How long it has run by the server's clock.
    public var ms: Int
    public var action: String?

    private enum Key: String, CodingKey { case id, type, description, model, state, startedAt, endedAt, ms, action }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(String.self, forKey: .id)
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        description = (try? c.decode(String.self, forKey: .description)) ?? ""
        model = try? c.decode(String.self, forKey: .model)
        let word = (try? c.decode(String.self, forKey: .state)) ?? ""
        state = switch word {
        case "running": .running
        case "done": .done
        case "stopped": .stopped
        case "failed": .failed
        default: .other(word)
        }
        startedAt = try? c.decode(Double.self, forKey: .startedAt)
        endedAt = try? c.decode(Double.self, forKey: .endedAt)
        ms = Int((try? c.decode(Double.self, forKey: .ms)) ?? 0)
        action = try? c.decode(String.self, forKey: .action)
    }
}

/// One event of a session's stream, read. A name or a body this app does not know is `.other`, never an error.
public enum ChatEvent: Sendable, Equatable {
    case status(ChatStatus)
    case state(ChatState)
    case delta(String)
    case think(id: String, text: String?, done: Bool)
    case work(ChatWork?)
    case changed
    case subagents([Subagent])
    case outside(ChatWork?)
    case approval(PendingApproval)
    case approvalResolved(requestID: String)
    case hold(ChatHold)
    case holdEnded(id: String)
    case mode(String)
    case model(String)
    case effort(String)
    case fast(Bool)
    case turnEnd(error: Bool, message: String?)
    case terminal(JSONValue)
    case error(String)
    case exit
    case other(name: String)

    public init(_ event: SSEEvent) {
        self = Self.read(event) ?? .other(name: event.name)
    }

    private static func read(_ event: SSEEvent) -> ChatEvent? {
        func obj() -> JSONValue? { try? event.decode(JSONValue.self) }
        switch event.name {
        case "status": return (try? event.decode(ChatStatus.self)).map(ChatEvent.status)
        case "state": return (try? event.decode(StateBody.self)).map { .state($0.state) }
        case "delta": return obj()?["text"]?.string.map(ChatEvent.delta)
        case "think":
            guard let o = obj(), let id = o["id"]?.string else { return nil }
            return .think(id: id, text: o["text"]?.string, done: o["done"]?.bool ?? false)
        case "work": return .work(try? event.decode(ChatWork.self))
        case "outside": return .outside(try? event.decode(ChatWork.self))
        case "changed": return .changed
        case "subagents":
            guard let o = obj() else { return nil }
            let list = (o["agents"]?.array ?? []).compactMap { v in (try? JSONEncoder().encode(v)).flatMap { try? JSONDecoder().decode(Subagent.self, from: $0) } }
            return .subagents(list)
        case "approval": return (try? event.decode(PendingApproval.self)).map(ChatEvent.approval)
        case "approval-resolved": return obj()?["requestId"]?.string.map { .approvalResolved(requestID: $0) }
        case "hold": return (try? event.decode(ChatHold.self)).map(ChatEvent.hold)
        case "hold-ended": return obj()?["id"]?.string.map { .holdEnded(id: $0) }
        case "mode": return obj()?["mode"]?.string.map(ChatEvent.mode)
        case "model": return obj()?["model"]?.string.map(ChatEvent.model)
        case "effort": return obj()?["effort"]?.string.map(ChatEvent.effort)
        case "fast": return obj()?["fast"]?.bool.map(ChatEvent.fast)
        case "turn-end":
            let o = obj()
            let failed: Bool = switch o?["error"] { case .bool(let b)?: b; case .string(let s)?: !s.isEmpty; case .object?: true; default: false }
            return .turnEnd(error: failed, message: o?["message"]?.string)
        case "terminal": return obj().map(ChatEvent.terminal)
        case "error": return .error(obj()?["message"]?.string ?? "")
        case "exit": return .exit
        default: return nil
        }
    }

    private struct StateBody: Decodable { let state: ChatState }
}

// A row the app cannot read is left out, so one odd entry never empties a page.
struct LossyItem<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}
