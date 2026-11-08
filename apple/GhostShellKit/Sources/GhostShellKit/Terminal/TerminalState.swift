import Foundation

// NOTE: [8 Nov 2026] EK - This mirrors public/ui/terminal-state.js. A command runs only because a caller of the store was told to: the owner's Run tap,
// Enter in the panel, or Return in the prompt. `apply` takes the server's events and never starts anything.
// See https://github.com/kulesy/ghostshell/issues/91.

/// An `event: terminal` frame of the chat's stream.
public enum TerminalEvent: Equatable, Sendable {
    case state(cwd: String, home: String, runs: [TerminalRun])
    case output(run: String, chunks: [TerminalChunk])
    case run(TerminalRun)
    case cwd(String)
    case cleared(runs: [TerminalRun])

    /// The event a frame carries, or nil for any other frame or one this app cannot read.
    public static func decode(_ frame: SSEEvent) -> TerminalEvent? {
        guard frame.name == "terminal", let wire = try? frame.decode(Wire.self) else { return nil }
        switch wire.type {
        case "state": return .state(cwd: wire.cwd ?? "", home: wire.home ?? "", runs: wire.runs)
        case "output": return wire.run.flatMap { id in wire.chunks.isEmpty ? nil : .output(run: id, chunks: wire.chunks) }
        case "run": return wire.summary.map { .run($0) }
        case "cwd": return wire.cwd.map { .cwd($0) }
        case "cleared": return .cleared(runs: wire.runs)
        default: return nil
        }
    }

    private struct Wire: Decodable {
        var type: String
        var cwd: String?
        var home: String?
        var run: String?
        var summary: TerminalRun?
        var runs: [TerminalRun]
        var chunks: [TerminalChunk]

        enum CodingKeys: String, CodingKey { case type, cwd, home, run, runs, chunks }

        // `run` is a run's id in an output event and a whole summary in a run event.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            type = try c.decode(String.self, forKey: .type)
            cwd = try? c.decode(String.self, forKey: .cwd)
            home = try? c.decode(String.self, forKey: .home)
            run = try? c.decode(String.self, forKey: .run)
            summary = try? c.decode(TerminalRun.self, forKey: .run)
            runs = ((try? c.decode([LossyItem<TerminalRun>].self, forKey: .runs)) ?? []).compactMap(\.value)
            chunks = ((try? c.decode([LossyItem<TerminalChunk>].self, forKey: .chunks)) ?? []).compactMap(\.value)
        }
    }
}

/// One chat's terminal: the runs held, the folder the panel is in and the line being typed. Plain data, so the store only draws and calls it.
public struct TerminalState: Equatable, Sendable {
    public var ready = false
    public var cwd = ""
    public var home = ""
    public var runs: [TerminalRun] = []
    public var input = ""
    public var sendTo: TerminalRules.InputPin?
    public var error = ""
    /// What the panel says aloud, with `announceCount` going up each time so the same words are said again.
    public var announce = ""
    public var announceCount = 0

    public init() {}

    /// The server's account of a change.
    public mutating func apply(_ event: TerminalEvent) {
        switch event {
        case .state(let cwd, let home, let runs):
            ready = true
            self.cwd = cwd
            self.home = home
            self.runs = TerminalRules.replaceRuns(held: self.runs, summaries: runs)
        case .run(let incoming):
            let was = runs.first { $0.id == incoming.id } ?? runs.first { $0.pending && $0.command == incoming.command && $0.source == incoming.source }
            runs = TerminalRules.upsertRun(runs, incoming)
            if was?.running == true, !incoming.running { say(TerminalRules.endedAloud(incoming)) }
        case .output(let id, let chunks):
            guard let n = runs.firstIndex(where: { $0.id == id }) else { return }
            runs[n].output = TerminalRules.appendChunks(runs[n].output, chunks)
        case .cwd(let dir):
            cwd = dir
        case .cleared(let left):
            runs = TerminalRules.replaceRuns(held: runs, summaries: left)
        }
    }

    /// The snapshot a GET returned, which says the same as a `state` event.
    public mutating func apply(_ snapshot: TerminalSnapshot) {
        apply(.state(cwd: snapshot.cwd, home: snapshot.home, runs: snapshot.runs))
    }

    /// The events that arrived while the snapshot was being read. The snapshot already ends with the first few output events of a run, so those
    /// are dropped and the rest are appended, which keeps a repeated chunk (a progress dot) that the snapshot did not hold.
    public mutating func applyHeld(_ events: [TerminalEvent]) {
        var skip: [String: Int] = [:]
        var heldText: [String: [String]] = [:]
        for case .output(let id, let chunks) in events { heldText[id, default: []].append(chunks.map(\.text).joined()) }
        for (id, texts) in heldText {
            guard let run = runs.first(where: { $0.id == id }) else { continue }
            let have = TerminalRules.textOf(run.output)
            skip[id] = (1...texts.count).reversed().first { have.hasSuffix(texts.prefix($0).joined()) } ?? 0
        }
        for event in events {
            if case .output(let id, _) = event, let left = skip[id], left > 0 {
                skip[id] = left - 1
                continue
            }
            apply(event)
        }
    }

    /// Draws a command at once, before the server has answered, because the first one after the server starts can wait a couple of seconds.
    /// Returns its key, or nil when the same command from the same source is still starting, which is a double tap.
    public mutating func begin(command: String, source: TerminalSource, key: String, now: Double) -> String? {
        if runs.contains(where: { $0.pending && $0.command == command && $0.source == source.rawValue }) { return nil }
        runs.append(TerminalRun(waiting: command, cwd: cwd, source: source, key: key, now: now))
        error = ""
        return key
    }

    /// The server refused the command, so the row drawn for it goes.
    public mutating func refused(key: String) {
        runs.removeAll { $0.key == key }
    }

    /// The server's summary of a run, such as the answer to a start or a stop.
    public mutating func settle(_ run: TerminalRun) {
        runs = TerminalRules.upsertRun(runs, run)
    }

    /// What is typed to a running command goes as written, and the panel draws it in the output because the command has no terminal to echo it.
    public mutating func typed(to id: String, text: String, eof: Bool) {
        error = ""
        guard let n = runs.firstIndex(where: { $0.id == id }) else { return }
        runs[n].output = TerminalRules.appendChunks(runs[n].output, [TerminalChunk(stream: "in", text: eof ? "^D\n" : text)])
    }

    public mutating func cleared(cwd fresh: String?, runs left: [TerminalRun]) {
        if let fresh { cwd = fresh }
        runs = TerminalRules.replaceRuns(held: runs, summaries: left)
    }

    /// `to` is given only to put back text that was taken out, which goes back to where it was headed.
    public mutating func setInput(_ text: String, to: TerminalRules.InputPin? = nil) {
        input = text
        sendTo = TerminalRules.pinAfter(to ?? sendTo, runs: runs, text: text)
    }

    private mutating func say(_ words: String) {
        announce = words
        announceCount += 1
    }
}
