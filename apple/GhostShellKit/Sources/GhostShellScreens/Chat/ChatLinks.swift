import Foundation
import GhostShellKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Where a link in a chat points. Anything but a plain web address or a file the server serves is dropped before it gets here.
enum ChatLink: Hashable {
    case web(URL)
    /// A path from a reply, which only the files feature may open, through the server.
    case file(path: String, line: Int?)

    private static let fileScheme = "ghostshell-file"

    /// The URL a rendered link carries, so a tap comes back through `OpenURLAction` and is classified here.
    var url: URL? {
        switch self {
        case .web(let url): return url
        case .file(let path, let line):
            var parts = URLComponents()
            parts.scheme = Self.fileScheme
            parts.host = ""
            parts.path = path
            if let line { parts.queryItems = [URLQueryItem(name: "line", value: String(line))] }
            return parts.url
        }
    }

    /// Reads a tapped URL. Only http, https and this app's own file scheme pass; file:// and everything else is nil.
    init?(url: URL) {
        switch url.scheme?.lowercased() {
        case "http", "https":
            guard url.host?.isEmpty == false else { return nil }
            self = .web(url)
        case Self.fileScheme:
            guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.path.hasPrefix("/") || parts.path.hasPrefix("~/") else { return nil }
            self = .file(path: parts.path, line: parts.queryItems?.first { $0.name == "line" }.flatMap { Int($0.value ?? "") })
        default:
            return nil
        }
    }
}

enum ChatLinks {
    /// Opens a web link in the default browser. A file link is not opened here.
    @MainActor @discardableResult
    static func openInBrowser(_ link: ChatLink) -> Bool {
        guard case .web(let url) = link, ["http", "https"].contains(url.scheme?.lowercased()) else { return false }
        #if os(macOS)
        return NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        return true
        #endif
    }
}
