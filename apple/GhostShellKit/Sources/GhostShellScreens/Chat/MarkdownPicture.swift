import GhostShellKit
import SwiftUI

/// A run of inline Markdown cut at its pictures: text runs with their style kept either side, and each picture on its own line.
enum MarkdownPieces {
    enum Piece: Equatable {
        case text([MDInline])
        case picture(alt: String, path: String)
    }

    static func hasPicture(_ inlines: [MDInline]) -> Bool {
        inlines.contains { inline in
            switch inline {
            case .image: true
            case .strong(let inner), .em(let inner), .del(let inner), .link(let inner, _), .file(let inner, _, _): hasPicture(inner)
            case .text, .code, .lineBreak: false
            }
        }
    }

    static func split(_ inlines: [MDInline]) -> [Piece] {
        var out: [Piece] = []
        var run: [MDInline] = []
        func flush() { if !run.isEmpty { out.append(.text(run)); run = [] } }
        func wrap(_ inner: [MDInline], _ make: ([MDInline]) -> MDInline) {
            guard hasPicture(inner) else { run.append(make(inner)); return }
            for piece in split(inner) {
                switch piece {
                case .text(let text): run.append(make(text))
                case .picture: flush(); out.append(piece)
                }
            }
        }
        for inline in inlines {
            switch inline {
            case .image(let alt, let path): flush(); out.append(.picture(alt: alt, path: path))
            case .strong(let inner): wrap(inner, MDInline.strong)
            case .em(let inner): wrap(inner, MDInline.em)
            case .del(let inner): wrap(inner, MDInline.del)
            case .link(let text, let url): wrap(text) { .link(text: $0, url: url) }
            case .file(let text, let path, let line): wrap(text) { .file(text: $0, path: path, line: line) }
            case .text, .code, .lineBreak: run.append(inline)
            }
        }
        flush()
        return trimmed(out)
    }

    /// Whitespace and line breaks beside a picture are dropped, and so is a run left with nothing to show.
    private static func trimmed(_ pieces: [Piece]) -> [Piece] {
        var out: [Piece] = []
        for (n, piece) in pieces.enumerated() {
            guard case .text(var run) = piece else { out.append(piece); continue }
            if n > 0, case .picture = pieces[n - 1] { while let first = run.first, isBlank(first) { run.removeFirst() }; trimStart(&run) }
            if n + 1 < pieces.count, case .picture = pieces[n + 1] { while let last = run.last, isBlank(last) { run.removeLast() }; trimEnd(&run) }
            if !run.isEmpty { out.append(.text(run)) }
        }
        return out
    }

    private static func isBlank(_ inline: MDInline) -> Bool {
        switch inline {
        case .lineBreak: true
        case .text(let text): text.allSatisfy(\.isWhitespace)
        default: false
        }
    }

    private static func trimStart(_ run: inout [MDInline]) {
        if case .text(let text)? = run.first {
            let rest = String(text.drop(while: \.isWhitespace))
            if rest.isEmpty { run.removeFirst() } else { run[0] = .text(rest) }
        }
    }

    private static func trimEnd(_ run: inout [MDInline]) {
        if case .text(let text)? = run.last {
            var rest = text
            while rest.last?.isWhitespace == true { rest.removeLast() }
            if rest.isEmpty { run.removeLast() } else { run[run.count - 1] = .text(rest) }
        }
    }

    /// Every picture of these blocks in document order, once each.
    static func gallery(_ blocks: [MDBlock]) -> [ChatPicture] {
        var seen = Set<String>()
        var out: [ChatPicture] = []
        func inlines(_ list: [MDInline]) {
            for inline in list {
                switch inline {
                case .image(let alt, let path):
                    let picture = ChatPicture.file(path: path, alt: alt)
                    if seen.insert(picture.id).inserted { out.append(picture) }
                case .strong(let inner), .em(let inner), .del(let inner), .link(let inner, _), .file(let inner, _, _): inlines(inner)
                case .text, .code, .lineBreak: break
                }
            }
        }
        func walk(_ list: [MDBlock]) {
            for block in list {
                switch block {
                case .paragraph(let text), .heading(_, let text): inlines(text)
                case .list(_, _, let items): for item in items { inlines(item.text); walk(item.children) }
                case .quote(let inner): walk(inner)
                case .table(let head, let rows): head.forEach(inlines); rows.forEach { $0.forEach(inlines) }
                case .code, .rule: break
                }
            }
        }
        walk(blocks)
        return out
    }
}

