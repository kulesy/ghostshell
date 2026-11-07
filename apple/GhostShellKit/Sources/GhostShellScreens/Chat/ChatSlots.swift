import GhostShellKit
import SwiftUI

/// The files a message or a tool result carries.
struct ChatAttachments {
    enum Source: Hashable { case user, toolResult(tool: String) }
    var files: [ChatFile]
    var images: [ChatImageRef]
    var source: Source
}

/// A fenced code block, as the reply wrote it.
struct ChatCodeBlock: Hashable {
    var language: String
    var text: String
}

/// Where the features that come after the chat plug in. Each slot returns its default now. The owning PBI replaces that one body with a call into its
/// own folder, and nothing else in the chat changes. A slot gets the `ChatContext` of the chat it is drawn in.
@MainActor
enum ChatSlots {
    // https://github.com/kulesy/ghostshell/issues/84 - under the thread.
    @ViewBuilder static func composer(_ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/85 - above the composer, for `chat.status?.pending`: permissions, questions and plan approvals.
    @ViewBuilder static func prompts(_ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/89 - a tapped link. Return true when handled. Only a web link or a file link the server serves arrives.
    static func openLink(_ link: ChatLink, _ chat: ChatContext) -> Bool { ChatLinks.openInBrowser(link) }

    // https://github.com/kulesy/ghostshell/issues/89 - the files and pictures of a user message or a tool result. The default is a name chip and fetches nothing.
    @ViewBuilder static func attachments(_ attachments: ChatAttachments, _ chat: ChatContext) -> some View { AttachmentChips(attachments: attachments) }

    // https://github.com/kulesy/ghostshell/issues/89 - the inspector beside the thread, shown while `chat.filePanelOpen`.
    @ViewBuilder static func filePanel(_ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/90 - a `*__show_widget` call with `input.widget_code`.
    @ViewBuilder static func widget(_ tool: ToolCall, _ chat: ChatContext) -> some View { WidgetPlaceholder(tool: tool) }

    // https://github.com/kulesy/ghostshell/issues/91 - the panel under the thread, shown while `chat.terminalOpen`.
    @ViewBuilder static func terminal(_ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/91 - in the head of each code block.
    @ViewBuilder static func runButton(_ code: ChatCodeBlock, _ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/84 (quoting a message) - the context menu items of a user or assistant message.
    @ViewBuilder static func messageActions(_ message: ChatItem, _ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/89 - toolbar buttons, such as the file panel toggle.
    @ViewBuilder static func fileToolbar(_ chat: ChatContext) -> some View { EmptyView() }

    // https://github.com/kulesy/ghostshell/issues/91 - toolbar buttons, such as the terminal toggle.
    @ViewBuilder static func terminalToolbar(_ chat: ChatContext) -> some View { EmptyView() }
}

/// The default for a file or picture: its name, with no fetch.
private struct AttachmentChips: View {
    let attachments: ChatAttachments

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(attachments.files.enumerated()), id: \.offset) { _, file in
                Label(file.name, systemImage: "doc").labelStyle(.titleAndIcon).chip()
            }
            ForEach(Array(attachments.images.enumerated()), id: \.offset) { n, _ in
                Label(attachments.images.count > 1 ? "Image \(n + 1)" : "Image", systemImage: "photo").chip()
            }
        }
    }
}

private extension View {
    func chip() -> some View {
        font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// The default for a widget: a quiet card with its title.
private struct WidgetPlaceholder: View {
    let tool: ToolCall

    var body: some View {
        let title = tool.input["title"]?.string ?? ""
        Label(title.isEmpty ? "Widget" : "Widget: \(title)", systemImage: "square.grid.2x2")
            .font(.callout).foregroundStyle(.secondary)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}
