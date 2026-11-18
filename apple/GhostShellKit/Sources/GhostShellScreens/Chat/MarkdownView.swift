import GhostShellKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Every size, colour and corner the thread is set in, the page's on both platforms.
enum ChatStyle {
    /// The iPhone's values were read at the page's 16pt `rem`, so a pointer's 15pt scales them.
    private static let k = GhostMetrics.current.scale

    // MARK: Text
    static let body = Font.geist(14 * k)
    static let small = Font.geist(12 * k, relativeTo: .caption)
    static let caption = Font.geist(11 * k, relativeTo: .caption2)
    static let mono = Font.geistMono(13 * k)
    static let monoSmall = Font.geistMono(12 * k, relativeTo: .caption)
    static let commandMono = Font.geistMono(13 * k)
    static let commandLineSpacing: CGFloat = 4 * k
    static let labelWeight = Font.Weight.medium
    static let chipInk = AnyShapeStyle(Color.ghost.foreground)
    static let chipFont = Font.geist(12 * k, weight: .medium, relativeTo: .caption)
    static let optionDescription = body
    static let fieldFont = Font.geist(16 * k)
    /// A narrow space either side of inline code stands in for padding, which an attributed string can't give.
    static let codePad = "\u{202F}"
    static let summary = body
    static let toolSummary = monoSmall
    static let detailValue = monoSmall
    static let groupMeta = monoSmall
    static let thinkText = body
    static let codeAction = Font.geist(12 * k, weight: .medium, relativeTo: .caption)
    static let linkWeight = Font.Weight.medium
    /// The page sets replies at 22.75 over 14, and code at 20.8 over 13.
    static let lineSpacing: CGFloat = 6 * k
    static let codeLineSpacing: CGFloat = 5 * k
    static let noticeLineSpacing: CGFloat = 3 * k
    static let noticeTracking: CGFloat = -0.35 * k
    /// The widest the thread's text runs, as on the page (46rem).
    static let column: CGFloat = 736 * k

    // MARK: Colours
    static let text = AnyShapeStyle(Color.ghost.foreground)
    static let muted = AnyShapeStyle(Color.ghost.mutedForeground)
    static let marker = AnyShapeStyle(Color.ghost.foreground)
    static let border = AnyShapeStyle(Color.ghost.border)
    static let card = AnyShapeStyle(Color.ghost.card)
    static let bubble = AnyShapeStyle(Color.ghost.secondary)
    static let codeBlock = AnyShapeStyle(Color.ghost.secondary)
    static let well = AnyShapeStyle(Color.ghost.secondary)
    static let planWell = AnyShapeStyle(Color.ghost.secondary)
    static let bashRun = AnyShapeStyle(Color.ghost.card)
    static let inlineCode = Color.ghost.secondary
    static let chip = AnyShapeStyle(Color.ghost.secondary)
    static let link = Color.ghost.primary
    static let added = Color.ghost.successForeground
    static let removed = Color.ghost.destructive
    static let approvalEdge = AnyShapeStyle(Color.ghost.warning)
    static let fieldEdge = AnyShapeStyle(Color.ghost.input)
    static let warningText = AnyShapeStyle(Color.ghost.warningForeground)
    static let dock = AnyShapeStyle(Color.ghost.background)
    static let rail = AnyShapeStyle(Color.ghost.border)
    static let quoteBar = AnyShapeStyle(Color.ghost.border)
    static let selectedBorder = Color.ghost.primary
    /// The page tints a picked option 5% in light and 10% in dark.
    static func selectedFill(_ scheme: ColorScheme) -> Color { Color.ghost.primary.opacity(scheme == .dark ? 0.1 : 0.05) }
    static let optionFill = Color.clear
    static let optionEdge = Color.ghost.border

