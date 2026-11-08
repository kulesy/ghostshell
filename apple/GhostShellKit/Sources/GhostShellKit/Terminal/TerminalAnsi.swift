import Foundation

// NOTE: [8 Nov 2026] EK - This mirrors public/ui/ansi.js: colours come from SGR sequences, \r goes back to the start of the line and writes over it,
// and every other escape sequence is dropped. Columns count Unicode scalars where the page counts UTF-16 units.
// See https://github.com/kulesy/ghostshell/issues/91.

/// A colour an SGR sequence names: one of the 16 palette entries, or a 24-bit value (an xterm 16 to 255 colour arrives as one).
public enum AnsiColor: Hashable, Sendable {
    case palette(Int)
    case rgb(Int, Int, Int)
}

/// How a piece of output is drawn. Inverse is already applied: `inverseFg` and `inverseBg` say the default colours were swapped.
public struct AnsiLook: Hashable, Sendable {
    public var fg: AnsiColor?
    public var bg: AnsiColor?
    public var inverseFg = false
    public var inverseBg = false
    public var bold = false
    public var dim = false
    public var italic = false
    public var underline = false
    public var strike = false

    public init() {}
}

/// A run of text that is drawn one way. `stream` is `out`, `err` or `in`.
public struct AnsiPiece: Hashable, Sendable {
    public var stream: String
    public var look: AnsiLook
    public var text: String
}

public struct AnsiOutput: Equatable, Sendable {
    /// The last lines, each as its pieces.
    public var lines: [[AnsiPiece]]
    /// How many lines came before them.
    public var cut: Int
}

public enum TerminalAnsi {
    /// A line holds at most this many pieces, so a line that changes colour at every character stays small.
    public static let maxPieces = 256

    private struct Style: Equatable {
        var fg: AnsiColor?
        var bg: AnsiColor?
        var bold = false, dim = false, italic = false, underline = false, inverse = false, strike = false
    }

    private struct Line {
        var pieces: [AnsiPiece] = []
        var width = 0
        var cells: (text: [Unicode.Scalar], looks: [Int])?
        var lookTable: [AnsiPiece] = []
    }

    /// Lines of pieces for output chunks, in the order they came. Only the last `maxLines` lines are returned.
    public static func render(_ chunks: [TerminalChunk], maxLines: Int = 2000) -> AnsiOutput {
        var lines = [Line()]
        var col = 0
        var styles: [String: Style] = [:]
        var waiting: [String: [Unicode.Scalar]] = [:]
        for chunk in chunks {
            let stream = chunk.stream
            var style = styles[stream] ?? Style()
            var look = Self.look(style)
            let text = (waiting[stream] ?? []) + Array(chunk.text.unicodeScalars)
            waiting[stream] = nil
            var i = 0
            while i < text.count {
                let c = text[i]
                if !isControl(c) {
                    var end = i + 1
                    while end < text.count, !isControl(text[end]) { end += 1 }
                    write(&lines[lines.count - 1], col, AnsiPiece(stream: stream, look: look, text: string(text[i..<end])))
                    col += end - i
                    i = end
                    continue
                }
                switch c {
                case "\n": lines.append(Line()); col = 0; i += 1
                case "\r": col = 0; i += 1
                case "\u{8}": col = max(0, col - 1); i += 1
                case "\t":
                    let stop = col + (8 - col % 8)
                    write(&lines[lines.count - 1], col, AnsiPiece(stream: stream, look: look, text: String(repeating: " ", count: stop - col)))
                    col = stop
                    i += 1
                case "\u{1B}":
                    if let csi = matchCSI(text, i) {
                        i = csi.end
                        if csi.final == "m", csi.intermediate.isEmpty {
                            style = applySgr(style, csi.params)
                            look = Self.look(style)
                        } else if csi.final == "K", csi.intermediate.isEmpty {
                            let mode = csi.params.isEmpty ? 0 : Int(csi.params) ?? -1
                            let last = lines.count - 1
                            if mode == 0, col < lines[last].width {
                                edit(&lines[last])
                                lines[last].cells!.text.removeSubrange(col...)
                                lines[last].cells!.looks.removeSubrange(col...)
                                lines[last].width = col
                            } else if mode == 2 {
                                lines[last] = Line()
                            }
                        }
                        continue
                    }
                    if let end = matchOSC(text, i) { i = end; continue }
                    if isUnfinished(text, i) { waiting[stream] = Array(text[i...]); i = text.count; continue }
                    i += (i + 1 < text.count && "()*+".unicodeScalars.contains(text[i + 1])) ? 3 : 2
                default: i += 1
                }
            }
            styles[stream] = style
        }
        if lines.count > 1, lines[lines.count - 1].width == 0 { lines.removeLast() }
        let cut = max(0, lines.count - maxLines)
        return AnsiOutput(lines: lines.suffix(from: cut).map(pieces), cut: cut)
    }

