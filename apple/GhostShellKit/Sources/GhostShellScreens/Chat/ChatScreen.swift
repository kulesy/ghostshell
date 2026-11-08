import GhostShellKit
import SwiftUI

/// A session's chat: the thread, the line that says what Claude is doing, and the layout the slots hang from.
struct ChatScreen: View {
    let sessionID: String
    /// A chat that is not a row in the list, such as a group's own, is named by the screen that holds it.
    var title: String?

    var body: some View { ChatHost(sessionID: sessionID, named: title).id(sessionID) }
}

private struct ChatHost: View {
    @Environment(AppModel.self) private var app
    let sessionID: String
    var named: String?
    @State private var model: ChatModel?

    var body: some View {
        let title = named ?? app.rows.first { $0.id == sessionID }?.title ?? ""
        Group {
            if let model { ChatLayout(model: model).environment(model) } else { Color.clear }
        }
        .navigationTitle(title.isEmpty ? "Untitled" : title)
        .task {
            guard let client = app.client else { return }
            let fresh = ChatModel(chat: ChatContext(sessionID: sessionID, client: client))
            model = fresh
            await fresh.run()
            fresh.close()
        }
    }
}

private struct ChatLayout: View {
    let model: ChatModel

    var body: some View {
        @Bindable var chat = model.chat
        VStack(spacing: 0) {
            ChatThreadView()
            NoticeBar()
            AgentStrip()
            if chat.terminalOpen { ChatSlots.terminal(chat) }
            ChatSlots.prompts(chat)
            ChatSlots.composer(chat)
        }
        // NOTE: [8 Nov 2026] EK - Keep .toolbar before .inspector: AppKit throws when the toolbar item is inserted into the inspector's toolbar section.
        .toolbar {
            ToolbarItemGroup {
                ChatSlots.fileToolbar(chat)
                ChatSlots.terminalToolbar(chat)
            }
        }
        .inspector(isPresented: $chat.filePanelOpen) { ChatSlots.filePanel(chat) }
        .overlay { ChatSlots.viewer(chat) }
        .environment(\.openURL, OpenURLAction { url in
            guard let link = ChatLink(url: url) else { return .discarded }
            return ChatSlots.openLink(link, chat) ? .handled : .discarded
        })
        .task { await model.keepDay() }
    }
}
