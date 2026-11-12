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
            await fresh.run(reconnects: app.reconnects)
            fresh.close()
        }
    }
}

extension EnvironmentValues {
    /// The height of the chat's column, set by the chat screen. It is measured from the column and not from the prompt stack, because a stack that measured its own
    /// surroundings could change what it measured and never settle.
    @Entry var chatHeight: CGFloat = 560
}

private struct ChatLayout: View {
    let model: ChatModel
    @State private var height = EnvironmentValues().chatHeight

    var body: some View {
        @Bindable var chat = model.chat
        VStack(spacing: 0) {
            ChatThreadView()
            NoticeBar()
            AgentStrip()
            #if os(macOS)
            if chat.terminalOpen { ChatSlots.terminal(chat) }
            #endif
            ChatSlots.prompts(chat)
            ChatSlots.composer(chat)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .environment(\.chatHeight, height)
        // NOTE: [8 Nov 2026] EK - Keep .toolbar before .inspector: AppKit throws when the toolbar item is inserted into the inspector's toolbar section.
        .toolbar {
            ToolbarItemGroup {
                ChatSlots.fileToolbar(chat)
                ChatSlots.terminalToolbar(chat)
            }
        }
        #if os(iOS)
        // NOTE: [9 Nov 2026] EK - A phone has no room beside the thread, so the file panel and the terminal fill the screen and Back returns to the chat. They are not
        // navigationDestinations, because the split's compact column has no stack of its own, and a stack added there made Back pop the whole chat to the list.
        .overlay { if chat.terminalOpen { ChatSlots.terminal(chat).background(.background).accessibilityAddTraits(.isModal) } }
        .overlay { if chat.filePanelOpen { ChatSlots.filePanel(chat).background(.background).accessibilityAddTraits(.isModal) } }
        .navigationBarBackButtonHidden(chat.filePanelOpen || chat.terminalOpen)
        .toolbar {
            if chat.filePanelOpen || chat.terminalOpen {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        if chat.filePanelOpen { chat.filePanelOpen = false } else { chat.terminalOpen = false }
                    } label: { HStack(spacing: 4) { Image(systemName: "chevron.left").fontWeight(.semibold); Text("Back") }.phoneIconTouch() }
                }
            }
        }
        // The composer under the terminal would keep the keyboard.
        .onChange(of: chat.terminalOpen) { _, open in if open { dismissKeyboard() } }
        #else
        .inspector(isPresented: $chat.filePanelOpen) { ChatSlots.filePanel(chat) }
        #endif
        .overlay { ChatSlots.viewer(chat) }
        .environment(\.openURL, OpenURLAction { url in
            guard let link = ChatLink(url: url) else { return .discarded }
            return ChatSlots.openLink(link, chat) ? .handled : .discarded
        })
        .task { await model.keepDay() }
    }
}
