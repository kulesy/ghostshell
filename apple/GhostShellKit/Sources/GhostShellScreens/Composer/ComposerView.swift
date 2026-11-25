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
        content
        .frame(maxWidth: ChatStyle.column)
        .padding(.horizontal, Self.sidePadding).padding(.top, Self.topPadding).padding(.bottom, Self.bottomPadding)
        .frame(maxWidth: .infinity)
        .background(Self.dock)
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
    private static let topPadding: CGFloat = 8
    private static let bottomPadding: CGFloat = 12
    private static let dock = AnyShapeStyle(.bar)
    private static let hintInk = AnyShapeStyle(.tertiary)
    #else
    private static let sidePadding = ChatStyle.threadInset
    private static let topPadding = 0.5 * GhostMetrics.current.rem
    private static let bottomPadding = 0.5 * GhostMetrics.current.rem
    private static let dock = ChatStyle.dock
    private static let hintInk = ChatStyle.muted
    #endif

    #if os(iOS)
    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            notice
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
    }
    #else
    @Environment(\.colorScheme) private var scheme
    private let rem = GhostMetrics.current.rem

    /// The page's box: the attachments over one row of attach button, field and Send, with the pickers under it.
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            notice.padding(.bottom, 0.375 * rem)
            VStack(alignment: .leading, spacing: 0) {
                ComposerChips(model: model)
                HStack(alignment: .bottom, spacing: 0) {
                    Button { importing = true } label: {
                        Image(systemName: "plus").font(.system(size: 1.05 * rem, weight: .regular)).foregroundStyle(Color.ghost.foreground)
                            .frame(width: 2 * rem, height: 2 * rem).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Attach files")
                    .accessibilityLabel("Attach files")
                    .padding(.bottom, 0.375 * rem)
                    field.padding(.horizontal, 0.25 * rem).padding(.vertical, 0.75 * rem).frame(minHeight: 2.75 * rem)
                    SendButton(model: model).padding(.bottom, 0.375 * rem)
                }
                .padding(.horizontal, 0.375 * rem)
            }
            .background(targeted ? Color.ghost.accent : (scheme == .dark ? Color.ghost.input.opacity(0.3) : .clear), in: GhostCorner(GhostMetrics.current.xl))
            .overlay(GhostCorner(GhostMetrics.current.xl).strokeBorder(targeted || model.focused ? Color.ghost.ring : Color.ghost.input, style: StrokeStyle(lineWidth: 1, dash: targeted ? [4, 3] : [])))
            .overlay { if model.focused { GhostCorner(GhostMetrics.current.xl).inset(by: -1.5).stroke(Color.ghost.ring.opacity(0.5), lineWidth: 3) } }
            .overlay(alignment: .topLeading) {
                if model.menuOpen { SlashMenu(model: model).offset(y: -(SlashMenu.height(for: model.matches.count) + 6)) }
            }
            // As on the page, the row wraps when it does not fit: the mode on one line, the account, model and effort under it at the right.
            // The ring sits outside the choice so it is built once and keeps its popover open.
            HStack(alignment: .bottom, spacing: 0.1 * rem) {
                ViewThatFits(in: .horizontal) {
                    ComposerPickers(model: model, compact: false)
                    ComposerPickers(model: model, compact: false, wrapped: true)
                }
                if let chat = model.chat { ContextMeter(sessionID: chat.sessionID) }
            }
            .padding(.horizontal, 0.25 * rem).padding(.top, 0.3 * rem)
        }
    }
    #endif

    @ViewBuilder private var notice: some View {
        if !model.notice.isEmpty { ErrorLine(text: model.notice) { model.notice = "" } }
    }

    private var field: some View {
        ZStack(alignment: .topLeading) {
            if model.text.isEmpty { Text(placeholder).foregroundStyle(Self.hintInk).allowsHitTesting(false) }
            if !model.hint.isEmpty {
                (Text(verbatim: model.text).foregroundStyle(.clear) + Text(verbatim: model.hint).foregroundStyle(Self.hintInk)).lineLimit(1).allowsHitTesting(false)
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

    /// The side of a control: the page's 2rem under a pointer, 44pt for a thumb.
    nonisolated static let hit: CGFloat = {
        #if os(iOS)
        44
        #else
        30
        #endif
    }()

    #if os(iOS)
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
    #endif
}

private struct SendButton: View {
    let model: ComposerModel
    @Environment(\.colorScheme) private var scheme

    #if os(macOS)
    private static let disc = ComposerView.hit
    private func fill(ready: Bool) -> Color { Color.ghost.primary.opacity(ready ? 1 : 0.5) }
    private func glyph(ready: Bool) -> Color { Color.ghost.primaryForeground }
    #else
    private static let disc: CGFloat = 24
    private func fill(ready: Bool) -> Color { ready ? Color.accentColor : Color.secondary.opacity(0.3) }
    private func glyph(ready: Bool) -> AnyShapeStyle { ready ? AnyShapeStyle(.background) : AnyShapeStyle(.secondary) }
    #endif

    var body: some View {
        let stop = model.showsStop
        let label = model.chat == nil ? "Start session" : (stop ? "Stop" : "Send")
        Button { Task { if stop { await model.stop() } else { await model.send() } } } label: {
            ZStack {
                Circle().fill(fill(ready: stop || model.canSend))
                if model.sending {
                    Spinner().tint(scheme == .dark ? .black : .white)
                } else {
                    Image(systemName: stop ? "stop.fill" : "arrow.up").font(.system(size: 11, weight: .bold)).foregroundStyle(glyph(ready: stop || model.canSend))
                }
            }
            .frame(width: Self.disc, height: Self.disc)
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
