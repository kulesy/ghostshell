import XCTest
@testable import GhostShellKit

/// Mirrors test/ansi.test.mjs: colours and weight from SGR sequences, \r writing over the line, and the escape sequences that are dropped.
final class TerminalAnsiTests: XCTestCase {
    private let esc = "\u{1B}"

    private func out(_ text: String) -> TerminalChunk { .init(stream: "out", text: text) }
    private func err(_ text: String) -> TerminalChunk { .init(stream: "err", text: text) }

    // One string for each piece: "fg1+bold|text".
    private func tag(_ look: AnsiLook) -> String {
        var parts: [String] = []
        switch look.fg {
        case .palette(let n)?: parts.append("fg\(n)")
        case .rgb(let r, let g, let b)?: parts.append("fg#\(r),\(g),\(b)")
        case nil: if look.inverseFg { parts.append("ifg") }
        }
        switch look.bg {
        case .palette(let n)?: parts.append("bg\(n)")
        case .rgb(let r, let g, let b)?: parts.append("bg#\(r),\(g),\(b)")
        case nil: if look.inverseBg { parts.append("ibg") }
        }
        if look.bold { parts.append("bold") }
        if look.dim { parts.append("dim") }
        if look.italic { parts.append("italic") }
        if look.underline { parts.append("underline") }
        if look.strike { parts.append("strike") }
        return parts.joined(separator: "+")
    }

    private func draw(_ chunks: TerminalChunk...) -> [[String]] {
        TerminalAnsi.render(chunks).lines.map { $0.map { piece in tag(piece.look).isEmpty ? piece.text : "\(tag(piece.look))|\(piece.text)" } }
    }

    private func plain(_ chunks: TerminalChunk...) -> String { TerminalAnsi.plain(chunks) }

    func testPlainTextIsOnePieceALine() {
        XCTAssertEqual(draw(out("one\ntwo\n")), [["one"], ["two"]])
        XCTAssertEqual(draw(out("one\ntwo")), [["one"], ["two"]])
        XCTAssertEqual(draw(out("a\n\nb")), [["a"], [], ["b"]])
        XCTAssertEqual(draw(), [[]])
        XCTAssertEqual(draw(out("")), [[]])
    }

    func testAPaletteColourLastsUntilReset() {
        XCTAssertEqual(draw(out("\(esc)[31mred\(esc)[0m plain")), [["fg1|red", " plain"]])
        XCTAssertEqual(draw(out("\(esc)[1;32mgo\(esc)[39m!")), [["fg2+bold|go", "bold|!"]])
        XCTAssertEqual(draw(out("\(esc)[91mbright\(esc)[m")), [["fg9|bright"]])
        XCTAssertEqual(draw(out("\(esc)[44mon blue\(esc)[49m")), [["bg4|on blue"]])
        XCTAssertEqual(draw(out("\(esc)[4mu\(esc)[24m\(esc)[3mi\(esc)[23m\(esc)[9ms")), [["underline|u", "italic|i", "strike|s"]])
    }

    func testAColourCarriesAcrossLinesAndChunksOfTheSameStream() {
        XCTAssertEqual(draw(out("\(esc)[33mone\ntwo\(esc)[0m")), [["fg3|one"], ["fg3|two"]])
        XCTAssertEqual(draw(out("\(esc)[33mone"), out(" two")), [["fg3|one two"]])
        XCTAssertEqual(draw(out("\(esc)[33mone"), err("x"), out("two")), [["fg3|one", "x", "fg3|two"]])
    }

    func testDimOnlyWhenThereIsNoColourOfItsOwn() {
        XCTAssertEqual(draw(out("\(esc)[2mdim\(esc)[0m")), [["dim|dim"]])
        XCTAssertEqual(draw(out("\(esc)[2;31mdim red\(esc)[0m")), [["fg1|dim red"]])
    }

    func testReversedColoursSwap() {
        XCTAssertEqual(draw(out("\(esc)[7mswap\(esc)[0m")), [["ifg+ibg|swap"]])
        XCTAssertEqual(draw(out("\(esc)[31;7mswap\(esc)[0m")), [["ifg+bg1|swap"]])
        XCTAssertEqual(draw(out("\(esc)[31;44;7mswap\(esc)[0m")), [["fg4+bg1|swap"]])
    }

