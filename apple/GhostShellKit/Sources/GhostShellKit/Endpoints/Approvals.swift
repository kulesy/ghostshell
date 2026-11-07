import Foundation

// NOTE: [8 Nov 2026] EK - The words and fields here mirror `cardParts` and `answersFor` in public/ui/approvals.js, and the request mirrors the `approve`
// action in server.mjs and `answer()` in lib/runner.mjs. If the page changes what a card says, change it here too.

/// What the person decides. `always` is honoured by the server only when the pending item has `always: true`.
public enum ApprovalDecision: Sendable, Equatable {
    case allow, always, deny
    /// Answers to a question card, keyed by the question's text.
    case answer([String: String])
}

public enum ApprovalOutcome: Sendable, Equatable {
    /// The server took the decision.
    case resolved
    /// The request was no longer pending (410): someone answered it elsewhere, or the turn ended. It is not a failure.
    case answeredElsewhere
}

private struct DecisionBody: Encodable, Sendable {
    var requestId: String
    var decision: String
    var answers: [String: String]?
}

extension GhostShellClient {
    /// Answers one pending prompt. A 410 is `.answeredElsewhere`. A 409 (the chat is not running here) and every other failure throws.
    public func decide(sessionID: String, requestID: String, _ decision: ApprovalDecision) async throws -> ApprovalOutcome {
        guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
        let body: DecisionBody
        switch decision {
        case .allow: body = DecisionBody(requestId: requestID, decision: "allow")
        case .always: body = DecisionBody(requestId: requestID, decision: "always")
        case .deny: body = DecisionBody(requestId: requestID, decision: "deny")
        case .answer(let answers): body = DecisionBody(requestId: requestID, decision: "answer", answers: answers)
        }
        do {
            try await send("api/sessions/\(sessionID)/approve", json: body)
            return .resolved
        } catch GhostShellError.server(status: 410) {
            return .answeredElsewhere
        }
    }
}

// MARK: Cards

public enum ApprovalKind: Equatable, Sendable { case permission, question, plan }

/// One option of a question.
public struct ApprovalOption: Equatable, Sendable {
    public var label: String
    public var description: String?
    public var preview: String?
}

/// One question of an `AskUserQuestion` prompt.
public struct ApprovalQuestion: Equatable, Sendable {
    public var question: String
    public var header: String?
    public var options: [ApprovalOption]
    public var multiSelect: Bool
}

/// What a person has picked for one question: option indexes in the order they were chosen, and their own text.
public struct ApprovalPick: Equatable, Sendable {
    public var chosen: [Int] = []
    public var other = ""

    public init(chosen: [Int] = [], other: String = "") { (self.chosen, self.other) = (chosen, other) }

    /// Many choices add and remove. One choice toggles, and clears the person's own text.
    public mutating func choose(_ option: Int, multiSelect: Bool) {
        if multiSelect {
            if let at = chosen.firstIndex(of: option) { chosen.remove(at: at) } else { chosen.append(option) }
        } else {
            chosen = chosen.contains(option) ? [] : [option]
            other = ""
        }
    }

    /// Typing an own answer to a single-choice question clears the chosen option.
    public mutating func type(_ text: String, multiSelect: Bool) {
        if !text.isEmpty && !multiSelect { chosen = [] }
        other = text
    }
}

/// A permission card's words: a title that says what is about to happen, then the parts of the call to read before answering.
public struct ApprovalParts: Equatable, Sendable {
    public struct Field: Equatable, Sendable {
        public var label: String
        public var value: String
    }

    public struct Diff: Equatable, Sendable {
        public var removed: [String]
        public var added: [String]
    }

    public var title: String
    public var path: String?
    public var fields: [Field]
    public var diff: Diff?
}

public enum Approvals {
    /// A question when the tool is `AskUserQuestion`, a plan when it is `ExitPlanMode` and carries a plan, else a permission.
    public static func kind(of prompt: PendingApproval) -> ApprovalKind {
        if prompt.tool == "AskUserQuestion" { return .question }
        if prompt.tool == "ExitPlanMode", let plan = plan(of: prompt), !plan.isEmpty { return .plan }
        return .permission
    }

    public static func plan(of prompt: PendingApproval) -> String? { prompt.input["plan"]?.string }

    // MARK: Questions

