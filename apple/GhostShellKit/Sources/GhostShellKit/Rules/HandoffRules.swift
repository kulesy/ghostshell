import Foundation

/// What a chat says about a handoff its session saved before the prompt cache went cold. This mirrors public/ui/handoff-rules.js.
public enum HandoffRules {
    /// One line by the prompt box. `opens` is the session its button goes to, and `label` the button's words.
    public struct Line: Hashable, Sendable {
        public var text: String
        public var opens: String?
        public var label: String?
    }

    public static let coldLabel = "Handoff saved"

    public static func lines(for row: SessionRow?) -> [Line] {
        guard let row else { return [] }
        var lines: [Line] = []
        if row.cold { lines.append(Line(text: "Handoff saved, your next message starts a fresh session from it.")) }
        if let from = row.continues { lines.append(Line(text: "This session carries on from an earlier one.", opens: from, label: "Open the earlier session")) }
        if let to = row.continuedIn { lines.append(Line(text: "This work carries on in a fresh session.", opens: to, label: "Open it")) }
        return lines
    }
}