    func testExtendedColours() {
        XCTAssertEqual(draw(out("\(esc)[38;5;9mx")), [["fg9|x"]])
        XCTAssertEqual(draw(out("\(esc)[38;5;196mx")), [["fg#255,0,0|x"]])
        XCTAssertEqual(draw(out("\(esc)[38;5;244mx")), [["fg#128,128,128|x"]])
        XCTAssertEqual(draw(out("\(esc)[38;2;10;200;30mx")), [["fg#10,200,30|x"]])
        XCTAssertEqual(draw(out("\(esc)[48;2;10;200;30mx")), [["bg#10,200,30|x"]])
        XCTAssertEqual(draw(out("\(esc)[38;5;300mx")), [["x"]], "an index out of range is dropped")
        XCTAssertEqual(draw(out("\(esc)[38;2;1;2mx")), [["x"]], "a colour cut short is dropped")
        XCTAssertEqual(draw(out("\(esc)[38:5:2mx")), [["fg2|x"]], "the colon form too")
    }

    func testCarriageReturnWritesOverTheLine() {
        XCTAssertEqual(plain(out("10%\r50%\r100%\n")), "100%")
        XCTAssertEqual(plain(out("abcdef\rxy")), "xycdef")
        XCTAssertEqual(plain(out("a\r\nb")), "a\nb")
        XCTAssertEqual(plain(out("progress: 1\rprogress: 2"), out("\rprogress: 3\n")), "progress: 3")
        XCTAssertEqual(draw(out("\(esc)[31mabcdef\(esc)[0m\rXY")), [["XY", "fg1|cdef"]])
    }

    func testEraseBackspaceAndTab() {
        XCTAssertEqual(plain(out("loading...\r\(esc)[Kdone\n")), "done")
        XCTAssertEqual(plain(out("abcdef\r\(esc)[2Kxy")), "xy")
        XCTAssertEqual(plain(out("abcdef\u{8}\u{8}\(esc)[K")), "abcd")
        XCTAssertEqual(plain(out("abc\u{8}X")), "abX")
        XCTAssertEqual(plain(out("a\tb")), "a       b")
        XCTAssertEqual(plain(out("12345678\tb")), "12345678        b")
    }

    func testOtherEscapeSequencesAreStripped() {
        XCTAssertEqual(plain(out("a\(esc)[2Ab\(esc)[?25lc\(esc)]0;title\u{7}d\u{7}e")), "abcde")
        XCTAssertEqual(plain(out("a\(esc)]8;;http://x\(esc)\\link\(esc)]8;;\(esc)\\")), "alink")
        XCTAssertEqual(plain(out("a\(esc)(Bb\(esc)=c")), "abc")
        XCTAssertEqual(plain(out("a\u{0}b\u{1F}c\u{7F}d")), "abcd")
        XCTAssertEqual(plain(out("\(esc)[2J\(esc)[Hclean")), "clean")
        XCTAssertEqual(plain(out("\(esc)[1;31;40mx\(esc)[0K")), "x")
    }

    func testASequenceSplitBetweenChunksIsFinishedByTheNext() {
        XCTAssertEqual(draw(out("a\(esc)[3"), out("1mb")), [["a", "fg1|b"]])
        XCTAssertEqual(draw(out("a\(esc)"), out("[1mb")), [["a", "bold|b"]])
        XCTAssertEqual(draw(out("a\(esc)]0;ti"), out("tle\u{7}b")), [["ab"]])
        XCTAssertEqual(plain(out("a\(esc)[3")), "a")
    }

    func testTheStreamStaysWithThePiece() {
        let line = TerminalAnsi.render([out("out "), err("err"), out(" out")]).lines[0]
        XCTAssertEqual(line.map { [$0.stream, $0.text] }, [["out", "out "], ["err", "err"], ["out", " out"]])
    }

    func testOnlyTheLastLinesAreReturned() {
        let text = (0..<10).map { "line \($0)" }.joined(separator: "\n")
        let got = TerminalAnsi.render([out(text)], maxLines: 3)
        XCTAssertEqual(got.cut, 7)
        XCTAssertEqual(got.lines.map { $0[0].text }, ["line 7", "line 8", "line 9"])
        XCTAssertEqual(TerminalAnsi.render([out("a\nb")]).cut, 0)
    }

    func testALineKeepsAllItsTextWithinTheMostPieces() {
        let text = (0..<1000).map { "\(esc)[\(31 + $0 % 2)m\($0 % 10)" }.joined()
        let line = TerminalAnsi.render([out(text)]).lines[0]
        XCTAssertEqual(line.count, TerminalAnsi.maxPieces)
        XCTAssertEqual(line.map(\.text).joined(), (0..<1000).map { String($0 % 10) }.joined())
        XCTAssertEqual(tag(line[0].look), "fg1")
        XCTAssertEqual(tag(line[1].look), "fg2")
        XCTAssertEqual(plain(out(text), out("\rXY")), "XY" + (2..<1000).map { String($0 % 10) }.joined())
    }

