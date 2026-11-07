import SwiftUI

/// The stub thread, inside the layout the slots hang from. The chat PBI replaces the thread.
struct ChatScreen: View {
    @Environment(AppModel.self) private var model
    let sessionID: String
    @State private var chat: ChatContext?

    var body: some View {
        let title = model.rows.first { $0.id == sessionID }?.title ?? ""
        Group {
            if let chat { ChatLayout(chat: chat, title: title) } else { Color.clear }
        }
        .navigationTitle(title.isEmpty ? "Untitled" : title)
        .task(id: sessionID) {
            guard let client = model.client else { return }
            let fresh = ChatContext(sessionID: sessionID, client: client)
            chat = fresh
            defer { fresh.close() }
            try? await Task.sleep(for: .seconds(86_400 * 365))
        }
    }
}

private struct ChatLayout: View {
    @Bindable var chat: ChatContext
    let title: String

    var body: some View {
        VStack(spacing: 0) {
            Text(title.isEmpty ? "Untitled" : title)
                .font(.title2)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if chat.terminalOpen { ChatSlots.terminal(chat) }
            ChatSlots.prompts(chat)
            ChatSlots.composer(chat)
        }
        .inspector(isPresented: $chat.filePanelOpen) { ChatSlots.filePanel(chat) }
        .toolbar { ToolbarItemGroup { ChatSlots.toolbar(chat) } }
    }
}
