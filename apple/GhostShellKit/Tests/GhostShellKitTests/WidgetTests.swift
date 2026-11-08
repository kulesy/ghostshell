import XCTest
@testable import GhostShellKit

/// Answers every request and records it. The token in these tests is fake.
private final class WidgetStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var seen: [URLRequest] = []
    nonisolated(unsafe) static var body = "{}"
    private static let lock = NSLock()

    static func reset(body: String) { lock.lock(); defer { lock.unlock() }; seen = []; self.body = body }
    static func requests() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return seen }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        Self.lock.lock(); Self.seen.append(request); let reply = Self.body; Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class WidgetTests: XCTestCase {
    // MARK: The frame document

    func testDocumentMatchesTheWebPageByteForByte() {
        XCTAssertEqual(WidgetFrame.document(code: "<p>golden</p>", mode: .dark, card: false), WidgetPage.goldenDarkPlain)
        XCTAssertEqual(WidgetFrame.document(code: #"<svg viewBox="0 0 10 5"></svg>"#, mode: .light, card: true), WidgetPage.goldenLightCard)
    }

    func testDocumentWithNoModeCarriesNoDataMode() {
        XCTAssertTrue(WidgetFrame.document(code: "x", mode: nil, card: false).hasPrefix("<!doctype html><html><head>"))
    }

    func testHostEscapesTheDocumentAndTheTitleIntoAttributes() {
        let host = WidgetFrame.host(document: #"<a href="x">'&'</a>"#, title: #"A "b" <c>"#)
        XCTAssertTrue(host.contains(#"title="A &quot;b&quot; &lt;c&gt;""#))
        XCTAssertTrue(host.contains(#"srcdoc="&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;""#))
        XCTAssertTrue(host.contains(#"sandbox="allow-scripts" referrerpolicy="no-referrer""#))
        XCTAssertFalse(host.contains("<script"))
        XCTAssertFalse(host.contains("Content-Security-Policy"))
    }

    // MARK: Gates

    private func prompt(_ text: String = "What happens in the cart step?", here: Bool = true, now: Double = 10_000, last: Double? = 0, pending: Bool = false) -> PromptVerdict {
        WidgetRules.promptGate(text: text, clickedHere: here, now: now, lastSent: last, pending: pending)
    }

    func testPromptIsSentOnlyAfterAClickOnThisWidget() {
        XCTAssertEqual(prompt(), .send)
        XCTAssertEqual(prompt(last: nil), .send)
        XCTAssertEqual(prompt(here: false), .ask)
    }

    func testPromptWaitsFiveSecondsSinceTheLastSend() {
        XCTAssertEqual(prompt(now: 11_000, last: 10_000), .ask)
        XCTAssertEqual(prompt(now: 14_999, last: 10_000), .ask)
        XCTAssertEqual(prompt(now: 15_000, last: 10_000), .send)
    }

    func testPromptLengthAndDrops() {
        XCTAssertEqual(prompt(String(repeating: "x", count: 4000)), .send)
        XCTAssertEqual(prompt(String(repeating: "x", count: 4001)), .ask)
        for text in ["", "   ", "\n\t "] { XCTAssertEqual(prompt(text), .drop, text) }
        XCTAssertEqual(prompt(pending: true), .drop)
        XCTAssertEqual(prompt(here: false, pending: true), .drop)
    }

    func testLinkGate() {
        XCTAssertEqual(WidgetRules.linkGate(clickedHere: true, now: 10_000, lastOpened: 0), .open)
        XCTAssertEqual(WidgetRules.linkGate(clickedHere: true, now: 10_000, lastOpened: nil), .open)
        XCTAssertEqual(WidgetRules.linkGate(clickedHere: false, now: 10_000, lastOpened: 0), .ask)
        XCTAssertEqual(WidgetRules.linkGate(clickedHere: true, now: 14_999, lastOpened: 10_000), .ask)
        XCTAssertEqual(WidgetRules.linkGate(clickedHere: true, now: 15_000, lastOpened: 10_000), .open)
    }

    // MARK: The owner's claim on a widget

    func testClaimNeedsAClickOnThatWidgetWithinActiveMs() {
        var claim = WidgetClaim()
        XCTAssertFalse(claim.isActive(1, at: 0))
        claim.click(1, at: 1000)
        XCTAssertTrue(claim.isActive(1, at: 1000 + WidgetRules.activeMs))
        XCTAssertFalse(claim.isActive(1, at: 1000 + WidgetRules.activeMs + 1))
        XCTAssertFalse(claim.isActive(2, at: 1000))
    }

    func testClaimEndsOnAClickElsewhere() {
        var claim = WidgetClaim()
        claim.click(1, at: 0)
        claim.click(nil, at: 10)
        XCTAssertFalse(claim.isActive(1, at: 20))
        claim.click(1, at: 30)
        claim.click(2, at: 40)
        XCTAssertFalse(claim.isActive(1, at: 50))
        XCTAssertTrue(claim.isActive(2, at: 50))
    }

    func testAPlainKeyCountsButEscapeAndShortcutsDoNot() {
        var claim = WidgetClaim()
        claim.key(1, escape: false, command: false, control: false, at: 0)
        XCTAssertTrue(claim.isActive(1, at: 10))
        var other = WidgetClaim()
        other.key(1, escape: true, command: false, control: false, at: 0)
        other.key(1, escape: false, command: true, control: false, at: 0)
        other.key(1, escape: false, command: false, control: true, at: 0)
        XCTAssertFalse(other.isActive(1, at: 10))
        // An excluded key does not refresh an earlier claim either.
        claim.key(1, escape: true, command: false, control: false, at: WidgetRules.activeMs)
        XCTAssertFalse(claim.isActive(1, at: WidgetRules.activeMs + 1))
    }

    func testAKeyOutsideAnyWidgetEndsTheClaim() {
        var claim = WidgetClaim()
        claim.click(1, at: 0)
        claim.key(nil, escape: true, command: false, control: false, at: 10)
        XCTAssertFalse(claim.isActive(1, at: 20))
    }

    func testForgetEndsOnlyThatWidgetsClaim() {
        var claim = WidgetClaim()
        claim.click(1, at: 0)
        claim.forget(2)
        XCTAssertTrue(claim.isActive(1, at: 10))
        claim.forget(1)
        XCTAssertFalse(claim.isActive(1, at: 10))
    }

    // MARK: Links

    func testLinkTargetNormalises() {
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com/a?b=c#d"), "https://example.com/a?b=c#d")
        XCTAssertEqual(WidgetRules.linkTarget("HTTPS://Example.COM"), "https://example.com/")
        XCTAssertEqual(WidgetRules.linkTarget("  http://example.com:8080/x y  "), "http://example.com:8080/x%20y")
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com/a/../b"), "https://example.com/b")
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com:443/a/./b/"), "https://example.com/a/b/")
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com/caf\u{E9}?q=\u{E9}"), "https://example.com/caf%C3%A9?q=%C3%A9")
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com\\a\\..\\b"), "https://example.com/b")
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com/a\tb"), "https://example.com/ab")
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com/a\r\nb"), "https://example.com/ab")
    }

    func testLinkTargetRefusesAnythingButAPlainWebAddress() {
        for url in ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<p>x</p>", "blob:https://example.com/abc", "file:///etc/hosts", "about:blank",
                    "ftp://example.com/x", "mailto:a@example.com", "tel:123", "/relative/path", "//example.com/x", "example.com", "not a url", "", "https://",
                    "https://user:secret@example.com/", "https://user@example.com/", "https://:secret@example.com/", "https://exa\u{E4}mple.com/", "https://[::1]/",
                    "https://example.com:99999/", "https://example.com:80a/"] {
            XCTAssertNil(WidgetRules.linkTarget(url), url)
        }
    }

    func testLinkTargetStopsAt2048Characters() {
        let room = 2048 - "https://example.com/".count
        XCTAssertEqual(WidgetRules.linkTarget("https://example.com/" + String(repeating: "a", count: room))?.count, 2048)
        XCTAssertNil(WidgetRules.linkTarget("https://example.com/" + String(repeating: "a", count: room + 1)))
    }

    // MARK: The smaller decisions

    func testHumanTitle() {
        XCTAssertEqual(WidgetRules.humanTitle("q4_revenue_by_product_line"), "Q4 revenue by product line")
        XCTAssertEqual(WidgetRules.humanTitle("weekly_support_summary"), "Weekly support summary")
        XCTAssertEqual(WidgetRules.humanTitle("__loan__calculator_"), "Loan calculator")
        XCTAssertEqual(WidgetRules.humanTitle("Checkout flow"), "Checkout flow")
        XCTAssertEqual(WidgetRules.humanTitle("e-commerce funnel"), "E-commerce funnel")
        for title in [nil, "", "   ", "___"] { XCTAssertEqual(WidgetRules.humanTitle(title), "Widget") }
    }

    func testIsCard() {
        for code in [#"<svg viewBox="0 0 10 10"></svg>"#, "\n  <svg>", #"<SVG width="100%">"#, "<svg\nviewBox=\"0 0 1 1\">", "  \t<svg/>"] { XCTAssertTrue(WidgetRules.isCard(code), code) }
        for code in ["<div><svg></svg></div>", "<!-- a note --><svg></svg>", "<style>svg{}</style><svg></svg>", "<svgx></svgx>", "svg", ""] { XCTAssertFalse(WidgetRules.isCard(code), code) }
    }

    func testViewBoxRatioHoldsAPlaceForASvgAsWideAsTheCard() throws {
        func ratio(_ code: String) -> [Double]? { WidgetRules.viewBoxRatio(code).map { [$0.width, $0.height] } }
        XCTAssertEqual(ratio(#"<svg width="100%" viewBox="0 0 680 300" role="img"><title>x</title></svg>"#), [680, 300])
        XCTAssertEqual(ratio("<svg viewBox='0 0 400.5 250'>"), [400.5, 250])
        XCTAssertEqual(ratio(#"<svg role="img" viewBox="0, 0, 320, 180">"#), [320, 180])
        XCTAssertEqual(ratio("\n<svg\n  viewbox=\"-10 -10 100 50\">"), [100, 50])
        XCTAssertEqual(ratio(#"<svg width="100%" height="auto" viewBox="0 0 680 300">"#), [680, 300])
        XCTAssertEqual(ratio(#"<svg width=" 100% " viewBox="0 0 680 300">"#), [680, 300])
        XCTAssertEqual(ratio(#"<svg width="auto" viewBox="0 0 680 300">"#), [680, 300])
        XCTAssertEqual(ratio(#"<svg height="300" viewBox="0 0 680 300">"#), [680, 300])
        XCTAssertEqual(ratio(#"<svg stroke-width="2" viewBox="0 0 680 300">"#), [680, 300])
    }

    func testViewBoxRatioGivesNothingWhenItCannotHoldAPlace() {
        for code in [#"<svg width="100" height="100" viewBox="0 0 100 100">"#, #"<svg viewBox="0 0 680 300" width="680">"#, "<svg width='12.5em' viewBox='0 0 5 5'>",
                     #"<svg width="0" viewBox="0 0 5 5">"#, #"<svg width="100%">"#, #"<svg viewBox="0 0 0 100">"#, #"<svg viewBox="0 0 -5 100">"#, #"<svg viewBox="0 0 100">"#,
                     #"<svg viewBox="a b c d">"#, #"<svg viewBox="">"#, #"<div viewBox="0 0 1 1"><svg viewBox="0 0 680 300"></svg></div>"#, "<p>no svg</p>", ""] {
            XCTAssertNil(WidgetRules.viewBoxRatio(code), code)
        }
    }

    func testClampHeight() {
        XCTAssertEqual(WidgetRules.clampHeight(10), 40)
        XCTAssertEqual(WidgetRules.clampHeight(300.2), 301)
        XCTAssertEqual(WidgetRules.clampHeight(9_999), 4000)
        XCTAssertEqual(WidgetRules.clampHeight(4000), 4000)
        XCTAssertNil(WidgetRules.clampHeight(.nan))
        XCTAssertNil(WidgetRules.clampHeight(.infinity))
    }

    // MARK: Icons

    func testParseGlyphsReadsEachNameAndCodeIncludingARuleNamingSeveral() {
        let css = #"/*! made up */@font-face{font-family:"tabler-icons";src:url("./x.woff2")}.ti{font-family:"tabler-icons" !important}"#
            + #".ti-alpha:before{content:"\e001"}.ti-beta::before,.ti-beta-alias:before{content:"\E002"}.ti-gamma-2:before{content:"\10255"}.other:before{content:"\e999"}.ti-spin{animation:none}"#
        XCTAssertEqual(WidgetRules.parseGlyphs(css), ["alpha": "e001", "beta": "e002", "beta-alias": "e002", "gamma-2": "10255"])
    }

    func testParseGlyphsLeavesOutWhatTheFrameWouldRefuse() {
        XCTAssertEqual(WidgetRules.parseGlyphs(#".ti-UP:before{content:"\e001"}.ti-ok:before{content:"\1234567"}.ti-fine:before{content:"\e002"}"#), ["fine": "e002"])
    }

    // MARK: Navigation

    func testNavigationAllowsTheHostThenTheWidgetFrameOnce() {
        var nav = WidgetNavigation()
        XCTAssertEqual(nav.decide(url: URL(string: "about:blank"), mainFrame: true, inNewWindow: false), .allow)
        XCTAssertEqual(nav.decide(url: URL(string: "about:srcdoc"), mainFrame: false, inNewWindow: false), .allow)
        XCTAssertEqual(nav.decide(url: URL(string: "about:blank"), mainFrame: false, inNewWindow: false), .allow)
        XCTAssertEqual(nav.decide(url: URL(string: "about:srcdoc"), mainFrame: false, inNewWindow: false), .close)
    }

    func testNavigationClosesOnAnyOtherLoadAndCancelsAWindow() {
        var nav = WidgetNavigation()
        XCTAssertEqual(nav.decide(url: URL(string: "https://example.com"), mainFrame: true, inNewWindow: false), .close)
        XCTAssertEqual(nav.decide(url: URL(string: "about:blank"), mainFrame: true, inNewWindow: false), .allow)
        XCTAssertEqual(nav.decide(url: URL(string: "about:blank"), mainFrame: true, inNewWindow: false), .close)
        XCTAssertEqual(nav.decide(url: URL(string: "https://example.com"), mainFrame: false, inNewWindow: false), .close)
        XCTAssertEqual(nav.decide(url: URL(string: "file:///etc/hosts"), mainFrame: false, inNewWindow: false), .close)
        XCTAssertEqual(nav.decide(url: nil, mainFrame: false, inNewWindow: false), .close)
        XCTAssertEqual(nav.decide(url: URL(string: "https://example.com"), mainFrame: false, inNewWindow: true), .cancel)
    }

    // MARK: The endpoints

    private let address = ServerAddress("https://ghost.example.com")!
    private func signedInClient() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(String(repeating: "ab12", count: 16), for: address)
        return GhostShellClient(address: address, store: store, protocols: [WidgetStub.self])
    }

    func testSendPromptPostsTextAndModeToTheSendRoute() async throws {
        WidgetStub.reset(body: #"{"state":"working","running":true,"unarchived":false}"#)
        let status = try await signedInClient().sendPrompt(sessionID: "abc", text: "Hi", mode: "plan")
        XCTAssertEqual(status.state, .working)
        let request = try XCTUnwrap(WidgetStub.requests().first)
        XCTAssertEqual(request.url?.absoluteString, "https://ghost.example.com/api/sessions/abc/send")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        let body = try XCTUnwrap(request.httpBodyStream)
        body.open(); defer { body.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 256)
        while body.hasBytesAvailable { let n = body.read(&buffer, maxLength: 256); if n <= 0 { break }; data.append(buffer, count: n) }
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(json["text"]?.string, "Hi")
        XCTAssertEqual(json["mode"]?.string, "plan")
    }

    func testSendPromptRefusesAnIDWithASlash() async {
        do { _ = try await signedInClient().sendPrompt(sessionID: "a/b", text: "Hi", mode: nil); XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath("a/b")) }
        XCTAssertTrue(WidgetStub.requests().isEmpty || WidgetStub.requests().allSatisfy { !($0.url?.path.contains("a/b") ?? false) })
    }

    func testIconFilesAreReadFromTheVendorFolder() async throws {
        WidgetStub.reset(body: "bytes")
        let client = await signedInClient()
        _ = try await client.widgetIconFile(.font)
        _ = try await client.widgetIconFile(.styles)
        XCTAssertEqual(WidgetStub.requests().map { $0.url?.path }, ["/vendor/tabler-icons.woff2", "/vendor/tabler-icons.min.css"])
    }
}
