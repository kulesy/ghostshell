import Foundation

public enum PromptVerdict: Sendable, Equatable { case send, ask, drop }
public enum LinkVerdict: Sendable, Equatable { case open, ask }

/// What the app decides about a widget, ported from public/ui/widget-frame.js. Times are milliseconds on one clock, and an unset time is nil.
public enum WidgetRules {
    public static let heightMin = WidgetPage.heightMin
    public static let heightMax = WidgetPage.heightMax
    public static let activeMs = Double(WidgetPage.activeMs)
    public static let promptMax = WidgetPage.promptMax
    public static let linkMax = WidgetPage.linkMax

    // MARK: Gates

    /// Send a prompt at once, ask the owner, or drop it. A send needs a click on this widget, `activeMs` since the last send and a short text.
    public static func promptGate(text: String, clickedHere: Bool, now: Double, lastSent: Double?, pending: Bool) -> PromptVerdict {
        if pending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .drop }
        return clickedHere && now - (lastSent ?? -.infinity) >= activeMs && text.utf16.count <= promptMax ? .send : .ask
    }

    /// Open a link at once, after a click on this widget and `activeMs` since the last one, or ask the owner.
    public static func linkGate(clickedHere: Bool, now: Double, lastOpened: Double?) -> LinkVerdict {
        clickedHere && now - (lastOpened ?? -.infinity) >= activeMs ? .open : .ask
    }

    // MARK: Smaller decisions

    public static func clampHeight(_ h: Double) -> Int? {
        h.isFinite ? Int(min(max(h.rounded(.up), Double(heightMin)), Double(heightMax))) : nil
    }

    private static let underscores = Rx(#"_+"#)
    private static let spaced = Rx(#"\s+"#)
    private static let separators = Rx(#"[\s,]+"#)

    /// A tool's title is an identifier such as q4_revenue_by_product_line, so the frame is named by it as words.
    public static func humanTitle(_ title: String?) -> String {
        let words = spaced.replacing(underscores.replacing(title ?? "", with: " "), with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = words.unicodeScalars.first else { return "Widget" }
        return String(first).uppercased() + String(words.unicodeScalars.dropFirst())
    }

    private static let leadingSVG = Rx(#"^\s*<svg(?=[\s/>])([^>]*)>"#, .caseInsensitive)

    /// A widget that is only an SVG is drawn as a card. One that starts with anything else is a page of its own.
    public static func isCard(_ code: String) -> Bool { leadingSVG.matches(code) }

    /// The root SVG's viewBox, to hold its place before the frame has measured itself. Nil when the SVG has a width of its own.
    public static func viewBoxRatio(_ code: String) -> (width: Double, height: Double)? {
        guard let tag = leadingSVG.groups(code) else { return nil }
        let own = attribute(tag[1], "width")
        if let own, !own.isEmpty, own != "auto", !own.hasSuffix("%") { return nil }
        guard let box = attribute(tag[1], "viewBox") else { return nil }
        let parts = separators.replacing(box, with: " ").components(separatedBy: " ")
        guard parts.count == 4, let width = Double(parts[2]), let height = Double(parts[3]), width > 0, height > 0, width.isFinite, height.isFinite else { return nil }
        return (width, height)
    }

    private static func attribute(_ attributes: String, _ name: String) -> String? {
        guard let found = Rx(#"\s"# + name + #"\s*=\s*(?:"([^"]*)"|'([^']*)')"#, .caseInsensitive).groups(attributes) else { return nil }
        return (found[1].isEmpty ? found[2] : found[1]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Icons

    private static let rule = try! NSRegularExpression(pattern: #"([^{}]+)\{([^{}]*)\}"#)
    private static let content = Rx(#"content\s*:\s*["']\\([0-9a-f]{1,6})["']"#, .caseInsensitive)
    private static let selector = try! NSRegularExpression(pattern: #"\.ti-([a-z0-9-]+)::?before"#, options: .caseInsensitive)
    private static let iconName = Rx(#"^[a-z0-9-]+$"#)

    /// The glyph names in Tabler's stylesheet and the code each draws, as `["home": "eac1"]`. A rule may name several icons. A name or code the frame
    /// would refuse is left out.
    public static func parseGlyphs(_ css: String) -> [String: String] {
        var glyphs: [String: String] = [:]
        let all = NSRange(css.startIndex..., in: css)
        rule.enumerateMatches(in: css, range: all) { match, _, _ in
            guard let match, let selectors = Range(match.range(at: 1), in: css), let body = Range(match.range(at: 2), in: css),
                  let code = content.groups(String(css[body]))?[1].lowercased() else { return }
            let text = String(css[selectors])
            selector.enumerateMatches(in: text, range: NSRange(text.startIndex..., in: text)) { named, _, _ in
                guard let named, let r = Range(named.range(at: 1), in: text) else { return }
                let name = String(text[r])
                if iconName.matches(name) { glyphs[name] = code }
            }
        }
        return glyphs
    }

    // MARK: Links

    /// The address to offer the owner for a link, or nil when the widget must not get to propose it: only a web address that names no user.
    /// Written out here instead of through URL, because Foundation and the web page disagree on what a URL is.
    /// NOTE: [8 Nov 2026] EK - This is stricter than the page on purpose: a host with a non-ASCII letter, a bracketed host or any `@` before the host is
    /// refused, so the host the ask bar shows is the host that opens.
    public static func linkTarget(_ url: String) -> String? {
        guard url.utf16.count <= linkMax else { return nil }
        // Scalars, not Characters: Swift counts "\r\n" as one Character, which would survive a filter on Characters.
        let trimmed = String(url.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" })
        guard let head = Rx(#"^([A-Za-z][A-Za-z0-9+.\-]*):(.*)$"#, .dotMatchesLineSeparators).groups(trimmed) else { return nil }
        let scheme = head[1].lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }
        var rest = head[2]
        guard rest.hasPrefix("//") || rest.hasPrefix("/\\") || rest.hasPrefix("\\/") || rest.hasPrefix("\\\\") else { return nil }
        rest.removeFirst(2)
        // A backslash ends the authority and counts as a slash in the path, as it does for the page.
        let cut = rest.firstIndex { "/\\?#".contains($0) } ?? rest.endIndex
        let authority = String(rest[..<cut])
        var tail = String(rest[cut...])
        guard !authority.contains("@") else { return nil }
        let hostPort = authority.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let host = hostPort[0].lowercased()
        guard Rx(#"^[a-z0-9]([a-z0-9._~\-]*)$"#).matches(host) else { return nil }
        var port = ""
        if hostPort.count == 2, !hostPort[1].isEmpty {
            guard hostPort[1].allSatisfy(\.isASCII), hostPort[1].allSatisfy(\.isNumber), let n = Int(hostPort[1]), n <= 65535 else { return nil }
            if n != (scheme == "https" ? 443 : 80) { port = ":\(n)" }
        }
        var fragment = ""
        if let hash = tail.firstIndex(of: "#") {
            fragment = "#" + encode(String(tail[tail.index(after: hash)...]), keeping: fragmentSafe)
            tail = String(tail[..<hash])
        }
        var query = ""
        if let mark = tail.firstIndex(of: "?") {
            query = "?" + encode(String(tail[tail.index(after: mark)...]), keeping: querySafe)
            tail = String(tail[..<mark])
        }
        let path = dotted(tail.replacingOccurrences(of: "\\", with: "/"))
        let href = "\(scheme)://\(host)\(port)\(path)\(query)\(fragment)"
        return href.utf16.count <= linkMax ? href : nil
    }

    // The printable ASCII each part of an address keeps as it is, as the web standard lists them. Anything else, a non-ASCII letter included, is
    // percent-encoded as UTF-8.
    private static let printable = Set((0x21...0x7E).compactMap(Unicode.Scalar.init))
    private static let pathSafe = printable.subtracting("\"#<>?`{}".unicodeScalars)
    private static let querySafe = printable.subtracting("\"#<>'".unicodeScalars)
    private static let fragmentSafe = printable.subtracting("\"<>`".unicodeScalars)

    private static func encode(_ text: String, keeping safe: Set<Unicode.Scalar>) -> String {
        var out = ""
        for scalar in text.unicodeScalars {
            if safe.contains(scalar) { out.unicodeScalars.append(scalar); continue }
            for byte in String(scalar).utf8 { out += String(format: "%%%02X", byte) }
        }
        return out
    }

    /// The path with `.` and `..` resolved, always starting with a slash.
    private static func dotted(_ path: String) -> String {
        var kept: [String] = []
        let segments = path.split(separator: "/", omittingEmptySubsequences: false).dropFirst(path.hasPrefix("/") ? 1 : 0)
        for (n, raw) in segments.enumerated() {
            let segment = String(raw)
            let last = n == segments.count - 1
            switch segment.lowercased() {
            case ".", "%2e": if last { kept.append("") }
            case "..", ".%2e", "%2e.", "%2e%2e":
                if !kept.isEmpty { kept.removeLast() }
                if last { kept.append("") }
            default: kept.append(encode(segment, keeping: pathSafe))
            }
        }
        return "/" + kept.joined(separator: "/")
    }
}
