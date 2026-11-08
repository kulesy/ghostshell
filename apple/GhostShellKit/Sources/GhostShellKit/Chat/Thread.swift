import Foundation

/// The loaded part of a chat: items in order, with each result already merged into its tool and each message's blocks joined. It is a value, and an
/// item is never changed in place except by taking in a result or a later block, so a row can tell by equality whether it needs to draw again.
public struct ChatThread: Sendable {
    public private(set) var items: [ChatItem] = []
    private var orphans: [String: ToolResult] = [:]
    private var counter = 0

    public init() {}

    private mutating func nextKey() -> String { counter += 1; return "i\(counter)" }

    /// Takes in newer items after the ones held. A result settles the last tool with its id, or waits if that tool is in a part not loaded yet.
    public mutating func absorb(_ incoming: [ChatItem]) {
        var toolAt: [String: Int]?
        for var item in incoming {
            if case .result(let result) = item.body {
                if toolAt == nil { toolAt = Self.toolIndex(items) }
                if let at = toolAt?[result.toolID], case .tool(let call) = items[at].body {
                    items[at].body = .tool(call.settled(by: result))
                } else {
                    orphans[result.toolID] = orphans[result.toolID].map { Self.merge($0, result) } ?? result
                }
                continue
            }
            if case .assistant(let id, let text) = item.body, let last = items.last, case .assistant(let lastID, let lastText) = last.body, lastID == id {
                items[items.count - 1].body = .assistant(msgID: id, text: lastText + "\n\n" + text)
                continue
            }
            item.key = nextKey()
            if case .tool(let call) = item.body { toolAt?[call.id] = items.count }
            items.append(item)
        }
    }

    /// Takes in older items, in front. The results still waiting come after them in the file, so they settle the last call with their id, as a read of
    /// the whole file does. A message cut in two by the chunk boundary is joined again.
    public mutating func prepend(_ incoming: [ChatItem]) {
        var older = ChatThread()
        older.counter = counter
        older.absorb(incoming)
        let waiting = orphans
        orphans = [:]
        older.orphans = [:]
        older.absorb(waiting.values.map { ChatItem(body: .result($0)) })
        counter = older.counter
        orphans = older.orphans
        var list = older.items
        if let seam = list.last, case .assistant(let id, let text) = seam.body, let first = items.first, case .assistant(let firstID, let firstText) = first.body, id == firstID {
            // The joined message keeps the newer half's key, so the row the reader is on keeps its id.
            list[list.count - 1].body = .assistant(msgID: id, text: text + "\n\n" + firstText)
            list[list.count - 1].key = first.key
            list.append(contentsOf: items.dropFirst())
        } else {
            list.append(contentsOf: items)
        }
        items = list
    }

    public mutating func removeAll() { items = []; orphans = [:] }

    private static func toolIndex(_ list: [ChatItem]) -> [String: Int] {
        var at: [String: Int] = [:]
        for (n, item) in list.enumerated() { if case .tool(let call) = item.body { at[call.id] = n } }
        return at
    }

    private static func merge(_ a: ToolResult, _ b: ToolResult) -> ToolResult {
        ToolResult(toolID: a.toolID, status: b.status, output: b.output, images: b.images.isEmpty ? a.images : b.images)
    }
}

// MARK: Folding

/// What a run of tool calls and thoughts did, in the words the page uses.
public struct GroupSummary: Hashable, Sendable {
    public var title: String
    public var edited: Bool
    public var added: Int
    public var removed: Int
    /// "running", or "1 failed, 2 denied", or empty.
    public var note: String
    public var status: ToolStatus
}

public struct ChatGroup: Hashable, Sendable, Identifiable {
    public var id: String
    /// Thinking and tool items, in order. At least one is a tool.
    public var rows: [ChatItem]
    public var summary: GroupSummary
}

/// What the thread draws: an item as itself, or a folded group.
public enum ChatRow: Hashable, Sendable, Identifiable {
    case item(ChatItem)
    case group(ChatGroup)

    public var id: String {
        switch self {
        case .item(let item): item.key
        case .group(let group): group.id
        }
    }

    /// The keys of the items this row draws. A group's id follows its first item, so older items joining it change the id and not these.
    public var itemKeys: [String] {
        switch self {
        case .item(let item): [item.key]
        case .group(let group): group.rows.map(\.key)
        }
    }

    /// The id of the row in `rows` that draws any of `keys`, such as the row a reader was on before older items were put in front.
    public static func id(holding keys: [String], in rows: [ChatRow]) -> String? {
        let wanted = Set(keys)
        return rows.first { !wanted.isDisjoint(with: $0.itemKeys) }?.id
    }
}