    public static func questions(of prompt: PendingApproval) -> [ApprovalQuestion] {
        (prompt.input["questions"]?.array ?? []).map { q in
            let options: [ApprovalOption] = (q["options"]?.array ?? []).compactMap { o in
                guard let label = o["label"]?.string, !label.isEmpty else { return nil }
                return ApprovalOption(label: label, description: o["description"]?.string.flatMap { $0.isEmpty ? nil : $0 },
                                      preview: o["preview"]?.string.flatMap { $0.isEmpty ? nil : $0 })
            }
            return ApprovalQuestion(question: q["question"]?.string ?? "", header: q["header"]?.string.flatMap { $0.isEmpty ? nil : $0 },
                                    options: options, multiSelect: q["multiSelect"]?.bool ?? false)
        }
    }

    /// The answers to send: for each question the chosen labels, then the person's own text, joined with ", ". A question with neither has no entry.
    public static func answers(for questions: [ApprovalQuestion], picks: [ApprovalPick]) -> [String: String] {
        var out: [String: String] = [:]
        for (n, q) in questions.enumerated() where picks.indices.contains(n) {
            var labels = picks[n].chosen.compactMap { q.options.indices.contains($0) ? q.options[$0].label : nil }
            let own = picks[n].other.trimmingCharacters(in: .whitespacesAndNewlines)
            if !own.isEmpty { labels.append(own) }
            if !labels.isEmpty { out[q.question] = labels.joined(separator: ", ") }
        }
        return out
    }

    /// Send answers is allowed once every question has an answer.
    public static func isComplete(_ questions: [ApprovalQuestion], answers: [String: String]) -> Bool {
        !questions.isEmpty && answers.count == questions.count
    }

    // MARK: Permission cards