    // MARK: Corners
    /// The page's bubble: 0.25rem corners and a 0.875rem top right where corners are bevelled.
    static let bubbleShape = GhostCorner(topLeading: 0.25 * GhostMetrics.current.rem, topTrailing: (GhostMetrics.current.touch ? 0.25 : 0.875) * GhostMetrics.current.rem,
                                         bottomTrailing: 0.25 * GhostMetrics.current.rem, bottomLeading: 0.25 * GhostMetrics.current.rem)
    static let radiusCard = GhostMetrics.current.xl
    static let radiusNotice = GhostMetrics.current.lg
    static let radiusBlock = GhostMetrics.current.lg
    static let radiusQuoted = GhostMetrics.current.xl
    static let radiusInner = GhostMetrics.current.lg
    static let radiusSummary = GhostMetrics.current.md
    static let radiusButton = GhostMetrics.current.md

    // MARK: Layout
    static let threadInset: CGFloat = 16 * k
    static let bubbleFraction: CGFloat = 0.8
    /// The page's bubble has a transparent 1pt border, so its padding starts one point further in.
    static let bubblePadding = EdgeInsets(top: 9 * k, leading: 13 * k, bottom: 9 * k, trailing: 13 * k)
    static let listMarkerWidth: CGFloat = 16 * k
    static let headingTop: CGFloat = 8 * k
    static let headingBottom: CGFloat = -4 * k
    static let ruleGap: CGFloat = 8 * k
    static let quoteGap: CGFloat = 16 * k
    static let tablePadding = EdgeInsets(top: 8 * k, leading: 8 * k, bottom: 8 * k, trailing: 8 * k)
    static let tableColumnGap: CGFloat = 16 * k
    static let tableHeadWeight = Font.Weight.medium
    static let tableLineSpacing: CGFloat = 3 * k
    static let tableRowHeight: CGFloat = 20 * k
    static let tableHeadHeight: CGFloat = 24 * k
    static let codeHead = EdgeInsets(top: 4 * k, leading: 16 * k, bottom: 0 * k, trailing: 8 * k)
    static let codeHeadHeight: CGFloat = 28 * k
    static let codeActionPadding: CGFloat = 8 * k
    static let codeBody = EdgeInsets(top: 4 * k, leading: 16 * k, bottom: 12 * k, trailing: 16 * k)
    static let summaryPadding = EdgeInsets(top: 4 * k, leading: 8 * k, bottom: 4 * k, trailing: 8 * k)
    static let summaryHeight: CGFloat = 20 * k
    static let groupHeight: CGFloat = 36 * k
    static let chevron = Font.system(size: 14 * k, weight: .semibold)
    static let chevronWidth: CGFloat = 14 * k
    static let groupIndent: CGFloat = 14 * k
    static let railPadding: CGFloat = 10 * k
    static let thinkIndent: CGFloat = 8 * k
    static let thinkBottom: CGFloat = 8 * k
    static let nestedIndent: CGFloat = 8 * k
    static let ioGap: CGFloat = 4 * k
    static let ioBottom: CGFloat = 8 * k
    static let ioPadding = EdgeInsets(top: 8 * k, leading: 12 * k, bottom: 8 * k, trailing: 12 * k)
    static let ioLineSpacing: CGFloat = 3 * k
    /// Includes the page's 1pt border, which this app draws inside the box.
    static let noticePadding = EdgeInsets(top: 13 * k, leading: 17 * k, bottom: 13 * k, trailing: 17 * k)
    static let noticeLamp: CGFloat = 4 * k
    static let cardPadding: CGFloat = 17 * k
    /// The height of an approval card around its body: padding, title, gaps and buttons.
    static let cardChrome: CGFloat = 140 * k
    static let questionGap: CGFloat = 8 * k
    static let cardLamp: CGFloat = 4 * k
    static let titleAlignment = VerticalAlignment.top
    static let titleHeight: CGFloat = 20 * k
    static let diffInset: CGFloat = 8 * k
    static let diffRowPadding: CGFloat = 12 * k
    static let fieldHeight: CGFloat = 36
    static let chipPadding = EdgeInsets(top: 2 * k, leading: 8 * k, bottom: 2 * k, trailing: 8 * k)
    static let optionPadding = EdgeInsets(top: 11 * k, leading: 13 * k, bottom: 11 * k, trailing: 13 * k)
    static let questionFont = Font.geist(14 * k, weight: .semibold)
}

