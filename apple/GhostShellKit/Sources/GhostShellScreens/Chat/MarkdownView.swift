import GhostShellKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// The value the iPhone shows, which follows the page as iOS Safari draws it (public/ghost.css, with no `corner-shape`), or the Mac's own.
/// https://github.com/kulesy/ghostshell/issues/136
private func onPhone<T>(_ page: @autoclosure () -> T, mac: @autoclosure () -> T) -> T {
    #if os(iOS)
    return page()
    #else
    return mac()
    #endif
}

/// Every size, colour and corner the thread is set in. The iPhone takes the page's values and the Mac keeps its own, so a view reads this and never asks which.
enum ChatStyle {
    static let page = onPhone(true, mac: false)

    // MARK: Text
    static let body = Font.system(size: 14)
    static let small = Font.system(size: 12)
    static let caption = Font.system(size: 11)
    static let mono = Font.system(size: onPhone(13, mac: 12.5), design: .monospaced)
    static let monoSmall = Font.system(size: 12, design: .monospaced)
    static let commandMono = onPhone(Font.system(size: 13, design: .monospaced), mac: monoSmall)
    static let commandLineSpacing: CGFloat = onPhone(4, mac: 2)
    static let labelWeight = onPhone(Font.Weight.medium, mac: .regular)
    static let chipInk = onPhone(AnyShapeStyle(Color.ghost.foreground), mac: AnyShapeStyle(HierarchicalShapeStyle.secondary))
    static let chipFont = onPhone(Font.system(size: 12, weight: .medium), mac: caption)
    static let optionDescription = onPhone(body, mac: small)
    static let fieldFont = Font.system(size: 16)
    static let buttonFont = Font.system(size: 14, weight: .medium)
    /// A narrow space either side of inline code stands in for padding, which an attributed string can't give.
    static let codePad = "\u{202F}"
    static let summary = onPhone(body, mac: small)
    static let toolSummary = onPhone(monoSmall, mac: small)
    static let detailValue = onPhone(Font.system(size: 12, design: .monospaced), mac: small)
    static let groupMeta = onPhone(monoSmall, mac: small)
    static let thinkText = onPhone(body, mac: small)
    static let codeAction = onPhone(Font.system(size: 12, weight: .medium), mac: caption)
    static let linkWeight = onPhone(Font.Weight.medium, mac: .regular)
    /// The page sets replies at 22.75 over 14, and code at 20.8 over 13.
    static let lineSpacing: CGFloat = onPhone(6, mac: 4)
    static let codeLineSpacing: CGFloat = onPhone(5, mac: 3)
    static let noticeLineSpacing: CGFloat = onPhone(3, mac: 0)
    static let noticeTracking: CGFloat = onPhone(-0.35, mac: 0)
    /// The widest the thread's text runs, as on the page (46rem).
    static let column: CGFloat = 736

    // MARK: Colours
    static let text = onPhone(AnyShapeStyle(Color.ghost.foreground), mac: AnyShapeStyle(HierarchicalShapeStyle.primary))
    static let muted = onPhone(AnyShapeStyle(Color.ghost.mutedForeground), mac: AnyShapeStyle(HierarchicalShapeStyle.secondary))
    static let marker = onPhone(AnyShapeStyle(Color.ghost.foreground), mac: AnyShapeStyle(HierarchicalShapeStyle.secondary))
    static let border = onPhone(AnyShapeStyle(Color.ghost.border), mac: AnyShapeStyle(HierarchicalShapeStyle.quaternary))
    static let card = onPhone(AnyShapeStyle(Color.ghost.card), mac: AnyShapeStyle(BackgroundStyle()))
    static let bubble = onPhone(AnyShapeStyle(Color.ghost.secondary), mac: AnyShapeStyle(Color.secondary.opacity(0.14)))
    static let codeBlock = onPhone(AnyShapeStyle(Color.ghost.secondary), mac: AnyShapeStyle(Color.secondary.opacity(0.12)))
    static let well = onPhone(AnyShapeStyle(Color.ghost.secondary), mac: AnyShapeStyle(Color.secondary.opacity(0.1)))
    static let planWell = onPhone(AnyShapeStyle(Color.ghost.secondary), mac: AnyShapeStyle(Color.secondary.opacity(0.07)))
    static let bashRun = onPhone(AnyShapeStyle(Color.ghost.card), mac: AnyShapeStyle(Color.secondary.opacity(0.07)))
    static let inlineCode = onPhone(Color.ghost.secondary, mac: Color.secondary.opacity(0.16))
    static let chip = onPhone(AnyShapeStyle(Color.ghost.secondary), mac: AnyShapeStyle(Color.secondary.opacity(0.16)))
    static let link: Color? = onPhone(Color.ghost.primary, mac: nil)
    static let added = onPhone(Color.ghost.successForeground, mac: .green)
    static let removed = onPhone(Color.ghost.destructive, mac: .red)
    static let approvalEdge = onPhone(AnyShapeStyle(Color.ghost.warning), mac: AnyShapeStyle(HierarchicalShapeStyle.quaternary))
    static let primaryFill = Color.ghost.primary
    static let primaryInk = Color.ghost.primaryForeground
    static func outlineFill(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color.ghost.input.opacity(0.3) : Color.ghost.background }
    static let fieldEdge = onPhone(AnyShapeStyle(Color.ghost.input), mac: AnyShapeStyle(HierarchicalShapeStyle.quaternary))
    static let warningText = onPhone(AnyShapeStyle(Color.ghost.warningForeground), mac: AnyShapeStyle(HierarchicalShapeStyle.primary))
    static let dock = onPhone(AnyShapeStyle(Color.ghost.background), mac: AnyShapeStyle(Material.bar))
    static let rail = onPhone(AnyShapeStyle(Color.ghost.border), mac: AnyShapeStyle(Color.clear))
    static let quoteBar = onPhone(AnyShapeStyle(Color.ghost.border), mac: AnyShapeStyle(HierarchicalShapeStyle.tertiary))
    static let selectedBorder = onPhone(Color.ghost.primary, mac: Color.accentColor.opacity(0.6))
    /// The page tints a picked option 5% in light and 10% in dark.
    static func selectedFill(_ scheme: ColorScheme) -> Color { onPhone(Color.ghost.primary.opacity(scheme == .dark ? 0.1 : 0.05), mac: Color.accentColor.opacity(0.14)) }
    static let optionFill = onPhone(Color.clear, mac: Color.secondary.opacity(0.07))
    static let optionEdge = onPhone(Color.ghost.border, mac: Color.clear)

