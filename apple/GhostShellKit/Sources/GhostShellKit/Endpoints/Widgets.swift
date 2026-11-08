import Foundation

// NOTE: [8 Nov 2026] EK - The send route is the one the web page's widget prompt uses (`prompt` in public/ui/session.js), and the icon files are the
// ones public/ui/widget.js fetches as `../vendor/<name>`. If either moves, a widget's button and its icons stop working.

extension GhostShellClient {
    /// Sends a widget's prompt as the owner's message, in the mode the prompt box would use. The reply is the chat's status.
    public func sendPrompt(sessionID: String, text: String, mode: String?) async throws -> ChatStatus {
        guard !sessionID.isEmpty, !sessionID.contains("/") else { throw GhostShellError.badPath(sessionID) }
        return try await post("api/sessions/\(sessionID)/send", json: PromptBody(text: text, mode: mode))
    }

    /// The icon font or its stylesheet, as the server ships them.
    public func widgetIconFile(_ file: WidgetIconFile) async throws -> Data {
        try await data("GET", "vendor/\(file.rawValue)")
    }

    private struct PromptBody: Encodable, Sendable {
        var text: String
        var mode: String?
    }
}

public enum WidgetIconFile: String, Sendable {
    case font = "tabler-icons.woff2"
    case styles = "tabler-icons.min.css"
}
