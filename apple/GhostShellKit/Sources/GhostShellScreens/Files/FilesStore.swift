import Foundation
import GhostShellKit
import Observation
import SwiftUI
#if os(macOS)
import AppKit
import CoreServices
#endif

/// Everything the file panel and the image viewer of one chat hold. One per visit, kept on the `ChatContext`. All bytes come through `client`, and none is written
/// to disk except by Download, to a place the person picks.
@Observable @MainActor
final class FilesStore {
    /// The file the panel shows. `preview` is nil while it loads or when it failed.
    struct Opened {
        var path: String
        var line: Int?
        var preview: FilePreview?
        var blocks: [MDBlock]?
        /// The text split for the numbered view, for a markdown or text file.
        var lines: [String]?
        var error: String?
    }

    struct Edit {
        var text: String
        /// The text as the server last sent it, so "changed" means different from this.
        var original: String
        /// The `version` this text started from, which a save sends back.
        var base: String
        var conflict = false
        var restored = false
        var saving = false
        var changed: Bool { text != original }
    }

    struct Alert: Identifiable {
        let id = UUID()
        var title: String
        var message: String
        var conflict = false
    }

    enum Media {
        case none, loading, audio
        case pdf(Data)
        case failed(String)
    }

    struct Viewer {
        var pictures: [ChatPicture]
        var index: Int
        var current: ChatPicture { pictures[index] }
    }

    private(set) var file: Opened?
    private(set) var loading = false
    private(set) var media: Media = .none
    var showSource = false
    var edit: Edit?
    var alert: Alert?
    var confirmDiscard = false
    private(set) var saved: String?
    private(set) var viewer: Viewer?

    let player = ClipPlayer()
    let sessionID: String
    let client: GhostShellClient
    let pictures: PictureCache
    // Weak, because the chat holds this store.
    private weak var chat: ChatContext?
    @ObservationIgnored private var serial = 0
    @ObservationIgnored private var galleryToken = 0
    @ObservationIgnored private var savedTask: Task<Void, Never>?

    init(chat: ChatContext) {
        self.chat = chat
        sessionID = chat.sessionID
        client = chat.client
        pictures = PictureCache(client: chat.client, sessionID: chat.sessionID)
    }

    // MARK: Opening a file

