#if os(macOS)
import GhostShellKit
import SwiftUI

/// Turns the pieces of a rendered line into a styled string. The 16 palette colours are the page's, one set for each look, and a colour a program
/// names by number is moved until its text keeps 4.5:1 on the output surface.
struct AnsiStyler {
    let scheme: TerminalAnsi.Scheme
    private let palette: [UInt32]

    init(_ scheme: ColorScheme) {
        self.scheme = scheme == .dark ? .dark : .light
        palette = TerminalAnsi.palette(self.scheme)
    }

    /// The red of an error, which the panel also uses for a failed run.
    var danger: Color { color(1) }

    func color(_ n: Int) -> Color {
        let hex = palette[min(max(n, 0), 15)]
        return Color(red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    private func text(_ c: AnsiColor) -> Color {
        switch c {
        case .palette(let n): return color(n)
        case .rgb(let r, let g, let b):
            let m = TerminalAnsi.readable(r, g, b, scheme: scheme)
            return Color(red: Double(m.0) / 255, green: Double(m.1) / 255, blue: Double(m.2) / 255)
        }
    }

    /// A background is a tint of its colour, so the text over it stays readable whatever colour it is.
    private func tint(_ c: AnsiColor) -> Color {
        switch c {
        case .palette(let n): return color(n).opacity(0.3)
        case .rgb(let r, let g, let b): return Color(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255).opacity(0.3)
        }
    }

    func line(_ pieces: [AnsiPiece]) -> AttributedString {
        var out = AttributedString()
        for piece in pieces {
            var run = AttributedString(piece.text)
            let look = piece.look
            let bold = look.bold || piece.stream == "in"
            run.font = bold ? ChatStyle.terminal.weight(.bold) : ChatStyle.terminal
            if let fg = look.fg { run.foregroundColor = text(fg) }
            else if look.inverseFg { run.foregroundColor = Color(white: scheme == .dark ? 0.05 : 0.95) }
            else if piece.stream == "err" { run.foregroundColor = color(1) }
            else if look.dim { run.foregroundColor = color(8) }
            if let bg = look.bg { run.backgroundColor = tint(bg) }
            else if look.inverseBg { run.backgroundColor = .primary }
            if look.underline { run.underlineStyle = .single }
            if look.strike { run.strikethroughStyle = .single }
            out += run
        }
        return out
    }

    var blank: AttributedString {
        var space = AttributedString(" ")
        space.font = ChatStyle.terminal
        return space
    }

    /// The note above output whose first lines were dropped.
    func cut(_ count: Int) -> AttributedString {
        var note = AttributedString("\(count) earlier \(count == 1 ? "line is" : "lines are") not shown")
        note.font = ChatStyle.terminal.italic()
        note.foregroundColor = color(8)
        return note
    }
}

/// The lines of a command's output. Lines are built when they scroll into view, so thousands of them cost what is on screen.
struct AnsiLines: View {
    let output: AnsiOutput
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let styler = AnsiStyler(colorScheme)
        LazyVStack(alignment: .leading, spacing: 0) {
            if output.cut > 0 { Text(styler.cut(output.cut)) }
            ForEach(output.lines.indices, id: \.self) { n in
                // An empty line still takes its height.
                Text(output.lines[n].isEmpty ? styler.blank : styler.line(output.lines[n]))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension ChatStyle {
    /// A run's output and command: 12pt monospaced, as on the page.
    static let terminal = Font.system(size: 12, design: .monospaced)
}
#endif
