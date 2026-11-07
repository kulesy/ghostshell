import Foundation

// The page's Markdown (public/md.mjs) as a tree, so the same reply reads the same here. Only http and https links survive, and a path is a file link
// only when the caller says the server allows file links. The tree is plain data: Screens draws it and decides what a tap does.

public indirect enum MDInline: Hashable, Sendable {
    case text(String)
    case code(String)
    case strong([MDInline])
    case em([MDInline])
    case del([MDInline])
    /// Always http or https.
    case link(text: [MDInline], url: URL)
    case file(text: [MDInline], path: String, line: Int?)
    case lineBreak
}

public struct MDItem: Hashable, Sendable {
    public var text: [MDInline]
    /// Lists nested under this item.
    public var children: [MDBlock]
}

public indirect enum MDBlock: Hashable, Sendable {
    case paragraph([MDInline])
    /// `level` is the Markdown level, 1 to 6.
    case heading(level: Int, [MDInline])
    case code(lang: String, text: String)
    case rule
    case list(ordered: Bool, start: Int, items: [MDItem])
    case quote([MDBlock])
    case table(head: [[MDInline]], rows: [[[MDInline]]])
}

public enum ChatMarkdown {
    public static func parse(_ src: String, fileLinks: Bool = false) -> [MDBlock] {
        BlockParser(fileLinks: fileLinks).blocks(src)
    }

    /// Where a link or path points, as a path and line, or nil when it is not a plain path. A `:12` or `:12:3` on the end sets the line, a file URL
    /// becomes the absolute path it names, and `encoded` says the path is written as a link target is, with %20 for a space.
    public static func fileTarget(_ raw: String, encoded: Bool = false) -> (path: String, line: Int?)? {
        var path = raw
        var line: Int?
        if let g = lineSuffix.groups(raw) { path = g[1]; line = Int(g[2]) }
        let isURL = path.hasPrefix("file://")
        if isURL {
            path.removeFirst(7)
            if path.hasPrefix("localhost/") { path.removeFirst(9) }
        }
        if isURL || encoded {
            guard let decoded = path.removingPercentEncoding else { return nil }
            path = decoded
            if isURL && !path.hasPrefix("/") { return nil }
            // A decoded path that ends in :12 would read as a line.
            if lineSuffix.matches(path) { return nil }
        }
        return isPlain(path) ? (path, line) : nil
    }

    private static let lineSuffix = Rx(#"^(.*?):([1-9]\d{0,6})(?::\d{1,7})?$"#)

    /// Starts with `~/` or `/`, and every segment after that is named: none empty, none `.` or `..`, no trailing slash, no control characters.
    private static func isPlain(_ path: String) -> Bool {
        let rest: Substring
        if path.hasPrefix("~/") { rest = path.dropFirst(2) } else if path.hasPrefix("/") { rest = path.dropFirst() } else { return false }
        if path.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) { return false }
        return rest.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
}

// MARK: Regex helpers

extension Rx {
    struct Hit { var range: Range<String.Index>; var groups: [String] }

    func all(_ text: String) -> [Hit] {
        re.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { m in
            guard let whole = Range(m.range, in: text) else { return nil }
            return Hit(range: whole, groups: (0..<m.numberOfRanges).map { Range(m.range(at: $0), in: text).map { String(text[$0]) } ?? "" })
        }
    }

    /// Replaces each match with what `make` returns, and leaves a match alone when it returns nil.
    func substitute(_ text: String, _ make: (Hit) -> String?) -> String {
        var out = ""
        var cursor = text.startIndex
        for hit in all(text) {
            guard let new = make(hit) else { continue }
            out += text[cursor..<hit.range.lowerBound] + new
            cursor = hit.range.upperBound
        }
        return out + text[cursor...]
    }
}

// MARK: Inline

private final class InlineParser {
    let fileLinks: Bool
    private var kept: [MDInline] = []
    private var spans: [Int: String] = [:]

    init(fileLinks: Bool) { self.fileLinks = fileLinks }

