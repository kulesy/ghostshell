import GhostShellKit
import SwiftUI

/// What the chat's file slots call into: a tapped link, the pictures and files of a message, the panel beside the thread, its toolbar button and the
/// image viewer. The state is one `FilesStore` per chat. https://github.com/kulesy/ghostshell/issues/89
@MainActor
enum FilesSlot {
    static func store(_ chat: ChatContext) -> FilesStore { chat.store(FilesStore.self) { FilesStore(chat: chat) } }

    /// A web link goes to the browser. A file link is fetched through the server, which allows only a path the chat's replies link.
    static func openLink(_ link: ChatLink, _ chat: ChatContext) -> Bool {
        switch link {
        case .web: return ChatLinks.openInBrowser(link)
        case .file(let path, let line):
            store(chat).open(path: path, line: line, autoplay: ChatFiles.isClip(path))
            return true
        }
    }

    @ViewBuilder static func attachments(_ attachments: ChatAttachments, _ chat: ChatContext) -> some View {
        AttachmentsView(attachments: attachments, chat: chat)
    }

    @ViewBuilder static func panel(_ chat: ChatContext) -> some View { FilePanel(chat: chat, store: store(chat)) }

    @ViewBuilder static func toolbar(_ chat: ChatContext) -> some View { FileToolbarButton(chat: chat, store: store(chat)) }

    @ViewBuilder static func viewer(_ chat: ChatContext) -> some View { ImageViewerOverlay(store: store(chat)) }
}

/// Shows or hides the panel, once a file has been opened in this chat.
private struct FileToolbarButton: View {
    let chat: ChatContext
    let store: FilesStore

    var body: some View {
        if store.file != nil {
            Button { chat.filePanelOpen.toggle() } label: {
                Label(chat.filePanelOpen ? "Hide file" : "Show file", systemImage: chat.filePanelOpen ? "sidebar.trailing" : "doc.text")
            }
            .help(chat.filePanelOpen ? "Hide file" : "Show file")
        }
    }
}