    /// The words of output with its colours and cursor moves taken out, for a copy.
    public static func plain(_ chunks: [TerminalChunk]) -> String {
        render(chunks, maxLines: .max).lines.map { $0.map(\.text).joined() }.joined(separator: "\n")
    }

    // MARK: Colour

    /// The xterm colour for 16 to 255.
    static func xterm(_ n: Int) -> AnsiColor {
        if n >= 232 { let v = 8 + 10 * (n - 232); return .rgb(v, v, v) }
        let i = n - 16
        func level(_ v: Int) -> Int { v == 0 ? 0 : 55 + 40 * v }
        return .rgb(level(i / 36), level(i / 6 % 6), level(i % 6))
    }

    public enum Scheme: Sendable { case light, dark }

    private static func luminance(_ r: Int, _ g: Int, _ b: Int) -> Double {
        func channel(_ v: Int) -> Double {
            let s = Double(v) / 255
            return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    /// A colour moved towards black (light) or white (dark) until its text keeps 4.5:1 on the lightest or darkest the output surface gets, and left
    /// as it is when it already does.
    public static func readable(_ r: Int, _ g: Int, _ b: Int, scheme: Scheme) -> (Int, Int, Int) {
        let target = scheme == .dark ? 255 : 0
        let surface = scheme == .dark ? 0.02 : 0.79
        func ratio(_ l: Double) -> Double { scheme == .dark ? (l + 0.05) / (surface + 0.05) : (surface + 0.05) / (l + 0.05) }
        var t = 0.0
        while t <= 1.0001 {
            func mix(_ v: Int) -> Int { Int((Double(v) + Double(target - v) * t).rounded()) }
            let m = (mix(r), mix(g), mix(b))
            if ratio(luminance(m.0, m.1, m.2)) >= 4.5 { return m }
            t += 0.05
        }
        return (target, target, target)
    }

    /// The 16 palette colours as 0xRRGGBB, from the page's OKLCH values (--ansi-0 to --ansi-15 in app.css).
    public static func palette(_ scheme: Scheme) -> [UInt32] {
        scheme == .light
            ? [0x292929, 0xbd0f18, 0x036d1b, 0x735b09, 0x1655d0, 0x9f269a, 0x026871, 0x636363, 0x4d4d4d, 0xcb0316, 0x05751e, 0x7b620a, 0x1159e3, 0xad22a7, 0x0c6f78, 0x383838]
            : [0x929292, 0xfa574e, 0x36a442, 0xaf8c11, 0x518cfe, 0xd961d1, 0x009fac, 0xc7c7c7, 0xa4a4a4, 0xfe9489, 0x4ec95a, 0xd8ac05, 0x88b1fe, 0xfe83f5, 0x07c4d3, 0xf5f5f5]
    }

    // MARK: SGR

    private static func look(_ style: Style) -> AnsiLook {
        var fg = style.fg, bg = style.bg
        if style.inverse { swap(&fg, &bg) }
        var look = AnsiLook()
        look.fg = fg
        look.bg = bg
        look.inverseFg = fg == nil && style.inverse
        look.inverseBg = bg == nil && style.inverse
        look.bold = style.bold
        look.dim = style.dim && fg == nil
        look.italic = style.italic
        look.underline = style.underline
        look.strike = style.strike
        return look
    }

    private static func applySgr(_ style: Style, _ text: String) -> Style {
        // A colon and a semicolon both separate. A part that is not a number matches nothing, as NaN does on the page.
        let params: [Int?] = text.isEmpty ? [0] : text.replacingOccurrences(of: ":", with: ";").split(separator: ";", omittingEmptySubsequences: false).map { $0.isEmpty ? 0 : Int($0) }
        var s = style
        var i = 0
        while i < params.count {
            defer { i += 1 }
            guard let p = params[i] else { continue }
            switch p {
            case 0: s = Style()
            case 1: s.bold = true
            case 2: s.dim = true
            case 3: s.italic = true
            case 4, 21: s.underline = true
            case 7: s.inverse = true
            case 9: s.strike = true
            case 22: s.bold = false; s.dim = false
            case 23: s.italic = false
            case 24: s.underline = false
            case 27: s.inverse = false
            case 29: s.strike = false
            case 30...37: s.fg = .palette(p - 30)
            case 90...97: s.fg = .palette(p - 90 + 8)
            case 40...47: s.bg = .palette(p - 40)
            case 100...107: s.bg = .palette(p - 100 + 8)
            case 39: s.fg = nil
            case 49: s.bg = nil
            case 38, 48:
                guard let got = extended(params, i + 1) else { return s }
                if p == 38 { s.fg = got.color } else { s.bg = got.color }
                i += got.used
            default: break
            }
        }
        return s
    }

    private static func extended(_ params: [Int?], _ i: Int) -> (color: AnsiColor, used: Int)? {
        guard i < params.count else { return nil }
        if params[i] == 5, i + 1 < params.count, let n = params[i + 1], (0...255).contains(n) {
            return (n < 16 ? .palette(n) : xterm(n), 2)
        }
        if params[i] == 2, i + 3 < params.count {
            let rgb = params[(i + 1)...(i + 3)].compactMap { $0 }
            if rgb.count == 3, rgb.allSatisfy({ (0...255).contains($0) }) { return (.rgb(rgb[0], rgb[1], rgb[2]), 4) }
        }
        return nil
    }

    // MARK: Escape sequences

    private static func isControl(_ c: Unicode.Scalar) -> Bool { c.value < 0x20 || c.value == 0x7F }

    private static func string(_ scalars: ArraySlice<Unicode.Scalar>) -> String {
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        return String(view)
    }

    // ESC [ params (0x30 to 0x3F) intermediates (0x20 to 0x2F) final (0x40 to 0x7E)
    private static func matchCSI(_ t: [Unicode.Scalar], _ at: Int) -> (end: Int, params: String, intermediate: String, final: Unicode.Scalar)? {
        guard at + 1 < t.count, t[at + 1] == "[" else { return nil }
        var i = at + 2
        let p0 = i
        while i < t.count, (0x30...0x3F).contains(t[i].value) { i += 1 }
        let p1 = i
        while i < t.count, (0x20...0x2F).contains(t[i].value) { i += 1 }
        guard i < t.count, (0x40...0x7E).contains(t[i].value) else { return nil }
        return (i + 1, string(t[p0..<p1]), string(t[p1..<i]), t[i])
    }

    // ESC ] anything but BEL or ESC, then BEL or ESC \
    private static func matchOSC(_ t: [Unicode.Scalar], _ at: Int) -> Int? {
        guard at + 1 < t.count, t[at + 1] == "]" else { return nil }
        var i = at + 2
        while i < t.count, t[i] != "\u{7}", t[i] != "\u{1B}" { i += 1 }
        guard i < t.count else { return nil }
        if t[i] == "\u{7}" { return i + 1 }
        return i + 1 < t.count && t[i + 1] == "\\" ? i + 2 : nil
    }

    // A sequence that has begun and not ended, which the next piece of the same stream finishes.
    private static func isUnfinished(_ t: [Unicode.Scalar], _ at: Int) -> Bool {
        var i = at + 1
        if i == t.count { return true }
        if t[i] == "[" {
            i += 1
            while i < t.count, (0x30...0x3F).contains(t[i].value) { i += 1 }
            while i < t.count, (0x20...0x2F).contains(t[i].value) { i += 1 }
            return i == t.count
        }
        if t[i] == "]" {
            i += 1
            while i < t.count, t[i] != "\u{7}", t[i] != "\u{1B}" { i += 1 }
            if i < t.count, t[i] == "\u{1B}" { i += 1 }
            return i == t.count
        }
        return false
    }

    // MARK: Lines

    private static func append(_ line: inout Line, _ piece: AnsiPiece) {
        if let last = line.pieces.last, line.pieces.count >= maxPieces || (last.stream == piece.stream && last.look == piece.look) {
            line.pieces[line.pieces.count - 1].text += piece.text
        } else {
            line.pieces.append(piece)
        }
        line.width += piece.text.unicodeScalars.count
    }

    // A line that is written over is held as one cell for each column, so a write costs the text it writes and not the length of the line.
    private static func edit(_ line: inout Line) {
        guard line.cells == nil else { return }
        var cells = (text: [Unicode.Scalar](), looks: [Int]())
        for (n, piece) in line.pieces.enumerated() {
            for scalar in piece.text.unicodeScalars { cells.text.append(scalar); cells.looks.append(n) }
        }
        line.lookTable = line.pieces.map { AnsiPiece(stream: $0.stream, look: $0.look, text: "") }
        line.cells = cells
        line.pieces = []
    }

    private static func pieces(_ line: Line) -> [AnsiPiece] {
        guard let cells = line.cells, !cells.text.isEmpty else { return line.cells == nil ? line.pieces : [] }
        var out: [AnsiPiece] = []
        var from = 0
        var i = 1
        while i <= cells.text.count {
            defer { i += 1 }
            let full = out.count == maxPieces - 1
            if i < cells.text.count, full || same(line.lookTable[cells.looks[i]], line.lookTable[cells.looks[from]]) { continue }
            let src = line.lookTable[cells.looks[from]]
            out.append(AnsiPiece(stream: src.stream, look: src.look, text: string(cells.text[from..<i])))
            from = i
        }
        return out
    }

    private static func same(_ a: AnsiPiece, _ b: AnsiPiece) -> Bool { a.stream == b.stream && a.look == b.look }

    // `piece` written at column `col` of a line, over what is there.
    private static func write(_ line: inout Line, _ col: Int, _ piece: AnsiPiece) {
        if line.cells == nil, col >= line.width {
            if col > line.width { append(&line, AnsiPiece(stream: piece.stream, look: AnsiLook(), text: String(repeating: " ", count: col - line.width))) }
            append(&line, piece)
            return
        }
        edit(&line)
        // A progress bar rewrites one line thousands of times, so a look the last write used is reused.
        let known = AnsiPiece(stream: piece.stream, look: piece.look, text: "")
        if line.lookTable.last != known { line.lookTable.append(known) }
        let slot = line.lookTable.count - 1
        for (n, scalar) in piece.text.unicodeScalars.enumerated() {
            if col + n < line.cells!.text.count {
                line.cells!.text[col + n] = scalar
                line.cells!.looks[col + n] = slot
            } else {
                line.cells!.text.append(scalar)
                line.cells!.looks.append(slot)
            }
        }
        line.width = line.cells!.text.count
    }
}
