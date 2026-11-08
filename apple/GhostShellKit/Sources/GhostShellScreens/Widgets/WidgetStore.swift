import GhostShellKit
import SwiftUI

/// The widgets of one chat, by the tool call that made each. It lives in `ChatContext.store`, so it lasts one visit to the chat.
@MainActor
final class WidgetStore {
    private var controllers: [String: WidgetController] = [:]
    private let icons: WidgetIcons
    private let client: GhostShellClient

    init(client: GhostShellClient) {
        self.client = client
        icons = WidgetIcons.shared(for: client.address)
    }

    /// The widget for this call, made on first sight. A call whose code changed gets a fresh widget, as the web page's new document does.
    func controller(for tool: ToolCall, chat: ChatContext, mode: WidgetMode) -> WidgetController {
        let code = tool.input["widget_code"]?.string ?? ""
        if let held = controllers[tool.id], held.code == code { return held }
        controllers[tool.id]?.shutDown()
        let sessionID = chat.sessionID
        let made = WidgetController(
            code: code, title: tool.input["title"]?.string, mode: mode,
            sendPrompt: { [weak chat] text in
                guard let chat else { return WidgetController.failed }
                // A widget's button sends its text as the owner's message, in the mode the prompt box would use for a plain message.
                do {
                    let status = try await chat.client.sendPrompt(sessionID: sessionID, text: text, mode: chat.status?.mode)
                    chat.apply(status: status)
                    chat.refresh()
                    return nil
                } catch GhostShellError.refused(_, let message) {
                    return message
                } catch {
                    return WidgetController.failed
                }
            },
            loadIcons: { [icons, client] in await icons.load(with: client) })
        controllers[tool.id] = made
        return made
    }
}