/// The page's lamp: a core in a dark socket with a thin ring, and a glow while something waits or works.
struct ChatLamp: View {
    let state: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View { ghostLamp.frame(width: 8, height: 8) }

    @ViewBuilder private var ghostLamp: some View {
        let lit = ["working", "active", "done", "waiting", "failed"].contains(state ?? "")
        if lit {
            let core = state == "waiting" ? Color.ghost.warning : state == "failed" ? Color.ghost.destructive : Color(white: 0.99)
            let socket = scheme == .dark ? Color(white: 0.0435) : Color.ghost.primary
            let glow = state == "waiting" ? Color.ghost.warning.opacity(0.45) : state == "working" ? (scheme == .dark ? Color(white: 0.99) : Color.ghost.success).opacity(0.45) : .clear
            Circle()
                .fill(RadialGradient(stops: [.init(color: core, location: 0), .init(color: core, location: 0.58), .init(color: socket, location: 0.64), .init(color: socket, location: 1)],
                                     center: .center, startRadius: 0, endRadius: 4))
                .overlay(Circle().inset(by: -0.5).stroke(Color.ghost.foreground.opacity(0.16), lineWidth: 1))
                .shadow(color: glow, radius: state == "waiting" ? 4.8 : 2.8)
        } else {
            Circle().inset(by: 0.5).stroke(Color.ghost.mutedForeground, lineWidth: 1)
        }
    }
}

extension View {
    /// The page's 1pt rule down the left of a group's rows and a thought's text.
    func railed(padding: CGFloat) -> some View {
        self.padding(.leading, padding).overlay(alignment: .leading) { Rectangle().fill(ChatStyle.rail).frame(width: 1).allowsHitTesting(false) }
    }

    /// The page's text colour.
    func chatText() -> some View { foregroundStyle(ChatStyle.text) }
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
        var link = false
    }

    private static func append(_ inlines: [MDInline], to out: inout AttributedString, style: Style) {
        for inline in inlines {
            switch inline {
            case .text(let text):
                out += run(text, style)
            case .code(let text):
                var code = run("\(ChatStyle.codePad)\(text)\(ChatStyle.codePad)", style)
                code.font = style.bold ? ChatStyle.mono.bold() : ChatStyle.mono
                code.backgroundColor = ChatStyle.inlineCode
                out += code
            case .strong(let inner): var s = style; s.bold = true; append(inner, to: &out, style: s)
            case .em(let inner): var s = style; s.italic = true; append(inner, to: &out, style: s)
            case .del(let inner): var s = style; s.struck = true; append(inner, to: &out, style: s)
            case .link(let text, let url):
                var inner = AttributedString()
                var linked = style
                linked.link = true
                append(text, to: &inner, style: linked)
                inner.link = url
                Self.styleLink(&inner)
                out += inner
            case .file(let text, let path, let line):
                var inner = AttributedString()
                var linked = style
                linked.link = true
                append(text, to: &inner, style: linked)
                inner.link = ChatLink.file(path: path, line: line).url
                Self.styleLink(&inner)
                out += inner
            case .lineBreak:
                out += AttributedString("\n")
            }
        }
    }

    /// The app's tint is a neutral grey, so a link gets the page's link colour and an underline.
    private static func styleLink(_ text: inout AttributedString) {
        text.foregroundColor = ChatStyle.link
        text.underlineStyle = .single
    }

    private static func run(_ text: String, _ style: Style) -> AttributedString {
        var piece = AttributedString(text)
        var font = style.font
        if style.bold { font = font.bold() }
        if style.italic { font = font.italic() }
        if style.link, !style.bold { font = font.weight(ChatStyle.linkWeight) }
        piece.font = font
        if style.struck { piece.strikethroughStyle = .single }
        return piece
    }
}

private extension EnvironmentValues {
    @Entry var codeCanRun = false
}

/// A reply's Markdown blocks: headings, lists, quotes, code with a label and Copy, and tables. `canRun` lets a code block draw the Run slot, which
/// only a finished reply of the assistant does, as on the page. A streaming reply and a thinking block never do.
struct MarkdownView: View {
    let blocks: [MDBlock]
    var font: Font = ChatStyle.body
    var canRun = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block, font: font, depth: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.codeCanRun, canRun)
    }
}

