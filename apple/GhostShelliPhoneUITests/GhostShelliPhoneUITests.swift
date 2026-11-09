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
    /// `stub` names one of the other stubs the script starts (files or groups). Nil is the chat stub.
    private func launch(prefillAddress: Bool = true, stub: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        let tag = UUID().uuidString
        app.launchArguments = ["-GSKeychainService", "gs.iphone.test.\(tag)", "-GSDefaultsSuite", "gs.iphone.test.\(tag)", "-GSAppearance", appearance]
        if prefillAddress { app.launchArguments += ["-GSAddress", stub.flatMap { env["GS_ADDRESS_\($0.uppercased())"] } ?? address] }
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

    /// `expecting` is a label the stub's list shows once signed in.
    private func signIn(_ app: XCUIApplication, expecting: String = "Fix the flaky upload test") {
        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15), app.debugDescription)
        password.tap()
        dismissKeyboardIntro(app)
        password.typeText("any-password")
        app.buttons["Sign In"].tap()
        XCTAssertTrue(app.staticTexts[expecting].waitForExistence(timeout: 20), app.debugDescription)
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

    // MARK: Files

    /// The last match is the live copy of a chat's contents, because a stale copy with old frames comes first.
    private func live(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let all = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        return all.element(boundBy: max(all.count - 1, 0))
    }

    /// A link is a run inside a line of text, so a tap goes at the end of the line, where every link of the files fixture sits.
    private func tapLink(_ app: XCUIApplication, line: String) {
        live(app, line).coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    }

    private func contains(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func openFilesChat() -> XCUIApplication {
        let app = launch(stub: "files")
        signIn(app, expecting: "Read the notes against the screenshots")
        open(app, "Read the notes against the screenshots", expecting: "Here are two screenshots and the spec. Can you read them against the notes?")
        return app
    }

    /// Taps a file link once and waits for the panel, which is the one place with a Close button.
    private func openFile(_ app: XCUIApplication, line: String, header: String, file: StaticString = #filePath, at: UInt = #line) {
        tapLink(app, line: line)
        XCTAssertTrue(app.buttons["Close"].firstMatch.waitForExistence(timeout: 10), "\(line) did not open the panel\n\(app.debugDescription)", file: file, line: at)
        XCTAssertTrue(app.staticTexts[header].firstMatch.waitForExistence(timeout: 10), "The panel for \(line) does not name \(header)", file: file, line: at)
    }

    func testEachKindOfFileOpensFromItsLink() throws {
        let app = openFilesChat()
        shot("files-1-chat")

        openFile(app, line: "Notes: NOTES.md:14", header: "NOTES.md")
        XCTAssertTrue(contains(app, "The upload test fails about one run in five").waitForExistence(timeout: 10), "The markdown is rendered\n\(app.debugDescription)")
        for name in ["Edit", "Show rendered", "Close", "Save to Files"] { assertTouchable(app.buttons[name].firstMatch, name) }
        shot("files-2-markdown")
        // The panel is a pushed step of its own, so Back returns to the chat and Show file pushes it again.
        back(app)
        XCTAssertTrue(app.buttons["Show file"].firstMatch.waitForExistence(timeout: 5), "Back leaves the panel for the chat\n\(app.debugDescription)")
        app.buttons["Show file"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Close"].firstMatch.waitForExistence(timeout: 5), "Show file pushes the panel again")
        app.buttons["Close"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Show file"].firstMatch.waitForExistence(timeout: 5), "The toolbar can bring the file back")

        openFile(app, line: "The server: server.js:42", header: "server.js")
        XCTAssertTrue(contains(app, "const RETRIES = 5;").waitForExistence(timeout: 10), "The text file shows its linked line\n\(app.debugDescription)")
        shot("files-3-text-line")
        app.buttons["Close"].firstMatch.tap()

        openFile(app, line: "The checklist: report.pdf", header: "report.pdf")
        sleep(2)
        shot("files-4-pdf")
        app.buttons["Close"].firstMatch.tap()

        openFile(app, line: "A short intro: intro.wav", header: "intro.wav")
        let play = app.buttons.matching(NSPredicate(format: "label IN {'Play', 'Pause'}")).firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 10), "The clip has a play control")
        assertTouchable(play, "Play")
        shot("files-5-audio")
        app.buttons["Close"].firstMatch.tap()

        openFile(app, line: "The bundle: archive.zip", header: "archive.zip")
        shot("files-6-binary")
        let saves = app.buttons.matching(NSPredicate(format: "label == 'Save to Files'")).allElementsBoundByIndex
        XCTAssertFalse(saves.isEmpty, "A file with no preview can be saved to Files")
        for save in saves { assertTouchable(save, "Save to Files") }
        saves.last?.tap()
        XCTAssertTrue(contains(app, "archive.zip").waitForExistence(timeout: 10), "The save sheet offers the file's own name\n\(app.debugDescription)")
        sleep(1)
        shot("files-6b-save-to-files")
        // The system's Files sheet has no Cancel on this OS, so a drag down from its top edge puts it away.
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
        top.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
        XCTAssertTrue(app.buttons["Close"].firstMatch.waitForExistence(timeout: 10), "The panel is back under the sheet\n\(app.debugDescription)")
        app.buttons["Close"].firstMatch.tap()

        tapLink(app, line: "An old log: gone.txt")
        XCTAssertTrue(app.staticTexts["There is no file at that path."].firstMatch.waitForExistence(timeout: 10), "A missing file says so\n\(app.debugDescription)")
        sleep(1)
        shot("files-7-missing")
        if app.alerts.firstMatch.exists { app.alerts.buttons["OK"].firstMatch.tap() }
    }

    func testAFileCanBeEditedAndSaved() throws {
        let app = openFilesChat()
        openFile(app, line: "Notes: NOTES.md:14", header: "NOTES.md")
        app.buttons["Edit"].firstMatch.tap()
        let editor = app.textViews["File text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        editor.tap()
        editor.typeText("Typed on the phone. ")
        shot("files-8-editor")
        for name in ["Save", "Cancel"] { assertTouchable(app.buttons[name].firstMatch, name) }
        XCTAssertTrue(app.keyboards.firstMatch.exists, "The keyboard is up while typing")
        app.buttons["Save"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Saved NOTES.md"].waitForExistence(timeout: 10), "Saving says so\n\(app.debugDescription)")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Saving puts the keyboard away")
        shot("files-9-saved")
    }

    func testPicturesOpenInTheViewer() throws {
        let app = openFilesChat()
        let tile = live(app, "View image 1 of 5, from a tool")
        XCTAssertTrue(tile.waitForExistence(timeout: 10), app.debugDescription)
        tile.tap()
        XCTAssertTrue(app.buttons["Next image"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        sleep(1)
        shot("files-10-viewer")
        for name in ["Previous image", "Next image", "Close"] { assertTouchable(app.buttons[name].firstMatch, name) }
        XCTAssertFalse(app.navigationBars.firstMatch.isHittable, "The viewer covers the chat's own bar, so it fills the screen")
        app.buttons["Next image"].firstMatch.tap()
        sleep(1)
        shot("files-11-viewer-next")
        app.swipeLeft()
        sleep(1)
        shot("files-12-viewer-swiped")
        app.buttons["Close"].firstMatch.tap()
        XCTAssertFalse(app.buttons["Next image"].firstMatch.exists, "Close puts the viewer away")
    }

    // MARK: Widgets

    func testAWidgetsLongPressAndAskBar() throws {
        let app = launch()
        signIn(app)
        open(app, "Revenue by region", expecting: "Say the word and I will go further on any region.")
        XCTAssertTrue(app.buttons["Show Q4 by region"].firstMatch.waitForExistence(timeout: 20))
        sleep(2)
        shot("widgets-1-chart")
        XCTAssertGreaterThan(app.webViews.count, 0, "The widget draws in a web view")
        // A long press in the widget selects the word under it and offers the system's callout with Copy.
        app.webViews.element(boundBy: app.webViews.count - 1).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).press(forDuration: 1.3)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Copy")).firstMatch.waitForExistence(timeout: 5), "A long press in a widget offers Copy\n\(app.debugDescription)")
        sleep(1)
        shot("widgets-2-long-press")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97)).tap()
        back(app)

        open(app, "A widget that asks first", expecting: "Show me a widget that tries to send a message on its own.")
        let bar = app.descendants(matching: .any)["Request from the widget"].firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 15), app.debugDescription)
        sleep(2)
        shot("widgets-3-ask")
        for name in ["Send", "Open link", "Cancel"] where app.buttons[name].firstMatch.exists { assertTouchable(app.buttons[name].firstMatch, name) }
        XCTAssertTrue(app.buttons["Send"].firstMatch.exists || app.buttons["Open link"].firstMatch.exists, "The ask bar has a confirm button")
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertFalse(bar.waitForExistence(timeout: 2), "Cancel puts the ask bar away")
        shot("widgets-4-asked-and-cancelled")
    }

    // MARK: Groups

    private func rowStarting(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    /// The icon is named in capitals on a phone, because a list header uppercases its text, so the name is matched without case.
    private func headingIcon(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", "Open the Release chat")).firstMatch
    }

    private func openGroupChat(_ app: XCUIApplication) {
        let icon = headingIcon(app)
        XCTAssertTrue(icon.waitForExistence(timeout: 5), "The heading's chat icon is a button\n\(app.debugDescription)")
        icon.tap()
        XCTAssertTrue(app.segmentedControls.buttons["Sub sessions"].firstMatch.waitForExistence(timeout: 15), "The group chat opens\n\(app.debugDescription)")
    }

    func testAGroupHeadingOpensItsChatFromTheIconAndTheLongPress() throws {
        let app = launch(stub: "groups")
        signIn(app, expecting: "A session outside the group")
        assertTouchable(headingIcon(app), "The heading's chat icon")
        let heading = rowStarting(app, "Release")
        heading.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).press(forDuration: 1.0)
        let item = app.buttons.matching(NSPredicate(format: "label ==[c] %@", "Open group chat")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "A long press on the heading offers Open group chat\n\(app.debugDescription)")
        XCTAssertTrue(app.buttons["Cancel"].firstMatch.exists)
        shot("groups-1b-heading-menu")
        assertTouchable(item, "Open group chat")
        item.tap()
        XCTAssertTrue(app.segmentedControls.buttons["Sub sessions"].firstMatch.waitForExistence(timeout: 15), "The menu opens the group chat\n\(app.debugDescription)")
    }

    func testAGroupChatShowsItsChipsAndSubSessions() throws {
        let app = launch(stub: "groups")
        signIn(app, expecting: "A session outside the group")
        shot("groups-1-sidebar")
        openGroupChat(app)
        sleep(2)
        shot("groups-2-group-chat")

        // The first Start is refused by the stub, which says so under the chip.
        XCTAssertTrue(app.buttons["Start"].firstMatch.waitForExistence(timeout: 5), "A suggested task has Start\n\(app.debugDescription)")
        XCTAssertTrue(app.buttons["Dismiss"].firstMatch.exists)
        for name in ["Start", "Dismiss"] { assertTouchable(app.buttons[name].firstMatch, name) }
        app.buttons["Start"].firstMatch.tap()
        sleep(2)
        shot("groups-3-chip-start")

        app.segmentedControls.buttons["Sub sessions"].firstMatch.tap()
        let reply = app.buttons["Reply to Draft the release notes"].firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 10), app.debugDescription)
        sleep(1)
        shot("groups-4-sub-sessions")
        let details = app.buttons["Details of Draft the release notes"].firstMatch
        assertTouchable(reply, "Reply")
        assertTouchable(details, "Details")
        reply.tap()
        let box = app.textViews["Message to Draft the release notes"].firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 5), app.debugDescription)
        assertTouchable(app.buttons["Cancel"].firstMatch, "Cancel")
        assertTouchable(app.buttons["Send"].firstMatch, "Send")
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertFalse(box.waitForExistence(timeout: 2), "Cancel puts the reply box away")
        reply.tap()
        XCTAssertTrue(box.waitForExistence(timeout: 5), app.debugDescription)
        box.tap()
        box.typeText("Hello from the phone")
        shot("groups-5-reply-box")
        app.keyboards.buttons["return"].firstMatch.tap()
        XCTAssertTrue((box.value as? String)?.contains("\n") == true, "Return adds a newline\n\(box.value ?? "")")
        XCTAssertTrue(app.buttons["Send"].firstMatch.exists, "Send is the send route")
        shot("groups-6-after-return")
        app.buttons["Send"].firstMatch.tap()
        sleep(2)
        shot("groups-7-after-send")

        XCTAssertTrue(details.exists)
        details.tap()
        sleep(1)
        shot("groups-8-details")
    }
}
