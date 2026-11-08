import Foundation

// NOTE: [8 Nov 2026] EK - These types mirror the terminal routes in server.mjs (terminalApi) and the summaries in lib/terminal.mjs.
// Decoding is lenient: a field this app does not know is ignored and a missing one reads as empty, so one odd run never empties the panel.
// See https://github.com/kulesy/ghostshell/issues/91.

extension GhostShellClient {
    /// The folder, the home folder and the runs the server holds for a chat. It starts nothing.
    public func terminalSnapshot(sessionID: String) async throws -> TerminalSnapshot {
        try await get(try Self.terminalPath(sessionID, ""))
    }

    /// Starts `command` in the chat's folder. Only an owner action calls this: a Run click, Enter in the panel, or a `!` command.
    public func runCommand(sessionID: String, command: String, source: TerminalSource) async throws -> TerminalRun {
        let reply: TerminalRunReply = try await post(try Self.terminalPath(sessionID, "/run"), json: RunBody(command: command, source: source.rawValue))
        return reply.run
    }

    /// Text for a running command's standard input, or its end with `eof`.
    public func sendInput(sessionID: String, run: String, text: String, eof: Bool = false) async throws {
        try await send(try Self.terminalPath(sessionID, "/input"), json: InputBody(run: run, text: text, eof: eof))
    }

    public func stopCommand(sessionID: String, run: String) async throws -> TerminalRun {
        let reply: TerminalRunReply = try await post(try Self.terminalPath(sessionID, "/stop"), json: StopBody(run: run))
        return reply.run
    }

    /// Drops the finished runs. The reply holds the folder and the runs left.
    public func clearTerminal(sessionID: String) async throws -> TerminalCleared {
        try await post(try Self.terminalPath(sessionID, "/clear"), json: Empty())
    }

    private static func terminalPath(_ sessionID: String, _ step: String) throws -> String {
        guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
        return "api/sessions/\(sessionID)/terminal\(step)"
    }
}

/// The words for a refused terminal call. The client keeps the server's own words for a 400, 404 or 409, and those pass through. For a 403, 415 or 429
/// it keeps only the status, so these are the server's sentences for them. An error that is not the server's (offline, signed out) keeps its own words.
public enum TerminalFailure {
    public enum Step: Sendable { case read, run, input, stop, clear }

    /// Only a server that could not be reached, or that failed, is worth asking again. A refusal gives the same answer next time.
    public static func isTemporary(_ error: Error) -> Bool {
        switch error as? GhostShellError {
        case .unreachable: true
        case .server(let status): status >= 500
        default: false
        }
    }

    public static func words(_ error: Error, step: Step) -> String {
        guard case GhostShellError.server(let status) = error else { return error.localizedDescription }
        switch (status, step) {
        case (403, _): return "Cross-site request refused."
        case (415, _): return "Send JSON."
        case (409, .run): return "The session's folder does not exist on this Mac."
        case (409, _): return "That command is not taking input."
        case (404, .input), (404, .stop): return "No such command in this session."
        case (404, _): return "No session with that id on this Mac."
        case (429, _): return "Too many commands are running. Wait for one to finish."
        case (400, .read), (400, .run): return "This session has no terminal."
        default: return error.localizedDescription
        }
    }
}

// MARK: Wire

/// One piece of a run's output. `stream` is `out`, `err`, or `in` for the app's own echo of what was typed.
public struct TerminalChunk: Hashable, Sendable, Decodable {
    public var stream: String
    public var text: String

    public init(stream: String, text: String) {
        self.stream = stream
        self.text = text
    }
}

/// A command the owner ran. Times are milliseconds since 1970. A `pending` run is one drawn while the server has not answered, so it has no `id`.
public struct TerminalRun: Hashable, Sendable, Decodable {
    /// The identity a row keeps from the moment it is drawn, whether or not the server has an id for it yet.
    public var key: String
    public var id: String?
    public var command: String
    public var cwd: String
    public var source: String
    public var startedAt: Double
    public var endedAt: Double?
    public var exitCode: Int?
    public var signal: String?
    public var stopped: Bool
    public var running: Bool
    public var truncated: Bool
    public var delivered: String?
    public var output: [TerminalChunk]
    public var pending: Bool
    /// Rises each time the output changes, which a trimmed output (held at its cap) does not show by its size.
    public var revision = 0

    enum CodingKeys: String, CodingKey {
        case id, command, cwd, source, startedAt, endedAt, exitCode, signal, stopped, running, truncated, delivered, output
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .id)
        key = id
        self.id = id
        command = (try? c.decode(String.self, forKey: .command)) ?? ""
        cwd = (try? c.decode(String.self, forKey: .cwd)) ?? ""
        source = (try? c.decode(String.self, forKey: .source)) ?? "panel"
        startedAt = (try? c.decode(Double.self, forKey: .startedAt)) ?? 0
        endedAt = try? c.decode(Double.self, forKey: .endedAt)
        exitCode = try? c.decode(Int.self, forKey: .exitCode)
        signal = try? c.decode(String.self, forKey: .signal)
        stopped = (try? c.decode(Bool.self, forKey: .stopped)) ?? false
        running = (try? c.decode(Bool.self, forKey: .running)) ?? false
        truncated = (try? c.decode(Bool.self, forKey: .truncated)) ?? false
        delivered = try? c.decode(String.self, forKey: .delivered)
        output = ((try? c.decode([LossyItem<TerminalChunk>].self, forKey: .output)) ?? []).compactMap(\.value)
        pending = false
    }

    /// A run drawn at once, before the server has answered.
    public init(waiting command: String, cwd: String, source: TerminalSource, key: String, now: Double) {
        self.key = key
        id = nil
        self.command = command
        self.cwd = cwd
        self.source = source.rawValue
        startedAt = now
        endedAt = nil
        exitCode = nil
        signal = nil
        stopped = false
        running = true
        truncated = false
        delivered = nil
        output = []
        pending = true
    }
}

public struct TerminalSnapshot: Sendable, Decodable {
    public var cwd: String
    public var home: String
    public var runs: [TerminalRun]

    enum CodingKeys: String, CodingKey { case cwd, home, runs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cwd = (try? c.decode(String.self, forKey: .cwd)) ?? ""
        home = (try? c.decode(String.self, forKey: .home)) ?? ""
        runs = ((try? c.decode([LossyItem<TerminalRun>].self, forKey: .runs)) ?? []).compactMap(\.value)
    }
}

public struct TerminalCleared: Sendable, Decodable {
    public var cwd: String?
    public var runs: [TerminalRun]

    enum CodingKeys: String, CodingKey { case cwd, runs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cwd = try? c.decode(String.self, forKey: .cwd)
        runs = ((try? c.decode([LossyItem<TerminalRun>].self, forKey: .runs)) ?? []).compactMap(\.value)
    }
}

struct TerminalRunReply: Decodable, Sendable { var run: TerminalRun }

private struct RunBody: Encodable, Sendable { var command: String; var source: String }
private struct InputBody: Encodable, Sendable { var run: String; var text: String; var eof: Bool }
private struct StopBody: Encodable, Sendable { var run: String }
private struct Empty: Encodable, Sendable {}