extension EnvironmentValues {
    /// The pictures of the message being drawn, so a tap opens the viewer on all of them.
    @Entry var pictureGallery: [ChatPicture] = []
    /// The page's `max-width: 47.99rem`, which is the window and not the pane.
    @Entry var narrowWindow = false
}

/// Inline Markdown drawn as one `Text`, or, when it holds a picture, as text runs and pictures stacked.
struct InlineRuns: View {
    let inlines: [MDInline]
    let font: Font
    var lineSpacing: CGFloat = 0

    var body: some View {
        if MarkdownPieces.hasPicture(inlines) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(MarkdownPieces.split(inlines).enumerated()), id: \.offset) { _, piece in
                    switch piece {
                    case .text(let run): text(run)
                    case .picture(let alt, let path): MarkdownPicture(alt: alt, path: path, font: font, lineSpacing: lineSpacing).id(path)
                    }
                }
            }
        } else {
            text(inlines)
        }
    }

    private func text(_ run: [MDInline]) -> some View { InlineText(inlines: run, font: font, lineSpacing: lineSpacing) }
}

struct InlineText: View {
    let inlines: [MDInline]
    let font: Font
    var lineSpacing: CGFloat = 0

    var body: some View {
        let text = MarkdownText.attributed(inlines, font: font)
        Text(text).lineSpacing(lineSpacing).fixedSize(horizontal: false, vertical: true).linkActions(text)
    }
}

/// A picture file from a reply: a button that opens the viewer. It reads its bytes only through the chat's `PictureCache`, so the server's rule that
/// the chat's replies must link the file holds, and a picture that will not load becomes the file link it would have been.
struct MarkdownPicture: View {
    @Environment(ChatModel.self) private var model: ChatModel?
    @Environment(\.pictureGallery) private var gallery
    @Environment(\.narrowWindow) private var narrow
    @State private var image: PlatformImage?
    @State private var failed = false
    @State private var hovering = false
    let alt: String
    let path: String
    let font: Font
    let lineSpacing: CGFloat

    private var picture: ChatPicture { .file(path: path, alt: alt) }
    private static let shape = GhostCorner(GhostMetrics.current.lg)
    private var tallest: CGFloat { (narrow ? 10 : 15) * GhostMetrics.current.rem }

    var body: some View {
        if failed || model == nil {
            InlineText(inlines: [.file(text: [.text(alt)], path: path, line: nil)], font: font, lineSpacing: lineSpacing)
        } else {
            Button(action: open) { content }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .accessibilityLabel(alt)
                .task(id: picture.id) {
                    guard let model else { return }
                    let store = FilesSlot.store(model.chat)
                    image = store.pictures.cached(picture.id)
                    guard image == nil else { return }
                    image = await store.pictures.image(picture)
                    failed = image == nil
                }
        }
    }

    private var content: some View {
        Group {
            if let image {
                // Only the width is capped, so the box is never wider or taller than the picture.
                let width = image.size.width * min(1, tallest / image.size.height)
                Image(platform: image).resizable().scaledToFit()
                    .frame(idealWidth: width, maxWidth: width).fixedSize(horizontal: false, vertical: true)
            } else {
                Image(systemName: "photo").foregroundStyle(.tertiary).frame(width: 64, height: 48)
            }
        }
        .background(Color.ghost.muted)
        .clipShape(Self.shape)
        .overlay(Self.shape.strokeBorder(hovering ? Color.ghost.ring : Color.ghost.border))
        .contentShape(Self.shape)
    }

    private func open() {
        guard let model else { return }
        FilesSlot.store(model.chat).show(gallery, at: gallery.firstIndex { $0.id == picture.id } ?? 0, widen: nil)
    }
}
