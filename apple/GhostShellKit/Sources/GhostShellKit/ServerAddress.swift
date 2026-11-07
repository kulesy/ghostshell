import Foundation

/// The only way to get a base URL. The one failable init normalises and validates, so a value of this type is always safe to send a token to.
public struct ServerAddress: Hashable, Sendable {
    /// The normalised base URL. It always ends in a slash and may carry a sub-path.
    public let baseURL: URL
    /// `scheme://host[:port]`, as a browser sends it in an `Origin` header.
    public let origin: String
    private let basePath: [String]

    /// The default for a server on this Mac.
    public static let local = ServerAddress("http://localhost:4310")!

    /// http is accepted only for a loopback host, https for any other. Userinfo, a query and a fragment are refused.
    public init?(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.unicodeScalars.allSatisfy({ !CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) && $0 != "\\" }) else { return nil }

        // With no scheme typed, a loopback host gets http and everything else https.
        var candidate = trimmed
        if !trimmed.contains("://") {
            guard let guess = URLComponents(string: "https://" + trimmed), let host = guess.percentEncodedHost else { return nil }
            candidate = (Self.isLoopback(host) ? "http://" : "https://") + trimmed
        }
        // Check the raw host. `parts.host` decodes %3A and %40, and the decoded text reads as a different host once it is in a URL.
        guard let parts = URLComponents(string: candidate),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              var host = parts.percentEncodedHost?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil
        else { return nil }
        if host.hasPrefix("["), host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        let isV6 = host.contains(":")
        guard isV6 ? Self.ipv6Bytes(host) != nil : host.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "-") }) else { return nil }
        if scheme == "http", !Self.isLoopback(host) { return nil }
        if let port = parts.port, !(1...65535).contains(port) { return nil }

        var segments: [String] = []
        for raw in parts.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true) {
            guard let segment = String(raw).removingPercentEncoding, segment != ".", segment != "..", !segment.contains("/"), !segment.contains("\\"),
                  segment.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            else { return nil }
            segments.append(segment)
        }

        let defaultPort = scheme == "https" ? 443 : 80
        let shownHost = isV6 ? "[\(host)]" : host
        let port = parts.port == defaultPort ? nil : parts.port
        let shownPort = port.map { ":\($0)" } ?? ""
        let origin = "\(scheme)://\(shownHost)\(shownPort)"
        let path = segments.map(Self.encode).map { "/" + $0 }.joined() + "/"
        // The URL must parse back to exactly what was checked, because that is where the password and the token go.
        guard let url = URL(string: origin + path), let built = URLComponents(url: url, resolvingAgainstBaseURL: false),
              built.scheme == scheme, built.percentEncodedHost?.trimmingCharacters(in: CharacterSet(charactersIn: "[]")) == host, built.port == port,
              built.percentEncodedPath == path, built.user == nil, built.password == nil, built.query == nil, built.fragment == nil
        else { return nil }
        self.baseURL = url
        self.origin = origin
        self.basePath = segments
    }

    /// The same text in, the same key out, so a token saved for one server is never found by another.
    public var key: String { baseURL.absoluteString }

    /// Builds a request URL from a path RELATIVE to the base, such as `api/sessions`. An absolute URL, a scheme, an empty or `.` or `..` segment is refused.
    /// Other characters in a segment are percent-encoded, so they cannot end it early.
    public func url(for path: String, query: [URLQueryItem] = []) throws -> URL {
        let bad = GhostShellError.badPath(path)
        guard !path.isEmpty, !path.hasPrefix("/"), path.range(of: #"^[A-Za-z][A-Za-z0-9+.\-]*:"#, options: .regularExpression) == nil else { throw bad }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        for segment in segments {
            guard !segment.isEmpty, segment != ".", segment != "..", segment.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { throw bad }
        }
        guard var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { throw bad }
        parts.percentEncodedPath = "/" + (basePath.map(Self.encode) + segments.map(Self.encode)).joined(separator: "/")
        parts.queryItems = query.isEmpty ? nil : query
        // URLComponents leaves + alone, and the server's URLSearchParams reads it as a space.
        parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        // The last check: whatever was built must still be this server, over this scheme, under this path.
        guard let url = parts.url, url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port, url.path.hasPrefix(baseURL.path) else { throw bad }
        return url
    }

    private static let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    private static func encode(_ segment: String) -> String { segment.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "" }

    /// localhost, 127.0.0.0/8 and ::1 only. `inet_pton` on macOS accepts `0127.0.0.1`, so the parsed address must print back as the same text.
    static func isLoopback(_ host: String) -> Bool {
        let bare = host.hasPrefix("[") && host.hasSuffix("]") ? String(host.dropFirst().dropLast()) : host
        if bare.lowercased() == "localhost" { return true }
        var v4 = in_addr()
        if inet_pton(AF_INET, bare, &v4) == 1 {
            var text = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &v4, &text, socklen_t(INET_ADDRSTRLEN)) != nil, text.withUnsafeBufferPointer { String(cString: $0.baseAddress!) } == bare else { return false }
            return UInt32(bigEndian: v4.s_addr) >> 24 == 127
        }
        return ipv6Bytes(bare) == [UInt8](repeating: 0, count: 15) + [1]
    }

    /// `inet_pton` on macOS accepts `::1%<anything>`, so only hex digits, colons and dots reach it.
    private static func ipv6Bytes(_ host: String) -> [UInt8]? {
        var v6 = in6_addr()
        guard host.allSatisfy({ $0.isASCII && ($0.isHexDigit || $0 == ":" || $0 == ".") }), inet_pton(AF_INET6, host, &v6) == 1 else { return nil }
        return withUnsafeBytes(of: &v6) { Array($0) }
    }
}
