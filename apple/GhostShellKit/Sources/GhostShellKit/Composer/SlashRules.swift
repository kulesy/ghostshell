import Foundation

/// What the composer's `/` list does with the text. This mirrors public/ui/command-rules.js. Carets are UTF-16 offsets, as `NSRange` counts them.
public enum SlashRules {
    /// A message that opens with /name is a slash command for the CLI. A mention of a file or a quote in front of it would stop that.
    public static func isCommand(_ text: String) -> Bool {
        text.range(of: #"^\s*/[A-Za-z][\w:.-]*(?=\s|$)"#, options: .regularExpression) != nil
    }

    /// The word being typed: the text starts with `/` and the caret is inside that first word or at its end.
    /// `query` is what follows the `/`, and `end` is where the word stops.
    public static func typed(in text: String, caret: Int) -> (query: String, end: Int)? {
        let units = Array(text.utf16)
        guard units.first == 0x2F, caret >= 1, caret <= units.count else { return nil }
        if units[..<caret].contains(where: isSpace) { return nil }
        let end = units.firstIndex(where: isSpace) ?? units.count
        return (String(decoding: units[1..<end], as: UTF16.self), end)
    }

    private static func isSpace(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.whitespacesAndNewlines.contains(scalar)
    }

    /// How well a command fits the query, best first: its name is the query, its name starts with it, an alias starts with it, a part of its name
    /// starts with it, or its name holds it. Nil when none does.
    static func rank(_ command: SlashCommand, _ query: String) -> Int? {
        let name = command.name.lowercased()
        if name == query { return 0 }
        if name.hasPrefix(query) { return 1 }
        if command.aliases.contains(where: { $0.lowercased().hasPrefix(query) }) { return 2 }
        if name.split(whereSeparator: { "-_:.".contains($0) }).contains(where: { $0.hasPrefix(query) }) { return 3 }
        return name.contains(query) ? 4 : nil
    }

    /// The commands that fit the query, best first and in the CLI's order within a rank. An empty query fits them all.
    public static func matching(_ commands: [SlashCommand], query: String) -> [SlashCommand] {
        let q = query.lowercased()
        guard !q.isEmpty else { return commands }
        return commands.enumerated().compactMap { n, command in rank(command, q).map { (n, $0, command) } }
            .sorted { ($0.1, $0.0) < ($1.1, $1.0) }.map(\.2)
    }

    /// The text with its first word replaced by the command and one space after it, and the caret just past that space.
    public static func pick(_ name: String, in text: String) -> (text: String, caret: Int) {
        let units = Array(text.utf16)
        let end = units.firstIndex(where: isSpace) ?? units.count
        var rest = String(decoding: units[end...], as: UTF16.self)
        if let first = rest.first, first == " " || first == "\t" { rest.removeFirst() }
        let head = "/\(name) "
        return (head + rest, head.utf16.count)
    }

    /// The argument hint to show after the text, which is only a command typed in full with a single space after it.
    public static func hint(for commands: [SlashCommand]?, text: String) -> String {
        guard text.hasPrefix("/"), text.hasSuffix(" "), text.dropFirst().dropLast().allSatisfy({ !$0.isWhitespace }), text.count > 2 else { return "" }
        let word = String(text.dropFirst().dropLast())
        return commands?.first { $0.name == word || $0.aliases.contains(word) }?.hint ?? ""
    }
}
