import GhostShellKit
import SwiftUI

/// The sizes the thread is set in. They follow the page, which sets its replies at 14 points.
enum ChatStyle {
    static let body = Font.system(size: 14)
    static let small = Font.system(size: 12)
    static let caption = Font.system(size: 11)
    static let mono = Font.system(size: 12.5, design: .monospaced)
    static let monoSmall = Font.system(size: 12, design: .monospaced)
    /// The widest the thread's text runs, as on the page (46rem).
    static let column: CGFloat = 736
}

/// Turns the Markdown tree's inline runs into one styled string. A link carries a URL that `ChatLink` reads when it is tapped.
enum MarkdownText {
    static func attributed(_ inlines: [MDInline], font: Font = ChatStyle.body) -> AttributedString {
        var out = AttributedString()
        append(inlines, to: &out, style: Style(font: font))
        return out
    }

    private struct Style {
        var font: Font
        var bold = false
        var italic = false
        var struck = false
    }

    private static func append(_ inlines: [MDInline], to out: inout AttributedString, style: Style) {
        for inline in inlines {
            switch inline {
            case .text(let text):
                out += run(text, style)
            case .code(let text):
                var code = run("\u{202F}\(text)\u{202F}", style)
                code.font = style.bold ? ChatStyle.mono.bold() : ChatStyle.mono
                code.backgroundColor = Color.secondary.opacity(0.16)
                out += code
            case .strong(let inner): var s = style; s.bold = true; append(inner, to: &out, style: s)
            case .em(let inner): var s = style; s.italic = true; append(inner, to: &out, style: s)
            case .del(let inner): var s = style; s.struck = true; append(inner, to: &out, style: s)
            case .link(let text, let url):
                var inner = AttributedString()
                append(text, to: &inner, style: style)
                inner.link = url
                out += inner
            case .file(let text, let path, let line):
                var inner = AttributedString()
                append(text, to: &inner, style: style)
                inner.link = ChatLink.file(path: path, line: line).url
                out += inner
            case .lineBreak:
                out += AttributedString("\n")
            }
        }
    }

    private static func run(_ text: String, _ style: Style) -> AttributedString {
        var piece = AttributedString(text)
        var font = style.font
        if style.bold { font = font.bold() }
        if style.italic { font = font.italic() }
        piece.font = font
        if style.struck { piece.strikethroughStyle = .single }
        return piece
    }
}

/// A reply's Markdown blocks: headings, lists, quotes, code with a label and Copy, and tables.
struct MarkdownView: View {
    let blocks: [MDBlock]
    var font: Font = ChatStyle.body

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block, font: font, depth: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownBlockView: View {
    let block: MDBlock
    let font: Font
    let depth: Int

    var body: some View {
        switch block {
        case .paragraph(let inlines):
            Text(MarkdownText.attributed(inlines, font: font)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let inlines):
            Text(MarkdownText.attributed(inlines, font: Self.headingFont(level)))
                .fontWeight(.semibold)
                .padding(.top, 6)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        case .code(let lang, let text):
            CodeBlockView(block: ChatCodeBlock(language: lang, text: text))
        case .rule:
            Divider().padding(.vertical, 4)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { n, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(ordered ? "\(start + n)." : (depth == 0 ? "\u{2022}" : "\u{25E6}"))
                            .font(font).monospacedDigit().foregroundStyle(.secondary)
                            .frame(minWidth: 18, alignment: .trailing)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(MarkdownText.attributed(item.text, font: font)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
                            ForEach(Array(item.children.enumerated()), id: \.offset) { _, child in
                                MarkdownBlockView(block: child, font: font, depth: depth + 1)
                            }
                        }
                    }
                }
            }
        case .quote(let inner):
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 1).fill(.tertiary).frame(width: 2)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(inner.enumerated()), id: \.offset) { _, child in MarkdownBlockView(block: child, font: font, depth: depth) }
                }
                .foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .table(let head, let rows):
            TableView(head: head, rows: rows, font: font)
        }
    }

    private static func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .system(size: 20)
        case 2: .system(size: 18)
        case 3: .system(size: 16)
        default: .system(size: 14)
        }
    }
}

private struct TableView: View {
    let head: [[MDInline]]
    let rows: [[[MDInline]]]
    let font: Font

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(head.enumerated()), id: \.offset) { _, cell in cellText(cell).fontWeight(.semibold) }
            }
            .padding(.vertical, 6)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Divider().gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in cellText(cell) }
                }
                .padding(.vertical, 6)
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.quaternary))
    }

    private func cellText(_ cell: [MDInline]) -> some View {
        Text(MarkdownText.attributed(cell, font: font)).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A fenced block: its language, Copy, and the feature slot for Run, above the code, which scrolls sideways rather than wrapping.
struct CodeBlockView: View {
    @Environment(ChatModel.self) private var model
    let block: ChatCodeBlock
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if !block.language.isEmpty { Text(block.language).font(ChatStyle.monoSmall).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
                ChatSlots.runButton(block, model.chat)
                Button(copied ? "Copied" : "Copy") {
                    ChatLinks.copy(block.text)
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                }
                .buttonStyle(.borderless).font(ChatStyle.caption).foregroundStyle(.secondary)
                .accessibilityLabel("Copy code")
            }
            .padding(.leading, 14).padding(.trailing, 10).padding(.top, 6)
            ScrollView(.horizontal) {
                Text(block.text).font(ChatStyle.mono).lineSpacing(3).textSelection(.enabled).fixedSize(horizontal: true, vertical: true)
                    .padding(.horizontal, 14).padding(.vertical, 8)
            }
            .scrollIndicators(.automatic)
        }
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}