private struct MarkdownBlockView: View {
    let block: MDBlock
    let font: Font
    let depth: Int

    var body: some View {
        switch block {
        case .paragraph(let inlines):
            let text = MarkdownText.attributed(inlines, font: font)
            Text(text).lineSpacing(ChatStyle.lineSpacing).fixedSize(horizontal: false, vertical: true).linkActions(text)
        case .heading(let level, let inlines):
            let text = MarkdownText.attributed(inlines, font: Self.headingFont(level))
            Text(text)
                .linkActions(text)
                .fontWeight(.semibold)
                .padding(.top, ChatStyle.headingTop)
                .padding(.bottom, ChatStyle.headingBottom)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        case .code(let lang, let text):
            CodeBlockView(block: ChatCodeBlock(language: lang, text: text))
        case .rule:
            Hairline().padding(.vertical, ChatStyle.ruleGap)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { n, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(ordered ? "\(start + n)." : (depth == 0 ? "\u{2022}" : "\u{25E6}"))
                            .font(font).monospacedDigit().foregroundStyle(ChatStyle.marker)
                            .frame(minWidth: ChatStyle.listMarkerWidth, alignment: .trailing)
                        VStack(alignment: .leading, spacing: 4) {
                            let text = MarkdownText.attributed(item.text, font: font)
                            Text(text).lineSpacing(ChatStyle.lineSpacing).fixedSize(horizontal: false, vertical: true).linkActions(text)
                            ForEach(Array(item.children.enumerated()), id: \.offset) { _, child in
                                MarkdownBlockView(block: child, font: font, depth: depth + 1)
                            }
                        }
                    }
                }
            }
        case .quote(let inner):
            HStack(alignment: .top, spacing: ChatStyle.quoteGap) {
                RoundedRectangle(cornerRadius: 1).fill(ChatStyle.quoteBar).frame(width: 2)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(inner.enumerated()), id: \.offset) { _, child in MarkdownBlockView(block: child, font: font, depth: depth) }
                }
                .foregroundStyle(ChatStyle.muted)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .table(let head, let rows):
            TableView(head: head, rows: rows, font: font)
        }
    }

    private static func headingFont(_ level: Int) -> Font {
        let size: CGFloat = switch level { case 1: 20; case 2: 18; case 3: 16; default: 14 }
        return Font.geist(size, relativeTo: .headline)
    }
}

private struct TableView: View {
    let head: [[MDInline]]
    let rows: [[[MDInline]]]
    let font: Font

    var body: some View {
        // A table wider than the thread scrolls sideways, as on the page. Left to size itself it widens the whole thread past the screen.
        ViewThatFits(in: .horizontal) {
            grid.frame(maxWidth: .infinity, alignment: .leading)
            ScrollView(.horizontal) { grid }
        }
        .overlay(GhostCorner(ChatStyle.radiusInner).strokeBorder(ChatStyle.border))
    }

    private var grid: some View {
        Grid(alignment: .topLeading, horizontalSpacing: ChatStyle.tableColumnGap, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(head.enumerated()), id: \.offset) { _, cell in cellText(cell).fontWeight(ChatStyle.tableHeadWeight).frame(minHeight: ChatStyle.tableHeadHeight, alignment: .leading) }
            }
            .padding(.vertical, ChatStyle.tablePadding.top)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Hairline().gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in cellText(cell).frame(minHeight: ChatStyle.tableRowHeight, alignment: .leading) }
                }
                .padding(.vertical, ChatStyle.tablePadding.top)
            }
        }
        .padding(.horizontal, ChatStyle.tablePadding.leading)
    }

    private func cellText(_ cell: [MDInline]) -> some View {
        let text = MarkdownText.attributed(cell, font: font)
        return Text(text).lineSpacing(ChatStyle.tableLineSpacing).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading).linkActions(text)
    }
}

