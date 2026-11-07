import XCTest
@testable import GhostShellKit

final class ServerAddressTests: XCTestCase {
    func testLoopbackMayUseHttp() {
        for text in ["http://localhost:4310", "localhost:4310", "http://127.0.0.1:4310", "127.5.5.5:80", "http://[::1]:4310", "[::1]:4310"] {
            let address = ServerAddress(text)
            XCTAssertEqual(address?.baseURL.scheme, "http", text)
        }
        XCTAssertEqual(ServerAddress("localhost:4310")?.baseURL.absoluteString, "http://localhost:4310/")
        XCTAssertEqual(ServerAddress("http://[::1]:4310")?.origin, "http://[::1]:4310")
    }

    func testOtherHostsNeedHttps() {
        XCTAssertNil(ServerAddress("http://example.com"))
        XCTAssertNil(ServerAddress("http://192.168.1.5:4310"))
        XCTAssertNil(ServerAddress("http://127.0.0.1.example.com"))
        XCTAssertNil(ServerAddress("http://localhost.example.com"))
        XCTAssertNil(ServerAddress("http://127.1"))
        XCTAssertNil(ServerAddress("http://0127.0.0.1"))
        XCTAssertNil(ServerAddress("http://127.000.000.001"))
        XCTAssertEqual(ServerAddress("example.com")?.baseURL.absoluteString, "https://example.com/")
        XCTAssertEqual(ServerAddress("https://Example.com:443")?.origin, "https://example.com")
    }

    func testRefusesWhatCouldRedirectATokenOrHideAHost() {
        for text in ["", "   ", "ftp://example.com", "https://user@example.com", "https://user:pw@example.com", "https://example.com?x=1", "https://example.com#top",
                     "https://exa mple.com", "https://example.com/a/../b", "https://example.com/%2e%2e/b", "https://example.com:99999", "https://", "file:///etc"] {
            XCTAssertNil(ServerAddress(text), text)
        }
    }

    func testRefusesAnEncodedHostAndAZoneOnAnIPv6Host() {
        for text in ["http://%3A%3A1%25%40127.0.0.1.example.com:4310%23/", "http://%3A%3A1%25%40evil.example%23/", "https://ghost.example%3A%40evil.example%23/",
                     "%3A%3A1%25%40evil.example%23/", "https://ex%61mple.com", "http://[::1%25lo0]", "http://[::1%25x.127.0.0.1.example.com]", "[::1%25lo0]:4310"] {
            XCTAssertNil(ServerAddress(text), text)
        }
    }

    // Random mixes of the characters that have fooled URL parsers. An address that gets through must land on a host that was checked.
    func testAnAcceptedAddressAlwaysLandsOnACheckedHost() throws {
        let pieces = ["%3A%3A1", "::1", "%3A", "%25", "%40", "%23", "%3F", "%2F", "%5B", "%5D", "%00", "@", "#", "?", ":", "/", "[", "]", ".", "1", "lo0",
                      "127.0.0.1", "localhost", "evil.example", ":4310", "%3A4310"]
        var state: UInt64 = 80
        func next(_ bound: Int) -> Int {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Int((state >> 33) % UInt64(bound))
        }
        for _ in 0..<40_000 {
            let text = ["http://", "https://", ""][next(3)] + (0...next(7)).map { _ in pieces[next(pieces.count)] }.joined()
            guard let address = ServerAddress(text) else { continue }
            let parts = try XCTUnwrap(URLComponents(url: address.baseURL, resolvingAgainstBaseURL: false), text)
            let host = try XCTUnwrap(parts.percentEncodedHost, text).trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            XCTAssertTrue(host.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || ".-:".contains($0)) }, text)
            XCTAssertTrue(parts.user == nil && parts.password == nil && parts.query == nil && parts.fragment == nil, text)
            if address.baseURL.scheme == "http" { XCTAssertNotNil(host.range(of: #"^(localhost|::1|127(\.[0-9]{1,3}){3})$"#, options: .regularExpression), text) }
        }
    }

    func testSubPathIsKeptAndEndsInASlash() throws {
        let address = try XCTUnwrap(ServerAddress("https://example.com/ghost//app"))
        XCTAssertEqual(address.baseURL.absoluteString, "https://example.com/ghost/app/")
        XCTAssertEqual(try address.url(for: "api/sessions").absoluteString, "https://example.com/ghost/app/api/sessions")
        XCTAssertEqual(try address.url(for: "login").absoluteString, "https://example.com/ghost/app/login")
    }

    func testKeyDiffersPerAddress() {
        XCTAssertNotEqual(ServerAddress("https://a.example.com")?.key, ServerAddress("https://b.example.com")?.key)
        XCTAssertEqual(ServerAddress("HTTPS://A.example.com/")?.key, ServerAddress("a.example.com")?.key)
    }

    func testRequestPathsMustBeRelative() throws {
        let address = try XCTUnwrap(ServerAddress("https://example.com/base"))
        for path in ["", "/api/sessions", "//evil.com/x", "https://evil.com/x", "http:evil", "javascript:alert(1)", "api/../x", "..", ".", "api/./x", "api//x", "a/\u{0}b", "api/sessions/"] {
            XCTAssertThrowsError(try address.url(for: path), path) { XCTAssertEqual($0 as? GhostShellError, .badPath(path)) }
        }
    }

    func testOddCharactersInASegmentStayInThatSegment() throws {
        let address = try XCTUnwrap(ServerAddress("https://example.com"))
        XCTAssertEqual(try address.url(for: "api/files/a b?c#d%2e").absoluteString, "https://example.com/api/files/a%20b%3Fc%23d%252e")
        let url = try address.url(for: "api/sessions", query: [URLQueryItem(name: "archived", value: "1")])
        XCTAssertEqual(url.absoluteString, "https://example.com/api/sessions?archived=1")
        let plus = try address.url(for: "api/files", query: [URLQueryItem(name: "path", value: "/a+b c.png")])
        XCTAssertEqual(plus.absoluteString, "https://example.com/api/files?path=/a%2Bb%20c.png")
    }
}
