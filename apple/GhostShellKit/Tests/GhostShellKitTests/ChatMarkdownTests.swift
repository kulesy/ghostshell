import XCTest
@testable import GhostShellKit

final class ChatMarkdownTests: XCTestCase {
    private func parse(_ s: String, files: Bool = false) -> [MDBlock] { ChatMarkdown.parse(s, fileLinks: files) }
    private func para(_ s: String, files: Bool = false) -> [MDInline] {
        guard case .paragraph(let p)? = parse(s, files: files).first else { XCTFail("not a paragraph"); return [] }
        return p
    }

    func testHeadingsRulesAndParagraphs() {
        let blocks = parse("# One\n\nline a\nline b\n\n---\n\n###### Six")
        XCTAssertEqual(blocks.count, 4)
        XCTAssertEqual(blocks[0], .heading(level: 1, [.text("One")]))
        XCTAssertEqual(blocks[1], .paragraph([.text("line a"), .lineBreak, .text("line b")]))
        XCTAssertEqual(blocks[2], .rule)
        XCTAssertEqual(blocks[3], .heading(level: 6, [.text("Six")]))
    }

    func testFencedCodeKeepsItsTextAndLanguage() {
        let blocks = parse("before\n```swift\nlet a = 1\n\n**not bold**\n```\nafter\n~~~\nplain\n~~~")
        XCTAssertEqual(blocks[1], .code(lang: "swift", text: "let a = 1\n\n**not bold**"))
        XCTAssertEqual(blocks[3], .code(lang: "", text: "plain"))
    }

    func testAnUnclosedFenceTakesTheRest() {
        XCTAssertEqual(parse("```\nopen\nforever"), [.code(lang: "", text: "open\nforever")])
    }

    func testInlineStyles() {
        XCTAssertEqual(para("a **b** *c* _d_ ~~e~~ `f`"), [
            .text("a "), .strong([.text("b")]), .text(" "), .em([.text("c")]), .text(" "), .em([.text("d")]), .text(" "), .del([.text("e")]), .text(" "), .code("f"),
        ])
    }

    func testEmphasisNestsAndSnakeCaseStaysText() {
        XCTAssertEqual(para("**a _b_ c**"), [.strong([.text("a "), .em([.text("b")]), .text(" c")])])
        XCTAssertEqual(para("snake_case_name here"), [.text("snake_case_name here")])
    }

    func testOnlyHttpLinksSurvive() {
        let url = URL(string: "https://example.com/a_b_c")!
        XCTAssertEqual(para("[site](https://example.com/a_b_c)"), [.link(text: [.text("site")], url: url)])
        XCTAssertEqual(para("see https://example.com/a_b_c."), [.text("see "), .link(text: [.text("https://example.com/a_b_c")], url: url), .text(".")])
        XCTAssertEqual(para("[x](javascript:alert(1))"), [.code("x")].map { $0 } + [.text(")")] )
        XCTAssertEqual(para("[x](file:///etc/passwd)"), [.code("x")])
        XCTAssertEqual(para("[x](./relative.md)"), [.code("x")])
    }

    func testNoFileLinksUnlessAllowed() {
        XCTAssertEqual(para("open /Users/me/a.txt now"), [.text("open /Users/me/a.txt now")])
        XCTAssertEqual(para("[a](/Users/me/a.txt)"), [.code("a")])
    }

    func testFileLinksWhenAllowed() {
        XCTAssertEqual(para("open /Users/me/a.txt:12, ok", files: true), [.text("open "), .file(text: [.text("/Users/me/a.txt:12")], path: "/Users/me/a.txt", line: 12), .text(", ok")])
        XCTAssertEqual(para("`~/notes/x.md`", files: true), [.file(text: [.code("~/notes/x.md")], path: "~/notes/x.md", line: nil)])
        XCTAssertEqual(para("[see](</Users/me/My%20File.txt>)", files: true), [.file(text: [.text("see")], path: "/Users/me/My File.txt", line: nil)])
        XCTAssertEqual(para("/api/sessions", files: true), [.text("/api/sessions")])
        XCTAssertEqual(para("[x](/Users/me/../etc)", files: true), [.code("x")])
    }

    func testFileTargetRules() {
        XCTAssertNil(ChatMarkdown.fileTarget("relative/path"))
        XCTAssertNil(ChatMarkdown.fileTarget("/a//b"))
        XCTAssertNil(ChatMarkdown.fileTarget("/a/./b"))
        XCTAssertNil(ChatMarkdown.fileTarget("/a/b/"))
        XCTAssertNil(ChatMarkdown.fileTarget("/a/b\u{7}"))
        XCTAssertEqual(ChatMarkdown.fileTarget("file://localhost/Users/me/a")?.path, "/Users/me/a")
        XCTAssertNil(ChatMarkdown.fileTarget("file://host/a"))
        XCTAssertNil(ChatMarkdown.fileTarget("/a/b%3A12", encoded: true))
        XCTAssertEqual(ChatMarkdown.fileTarget("/a/b:3:9")?.line, 3)
    }

