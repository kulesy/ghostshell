import Foundation

public enum WidgetMode: String, Sendable, Equatable {
    case light, dark
}

/// The page a widget runs in and the page that holds it. The pieces come from `WidgetPage`, which is generated from the web page's own files.
public enum WidgetFrame {
    /// The widget's document, built exactly as `frameDoc` in public/ui/widget-frame.js builds it. A test holds the two equal.
    public static func document(code: String, mode: WidgetMode?, card: Bool) -> String {
        let attributes = mode.map { " data-mode=\"\($0.rawValue)\" style=\"color-scheme:\($0.rawValue)\"" } ?? ""
        return "<!doctype html><html\(attributes)><head>"
            + "<meta http-equiv=\"Content-Security-Policy\" content=\"\(WidgetPage.csp)\">"
            + "<meta name=\"referrer\" content=\"no-referrer\">"
            + "<meta http-equiv=\"x-dns-prefetch-control\" content=\"off\">"
            + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            + "<style>\(WidgetPage.hostCss)</style>"
            + "<script>(\(WidgetPage.frameBoot))()</script>"
            + "</head><body\(card ? " class=\"\(WidgetPage.cardClass)\"" : "")>\(code)\n</body></html>"
    }

    /// The outer page: a bare, transparent frame around the widget's document. It has no script and no policy of its own, because a srcdoc frame inherits
    /// its parent's policy and the widget's own CDN loads would break. The viewport line makes a phone lay the page out at its own width, which a Mac ignores.
    public static func host(document: String, title: String) -> String {
        "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            + "<style>"
            + "html,body{margin:0;padding:0;background:transparent;overflow:hidden;height:100%}"
            + "iframe{display:block;border:0;width:100%;height:100%;background:transparent}"
            + "</style></head><body>"
            + "<iframe sandbox=\"allow-scripts\" referrerpolicy=\"no-referrer\" title=\"\(escapeAttribute(title))\" srcdoc=\"\(escapeAttribute(document))\"></iframe>"
            + "</body></html>"
    }

    /// For text that goes inside a double-quoted HTML attribute.
    public static func escapeAttribute(_ text: String) -> String {
        var out = ""
        out.reserveCapacity(text.utf8.count + text.utf8.count / 8)
        for c in text.unicodeScalars {
            switch c {
            case "&": out += "&amp;"
            case "\"": out += "&quot;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "'": out += "&#39;"
            default: out.unicodeScalars.append(c)
            }
        }
        return out
    }
}
