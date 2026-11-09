import GhostShellKit
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The inspector beside the thread: one file, no history.
struct FilePanel: View {
    let chat: ChatContext
    @Bindable var store: FilesStore

    var body: some View {
        VStack(spacing: 0) {
            if let file = store.file {
                FileHeader(store: store, file: file)
                Divider()
                FileNotes(store: store, file: file)
                FileBody(store: store, file: file)
                    // A new file or line starts a fresh view, so the text scrolls to its own line.
                    .id("\(file.path)\u{0}\(file.line ?? 0)")
                    .clipped()
                FileFooter(file: file)
            } else {
                Text("No file open.").font(ChatStyle.small).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .inspectorColumnWidth(min: 320, ideal: 460, max: 900)
        // The chat sets this on the layout, and the inspector is part of it. Set again so a link in a rendered file can only reach the chat's own path.
        .environment(\.openURL, OpenURLAction { url in
            guard let link = ChatLink(url: url) else { return .discarded }
            return FilesSlot.openLink(link, chat) ? .handled : .discarded
        })
        .alert(store.alert?.title ?? "", isPresented: Binding(get: { store.alert != nil }, set: { if !$0 { store.alert = nil } }), presenting: store.alert) { alert in
            if alert.conflict {
                Button("Copy text") { store.copyEdit() }
                Button("Discard and reload", role: .destructive) { store.discardEdit() }
                Button("Keep editing", role: .cancel) {}
            } else {
                Button("OK", role: .cancel) {}
            }
        } message: { alert in
            Text(verbatim: alert.message)
        }
        .confirmationDialog("Your changes to this file will be lost.", isPresented: $store.confirmDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) { store.discardEdit() }
            Button("Keep editing", role: .cancel) {}
        }
        #if os(iOS)
        .fileExporter(isPresented: Binding(get: { store.export != nil }, set: { if !$0 { store.export = nil } }),
                      document: store.export.map { BytesDocument($0.data) }, contentType: .data, defaultFilename: store.export?.name) { result in
            if case .failure(let error) = result { store.alert = .init(title: "Cannot save this file", message: error.localizedDescription) }
        }
        #endif
    }
}

private struct FileHeader: View {
    let store: FilesStore
    let file: FilesStore.Opened

    var body: some View {
        let preview = file.preview
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: ChatFiles.displayName(preview?.name.isEmpty == false ? preview!.name : (file.path as NSString).lastPathComponent))
                    .font(ChatStyle.body.weight(.semibold)).lineLimit(1).truncationMode(.middle)
                    .help(file.path)
                if let preview { Text(verbatim: ChatFiles.fileSize(preview.size)).font(ChatStyle.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            if store.edit != nil {
                Button("Cancel") { dismissKeyboard(); store.cancelEdit() }
                    .phoneTouch().phoneIconTouch().compactOnMac().disabled(store.edit?.saving == true)
                Button("Save") { dismissKeyboard(); store.save() }
                    .buttonStyle(.borderedProminent).compactOnMac().phoneIconTouch()
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(store.edit.map { $0.saving || !($0.changed || $0.conflict) } ?? true)
            } else {
                if store.canEdit { iconButton("Edit", "pencil") { store.startEdit() } }
                if preview?.kind == .markdown {
                    iconButton(store.showSource ? "Show rendered" : "Show source", store.showSource ? "doc.richtext" : "chevron.left.forwardslash.chevron.right") {
                        store.showSource.toggle()
                    }
                }
                #if os(macOS)
                if let preview, !preview.tooLarge { iconButton("Download", "arrow.down.circle") { store.download() } }
                #else
                if let preview, !preview.tooLarge { iconButton("Save to Files", "square.and.arrow.down") { store.saveToFiles() } }
                #endif
                iconButton("Close", "xmark") { store.close() }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func iconButton(_ name: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(name, systemImage: symbol).labelStyle(.iconOnly) }
            .buttonStyle(.borderless).phoneIconTouch().help(name)
    }
}

/// The small lines between the header and the file: why it cannot be edited, what a draft is, a conflict, a save.
private struct FileNotes: View {
    let store: FilesStore
    let file: FilesStore.Opened

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if store.edit == nil, let why = file.preview?.readOnly { note(why, "lock") }
            if let edit = store.edit {
                if edit.conflict {
                    note("This file changed on disk after you opened it, so nothing was saved. Your text is still here.", "exclamationmark.triangle")
                } else if edit.restored {
                    note("These are your unsaved edits from earlier. Nothing is saved yet.", "clock.arrow.circlepath")
                }
            }
            if let saved = store.saved { note(saved, "checkmark.circle") }
        }
        .padding(.horizontal, 12).padding(.vertical, store.edit == nil && file.preview?.readOnly == nil && store.saved == nil ? 0 : 6)
    }