    func testNestedListsAndOrdering() {
        let blocks = parse("1. one\n2. two\n   - sub a\n   - sub b\n3. three wraps\n   onto a second line\n\n- bullet")
        guard case .list(let ordered, let start, let items) = blocks[0] else { return XCTFail() }
        XCTAssertTrue(ordered)
        XCTAssertEqual(start, 1)
        XCTAssertEqual(items.count, 3)
        guard case .list(false, _, let sub)? = items[1].children.first else { return XCTFail("nested list") }
        XCTAssertEqual(sub.count, 2)
        XCTAssertEqual(items[2].text, [.text("three wraps"), .text(" "), .text("onto a second line")])
        guard case .list(false, _, _) = blocks[1] else { return XCTFail("a bullet after numbers is a new list") }
    }

    func testAGapDoesNotSplitAList() {
        guard case .list(_, let start, let items) = parse("3. a\n\n4. b")[0] else { return XCTFail() }
        XCTAssertEqual(start, 3)
        XCTAssertEqual(items.count, 2)
    }

    func testQuotesNest() {
        XCTAssertEqual(parse("> a\n> > b"), [.quote([.paragraph([.text("a")]), .quote([.paragraph([.text("b")])])])])
    }

    func testQuoteDepthIsCapped() {
        var depth = 0
        var blocks = parse(String(repeating: ">", count: 5000) + " deep")
        while case .quote(let inner)? = blocks.first { depth += 1; blocks = inner }
        XCTAssertEqual(depth, 16)
        guard case .paragraph? = blocks.first else { return XCTFail("the rest is text") }
    }

    func testOddLineBreaksNeverCrashAListParse() {
        for sep in ["\u{2028}", "\u{2029}", "\u{85}", "\u{0B}", "\u{0C}"] {
            // The server splits a line at the first three, so they end the item. \v and \f stay inside it, as they do on the web page.
            let inside = sep == "\u{0B}" || sep == "\u{0C}"
            XCTAssertEqual(parse("- a\(sep)b").count, inside ? 1 : 2, sep.debugDescription)
            _ = parse("1. a\(sep)- b\(sep)  - c")
        }
        for sep in ["\u{0B}", "\u{0C}"] {
            XCTAssertEqual(parse("- a\(sep)b"), [.list(ordered: false, start: 1, items: [MDItem(text: [.text("a\(sep)b")], children: [])])])
        }
        // A separator the server treats as a line break splits the item, as it splits the line.
        XCTAssertEqual(parse("- a\u{2028}b"), [.list(ordered: false, start: 1, items: [MDItem(text: [.text("a")], children: [])]), .paragraph([.text("b")])])
    }

    func testListNestingIsCapped() {
        let src = (0..<300).map { String(repeating: "  ", count: $0) + "- item \($0)" }.joined(separator: "\n")
        var levels = 0, items = 0
        var blocks = parse(src)
        while case .list(_, _, let list)? = blocks.first {
            levels += 1
            items += list.count
            blocks = list.last?.children ?? []
        }
        XCTAssertEqual(levels, 17)
        XCTAssertEqual(items, 300)
    }

    func testTable() {
        let blocks = parse("| A | B |\n|---|:--|\n| 1 | `x` |\n| 2 | **y** |\n\nafter")
        guard case .table(let head, let rows) = blocks[0] else { return XCTFail() }
        XCTAssertEqual(head, [[.text("A")], [.text("B")]])
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[1][1], [.strong([.text("y")])])
        XCTAssertEqual(blocks.count, 2)
    }

    func testAPipeLineWithoutARuleIsAParagraph() {
        guard case .paragraph = parse("| a | b |")[0] else { return XCTFail() }
    }

    func testCRLFAndEmptyAndHugeInput() {
        XCTAssertEqual(parse("a\r\nb"), [.paragraph([.text("a"), .lineBreak, .text("b")])])
        XCTAssertEqual(parse(""), [])
        let started = Date()
        _ = parse(String(repeating: "[", count: 20_000) + String(repeating: "x ", count: 20_000))
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }
}

final class ChatLinkTests: XCTestCase {
    func testWebLinksPassAndRoundTrip() {
        let url = URL(string: "https://example.com/a?b=1")!
        XCTAssertEqual(ChatLink.web(url).url, url)
        XCTAssertEqual(ChatLink(url: url), .web(url))
        XCTAssertEqual(ChatLink(url: URL(string: "HTTP://example.com")!), .web(URL(string: "HTTP://example.com")!))
    }

    func testFileLinksRoundTripIncludingHomeAndSpaces() {
        for link in [ChatLink.file(path: "/Users/me/a b.txt", line: 12), .file(path: "~/notes/x.md", line: nil), .file(path: "/tmp/a&b=c", line: 3)] {
            let url = try! XCTUnwrap(link.url)
            XCTAssertEqual(url.scheme, "ghostshell-file")
            XCTAssertEqual(ChatLink(url: url), link)
        }
    }

    func testEverythingElseIsRefused() {
        for text in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x", "mailto:a@b.c", "x-apple.systempreferences:", "https:///nohost",
                     "ghostshell-file:open?path=../../etc/passwd", "ghostshell-file:open?path=relative/x", "ghostshell-file:open", "ghostshell-file://host/etc/passwd"] {
            XCTAssertNil(ChatLink(url: URL(string: text)!), text)
        }
    }
}
