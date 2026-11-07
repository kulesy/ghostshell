import Foundation

/// A message's text, set aside to be sent with the next message. `key` tells two quotes of the same words apart on screen.
public struct Quote: Hashable, Sendable, Identifiable {
    public let key: String
    public let text: String
    /// The session it was taken from.
    public let fromID: String
    public let fromTitle: String

    public init(key: String, text: String, fromID: String, fromTitle: String) {
        (self.key, self.text, self.fromID, self.fromTitle) = (key, text, fromID, fromTitle)
    }

    public var id: String { key }
}

/// How quotes go into a message. A quote travels as a markdown blockquote ahead of the text, so the CLI gets plain text and the server needs no change.
/// This mirrors quoteText, quotedMessage and messageFor in public/ui/quote-rules.js, and the page reads the same format back.
public enum QuoteRules {
    /// A message as one tidy block: LF line ends, plain spaces, no trailing spaces, at most one blank line in a row, and no blank line at either end.
    /// A single line loses its indent too, but the first line of several keeps it, so a code quote stays aligned.
    public static func clean(_ raw: String) -> String {
        var text = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").replacingOccurrences(of: "\u{00A0}", with: " ")
        text = text.replacingOccurrences(of: #"(?m)[ \t]+$"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        text = text.replacingOccurrences(of: #"^\n+"#, with: "", options: .regularExpression)
        while let last = text.last, last.isWhitespace { text.removeLast() }
        guard !text.contains("\n") else { return text }
        return String(text.drop(while: { $0.isWhitespace }))
    }

    private static func fromLine(_ title: String) -> String {
        let named = title.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return named.isEmpty ? "From another session:" : "From the session \"\(named)\":"
    }

    /// `here` is the id of the session the message goes to, nil for a new one. A quote from another session says which.
    public static func message(_ quotes: [Quote], text: String, here: String?) -> String {
        guard !quotes.isEmpty else { return text }
        let blocks = quotes.map { quote in
            ((quote.fromID != here ? [fromLine(quote.fromTitle)] : []) + quote.text.components(separatedBy: "\n").map { $0.isEmpty ? ">" : "> \($0)" })
                .joined(separator: "\n")
        }
        return (blocks + (text.isEmpty ? [] : [text])).joined(separator: "\n\n")
    }

    /// What a send writes and which quotes stay in the draft. The CLI runs a slash command only when it opens the message, so a command goes alone
    /// and the quotes wait for the next message.
    public static func messageFor(_ quotes: [Quote], text: String, here: String?) -> (message: String, kept: [Quote]) {
        if !quotes.isEmpty && SlashRules.isCommand(text) { return (text, quotes) }
        return (message(quotes, text: text, here: here), [])
    }
}