public enum ChatFold {
    private static let widgetName = Rx(#"__show_widget$"#)
    private static let excluded = Rx(#"__(spawn_task|dismiss_task|mark_chapter)$"#)

    public static func isWidget(_ tool: ToolCall) -> Bool {
        widgetName.matches(tool.name) && !(tool.input["widget_code"]?.string ?? "").isEmpty
    }

    /// Thinking and any tool call fold into a run. Questions, chips, chapters and widgets end a run and draw as themselves.
    static func groupable(_ item: ChatItem) -> Bool {
        switch item.body {
        case .thinking: return true
        case .tool(let call): return call.name != "AskUserQuestion" && !excluded.matches(call.name) && !isWidget(call)
        default: return false
        }
    }

    /// A run holding a tool call folds into one group, with the thinking between the calls inside it. Thinking with no call beside it stays a row.
    public static func display(_ items: [ChatItem]) -> [ChatRow] {
        var out: [ChatRow] = []
        var run: [ChatItem] = []
        func close() {
            if run.contains(where: { if case .tool = $0.body { true } else { false } }) {
                out.append(.group(ChatGroup(id: "g" + run[0].key, rows: run, summary: summarize(run))))
            } else {
                out.append(contentsOf: run.map(ChatRow.item))
            }
            run = []
        }
        for item in joinBash(items) {
            if groupable(item) { run.append(item) } else { close(); out.append(.item(item)) }
        }
        close()
        return out
    }

    /// An older CLI wrote a command and its output as two items, the second with no command. They read as one.
    static func joinBash(_ items: [ChatItem]) -> [ChatItem] {
        guard items.contains(where: { if case .bash(let b) = $0.body { b.command.isEmpty } else { false } }) else { return items }
        var out: [ChatItem] = []
        for item in items {
            if case .bash(let b) = item.body, b.command.isEmpty, let before = out.last, case .bash(let a) = before.body, !a.command.isEmpty {
                out[out.count - 1].body = .bash(BashRun(command: a.command, stdout: a.stdout + b.stdout, stderr: a.stderr + b.stderr))
            } else {
                out.append(item)
            }
        }
        return out
    }

    // MARK: Words

    enum Kind: Hashable { case read, search, run, edit, web, fetch, agent, skill, todo, message, peers, chrome, other }

    private static let editTools: Set<String> = ["Edit", "MultiEdit", "Write", "NotebookEdit"]
    private static let kindOf: [String: Kind] = [
        "Read": .read, "NotebookRead": .read, "Grep": .search, "Glob": .search, "Bash": .run, "WebSearch": .web, "WebFetch": .fetch, "Agent": .agent,
        "Task": .agent, "Skill": .skill, "TodoWrite": .todo, "SendMessage": .message, "ListAgents": .peers,
    ]

    static func kind(of name: String) -> Kind {
        if editTools.contains(name) { return .edit }
        if let known = kindOf[name] { return known }
        return ChatText.chromeTool(name) != nil ? .chrome : .other
    }

    private static func phrase(_ kind: Kind, _ n: Int) -> String {
        switch kind {
        case .read: "read \(ChatText.plural(n, "file"))"
        case .search: "searched \(ChatText.plural(n, "time"))"
        case .run: "ran \(ChatText.plural(n, "command"))"
        case .edit: "edited \(ChatText.plural(n, "file"))"
        case .web: "searched the web \(ChatText.plural(n, "time"))"
        case .fetch: "fetched \(ChatText.plural(n, "page"))"
        case .agent: "started \(ChatText.plural(n, "agent"))"
        case .skill: "used \(ChatText.plural(n, "skill"))"
        case .todo: "updated the to-do list"
        case .message: "sent \(ChatText.plural(n, "message"))"
        case .peers: "looked up other sessions"
        case .chrome: "used Chrome \(ChatText.plural(n, "time"))"
        case .other: "used \(ChatText.plural(n, "tool"))"
        }
    }

    private static let doing: [Kind: String] = [
        .read: "Reading", .search: "Searching", .run: "Running", .edit: "Editing", .web: "Searching the web", .fetch: "Fetching", .agent: "Running an agent",
        .skill: "Using a skill", .todo: "Updating the to-do list", .message: "Sending a message", .peers: "Looking up other sessions", .chrome: "Using Chrome", .other: "Using",
    ]
    private static let object: [Kind: String] = [.read: "a file", .run: "a command", .edit: "a file", .fetch: "a page"]

    /// What a run of calls and thoughts did: the sentence, the changed-line counts, and whether any call is running or failed.
    public static func summarize(_ rows: [ChatItem]) -> GroupSummary {
        var order: [Kind] = []
        var sets: [Kind: Set<String>] = [:]
        var thoughts = 0, added = 0, removed = 0, pending = 0, failed = 0, denied = 0
        var edited = false
        for row in rows {
            if case .thinking = row.body { thoughts += 1; continue }
            guard case .tool(let call) = row.body else { continue }
            let k = kind(of: call.name)
            if sets[k] == nil { order.append(k); sets[k] = [] }
            let path = k == .read || k == .edit ? nonEmpty(call.input["file_path"]?.string) ?? nonEmpty(call.input["notebook_path"]?.string) : nil
            sets[k]?.insert(path ?? call.id)
            switch call.status {
            case .pending: pending += 1
            case .failed: failed += 1
            case .denied: denied += 1
            default: break
            }
            if k == .edit {
                edited = true
                if call.status == .pending || call.status == .ok { let (a, d) = linesChanged(call); added += a; removed += d }
            }
        }
        let text = ([thoughts > 0 ? "thought" : nil] + order.map { phrase($0, sets[$0]?.count ?? 0) }).compactMap { $0 }.joined(separator: ", ")
        let note = pending > 0 ? "running" : [failed > 0 ? "\(failed) failed" : nil, denied > 0 ? "\(denied) denied" : nil].compactMap { $0 }.joined(separator: ", ")
        return GroupSummary(title: text.prefix(1).uppercased() + text.dropFirst(), edited: edited, added: added, removed: removed, note: note,
                            status: pending > 0 ? .pending : (failed > 0 || denied > 0 ? .failed : .ok))
    }

    private static func nonEmpty(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }

    private static func splitLines(_ text: String?) -> [Substring] {
        guard var t = text, !t.isEmpty else { return [] }
        if t.hasSuffix("\n") { t.removeLast() }
        return t.split(separator: "\n", omittingEmptySubsequences: false)
    }

    /// The unchanged head and tail are trimmed, so changing one line inside a long block counts as one line.
    static func lineDelta(_ before: String?, _ after: String?) -> (Int, Int) {
        let a = splitLines(before), b = splitLines(after)
        var head = 0
        while head < a.count, head < b.count, a[head] == b[head] { head += 1 }
        var tail = 0
        while tail < a.count - head, tail < b.count - head, a[a.count - 1 - tail] == b[b.count - 1 - tail] { tail += 1 }
        return (b.count - head - tail, a.count - head - tail)
    }

    // Write and NotebookEdit carry no old text, so they count as added lines only.
    private static func linesChanged(_ call: ToolCall) -> (Int, Int) {
        let input = call.input
        if call.name == "Edit" { return lineDelta(input["old_string"]?.string, input["new_string"]?.string) }
        if call.name == "MultiEdit" {
            return (input["edits"]?.array ?? []).reduce((0, 0)) { total, edit in
                let (a, d) = lineDelta(edit["old_string"]?.string, edit["new_string"]?.string)
                return (total.0 + a, total.1 + d)
            }
        }
        return (splitLines(call.name == "Write" ? input["content"]?.string : input["new_source"]?.string).count, 0)
    }

    /// What Claude is doing from the live snapshot: the tool being run with what it works on, else thinking or writing.
    public static func activity(_ work: ChatWork?, connectors: [String: String] = [:]) -> (doing: String, detail: String) {
        let tools = work?.tools ?? []
        if tools.count > 1 {
            var seen = Set<String>()
            let names = tools.map { ChatText.fullToolLabel($0.name, connectors: connectors) }.filter { seen.insert($0).inserted }
            return ("Running \(ChatText.plural(tools.count, "tool"))", names.joined(separator: ", "))
        }
        if let tool = tools.first {
            let k = kind(of: tool.name)
            let detail = k == .other ? [ChatText.fullToolLabel(tool.name, connectors: connectors), tool.summary].filter { !$0.isEmpty }.joined(separator: ": ") : tool.summary
            return (doing[k] ?? "Using", detail)
        }
        return (work?.thinking == true ? "Thinking" : work?.writing == true ? "Writing" : "Working", "")
    }

    /// The phrase after the time and tokens on the status line.
    public static func doingNow(_ work: ChatWork?, connectors: [String: String] = [:]) -> String {
        let tools = work?.tools ?? []
        if tools.count > 1 { return "Running \(ChatText.plural(tools.count, "tool"))" }
        guard let tool = tools.first else { return work?.thinking == true ? "Thinking" : work?.writing == true ? "Writing" : "Working" }
        let k = kind(of: tool.name)
        let parts = k == .other ? ["Using", ChatText.fullToolLabel(tool.name, connectors: connectors)] : [doing[k] ?? "Using", object[k] ?? ""]
        return parts.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// What a running group says it is doing: the call still waiting for its result, else the last call.
    public static func step(_ rows: [ChatItem], connectors: [String: String] = [:]) -> String {
        let calls = rows.compactMap { row -> ToolCall? in if case .tool(let c) = row.body { c } else { nil } }
        guard let call = calls.last(where: { $0.status == .pending }) ?? calls.last else { return "" }
        let work = ChatWork(tools: [ChatWork.Tool(name: call.name, summary: call.summary)])
        let (verb, detail) = activity(work, connectors: connectors)
        return detail.isEmpty ? doingNow(work, connectors: connectors) : "\(verb) \(detail)"
    }

    /// When the group began, from its first row that has a time.
    public static func start(of rows: [ChatItem]) -> Date? { rows.lazy.compactMap(\.at).first }
}
