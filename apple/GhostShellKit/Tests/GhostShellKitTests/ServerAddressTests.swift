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
        XCTAssertEqual(ServerAddress("example.com")?.baseURL.absoluteString, "https://example.com/")
        XCTAssertEqual(ServerAddress("https://Example.com:443")?.origin, "https://example.com")
    }

    func testRefusesWhatCouldRedirectATokenOrHideAHost() {
        for text in ["", "   ", "ftp://example.com", "https://user@example.com", "https://user:pw@example.com", "https://example.com?x=1", "https://example.com#top",
                     "https://exa mple.com", "https://example.com/a/../b", "https://example.com/%2e%2e/b", "https://example.com:99999", "https://", "file:///etc"] {
            XCTAssertNil(ServerAddress(text), text)
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
    }
}