    // MARK: Corners
    static let radiusBubble = onPhone(GhostRadius.xl, mac: 16)
    static let radiusCard = onPhone(GhostRadius.xl, mac: 14)
    static let radiusNotice = onPhone(GhostRadius.lg, mac: 12)
    static let radiusBlock = onPhone(GhostRadius.lg, mac: 10)
    static let radiusQuoted = onPhone(GhostRadius.xl, mac: 10)
    static let radiusInner = onPhone(GhostRadius.lg, mac: 8)
    static let radiusSummary = onPhone(GhostRadius.md, mac: 8)
    static let radiusButton = GhostRadius.md

    // MARK: Layout
    static let threadInset: CGFloat = onPhone(16, mac: 20)
    static let bubbleFraction: CGFloat = onPhone(0.8, mac: 1)
    /// The page's bubble has a transparent 1pt border, so its padding starts one point further in.
    static let bubblePadding = onPhone(EdgeInsets(top: 9, leading: 13, bottom: 9, trailing: 13), mac: EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
    static let listMarkerWidth: CGFloat = onPhone(16, mac: 18)
    static let headingTop: CGFloat = onPhone(8, mac: 6)
    static let headingBottom: CGFloat = onPhone(-4, mac: 0)
    static let ruleGap: CGFloat = onPhone(8, mac: 4)
    static let quoteGap: CGFloat = onPhone(16, mac: 12)
    static let tablePadding = onPhone(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8), mac: EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
    static let tableColumnGap: CGFloat = onPhone(16, mac: 18)
    static let tableHeadWeight = onPhone(Font.Weight.medium, mac: .semibold)
    static let tableLineSpacing: CGFloat = onPhone(3, mac: 0)
    static let tableRowHeight: CGFloat = onPhone(20, mac: 0)
    static let tableHeadHeight: CGFloat = onPhone(24, mac: 0)
    static let codeHead = onPhone(EdgeInsets(top: 4, leading: 16, bottom: 0, trailing: 8), mac: EdgeInsets(top: 6, leading: 14, bottom: 0, trailing: 10))
    static let codeHeadHeight: CGFloat = onPhone(28, mac: 0)
    static let codeActionPadding: CGFloat = onPhone(8, mac: 0)
    static let codeBody = onPhone(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16), mac: EdgeInsets(top: 8, leading: 14, bottom: 8, trailing: 14))
    static let summaryPadding = onPhone(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8), mac: EdgeInsets(top: 5, leading: 8, bottom: 5, trailing: 8))
    static let summaryHeight: CGFloat = onPhone(20, mac: 0)
    static let groupHeight: CGFloat = onPhone(36, mac: 0)
    static let chevron = onPhone(Font.system(size: 14, weight: .semibold), mac: Font.system(size: 9, weight: .semibold))
    static let chevronWidth: CGFloat = onPhone(14, mac: 10)
    /// The page marks only a group's line with a chevron.
    static let rowChevrons = !page
    static let groupIndent: CGFloat = onPhone(14, mac: 12)
    static let railPadding: CGFloat = onPhone(10, mac: 0)
    static let thinkIndent: CGFloat = onPhone(8, mac: 26)
    static let thinkBottom: CGFloat = onPhone(8, mac: 6)
    static let nestedIndent: CGFloat = onPhone(8, mac: 26)
    static let ioGap: CGFloat = onPhone(4, mac: 6)
    static let ioBottom: CGFloat = onPhone(8, mac: 4)
    static let ioPadding = onPhone(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12), mac: EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
    static let ioLineSpacing: CGFloat = onPhone(3, mac: 2)
    /// Includes the page's 1pt border, which this app draws inside the box.
    static let noticePadding = onPhone(EdgeInsets(top: 13, leading: 17, bottom: 13, trailing: 17), mac: EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
    static let noticeLamp: CGFloat = onPhone(4, mac: 6)
    static let cardPadding: CGFloat = onPhone(17, mac: 14)
    /// The height of an approval card around its body: padding, title, gaps and buttons.
    static let cardChrome: CGFloat = onPhone(140, mac: 125)
    static let cardGap: CGFloat = onPhone(8, mac: 10)
    static let questionGap: CGFloat = onPhone(8, mac: 6)
    static let cardLamp: CGFloat = onPhone(4, mac: 0)
    static let titleAlignment = onPhone(VerticalAlignment.top, mac: .firstTextBaseline)
    static let titleHeight: CGFloat = onPhone(20, mac: 0)
    static let diffInset: CGFloat = onPhone(8, mac: 0)
    static let diffRowPadding: CGFloat = onPhone(12, mac: 10)
    static let diffFill: Double = onPhone(0, mac: 0.14)
    static let fieldHeight: CGFloat = onPhone(36, mac: 0)
    static let chipPadding = onPhone(EdgeInsets(top: 2, leading: 8, bottom: 2, trailing: 8), mac: EdgeInsets(top: 2, leading: 6, bottom: 2, trailing: 6))
    static let buttonHeight: CGFloat = 36
    /// The page's buttons are 36pt, and the touch area around each is the 44pt the phone's tests hold every control to.
    static let touchHeight: CGFloat = 44
    static let optionPadding = onPhone(EdgeInsets(top: 11, leading: 13, bottom: 11, trailing: 13), mac: EdgeInsets(top: 7, leading: 10, bottom: 7, trailing: 10))
    static let optionRadio = !page
    static let questionFont = onPhone(Font.system(size: 14, weight: .semibold), mac: Font.system(size: 14, weight: .medium))
}

