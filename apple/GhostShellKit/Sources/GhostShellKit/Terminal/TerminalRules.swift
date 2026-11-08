import Foundation

// NOTE: [8 Nov 2026] EK - These rules mirror public/ui/terminal-rules.js, which test/terminal-rules.test.mjs pins. The server draws a block's Run
// button from the same rule (public/md.mjs), so a change there is a change here. Lengths are UTF-16 units, as the page counts them.
// See https://github.com/kulesy/ghostshell/issues/91.

/// Where a command came from, as the server takes it.
public enum TerminalSource: String, Sendable {
    case panel, block, bang
}

/// What Run would run for a fenced block. `hidden` says the block holds characters the owner cannot see, and Run is then refused.
public struct RunnableBlock: Equatable, Sendable {
    public var command: String
    public var hidden: Bool
}

public enum TerminalRules {
    /// The server refuses a longer command, so a block that long gets no Run button.
    public static let maxCommand = 100_000
    /// How much output the app keeps for a run. The server keeps 1 MB and sends a summary's last 64 KB.
    public static let keep = 256 * 1024
    static let runsKept = 100
    static let historyKept = 200

    // MARK: Code blocks

    private static let shellBlocks: Set<String> = ["bash", "sh", "zsh", "shell"]

    /// What a browser draws as nothing: controls other than tab and newline, format and line-separator characters, spaces other than a plain
    /// one, the default-ignorable code points and the braille blank. A command holding any is not the command the block shows.
    public static func hasHiddenCharacters(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            if scalar == "\t" || scalar == "\n" || scalar == " " { return false }
            if scalar.value == 0x2800 || scalar.properties.isDefaultIgnorableCodePoint { return true }
            switch scalar.properties.generalCategory {
            case .control, .format, .lineSeparator, .paragraphSeparator, .spaceSeparator: return true
            default: return false
            }
        }
    }

    /// What Run would run for a fenced block, or nil when the block is not a command. `language` is the fence's word. A bash, sh, zsh or shell
    /// block runs as written, a console block runs only its "$ " lines, and a block with no word runs when it is a single line.
    public static func runnableBlock(language: String?, text: String) -> RunnableBlock? {
        let kind = (language ?? "").lowercased()
        let lines = lines(of: text)
        let filled = lines.filter { !jsTrim($0).isEmpty }
        guard !filled.isEmpty else { return nil }
        var command: String
        if readsAsConsole(kind, filled) {
            command = promptCommands(lines).map(\.command).joined(separator: "\n")
        } else if shellBlocks.contains(kind) {
            command = text
        } else if kind.isEmpty {
            command = filled.count == 1 ? filled[0] : ""
        } else {
            return nil
        }
        command = jsTrim(command)
        guard !command.isEmpty, command.utf16.count <= maxCommand else { return nil }
        return RunnableBlock(command: command, hidden: hasHiddenCharacters(text))
    }

    /// The lines of a console block that are commands, as line numbers with `to` included, and none for a block that runs as written. The page
    /// draws them apart from the output, so the wrapped tail of a long command is seen to be part of it.
    public static func commandLines(language: String?, text: String) -> [ClosedRange<Int>] {
        let all = lines(of: text)
        let kind = (language ?? "").lowercased()
        guard readsAsConsole(kind, all.filter { !jsTrim($0).isEmpty }) else { return [] }
        return promptCommands(all).map { $0.from...$0.to }
    }

    // Split on "\n" by scalar, because a Character joins "\r\n" and the page splits it in two.
    private static func lines(of text: String) -> [String] {
        text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { String(String.UnicodeScalarView($0)) }
    }

    // By scalar: String.hasPrefix compares characters, so "$ " followed by a combining mark would not match as the page's startsWith does.
    private static func isPrompt(_ line: String) -> Bool { jsTrimStart(line).unicodeScalars.starts(with: "$ ".unicodeScalars) }

    private static func readsAsConsole(_ kind: String, _ filled: [String]) -> Bool {
        kind == "console" || (shellBlocks.contains(kind) && filled.allSatisfy(isPrompt)) || (kind.isEmpty && filled.count == 1 && isPrompt(filled[0]))
    }

    // Each line after "$ ", a line ending in a backslash taking the next as its own.
    private static func promptCommands(_ lines: [String]) -> [(from: Int, to: Int, command: String)] {
        var out: [(Int, Int, String)] = []
        var i = 0
        while i < lines.count {
            defer { i += 1 }
            guard isPrompt(lines[i]) else { continue }
            let from = i
            var command = String(jsTrimStart(lines[i]).unicodeScalars.dropFirst(2))
            while command.unicodeScalars.last == "\\", i + 1 < lines.count {
                i += 1
                command += "\n" + lines[i]
            }
            out.append((from, i, command))
        }
        return out
    }

    // JavaScript's trim drops these, which is not the set Swift's whitespace drops.
    private static func isJSSpace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    static func jsTrimStart(_ text: String) -> String {
        String(String.UnicodeScalarView(text.unicodeScalars.drop(while: isJSSpace)))
    }

    static func jsTrim(_ text: String) -> String {
        var view = Substring(jsTrimStart(text)).unicodeScalars
        while let last = view.last, isJSSpace(last) { view.removeLast() }
        return String(view)
    }

    // MARK: Input history

    /// The commands the panel has run, oldest first, with a command run twice in a row listed once.
    public static func historyOf(_ runs: [TerminalRun]) -> [String] {
        var list: [String] = []
        for run in runs where !run.command.isEmpty && list.last != run.command { list.append(run.command) }
        return Array(list.suffix(historyKept))
    }

    /// Where Up or Down has got to in the history: `at` is the place in the list being shown, or nil when the input holds what was typed,
    /// which `draft` keeps while a command from the list is on show.
    public struct Recall: Equatable, Sendable {
        public var at: Int?
        public var draft: String
        public var text: String
    }

    /// One press of Up (-1) or Down (1) in the input, or nil when the key does nothing.
    public static func recall(list: [String], at: Int?, draft: String, text: String, direction: Int) -> Recall? {
        guard !list.isEmpty else { return nil }
        if direction < 0 {
            if at == 0 { return nil }
            let next = at.map { $0 - 1 } ?? list.count - 1
            return Recall(at: next, draft: at == nil ? text : draft, text: list[next])
        }
        guard let at else { return nil }
        return at == list.count - 1 ? Recall(at: nil, draft: "", text: draft) : Recall(at: at + 1, draft: draft, text: list[at + 1])
    }

    // MARK: Output

    /// The words of a run's output with the app's own echo of what was typed left out, which is how two accounts of it are compared.
    public static func textOf(_ chunks: [TerminalChunk]) -> String {
        chunks.filter { $0.stream != "in" }.map(\.text).joined()
    }

    /// A summary carries only the last 64 KB of a run. What is held is kept when it ends with those words, because it is the fuller account,
    /// and otherwise the summary wins, since some output was missed.
    public static func mergeOutput(held: [TerminalChunk], tail: [TerminalChunk]) -> [TerminalChunk] {
        if held.isEmpty { return tail }
        return textOf(held).hasSuffix(textOf(tail)) ? held : tail
    }

    /// `output` with `chunks` after it, joined to the last piece when it is the same stream, and the oldest words dropped past `cap`.
    public static func appendChunks(_ output: [TerminalChunk], _ chunks: [TerminalChunk], cap: Int = keep) -> [TerminalChunk] {
        var next = output
        for chunk in chunks where !chunk.text.isEmpty {
            if let last = next.last, last.stream == chunk.stream { next[next.count - 1].text += chunk.text } else { next.append(chunk) }
        }
        var size = next.reduce(0) { $0 + $1.text.utf16.count }
        while size > cap, !next.isEmpty {
            let over = size - cap
            let first = next[0].text.utf16.count
            if first <= over {
                size -= first
                next.removeFirst()
            } else {
                next[0].text = dropUnits(next[0].text, over)
                size = cap
            }
        }
        return next
    }

    // Drops at least `count` UTF-16 units from the front, never splitting a pair.
    private static func dropUnits(_ text: String, _ count: Int) -> String {
        var dropped = 0
        var view = text.unicodeScalars[...]
        while dropped < count, let first = view.first {
            dropped += first.value > 0xFFFF ? 2 : 1
            view = view.dropFirst()
        }
        return String(view)
    }

    // MARK: The runs held

    /// A run in `runs` with the server's summary of it. A summary of a run not known yet takes the place of the one drawn while the app waited
    /// for the server, which is a pending run with the same command and source, so it never shows twice.
    public static func upsertRun(_ runs: [TerminalRun], _ incoming: TerminalRun) -> [TerminalRun] {
        var next = runs
        if let known = next.firstIndex(where: { $0.id == incoming.id }) {
            let held = next[known]
            // The answer to the request that started a run can arrive after the event that says it ended, and is then the older account.
            if !held.running, incoming.running { return runs }
            var merged = incoming
            merged.key = held.key
            merged.pending = false
            merged.output = mergeOutput(held: held.output, tail: incoming.output)
            merged.revision = held.revision + 1
            next[known] = merged
            return next
        }
        if let waiting = next.firstIndex(where: { $0.pending && $0.command == incoming.command && $0.source == incoming.source }) {
            var merged = incoming
            merged.key = next[waiting].key
            merged.pending = false
            next[waiting] = merged
            return next
        }
        var fresh = incoming
        fresh.key = incoming.id ?? fresh.key
        fresh.pending = false
        next.append(fresh)
        return Array(next.suffix(runsKept))
    }

    /// The runs after the server sends all of them: each summary joined to the run held for it, and the runs still waiting for the server at the end.
    /// A run waiting for the server goes once a summary the app did not know matches its command and source, which is the server's run for it.
    public static func replaceRuns(held: [TerminalRun], summaries: [TerminalRun]) -> [TerminalRun] {
        let byID = Dictionary(held.compactMap { run in run.id.map { ($0, run) } }, uniquingKeysWith: { first, _ in first })
        var waiting = held.filter(\.pending)
        var runs = summaries.map { summary -> TerminalRun in
            var run = summary
            if let was = summary.id.flatMap({ byID[$0] }) {
                run.key = was.key
                run.output = mergeOutput(held: was.output, tail: summary.output)
                run.revision = was.revision + 1
            } else if let n = waiting.firstIndex(where: { $0.command == summary.command && $0.source == summary.source }) {
                run.key = waiting.remove(at: n).key
            }
            run.pending = false
            return run
        }
        runs += waiting
        return Array(runs.suffix(runsKept))
    }

    /// The newest run the server knows is running.
    public static func lastRunning(_ runs: [TerminalRun]) -> TerminalRun? {
        runs.last { $0.running && !$0.pending }
    }

    // MARK: Where the input sends

    /// Which run the input is pinned to: a run, or none (`run` nil), until the box is empty again.
    public struct InputPin: Equatable, Sendable {
        public var run: String?
        public init(run: String?) { self.run = run }
    }

    /// An empty input follows the newest running run. The first text typed pins it to the run it shows then, or to none, so a run that starts
    /// from elsewhere mid-typing does not take an Enter or Ctrl+C meant for something else.
    public static func pinAfter(_ pin: InputPin?, runs: [TerminalRun], text: String) -> InputPin? {
        text.isEmpty ? nil : pin ?? InputPin(run: lastRunning(runs)?.id)
    }

    /// Where Enter, Ctrl+C and Ctrl+D go: `run` is the running run, or nil when Enter runs a command. `ended` says the pinned run has finished,
    /// and the text, which was meant as input to it, is then not run as a command.
    public static func inputTarget(runs: [TerminalRun], pin: InputPin?) -> (run: TerminalRun?, ended: Bool) {
        guard let pin else { return (lastRunning(runs), false) }
        guard let id = pin.run else { return (nil, false) }
        let run = runs.first { $0.id == id && $0.running && !$0.pending }
        return (run, run == nil)
    }

    // MARK: How a run reads

    /// A folder with the home folder written as ~, only where the path starts with it.
    public static func inHome(_ path: String, home: String) -> String {
        if path.isEmpty { return "" }
        if home.isEmpty { return path }
        if path == home { return "~" }
        return path.hasPrefix(home + "/") ? "~" + path.dropFirst(home.count) : path
    }

    /// The last folder of a path, which is how a run's prompt names where it ran.
    public static func folderOf(_ path: String, home: String) -> String {
        if path.isEmpty { return "" }
        if path == home { return "~" }
        var trimmed = Substring(path)
        while trimmed.hasSuffix("/") { trimmed = trimmed.dropLast() }
        let last = trimmed.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        return last.isEmpty ? "/" : last
    }

    /// How long a run took: tenths of a second up to ten seconds, then whole seconds, minutes and hours.
    public static func took(_ ms: Double) -> String {
        guard ms >= 0 else { return "" }
        if ms < 9950 { return String(format: "%.1fs", ms / 1000) }
        let s = Int(ms / 1000)
        if s < 60 { return "\(s)s" }
        let m = s / 60
        return m < 60 ? "\(m)m \(pad(s % 60))s" : "\(m / 60)h \(pad(m % 60))m"
    }

    private static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    /// How a finished run ended, in words: `Exit 0`, `Stopped`, or the signal that ended it.
    public static func ending(_ run: TerminalRun) -> String {
        if run.stopped { return "Stopped" }
        if let signal = run.signal { return "Ended by \(signal)" }
        return "Exit \(run.exitCode.map(String.init) ?? "?")"
    }

    public enum RunState: String, Sendable { case running, stopped, ok, failed }

    /// The state a run is in, which colours its footer.
    public static func runState(_ run: TerminalRun) -> RunState {
        if run.running { return .running }
        if run.stopped || run.signal != nil { return .stopped }
        return run.exitCode == 0 ? .ok : .failed
    }

    /// How a run stands, in the words its footer uses. `now` is in milliseconds since 1970.
    public static func runStanding(_ run: TerminalRun, now: Double) -> String {
        if run.pending { return "Starting" }
        if run.running { return "Running \(took(now - run.startedAt))" }
        let span = run.endedAt.map { took($0 - run.startedAt) } ?? ""
        return [ending(run), span, run.truncated ? "Output cut" : "", deliveredWords(run.delivered)].filter { !$0.isEmpty }.joined(separator: " \u{B7} ")
    }

    /// What the panel says aloud when a run ends, since the output itself is not read out as it arrives.
    public static func endedAloud(_ run: TerminalRun) -> String {
        let words = run.stopped ? "was stopped" : run.signal.map { "ended with \($0)" } ?? "finished with exit code \(run.exitCode.map(String.init) ?? "unknown")"
        let line = run.command.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return "Command \(words): \(line.utf16.count > 80 ? String(line.prefix(80)) + "..." : line)"
    }

    /// What the server did with the result of a command run with !, in the words the footer uses.
    public static func deliveredWords(_ delivered: String?) -> String {
        delivered == "sent" ? "Sent to Claude" : delivered == "held" ? "Added to your next message" : ""
    }
}
