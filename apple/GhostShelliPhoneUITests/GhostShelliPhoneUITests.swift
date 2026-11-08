import XCTest

/// Drives the iPhone app in the Simulator against the stubs `apple/scripts/iphone.mjs` starts. The script passes the stub's address, where
/// screenshots go and which device and appearance this run is, as TEST_RUNNER_GS_* variables.
@MainActor
final class GhostShelliPhoneUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var address: String { env["GS_ADDRESS"] ?? "" }
    private var appearance: String { env["GS_APPEARANCE"] ?? "light" }
    private var device: String { env["GS_DEVICE"] ?? "device" }

    override func setUp() async throws {
        continueAfterFailure = false
        XCTAssertFalse(address.isEmpty, "Run these through apple/scripts/iphone.mjs, which starts the stub and passes its address.")
    }

    // MARK: Helpers

    /// A new Keychain service and defaults suite for every launch, so no test sees another's token or address.
    private func launch(prefillAddress: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        let tag = UUID().uuidString
        app.launchArguments = ["-GSKeychainService", "gs.iphone.test.\(tag)", "-GSDefaultsSuite", "gs.iphone.test.\(tag)", "-GSAppearance", appearance]
        if prefillAddress { app.launchArguments += ["-GSAddress", address] }
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let folder = env["GS_SHOTDIR"] else { return }
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? png.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name)-\(device)-\(appearance).png"))
    }

    /// A new simulator's keyboard introduces sliding to type on first use, and the card covers the screen.
    private func dismissKeyboardIntro(_ app: XCUIApplication) {
        let next = app.buttons["Continue"]
        if next.waitForExistence(timeout: 2) { next.tap() }
    }

    private func signIn(_ app: XCUIApplication) {
        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15), app.debugDescription)
        password.tap()
        dismissKeyboardIntro(app)
        password.typeText("any-password")
        app.buttons["Sign In"].tap()
        XCTAssertTrue(app.staticTexts["Fix the flaky upload test"].waitForExistence(timeout: 20), app.debugDescription)
    }

    private func row(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    private func open(_ app: XCUIApplication, _ title: String, expecting text: String) {
        let line = row(app, title)
        XCTAssertTrue(line.waitForExistence(timeout: 10), "No row \(title)\n\(app.debugDescription)")
        line.tap()
        XCTAssertTrue(app.staticTexts[text].firstMatch.waitForExistence(timeout: 20), "The chat \(title) did not show \(text)\n\(app.debugDescription)")
    }

    private func back(_ app: XCUIApplication) {
        let bar = app.navigationBars.firstMatch
        bar.buttons.firstMatch.tap()
    }

    /// Controls are at least 44pt tall and wide enough to hit. Checked on the controls the app draws, not on a widget's own web buttons.
    private func assertTouchable(_ element: XCUIElement, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        let frame = element.frame
        XCTAssertGreaterThanOrEqual(frame.height, 43.5, "\(name) is \(frame.height)pt tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.width, 43.5, "\(name) is \(frame.width)pt wide", file: file, line: line)
    }

    private func get(_ path: String) async throws -> [[String: Any]] {
        let (data, _) = try await URLSession.shared.data(from: URL(string: address + path)!)
        return (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    // MARK: Tests

    func testSignInThenBrowseAChat() throws {
        let app = launch(prefillAddress: false)
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(field.placeholderValue, "https://your-mac.your-tailnet.ts.net", "A new install shows a generic placeholder and no host.")
        dismissKeyboardIntro(app)
        shot("01-sign-in")
        field.typeText(address)
        signIn(app)
        shot("02-sidebar")
        assertTouchable(app.buttons["More"], "More")
        assertTouchable(row(app, "Fix the flaky upload test"), "A session row")

        open(app, "Fix the flaky upload test", expecting: "Thanks. Can you add a note to the changelog?")
        shot("03-chat-rich")
        assertTouchable(app.navigationBars.firstMatch.buttons.firstMatch, "Back")
        for _ in 0..<3 { app.swipeDown() }
        shot("04-chat-scrolled")
        back(app)
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 10), "Back returns to the list")

        // The same session opens again, which only works when Back cleared the navigator.
        open(app, "Fix the flaky upload test", expecting: "Thanks. Can you add a note to the changelog?")
    }

    func testAWidgetButtonTapSendsOneMessage() async throws {
        let app = launch()
        signIn(app)
        let before = try await get("/__sends").count
        open(app, "Revenue by region", expecting: "Say the word and I will go further on any region.")
        let button = app.buttons["Show Q4 by region"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 20), app.debugDescription)
        shot("05-chat-widgets")
        let untouched = try await get("/__sends").count
        XCTAssertEqual(untouched, before, "Nothing is sent before a tap.")
        button.tap()
        try await Task.sleep(for: .seconds(3))
        let sends = try await get("/__sends")
        XCTAssertEqual(sends.count, before + 1, "One tap on the widget's button sends exactly one message.")
        XCTAssertEqual(sends.last?["text"] as? String, "Break Q4 down by region")
        XCTAssertEqual(sends.last?["id"] as? String, "widgets")
    }

    func testApprovalsAreAnswered() async throws {
        let app = launch()
        signIn(app)
        open(app, "Choose the test setup", expecting: "Claude is asking")
        shot("06-approval-question")
        for name in ["Send answers", "Skip"] { assertTouchable(app.buttons[name].firstMatch, name) }
        back(app)
        open(app, "Approve the retry plan", expecting: "Claude has a plan")
        shot("07-approval-plan")
        for name in ["Approve plan", "Always allow", "Keep planning"] { assertTouchable(app.buttons[name].firstMatch, name) }
        // The dock scrolls once it passes half the chat, so the last button must be reachable by a swipe on the SE.
        app.buttons["Approve plan"].firstMatch.swipeUp()
        XCTAssertTrue(app.buttons["Keep planning"].firstMatch.isHittable, app.debugDescription)
        shot("07b-approval-plan-buttons")
        back(app)
        open(app, "Push the upload fix", expecting: "Bash wants to run a command")
        shot("08-approval-bash")
        for name in ["Allow", "Always allow", "Deny"] { assertTouchable(app.buttons[name].firstMatch, name) }
        app.buttons["Allow"].firstMatch.tap()
        try await Task.sleep(for: .seconds(2))
        let decisions = try await get("/__decisions")
        XCTAssertEqual(decisions.last?["decision"] as? String, "allow")
        XCTAssertEqual(decisions.last?["requestId"] as? String, "req-bash")
    }

    func testAccountsPasskeysAndSignOut() throws {
        let app = launch()
        signIn(app)
        app.buttons["More"].tap()
        app.buttons["Accounts"].tap()
        XCTAssertTrue(app.staticTexts["Work"].waitForExistence(timeout: 15), app.debugDescription)
        shot("09-accounts")
        app.swipeUp()
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Personal"].waitForExistence(timeout: 5), app.debugDescription)
        shot("09b-accounts-scrolled")
        for name in ["Switch to this", "Sign in", "Rename Personal"] { assertTouchable(app.buttons[name].firstMatch, name) }
        back(app)
        app.buttons["More"].tap()
        app.buttons["Passkeys"].tap()
        XCTAssertTrue(app.staticTexts["MacBook Pro, Safari"].waitForExistence(timeout: 15), app.debugDescription)
        shot("10-passkeys")
        assertTouchable(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Remove the passkey'")).firstMatch, "Remove passkey")
        back(app)
        app.buttons["More"].tap()
        app.buttons["Sign Out"].tap()
        XCTAssertTrue(app.buttons["Sign In"].waitForExistence(timeout: 15), app.debugDescription)
    }
}
