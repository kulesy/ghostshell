import GhostShellKit
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import PhotosUI
#endif

/// The prompt box under a thread, and on the New Session screen: the quotes and attachments, the text, the slash list and a footer with the
/// attach button, the pickers and Send. It stays inside the thread's column.
struct ComposerView: View {
    let model: ComposerModel
    var placeholder = "Type / for commands"
    var autofocus = false
    @State private var importing = false
    @State private var targeted = false
    #if os(iOS)
    @State private var photos: [PhotosPickerItem] = []
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.notice.isEmpty { ErrorLine(text: model.notice) { model.notice = "" } }
            ComposerChips(model: model)
            field
            ViewThatFits(in: .horizontal) {
                footer(compact: false)
                footer(compact: true)
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 8)
        .background(.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(targeted ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.separator), lineWidth: targeted ? 2 : 1))
        .overlay(alignment: .topLeading) {
            if model.menuOpen { SlashMenu(model: model).offset(y: -(SlashMenu.height(for: model.matches.count) + 6)) }
        }
        .frame(maxWidth: ChatStyle.column)
        .padding(.horizontal, Self.sidePadding).padding(.top, 8).padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .layoutPriority(1)
        .task(id: model.wantsCommands) { if model.wantsCommands { await model.loadCommands() } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { model.attach(urls: urls); model.requestFocus() }
        }
        #if DEBUG
        // The test run attaches a file this way, because the file panel and the pasteboard can't be driven in the background.
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("GSDebugAttach"))) { note in
            if let path = note.object as? String { model.attach(urls: [URL(fileURLWithPath: path)]) }
        }
        #endif
        #if os(macOS)
        .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url { Task { @MainActor in model.attach(urls: [url]) } }
                }
            }
            return true
        }
        #endif
    }

    #if os(iOS)
    private static let sidePadding: CGFloat = 8
    #else
    private static let sidePadding: CGFloat = 20
    #endif

    private var field: some View {
        ZStack(alignment: .topLeading) {
            if model.text.isEmpty { Text(placeholder).foregroundStyle(.tertiary).allowsHitTesting(false) }
            if !model.hint.isEmpty {
                (Text(verbatim: model.text).foregroundStyle(.clear) + Text(verbatim: model.hint).foregroundStyle(.tertiary)).lineLimit(1).allowsHitTesting(false)
            }
            ComposerTextView(model: model, text: model.text, settle: model.settle, focusRequests: model.focusRequests, autofocus: autofocus)
        }
        .font(ChatStyle.body)
    }

    #if os(iOS)
    private func attach(_ picked: [PhotosPickerItem]) async {
        var items: [Incoming] = []
        for (n, item) in picked.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            items.append(Incoming(name: "Photo \(n + 1).\(item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg")", data: data))
        }
        if items.count < picked.count { model.notice = "Some of those photos could not be read." }
        if !items.isEmpty { model.attach(items) }
    }
    #endif

    /// The side of a control: 24pt under a pointer, 44pt for a thumb.
    nonisolated static let hit: CGFloat = {
        #if os(iOS)
        44
        #else
        24
        #endif
    }()

    private func footer(compact: Bool) -> some View {
        HStack(spacing: 4) {
            Button { importing = true } label: { Image(systemName: "plus").font(.system(size: 13, weight: .medium)).frame(width: Self.hit, height: Self.hit).contentShape(Rectangle()) }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .help("Attach files")
                .accessibilityLabel("Attach files")
            #if os(iOS)
            PhotosPicker(selection: $photos, maxSelectionCount: 5, matching: .images) {
                Image(systemName: "photo").font(.system(size: 13, weight: .medium)).frame(width: Self.hit, height: Self.hit).contentShape(Rectangle())
            }
            .foregroundStyle(.secondary)
            .accessibilityLabel("Attach photos")
            .onChange(of: photos) { _, picked in
                guard !picked.isEmpty else { return }
                photos = []
                Task { await attach(picked) }
            }
            #endif
            ComposerPickers(model: model, compact: compact)
            Spacer(minLength: 8)
            SendButton(model: model)
        }
    }
}

private struct SendButton: View {
    let model: ComposerModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let stop = model.showsStop
        let label = model.chat == nil ? "Start session" : (stop ? "Stop" : "Send")
        Button { Task { if stop { await model.stop() } else { await model.send() } } } label: {
            ZStack {
                Circle().fill(stop || model.canSend ? Color.accentColor : Color.secondary.opacity(0.3))
                if model.sending {
                    ProgressView().controlSize(.small).tint(scheme == .dark ? .black : .white)
                } else {
                    Image(systemName: stop ? "stop.fill" : "arrow.up").font(.system(size: 11, weight: .bold)).foregroundStyle(stop || model.canSend ? AnyShapeStyle(.background) : AnyShapeStyle(.secondary))
                }
            }
            .frame(width: 24, height: 24)
            .frame(width: ComposerView.hit, height: ComposerView.hit)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!stop && !model.canSend)
        .help(label)
        .accessibilityLabel(label)
    }
}

private struct ErrorLine: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            // The minimum width stops the window's minimum height being measured at a width of 0, where fixedSize gives each letter a line.
            Text(verbatim: text).textSelection(.enabled).frame(minWidth: 200, maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            Button("Dismiss", systemImage: "xmark", action: dismiss).labelStyle(.iconOnly).buttonStyle(.borderless).foregroundStyle(.secondary)
                #if os(iOS)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                #endif
        }
        .font(ChatStyle.small)
        .accessibilityElement(children: .contain)
    }
}

/// The slot's body: the chat's composer, made on first use and kept for the visit.
struct ComposerHost: View {
    @Environment(AppModel.self) private var app
    let chat: ChatContext

    var body: some View { ComposerView(model: ComposerModel.of(chat) { [app] in await app.refreshIndex() }, autofocus: true) }
}

/// "Quote" in the menu of a user or assistant message. It adds the whole message to the quotes every composer in the app shows.
struct QuoteMenuItem: View {
    @Environment(AppModel.self) private var app
    let message: ChatItem
    let chat: ChatContext

    var body: some View {
        if let text {
            Button("Quote", systemImage: "quote.opening") {
                ComposerStore.shared.addQuote(text, fromID: chat.sessionID, fromTitle: chat.session.title)
                ComposerModel.of(chat) { [app] in await app.refreshIndex() }.requestFocus()
            }
        }
    }

    private var text: String? {
        switch message.body {
        case .user(let user): user.text
        case .assistant(_, let text): text
        default: nil
        }
    }
}