/// A rule one point thick in the page's border colour.
struct Hairline: View {
    var body: some View { Rectangle().fill(ChatStyle.border).frame(height: 1) }
}

/// A fenced block: its language, Copy, and the feature slot for Run, above the code, which scrolls sideways rather than wrapping. A block with a Run
/// button wraps instead, with its command lines marked, so the owner sees all of what Run would run.
struct CodeBlockView: View {
    @Environment(ChatModel.self) private var model
    @Environment(\.codeCanRun) private var canRun
    let block: ChatCodeBlock
    @State private var copied = false

    private var wraps: Bool {
        canRun && model.chat.terminalAvailable && TerminalRules.runnableBlock(language: block.language, text: block.text) != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if !block.language.isEmpty { Text(block.language).font(ChatStyle.monoSmall).foregroundStyle(ChatStyle.muted) }
                Spacer(minLength: 0)
                if canRun { ChatSlots.runButton(block, model.chat) }
                Button(copied ? "Copied" : "Copy") {
                    ChatLinks.copy(block.text)
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                }
                .buttonStyle(.borderless).font(ChatStyle.codeAction).foregroundStyle(ChatStyle.muted)
                .padding(.horizontal, ChatStyle.codeActionPadding)
                .accessibilityLabel("Copy code")
            }
            .frame(minHeight: ChatStyle.codeHeadHeight)
            .padding(ChatStyle.codeHead)
            if wraps {
                Text(Self.marked(block)).font(ChatStyle.mono).lineSpacing(ChatStyle.codeLineSpacing).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(ChatStyle.codeBody)
            } else {
                ScrollView(.horizontal) {
                    Text(block.text).font(ChatStyle.mono).lineSpacing(ChatStyle.codeLineSpacing).textSelection(.enabled).fixedSize(horizontal: true, vertical: true)
                        .padding(ChatStyle.codeBody)
                }
                .scrollIndicators(.automatic)
            }
        }
        .background(ChatStyle.codeBlock, in: GhostCorner(ChatStyle.radiusBlock))
    }

    /// Puts each command line, with the lines a backslash joins to it, on a darker ground so the owner sees all of what Run would run.
    private static func marked(_ block: ChatCodeBlock) -> AttributedString {
        let ranges = TerminalRules.commandLines(language: block.language, text: block.text)
        guard !ranges.isEmpty else { return AttributedString(block.text) }
        let lines = block.text.components(separatedBy: "\n")
        let ground = Color.secondary.opacity(0.25)
        var out = AttributedString()
        for (n, line) in lines.enumerated() {
            let inCommand = ranges.contains { $0.contains(n) }
            var piece = AttributedString(line)
            if inCommand { piece.backgroundColor = ground }
            out += piece
            if n < lines.count - 1 {
                var newline = AttributedString("\n")
                if inCommand, ranges.contains(where: { $0.contains(n + 1) }) { newline.backgroundColor = ground }
                out += newline
            }
        }
        return out
    }
}

extension View {
    /// Gives each link in `text` an accessibility action that opens it through the app's link handler. A link's own accessibility press hands its URL to the
    /// system instead, so without these a person using VoiceOver, or a script driving the app, could not open a file link.
    func linkActions(_ text: AttributedString) -> some View { modifier(LinkActions(text: text)) }

    /// Lets the markdown's text be selected, except on iOS 27, where selectable text spends a tap on itself and every link took two taps.
    /// A chat message there is copied from its menu. See https://github.com/kulesy/ghostshell/issues/148.
    @ViewBuilder func selectableMarkdown() -> some View {
        #if os(iOS)
        if #available(iOS 27, *) { self } else { textSelection(.enabled) }
        #else
        textSelection(.enabled)
        #endif
    }
}

private struct LinkActions: ViewModifier {
    @Environment(\.openURL) private var openURL
    let text: AttributedString

    func body(content: Content) -> some View {
        let links = text.runs.compactMap { run in run.link.map { (url: $0, name: String(text[run.range].characters)) } }
        content.accessibilityActions {
            ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                Button("Open \(link.name)") { openURL(link.url) }
            }
        }
    }
}