    private func note(_ words: String, _ symbol: String) -> some View {
        Label { Text(verbatim: words) } icon: { Image(systemName: symbol) }
            .font(ChatStyle.small).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FileFooter: View {
    let file: FilesStore.Opened

    var body: some View {
        if let preview = file.preview, preview.truncated, let lines = file.lines {
            Text(verbatim: "Showing the first \(lines.count) lines of \(ChatFiles.fileSize(preview.size)).")
                .font(ChatStyle.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(.bar)
        }
    }
}

private struct FileBody: View {
    let store: FilesStore
    let file: FilesStore.Opened

    var body: some View {
        if store.edit != nil {
            FileEditor(store: store)
        } else if let preview = file.preview {
            if preview.tooLarge {
                FileCard(store: store, preview: preview)
            } else {
                switch preview.kind {
                case .markdown where !store.showSource && file.blocks != nil:
                    ScrollView {
                        MarkdownView(blocks: file.blocks ?? [])
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    }
                case .markdown, .text:
                    if let lines = file.lines { NumberedText(lines: lines, highlight: file.line) } else { FileCard(store: store, preview: preview) }
                case .pdf:
                    switch store.media {
                    case .pdf(let data): PDFPane(data: data)
                    case .failed(let words): problem(words)
                    default: loading
                    }
                case .audio:
                    AudioPane(store: store, path: file.path)
                default:
                    FileCard(store: store, preview: preview)
                }
            }
        } else if let error = file.error {
            problem(error)
        } else {
            loading
        }
    }

    private var loading: some View {
        ProgressView("Loading").controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func problem(_ words: String) -> some View {
        Text(verbatim: words).font(ChatStyle.small).foregroundStyle(.secondary)
            .multilineTextAlignment(.center).padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A file the panel cannot show: its kind, its size and, where it can be saved, Download on the Mac and Save to Files on a phone.
private struct FileCard: View {
    let store: FilesStore
    let preview: FilePreview

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc").font(.system(size: 32, weight: .light)).foregroundStyle(.secondary).accessibilityHidden(true)
            Text(verbatim: ChatFiles.kindName(preview.name)).font(ChatStyle.body.weight(.semibold))
            Text(verbatim: ChatFiles.fileSize(preview.size)).font(ChatStyle.small).foregroundStyle(.secondary)
            if preview.tooLarge {
                Text("This file is too large to open here.").font(ChatStyle.small).foregroundStyle(.secondary)
            }
            #if os(macOS)
            if !preview.tooLarge { Button("Download") { store.download() }.padding(.top, 4) }
            #else
            if !preview.tooLarge { Button("Save to Files") { store.saveToFiles() }.phoneTouch(boxed: true).padding(.top, 4) }
            #endif
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A text file with its line numbers. The line the reply linked is tinted and brought to the middle.
private struct NumberedText: View {
    let lines: [String]
    let highlight: Int?

    var body: some View {
        if lines.isEmpty {
            Text("This file is empty.").font(ChatStyle.small).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            let gutter = CGFloat(String(lines.count).count) * 7.6 + 4
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(lines.indices, id: \.self) { row in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(verbatim: String(row + 1)).font(ChatStyle.monoSmall).foregroundStyle(.tertiary)
                                    .frame(width: gutter, alignment: .trailing).accessibilityHidden(true)
                                Text(verbatim: lines[row].isEmpty ? " " : lines[row]).font(ChatStyle.mono)
                                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.horizontal, 10)
                            .background(highlight == row + 1 ? Color.accentColor.opacity(0.2) : Color.clear)
                            .id(row + 1)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .task {
                    guard let highlight, (1...lines.count).contains(highlight) else { return }
                    // Lazy rows need a pass to lay out before the scroll can find the line.
                    try? await Task.sleep(for: .milliseconds(60))
                    proxy.scrollTo(highlight, anchor: .center)
                }
            }
        }
    }
}

private struct FileEditor: View {
    let store: FilesStore

    var body: some View {
        let text = Binding(get: { store.edit?.text ?? "" }, set: { store.edit?.text = $0; store.parkDraft() })
        let readOnly = store.edit?.saving ?? false
        #if os(macOS)
        CodeTextView(text: text, readOnly: readOnly).padding(.horizontal, 8).padding(.vertical, 6)
        #else
        TextEditor(text: text)
            .font(ChatStyle.mono)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .disabled(readOnly)
            .scrollContentBackground(.hidden)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .accessibilityLabel("File text")
        #endif
    }
}

#if os(macOS)
/// A plain text view for code. SwiftUI's TextEditor follows the system's smart quotes, dashes and text replacement, which would change what a person types into a file.
private struct CodeTextView: NSViewRepresentable {
    @Binding var text: String
    let readOnly: Bool

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        guard let view = scroll.documentView as? NSTextView else { return scroll }
        view.delegate = context.coordinator
        view.isRichText = false
        view.allowsUndo = true
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.isContinuousSpellCheckingEnabled = false
        view.isAutomaticLinkDetectionEnabled = false
        view.isAutomaticDataDetectionEnabled = false
        view.smartInsertDeleteEnabled = false
        view.isAutomaticTextCompletionEnabled = false
        if #available(macOS 15, *) { view.writingToolsBehavior = .none }
        view.font = .monospacedSystemFont(ofSize: 12.5, weight: .regular)
        view.textContainerInset = .zero
        view.drawsBackground = false
        scroll.drawsBackground = false
        view.setAccessibilityLabel("File text")
        view.string = text
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? NSTextView else { return }
        context.coordinator.parent = self
        view.isEditable = !readOnly
        // Setting the same string would move the caret.
        if view.string != text { view.string = text }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeTextView
        init(_ parent: CodeTextView) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            parent.text = view.string
        }
    }
}
#endif