    func testWritingOverALongColouredLineKeepsEachColourWhereItWasWritten() {
        let a = String(repeating: "a", count: 1000)
        XCTAssertEqual(draw(out("\(a)\r\(esc)[31mXY\(esc)[0m")), [["fg1|XY", String(repeating: "a", count: 998)]])
        XCTAssertEqual(draw(out("\(a)\r\(esc)[31mXY\(esc)[32m\u{8}\u{8}Z")), [["fg2|Z", "fg1|Y", String(repeating: "a", count: 998)]])
        XCTAssertEqual(draw(out("\(esc)[31mabc\rX\(esc)[0m\tY")), [["fg1|X", "       Y"]])
        XCTAssertEqual(draw(out("\(esc)[31mabc\(esc)[2K\(esc)[32mx")), [["   ", "fg2|x"]])
    }

    func testLongOutputIsDrawnFast() {
        var text = ""
        var n = 0
        while text.utf16.count < 256 * 1024 { text += "\(esc)[\(31 + n % 2)mx"; n += 1 }
        let chunks = stride(from: 0, to: text.utf16.count, by: 4096).map { at -> TerminalChunk in
            let start = text.utf16.index(text.utf16.startIndex, offsetBy: at)
            let end = text.utf16.index(start, offsetBy: min(4096, text.utf16.count - at))
            return out(String(text[start..<end]))
        }
        let started = Date()
        let drawn = TerminalAnsi.render(chunks)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.0)
        XCTAssertEqual(drawn.lines.count, 1)
        XCTAssertEqual(drawn.lines[0].reduce(0) { $0 + $1.text.count }, n)

        let lines = (0..<50_000).map { "line \($0) \(esc)[32mok\(esc)[0m" }.joined(separator: "\n")
        let begun = Date()
        let many = TerminalAnsi.render([out(lines)])
        XCTAssertLessThan(Date().timeIntervalSince(begun), 2.0)
        XCTAssertEqual(many.lines.count, 2000)
        XCTAssertEqual(many.cut, 48_000)
    }

    func testOverwritingALongLineIsDrawnFast() {
        let started = Date()
        let drawn = TerminalAnsi.render([out(String(repeating: "a", count: 400_000)), out(String(repeating: "\rX", count: 200_000))])
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.0)
        XCTAssertEqual(drawn.lines[0].map(\.text).joined(), "X" + String(repeating: "a", count: 399_999))
    }

    func testReadableMovesColoursToKeepContrast() {
        XCTAssertTrue(TerminalAnsi.readable(0, 0, 0, scheme: .light) == (0, 0, 0))
        XCTAssertTrue(TerminalAnsi.readable(255, 255, 255, scheme: .dark) == (255, 255, 255))
        let yellow = TerminalAnsi.readable(255, 255, 0, scheme: .light)
        XCTAssertTrue(yellow.0 < 255 && yellow.1 < 255)
        XCTAssertGreaterThan(TerminalAnsi.readable(0, 0, 120, scheme: .dark).2, 120)
        func lum(_ c: (Int, Int, Int)) -> Double {
            func ch(_ v: Int) -> Double { let s = Double(v) / 255; return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4) }
            return 0.2126 * ch(c.0) + 0.7152 * ch(c.1) + 0.0722 * ch(c.2)
        }
        for c in [(255, 255, 255), (200, 200, 200), (255, 0, 0), (0, 255, 0), (0, 0, 255), (128, 128, 128)] {
            let light = lum(TerminalAnsi.readable(c.0, c.1, c.2, scheme: .light)), dark = lum(TerminalAnsi.readable(c.0, c.1, c.2, scheme: .dark))
            XCTAssertGreaterThanOrEqual((0.79 + 0.05) / (light + 0.05), 4.5, "\(c) on light")
            XCTAssertGreaterThanOrEqual((dark + 0.05) / (0.02 + 0.05), 4.5, "\(c) on dark")
        }
    }

    func testThePaletteHasSixteenColoursForEachLook() {
        XCTAssertEqual(TerminalAnsi.palette(.light).count, 16)
        XCTAssertEqual(TerminalAnsi.palette(.dark).count, 16)
    }
}