    private static let codeSpan = Rx(#"`([^`\n]+)`"#)
    private static let httpLink = Rx(#"\[([^\]\n]{1,1000})\]\((https?:\/\/[^\s)]{1,4096})\)"#)
    private static let fileLink = Rx(#"\[([^\]\n]{1,1000})\]\((?:<([^>\n]{1,4096})>|([^\s)]{1,4096}))\)"#)
    private static let otherLink = Rx(#"\[([^\]\n]{1,1000})\]\(([^\s)]{1,4096})\)"#)
    private static let bareURL = Rx(#"(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])"#)
    private static let rooted = #"(?:~\/|file:\/\/|\/(?:Users|private|tmp|var|opt|etc|Volumes|Applications|Library|System|usr|home)\/)[^\s<>()*`\u0000]+"#
    private static let barePath = Rx(#"(^|[\s(*])("# + rooted + ")")
    private static let wholePath = Rx("^" + rooted + "$")
    private static let slot = Rx(#"\u0000(\d+)\u0000"#)
    private static let trailing = Set(".,;:!?'\"")

    private struct Rule: Sendable { var rx: Rx; var prefix: Bool; var make: @Sendable ([MDInline]) -> MDInline }
    private static let rules: [Rule] = [
        Rule(rx: Rx(#"\*\*([^*\n]+)\*\*"#), prefix: false, make: MDInline.strong),
        Rule(rx: Rx(#"(^|[^\w*])\*([^*\n]+)\*(?!\w)"#), prefix: true, make: MDInline.em),
        Rule(rx: Rx(#"(^|[^\w_])_([^_\n]+)_(?!\w)"#), prefix: true, make: MDInline.em),
        Rule(rx: Rx(#"~~([^~\n]+)~~"#), prefix: false, make: MDInline.del),
    ]

    private func keep(_ inline: MDInline) -> String { kept.append(inline); return "\u{0}\(kept.count - 1)\u{0}" }

    /// Code spans and links are set aside first, so an underscore in a URL stays a URL, then emphasis runs over what is left.
    func parse(_ src: String) -> [MDInline] {
        var s = Self.codeSpan.substitute(src) { hit in
            spans[kept.count] = hit.groups[1]
            return keep(.code(hit.groups[1]))
        }
        s = Self.httpLink.substitute(s) { hit in
            guard let url = URL(string: hit.groups[2]), ["http", "https"].contains(url.scheme) else { return nil }
            return keep(.link(text: resolve(hit.groups[1], linkable: false), url: url))
        }
        if fileLinks {
            s = Self.fileLink.substitute(s) { hit in
                let raw = hit.groups[2].isEmpty ? hit.groups[3] : hit.groups[2]
                guard let target = ChatMarkdown.fileTarget(raw, encoded: true) else { return nil }
                return keep(.file(text: resolve(hit.groups[1], linkable: false), path: target.path, line: target.line))
            }
        }
        // A link to anything else (a relative path, another scheme) is shown as code, never as a link.
        s = Self.otherLink.substitute(s) { keep(.code($0.groups[1])) }
        s = Self.bareURL.substitute(s) { hit in
            guard let url = URL(string: hit.groups[2]) else { return nil }
            return hit.groups[1] + keep(.link(text: [.text(hit.groups[2])], url: url))
        }
        if fileLinks {
            s = Self.barePath.substitute(s) { hit in
                let run = hit.groups[2]
                var end = run.endIndex
                while end > run.startIndex, Self.trailing.contains(run[run.index(before: end)]) { end = run.index(before: end) }
                let shown = String(run[..<end])
                guard let target = ChatMarkdown.fileTarget(shown) else { return nil }
                return hit.groups[1] + keep(.file(text: [.text(shown)], path: target.path, line: target.line)) + run[end...]
            }
        }
        return emphasize(s, 0)
    }

    private func emphasize(_ s: String, _ level: Int) -> [MDInline] {
        guard level < Self.rules.count else { return resolve(s, linkable: true) }
        let rule = Self.rules[level]
        var out: [MDInline] = []
        var cursor = s.startIndex
        for hit in rule.rx.all(s) {
            let before = String(s[cursor..<hit.range.lowerBound]) + (rule.prefix ? hit.groups[1] : "")
            out += emphasize(before, level + 1)
            out.append(rule.make(emphasize(hit.groups[rule.prefix ? 2 : 1], level + 1)))
            cursor = hit.range.upperBound
        }
        return out + emphasize(String(s[cursor...]), level + 1)
    }

    /// Puts the set-aside spans and links back. A code span that is a whole path links when file links are on, but not inside a link's own text.
    private func resolve(_ s: String, linkable: Bool) -> [MDInline] {
        var out: [MDInline] = []
        var cursor = s.startIndex
        for hit in Self.slot.all(s) {
            if cursor < hit.range.lowerBound { out.append(.text(String(s[cursor..<hit.range.lowerBound]))) }
            cursor = hit.range.upperBound
            guard let n = Int(hit.groups[1]), kept.indices.contains(n) else { continue }
            if linkable, fileLinks, let code = spans[n], Self.wholePath.matches(code), let target = ChatMarkdown.fileTarget(code) {
                out.append(.file(text: [kept[n]], path: target.path, line: target.line))
            } else {
                out.append(kept[n])
            }
        }
        if cursor < s.endIndex { out.append(.text(String(s[cursor...]))) }
        return out
    }
}

// MARK: Blocks

private struct BlockParser {
    let fileLinks: Bool

    private static let fence = Rx(#"^\s*(```+|~~~+)\s*([\w+-]*)"#)
    private static let heading = Rx(#"^(#{1,6})\s+(.*)$"#)
    private static let rule = Rx(#"^\s*([-*_])(\s*\1){2,}\s*$"#)
    private static let listStart = Rx(#"^\s*([-*+]|\d+[.)])\s+"#)
    private static let item = Rx(#"^(\s*)([-*+]|(\d+)[.)])\s+(.*)$"#)
    private static let quote = Rx(#"^\s*>"#)
    private static let quotePrefix = Rx(#"^\s*>\s?"#)
    private static let tableRow = Rx(#"^\s*\|.*\|\s*$"#)
    private static let tableRule = Rx(#"^\s*\|?\s*:?-{2,}"#)

    private func inline(_ s: String) -> [MDInline] { InlineParser(fileLinks: fileLinks).parse(s) }

    private func cells(_ line: String) -> [[MDInline]] {
        var t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.split(separator: "|", omittingEmptySubsequences: false).map { inline($0.trimmingCharacters(in: .whitespaces)) }
    }

    func blocks(_ src: String) -> [MDBlock] {
        let lines = src.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        var out: [MDBlock] = []
        var para: [String] = []
        func flush() {
            guard !para.isEmpty else { return }
            var joined: [MDInline] = []
            for (n, line) in para.enumerated() {
                if n > 0 { joined.append(.lineBreak) }
                joined += inline(line.trimmingCharacters(in: .whitespaces))
            }
            out.append(.paragraph(joined))
            para = []
        }
        var i = 0
        while i < lines.count {
            let l = lines[i]
            if let f = Self.fence.groups(l) {
                flush()
                var body: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(f[1]) { body.append(lines[i]); i += 1 }
                i += 1
                out.append(.code(lang: f[2], text: body.joined(separator: "\n")))
            } else if let h = Self.heading.groups(l) {
                flush(); out.append(.heading(level: h[1].count, inline(h[2]))); i += 1
            } else if Self.rule.matches(l) {
                flush(); out.append(.rule); i += 1
            } else if Self.listStart.matches(l) {
                flush()
                let (block, next) = list(lines, i)
                out.append(block); i = next
            } else if Self.quote.matches(l) {
                flush()
                var body: [String] = []
                while i < lines.count, Self.quote.matches(lines[i]) { body.append(Self.quotePrefix.replacing(lines[i], with: "")); i += 1 }
                out.append(.quote(blocks(body.joined(separator: "\n"))))
            } else if Self.tableRow.matches(l), i + 1 < lines.count, Self.tableRule.matches(lines[i + 1]) {
                flush()
                let head = cells(l)
                i += 2
                var rows: [[[MDInline]]] = []
                while i < lines.count, Self.tableRow.matches(lines[i]) { rows.append(cells(lines[i])); i += 1 }
                out.append(.table(head: head, rows: rows))
            } else if l.trimmingCharacters(in: .whitespaces).isEmpty {
                flush(); i += 1
            } else {
                para.append(l); i += 1
            }
        }
        flush()
        return out
    }

    private func list(_ lines: [String], _ start: Int) -> (MDBlock, Int) {
        let first = Self.item.groups(lines[start])!
        let indent = first[1].count
        let ordered = !first[3].isEmpty
        // An item of this list at this depth, or one nested under it. A bullet after a number starts a new list.
        func belongs(_ m: [String]?) -> Bool { m.map { $0[1].count > indent || ($0[1].count == indent && !$0[3].isEmpty == ordered) } ?? false }
        var items: [MDItem] = []
        var i = start
        while i < lines.count {
            let l = lines[i]
            // Blank lines between items keep the list going, so "1." then a gap then "2." stays one list.
            if l.trimmingCharacters(in: .whitespaces).isEmpty {
                var j = i + 1
                while j < lines.count, lines[j].trimmingCharacters(in: .whitespaces).isEmpty { j += 1 }
                if j < lines.count, belongs(Self.item.groups(lines[j])) { i = j; continue }
                break
            }
            let m = Self.item.groups(l)
            if let m, m[1].count == indent, !m[3].isEmpty == ordered {
                items.append(MDItem(text: [], children: [])); items[items.count - 1].text = inline(m[4]); i += 1
            } else if let m, m[1].count > indent, !items.isEmpty {
                let (sub, next) = list(lines, i)
                items[items.count - 1].children.append(sub); i = next
                _ = m
            } else if m == nil, l.first?.isWhitespace == true, !items.isEmpty {
                // A wrapped line continues the item's text.
                items[items.count - 1].text += [.text(" ")] + inline(l.trimmingCharacters(in: .whitespaces)); i += 1
            } else {
                break
            }
        }
        return (.list(ordered: ordered, start: ordered ? Int(first[3]) ?? 1 : 1, items: items), i)
    }
}
