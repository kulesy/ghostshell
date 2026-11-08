import Foundation

/// Where a link in a chat points. Anything but a plain web address or a plain path from a reply is dropped before it gets here, so a tap can
/// never reach `file://` or another scheme.
public enum ChatLink: Hashable, Sendable {
    case web(URL)
    /// A path from a reply, which only the files feature may open, through the server.
    case file(path: String, line: Int?)

    private static let fileScheme = "ghostshell-file"

    /// The URL a rendered link carries, so a tap comes back through `OpenURLAction` and is classified by `init?(url:)`.
    public var url: URL? {
        switch self {
        case .web(let url): return url
        case .file(let path, let line):
            var parts = URLComponents()
            parts.scheme = Self.fileScheme
            parts.path = "open"
            parts.queryItems = [URLQueryItem(name: "path", value: path)] + (line.map { [URLQueryItem(name: "line", value: String($0))] } ?? [])
            return parts.url
        }
    }

    /// Reads a tapped URL. Only http, https and this app's own file scheme pass, and a path must be a plain one; everything else is nil.
    public init?(url: URL) {
        switch url.scheme?.lowercased() {
        case "http", "https":
            guard url.host?.isEmpty == false else { return nil }
            self = .web(url)
        case Self.fileScheme:
            guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let path = parts.queryItems?.first(where: { $0.name == "path" })?.value,
                  let target = ChatMarkdown.fileTarget(path) else { return nil }
            self = .file(path: target.path, line: parts.queryItems?.first { $0.name == "line" }.flatMap { Int($0.value ?? "") })
        default:
            return nil
        }
    }
}