    private static let uuid = Rx(#"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"#, .caseInsensitive)
    private static let serverID = Rx(#"^mcp__(.+)__"#)
    private static let mcpTool = Rx(#"^mcp__(.+?)__(.+)$"#)

    /// Where a tool comes from, worded for a sentence (`toolSource` in format.js): its connector or server, else the tool's own name.
    public static func toolSource(_ tool: String, connectors: [String: String] = [:]) -> String {
        let id = serverID.groups(tool)?[1] ?? ""
        if uuid.matches(id) { return connectors[id].flatMap { $0.isEmpty ? nil : $0 } ?? "a connector" }
        let server = ChatText.serverLabel(tool, connectors: connectors)
        return server.isEmpty ? ChatText.toolLabel(tool) : server
    }

    private static let layoutTitles: [String: String] = [
        "mcp__capcom__archive_session": "Claude wants to archive another session",
        "mcp__capcom__unarchive_session": "Claude wants to unarchive a session",
        "mcp__capcom__set_session_title": "Claude wants to rename a session",
        "mcp__capcom__move_session_to_group": "Claude wants to move a session to a group",
    ]

    /// `place` is what the chat's session belongs to, "group" or "section", for the card that starts a session in it.
    public static func parts(of p: PendingApproval, connectors: [String: String] = [:], place: String = "group") -> ApprovalParts {
        let i = p.input
        func field(_ label: String, _ value: String?) -> ApprovalParts.Field? {
            guard let value, !value.isEmpty else { return nil }
            return ApprovalParts.Field(label: label, value: value)
        }
        func card(_ title: String, path: String? = nil, _ fields: ApprovalParts.Field?..., diff: ApprovalParts.Diff? = nil) -> ApprovalParts {
            ApprovalParts(title: title, path: path.flatMap { $0.isEmpty ? nil : $0 }, fields: fields.compactMap { $0 }, diff: diff)
        }
        func clipped(_ key: String, _ lines: Int = 40) -> String? { i[key]?.string.map { ChatText.clip($0, lines: lines, characters: .max) } }

        switch p.tool {
        case "Bash": return card("Bash wants to run a command", field("Command", text(i["command"])))
        case "Edit":
            let before = ChatText.clip(text(i["old_string"]) ?? "", lines: 30, characters: .max)
            let after = ChatText.clip(text(i["new_string"]) ?? "", lines: 30, characters: .max)
            return card("Edit wants to change", path: p.summary, diff: .init(removed: before.components(separatedBy: "\n"), added: after.components(separatedBy: "\n")))
        case "Write": return card("Write wants to create or replace", path: p.summary, field("New content", clipped("content")))
        case "NotebookEdit": return card("NotebookEdit wants to change", path: p.summary, field("New source", clipped("new_source")))
        case "Read": return card("Read wants to open", path: p.summary)
        case "WebFetch": return card("WebFetch wants to fetch a page", field("URL", text(i["url"])), field("Asks", text(i["prompt"])))
        case "WebSearch": return card("WebSearch wants to search the web", field("Query", text(i["query"])))
        case "Agent", "Task": return card("Claude wants to start a subagent", field("Task", text(i["description"])), field("Prompt", clipped("prompt", 12)))
        case "mcp__capcom__start_group_session":
            return card("Claude wants to start a session in this \(place)", field("Folder", text(i["cwd"])), field("Title", text(i["title"])), field("First message", clipped("prompt", 12)))
        case "mcp__capcom__send_session": return card("Claude wants to message another session", path: p.summary, field("Message", clipped("message", 12)))
        case "SendMessage": return card("Claude wants to message another session", field("To", text(i["to"])), field("Message", clipped("message", 12)))
        default: break
        }
        if let title = layoutTitles[p.tool] { return card(title, path: p.summary) }
        if let chrome = ChatText.chromeTool(p.tool) { return chromeParts(chrome, i) }

        let fields: [ApprovalParts.Field] = members(i).sorted { $0.key < $1.key }
            .compactMap { key, value in field(key, text(value)) }.prefix(8).map { $0 }
        let title: String
        if mcpTool.matches(p.tool) {
            let source = toolSource(p.tool, connectors: connectors)
            title = "\(source.prefix(1).uppercased() + source.dropFirst()) wants to use \(ChatText.toolLabel(p.tool))"
        } else {
            title = "\(p.label ?? p.tool) wants to run"
        }
        return ApprovalParts(title: title, path: nil, fields: fields, diff: nil)
    }

    private static func chromeParts(_ tool: String, _ i: JSONValue) -> ApprovalParts {
        func field(_ label: String, _ value: String?) -> ApprovalParts.Field? {
            guard let value, !value.isEmpty else { return nil }
            return ApprovalParts.Field(label: label, value: value)
        }
        func form(_ what: String, _ fields: ApprovalParts.Field?...) -> ApprovalParts {
            ApprovalParts(title: "Chrome wants to \(what)", path: nil, fields: fields.compactMap { $0 }, diff: nil)
        }
        let tab = field("Tab", text(i["tabId"]))
        switch tool {
        case "navigate": return form("open a page", field("URL", text(i["url"])), tab)
        case "computer":
            let action = text(i["action"])
            let coordinate = (i["coordinate"]?.array ?? []).compactMap { text($0) }.joined(separator: ", ")
            return form("\(action.flatMap { $0.isEmpty ? nil : $0 } ?? "act") on a page", field("Action", action), field("Text", text(i["text"])),
                        field("Where", coordinate.isEmpty ? text(i["ref"]) : coordinate), tab)
        case "javascript_tool": return form("run JavaScript in a tab", field("Script", text(i["text"])), tab)
        case "form_input": return form("fill in a form field", field("Field", text(i["ref"])), field("Value", i["value"].map { $0 == .null ? "null" : text($0) } ?? ""), tab)
        case "find": return form("search a page", field("Looking for", text(i["query"])), tab)
        case "file_upload": return form("upload a file", field("Files", (i["paths"]?.array ?? []).compactMap { text($0) }.joined(separator: "\n")), field("Field", text(i["ref"])), tab)
        default:
            let fields = members(i).sorted { $0.key < $1.key }.compactMap { key, value in field(key, value.string ?? compact(value)) }
            return ApprovalParts(title: "Chrome wants to use \(ChatText.toolLabel(tool))", path: nil, fields: fields, diff: nil)
        }
    }

    private static func members(_ value: JSONValue) -> [String: JSONValue] {
        if case .object(let o) = value { return o }
        return [:]
    }

    /// A value as the card shows it: a string as it is, anything else as indented JSON. Nil for a missing or null value.
    private static func text(_ value: JSONValue?) -> String? {
        switch value {
        case nil, .null?: nil
        case .string(let s)?: s
        case let other?: other.pretty()
        }
    }

    private static func compact(_ value: JSONValue) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(value)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }

    /// The words under a card whose decision failed.
    public static func message(for error: Error) -> String {
        switch error as? GhostShellError {
        case .server(status: 409)?: "This chat is not running here, so it can't take an answer."
        case .server(status: 400)?: "The server did not accept that answer."
        case let known?: known.errorDescription ?? "That did not go through."
        case nil: "That did not go through. Try again."
        }
    }

    /// Everything the call holds, for the All input disclosure.
    public static func allInput(of prompt: PendingApproval) -> String {
        if case .null = prompt.input { return "{}" }
        return prompt.input.pretty()
    }
}