/// The page's lamp: a core in a dark socket with a thin ring, and a glow while something waits or works. The Mac draws a plain dot.
struct ChatLamp: View {
    let state: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if ChatStyle.page { ghostLamp.frame(width: 8, height: 8) } else { Circle().fill(plain).frame(width: 8, height: 8) }
    }

    private var plain: Color {
        switch state {
        case "failed": .red
        case "waiting": .orange
        case "working", "active", "done": .green
        default: .secondary
        }
    }

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
    /// The page's 1pt rule down the left of a group's rows and a thought's text. The Mac draws none.
    @ViewBuilder func railed(padding: CGFloat) -> some View {
        if ChatStyle.page {
            self.padding(.leading, padding).overlay(alignment: .leading) { Rectangle().fill(ChatStyle.rail).frame(width: 1).allowsHitTesting(false) }
        } else {
            self
        }
    }

    /// The page's text colour on the iPhone. The Mac keeps the system's.
    @ViewBuilder func chatText() -> some View {
        if ChatStyle.page { foregroundStyle(ChatStyle.text) } else { self }
    }
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

    /// The app's tint is a neutral grey, so on a phone, where nothing hovers to show a link, a link gets the page's link colour and an underline.
    private static func styleLink(_ text: inout AttributedString) {
        guard let color = ChatStyle.link else { return }
        text.foregroundColor = color
        text.underlineStyle = .single
    }

    private static func run(_ text: String, _ style: Style) -> AttributedString {
        var piece = AttributedString(text)
        var font = style.font
        if style.bold { font = font.bold() }
        if style.italic { font = font.italic() }
        if style.link { font = font.weight(ChatStyle.linkWeight) }
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

    // A table wider than the thread scrolls sideways, as on the page. Left to size itself it widens the whole thread past the screen.
    var body: some View {
        ViewThatFits(in: .horizontal) {
            grid.frame(maxWidth: .infinity, alignment: .leading)
            ScrollView(.horizontal) { grid }
        }
        .overlay(RoundedRectangle(cornerRadius: ChatStyle.radiusInner).strokeBorder(ChatStyle.border))
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

/// A rule one point thick in the page's border colour. The Mac keeps the system's divider.
struct Hairline: View {
    var body: some View {
        if ChatStyle.page { Rectangle().fill(ChatStyle.border).frame(height: 1) } else { Divider() }
    }
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
        .background(ChatStyle.codeBlock, in: RoundedRectangle(cornerRadius: ChatStyle.radiusBlock))
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