    /// Fetches the preview, then shows it in the panel. A picture opens in the viewer instead, and the panel is left as it was.
    func open(path: String, line: Int?, autoplay: Bool = false) {
        guard let chat else { return }
        edit = nil
        alert = nil
        player.stop()
        media = .none
        serial += 1
        let turn = serial
        let before = file
        loading = true
        // The panel opens at once if the preview is slow, so a click is never met with nothing.
        let reveal = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, let self, self.serial == turn else { return }
            self.file = Opened(path: path, line: line)
            chat.filePanelOpen = true
        }
        Task {
            let result: Result<FilePreview, Error>
            do { result = .success(try await client.preview(sessionID: sessionID, path: path)) } catch { result = .failure(error) }
            reveal.cancel()
            guard serial == turn else { return }
            loading = false
            switch result {
            case .success(let preview) where preview.kind == .image && !preview.tooLarge:
                file = before
                if before == nil { chat.filePanelOpen = false }
                show([.file(path: path, alt: preview.name.isEmpty ? "Image" : preview.name)], at: 0, widen: nil)
            case .success(let preview):
                show(preview, path: path, line: line, autoplay: autoplay, turn: turn)
            case .failure(let error):
                let sentence = error.localizedDescription
                file = Opened(path: path, line: line, error: sentence)
                alert = Alert(title: "Cannot open this file", message: sentence)
                chat.filePanelOpen = true
            }
        }
    }

    private func show(_ preview: FilePreview, path: String, line: Int?, autoplay: Bool, turn: Int) {
        showSource = line != nil
        file = opened(preview, path: path, line: line)
        chat?.filePanelOpen = true
        guard !preview.tooLarge else { return }
        // A file with a parked draft opens straight into it, as the page does.
        if canEdit, FileDrafts.read(draftKey(path)) != nil { startEdit() }
        switch preview.kind {
        case .pdf: loadMedia(path, turn: turn) { .pdf($0) }
        // NOTE: [8 Nov 2026] EK - The page streams audio up to 1 GB with ranges. This app decodes from memory, so it stops at 200 MB.
        case .audio where preview.size > Self.clipLimit:
            media = .failed("This clip is too large to play here. Download it to listen.")
        case .audio: loadMedia(path, turn: turn, autoplay: autoplay) { _ in .audio }
        default: break
        }
    }

    private func opened(_ preview: FilePreview, path: String, line: Int?) -> Opened {
        var opened = Opened(path: path, line: line, preview: preview)
        guard let text = preview.text, preview.kind == .markdown || preview.kind == .text else { return opened }
        opened.lines = ChatFiles.lines(of: text)
        if preview.kind == .markdown, let chat { opened.blocks = ChatMarkdown.parse(text, fileLinks: chat.fileLinks) }
        return opened
    }

    private static let clipLimit = 200 * 1024 * 1024

    private func loadMedia(_ path: String, turn: Int, autoplay: Bool = false, as make: @escaping (Data) -> Media) {
        media = .loading
        Task {
            do {
                let data = try await client.fileBytes(sessionID: sessionID, path: path)
                guard serial == turn else { return }
                let loaded = make(data)
                if case .audio = loaded { player.load(data, autoplay: autoplay) }
                media = loaded
            } catch {
                guard serial == turn else { return }
                media = .failed(error.localizedDescription)
            }
        }
    }

    /// Re-reads the open file, for after Discard and reload.
    func reload() {
        guard let file else { return }
        open(path: file.path, line: file.line)
    }

    func close() {
        edit = nil
        player.stop()
        chat?.filePanelOpen = false
    }

    // MARK: Editing

    var canEdit: Bool {
        guard let preview = file?.preview else { return false }
        return preview.editable && preview.text != nil && preview.version != nil && !preview.truncated && edit == nil
    }

    func startEdit() {
        guard canEdit, let file, let text = file.preview?.text, let version = file.preview?.version else { return }
        if let draft = FileDrafts.read(draftKey(file.path)) {
            edit = Edit(text: draft.text, original: text, base: draft.base, conflict: draft.base != version, restored: true)
        } else {
            edit = Edit(text: text, original: text, base: version)
        }
    }

    func cancelEdit() {
        guard let edit else { return }
        if edit.changed { confirmDiscard = true } else { discardEdit() }
    }

    /// Throws the text away and reads the file again, which may have changed since it was opened.
    func discardEdit() {
        if let file { FileDrafts.write(draftKey(file.path), nil) }
        edit = nil
        reload()
    }

    func save() {
        guard let file, let pending = edit, !pending.saving, pending.changed || pending.conflict else { return }
        edit?.saving = true
        let (path, name) = (file.path, file.preview?.name ?? "file")
        Task {
            do {
                let fresh = try await client.saveFile(sessionID: sessionID, path: path, text: pending.text, base: pending.base)
                FileDrafts.write(draftKey(path), nil)
                guard self.file?.path == path else { return }
                self.file = opened(fresh, path: path, line: nil)
                edit = nil
                flash("Saved \(fresh.name.isEmpty ? name : fresh.name)")
            } catch GhostShellError.refused(409, let message, _, true) {
                guard self.file?.path == path else { return }
                edit?.saving = false
                edit?.conflict = true
                alert = Alert(title: "Not saved", message: message, conflict: true)
            } catch {
                guard self.file?.path == path else { return }
                edit?.saving = false
                alert = Alert(title: "Not saved", message: error.localizedDescription)
            }
        }
    }

    /// For the conflict alert: the person's text goes to the clipboard before they reload.
    func copyEdit() {
        if let text = edit?.text { ChatLinks.copy(text) }
    }

    private func flash(_ words: String) {
        saved = words
        AccessibilityNotification.Announcement(words).post()
        savedTask?.cancel()
        savedTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { self?.saved = nil }
        }
    }

    /// Keeps unsaved text for the next time the file opens. The editor calls it on every change, so a switch of chats or a closed window loses nothing.
    func parkDraft() {
        guard let file, let edit else { return }
        FileDrafts.write(draftKey(file.path), edit.changed || edit.conflict ? FileDrafts.Draft(text: edit.text, base: edit.base) : nil)
    }

    private func draftKey(_ path: String) -> String { FileDrafts.key(client.address, sessionID: sessionID, path: path) }

    // MARK: Download

    #if os(macOS)
    /// The only disk write of this feature. The person picks where, and the bytes are fetched after they have.
    func download() {
        guard let file, let name = file.preview?.name else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = ChatFiles.displayName(name)
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let target = panel.url else { return }
        let path = file.path
        Task {
            do {
                let data = try await client.fileBytes(sessionID: sessionID, path: path, download: true)
                try data.write(to: target, options: .atomic)
                // A volume with no extended attributes cannot be marked, and the file is still saved.
                var marked = target
                var values = URLResourceValues()
                values.quarantineProperties = [kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String]
                try? marked.setResourceValues(values)
            } catch {
                alert = Alert(title: "Cannot save this file", message: error.localizedDescription)
            }
        }
    }
    #endif

    // MARK: Pictures

    /// Opens the viewer on pictures the caller already holds, then widens it to every picture of the chat when the server answers.
    func show(_ own: [ChatPicture], at index: Int, widen ref: String?) {
        guard own.indices.contains(index) else { return }
        viewer = Viewer(pictures: own, index: index)
        galleryToken += 1
        guard let ref else { return }
        let token = galleryToken
        Task {
            guard let items = try? await client.chatImages(sessionID: sessionID), token == galleryToken, let current = viewer?.current.id else { return }
            let all = ChatFiles.pictures(in: items)
            guard ChatFiles.start(of: ref, in: all) != nil else { return }
            let connectors = chat?.session.connectors ?? [:]
            let widened = all.map { ChatPicture.ref($0.ref, alt: Self.alt($0, connectors: connectors)) }
            // The person may have stepped on while this loaded, so the viewer keeps whichever picture they are on.
            if let at = widened.firstIndex(where: { $0.id == current }) { viewer = Viewer(pictures: widened, index: at) }
        }
    }

    static func alt(_ picture: ChatFiles.Picture, connectors: [String: String]) -> String {
        guard let tool = picture.tool else { return "Attached image" }
        return "Image from \(tool.isEmpty ? "a tool" : ChatFiles.toolSource(tool, connectors: connectors))"
    }

    func step(_ by: Int) {
        guard var current = viewer, current.pictures.indices.contains(current.index + by) else { return }
        current.index += by
        viewer = current
    }

    func closeViewer() {
        galleryToken += 1
        viewer = nil
    }
}
