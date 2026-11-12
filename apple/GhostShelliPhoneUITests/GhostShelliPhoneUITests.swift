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
    private func signIn(_ app: XCUIApplication, stub: String? = nil, expecting: String = "Fix the flaky upload test") {
        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15), app.debugDescription)
        password.tap()
        dismissKeyboardIntro(app)
        password.typeText(stub == "organise" ? env["GS_PASSWORD_ORGANISE"] ?? "" : "any-password")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.staticTexts[expecting].waitForExistence(timeout: 20), app.debugDescription)
    }

    private func row(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    private func open(_ app: XCUIApplication, _ title: String, expecting text: String) {
        let line = row(app, title)
        // The list only draws the rows on screen, and a small phone shows few of them.
        for _ in 0..<4 where !line.waitForExistence(timeout: 3) { app.swipeUp() }
        XCTAssertTrue(line.waitForExistence(timeout: 10), "No row \(title)\n\(app.debugDescription)")
        line.tap()
        XCTAssertTrue(app.staticTexts[text].firstMatch.waitForExistence(timeout: 20), "The chat \(title) did not show \(text)\n\(app.debugDescription)")
    }

    private func back(_ app: XCUIApplication) {
        let bar = app.navigationBars.firstMatch
        bar.buttons.firstMatch.tap()
    }

    /// Controls are at least 44pt tall and wide enough to hit. Checked on the controls the app draws, not on a widget's own web buttons.
    /// A text field reports only its 22pt text as its frame, so the 44pt row is checked by tapping 18pt below the middle, where only the row can take the tap.
    private func focusByEdge(_ field: XCUIElement, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).withOffset(CGVector(dx: 0, dy: 18)).tap()
        let focused = NSPredicate { object, _ in (object as? XCUIElement)?.value(forKey: "hasKeyboardFocus") as? Bool == true }
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: focused, object: field)], timeout: 5), .completed, "The edge of the \(name) row focuses the field: \(field.debugDescription)", file: file, line: line)
    }

    private func assertTouchable(_ element: XCUIElement, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        let frame = element.frame
        XCTAssertGreaterThanOrEqual(frame.height, 43.5, "\(name) is \(frame.height)pt tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.width, 43.5, "\(name) is \(frame.width)pt wide", file: file, line: line)
    }

    private func get(_ path: String, stub: String? = nil) async throws -> [[String: Any]] {
        let base = stub.flatMap { env["GS_ADDRESS_\($0.uppercased())"] } ?? address
        let (data, _) = try await URLSession.shared.data(from: URL(string: base + path)!)
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

    /// The chat stub refuses the password "wrong-password" with a 401, as the server does.
    func testAWrongPasswordIsShownUnderTheField() throws {
        let app = launch()
        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15), app.debugDescription)
        password.tap()
        dismissKeyboardIntro(app)
        password.typeText("wrong-password")
        assertTouchable(app.buttons["Sign in"], "Sign in")
        app.buttons["Sign in"].tap()
        let message = contains(app, "That password did not match.")
        XCTAssertTrue(message.waitForExistence(timeout: 15), "A wrong password is said under the field\n\(app.debugDescription)")
        XCTAssertEqual(app.alerts.count, 0, "The message is on the screen, not in an alert")
        sleep(1)
        shot("01b-sign-in-wrong")
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

    // https://github.com/kulesy/ghostshell/issues/118 - the iPhone composer's reply, refusal and New Session tests go here when it is turned on.

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
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 15), app.debugDescription)
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
        XCTAssertTrue(contains(app, "1 of 2").waitForExistence(timeout: 10), "The clips are counted between Previous and Next\n\(app.debugDescription)")
        for name in ["Previous", "Next"] { assertTouchable(app.buttons[name].firstMatch, name) }
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
        XCTAssertEqual(app.alerts.count, 0, "A missing file is a note in the panel, not an alert")
        shot("files-7-missing")
    }

    func testAFileCanBeEditedAndSaved() throws {
        let app = openFilesChat()
        openFile(app, line: "Notes: NOTES.md:14", header: "NOTES.md")
        app.buttons["Edit"].firstMatch.tap()
        let editor = app.textViews["File text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["Save"].firstMatch.isEnabled, "Save waits for a change")
        shot("files-8a-editor-unchanged")
        editor.tap()
        editor.typeText("Typed on the phone. ")
        XCTAssertTrue(app.buttons["Save"].firstMatch.isEnabled, "Save is on once the text changes")
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

    // MARK: Routines and scheduled sessions

    // These sign in to the routines stub, which records each write and applies it to its own lists, so nothing real is made, run or deleted.

    private func routinesApp() -> XCUIApplication {
        let app = launch(stub: "routines")
        signIn(app, stub: "routines", expecting: "Draft the release notes")
        return app
    }

    /// The stub's record of every write, oldest first. A test reads the ones it made by method and path.
    private func writes(_ method: String, _ prefix: String) async throws -> [[String: Any]] {
        try await get("/__writes", stub: "routines").filter { $0["method"] as? String == method && ($0["pathname"] as? String)?.hasPrefix(prefix) == true }
    }

    private func body(_ write: [String: Any]?) -> [String: Any] { write?["body"] as? [String: Any] ?? [:] }

    /// Opens a screen from the More menu, which is how a phone reaches Routines and Scheduled sessions.
    private func openFromMore(_ app: XCUIApplication, _ item: String) {
        let more = app.buttons["More"]
        XCTAssertTrue(more.waitForExistence(timeout: 10), app.debugDescription)
        more.tap()
        let entry = app.buttons[item]
        XCTAssertTrue(entry.waitForExistence(timeout: 5), "More offers \(item)\n\(app.debugDescription)")
        entry.tap()
    }

    /// Clears a field and types a new value, because a phone has no select-all key.
    private func replace(_ field: XCUIElement, with text: String) {
        field.tap()
        let old = (field.value as? String) ?? ""
        if !old.isEmpty { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count)) }
        field.typeText(text)
    }

    /// Scrolls down and then up until the element is on screen, for a list or form longer than the phone, whose off-screen rows are not in the tree.
    @discardableResult
    private func reveal(_ app: XCUIApplication, _ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        _ = element.waitForExistence(timeout: 3)
        for down in [true, false] {
            for _ in 0..<6 {
                if element.exists, element.isHittable { return element }
                if down { app.swipeUp() } else { app.swipeDown() }
            }
        }
        XCTFail("\(element) is not on screen\n\(app.debugDescription)", file: file, line: line)
        return element
    }

    /// Ends a single-line field's entry with its return key, which a form's own buttons do not need but the fields below the keyboard do.
    private func endEditing(_ app: XCUIApplication) {
        let key = app.keyboards.buttons["return"].firstMatch
        if key.exists { key.tap() }
    }

    private func waitForValue(_ element: XCUIElement, _ value: String) -> Bool {
        XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)], timeout: 10) == .completed
    }

    private func pickMenu(_ app: XCUIApplication, _ button: XCUIElement, _ item: String) {
        reveal(app, button).tap()
        let entry = app.buttons[item].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 5), "No \(item)\n\(app.debugDescription)")
        entry.tap()
    }

    func testRoutines() async throws {
        let app = routinesApp()
        shot("routines-1-sidebar")
        openFromMore(app, "Manage routines")
        XCTAssertTrue(app.staticTexts["Nightly check"].waitForExistence(timeout: 10), app.debugDescription)
        shot("routines-2-list")
        for name in ["Run now", "Actions for Nightly check", "New routine"] {
            assertTouchable(app.descendants(matching: .any)[name].firstMatch, name)
        }

        // Make one. The folder starts as the server's home, not the phone's sandbox.
        app.buttons["New routine"].tap()
        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10), app.debugDescription)
        let zoneHint = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Five fields' AND label CONTAINS %@", "in the GhostShell server's time zone (GMT")).firstMatch
        XCTAssertTrue(zoneHint.exists, "The schedule hint names the server's time zone\n\(app.debugDescription)")
        focusByEdge(title, "Title")
        title.typeText("Phone check")
        endEditing(app)
        let cron = app.textFields["30 7 * * 1-5"]
        focusByEdge(reveal(app, cron), "Schedule")
        app.typeText("0 8 * * 1-5")
        endEditing(app)
        // The large title and the scroll settle after the keyboard goes; a shot taken at once caught them mid-move.
        try await Task.sleep(for: .milliseconds(1500))
        shot("routines-3-form-top")
        let folder = reveal(app, app.textFields["Folder"])
        XCTAssertTrue(waitForValue(folder, "/Users/me/Projects/site"), "The folder is the server's home, not the phone's: \(folder.value ?? "")\n\(app.debugDescription)")
        focusByEdge(folder, "Folder")
        endEditing(app)
        for (name, element) in [("Cancel", app.buttons["Cancel"]), ("Save", app.buttons["Save"])] { assertTouchable(element, name) }
        let kind = reveal(app, app.segmentedControls.firstMatch)
        shot("routines-4-form-bottom")
        XCTAssertTrue(kind.buttons["A prompt file"].exists, "The prompt kind is a segmented control on a phone")
        assertTouchable(kind, "Prompt kind")
        for name in ["Model", "Effort", "Permission mode"] { assertTouchable(reveal(app, app.buttons[name].firstMatch), name) }
        let prompt = app.textViews["Prompt"]
        reveal(app, prompt).tap()
        prompt.typeText("Check the build")
        app.buttons["Save"].tap()
        try await Task.sleep(for: .seconds(2))
        let made = try await writes("POST", "/api/routines").last
        XCTAssertNotNil(made, "Save posts the routine\n\(app.debugDescription)")
        reveal(app, app.staticTexts["Phone check"])
        shot("routines-5-after-save")
        XCTAssertEqual(body(made)["title"] as? String, "Phone check")
        XCTAssertEqual(body(made)["cron"] as? String, "0 8 * * 1-5")
        XCTAssertEqual(body(made)["cwd"] as? String, "/Users/me/Projects/site")
        XCTAssertEqual(body(made)["prompt"] as? String, "Check the build")

        // The switch.
        let sync = app.switches["Run Sync the docs on its schedule"]
        reveal(app, sync)
        // The switch is UIKit's own 31pt control; a frame or content shape on it either leaves it 31pt or stops it taking taps.
        XCTAssertGreaterThanOrEqual(sync.frame.height, 31)
        sync.tap()
        try await Task.sleep(for: .seconds(1))
        let toggled = try await writes("POST", "/api/routines/sync/enabled").last
        XCTAssertEqual(body(toggled)["enabled"] as? Bool, false, "The switch pauses the routine")

        // Run now, on the stub only.
        reveal(app, app.buttons["Run now"].firstMatch).tap()
        try await Task.sleep(for: .seconds(2))
        let ran = try await writes("POST", "/api/routines/").filter { ($0["pathname"] as? String)?.hasSuffix("/run") == true }
        XCTAssertEqual(ran.count, 1, "One tap runs one routine")
        XCTAssertEqual(ran.first?["pathname"] as? String, "/api/routines/nightly/run")
        shot("routines-6-after-run")

        // Edit it.
        pickMenu(app, app.buttons["Actions for Phone check"], "Edit")
        shot("routines-7-actions-menu-edit")
        let editTitle = app.textFields["Title"]
        XCTAssertTrue(editTitle.waitForExistence(timeout: 10), app.debugDescription)
        replace(editTitle, with: "Phone check 2")
        endEditing(app)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Phone check 2"].waitForExistence(timeout: 10), app.debugDescription)
        let edited = try await writes("PATCH", "/api/routines/made-").last
        XCTAssertEqual(Set(body(edited).keys), ["title"], "An edit sends only what changed")
        XCTAssertEqual(body(edited)["title"] as? String, "Phone check 2")

        // Delete it from the edit form's own Delete, then another from the actions menu.
        pickMenu(app, app.buttons["Actions for Phone check 2"], "Edit")
        XCTAssertTrue(app.textFields["Title"].waitForExistence(timeout: 10))
        let remove = app.buttons["Delete"]
        reveal(app, remove)
        shot("routines-8-form-delete")
        assertTouchable(remove, "Delete")
        remove.tap()
        let confirm = app.buttons["Delete routine"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), app.debugDescription)
        shot("routines-9-delete-question")
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Phone check 2"].waitForNonExistence(timeout: 10), "The deleted routine is gone")
        let deleted = try await writes("DELETE", "/api/routines/made-")
        XCTAssertEqual(deleted.count, 1)
    }

    func testScheduledSessions() async throws {
        let app = routinesApp()
        openFromMore(app, "Manage scheduled sessions")
        XCTAssertTrue(app.staticTexts["Quarterly review"].waitForExistence(timeout: 10), app.debugDescription)
        shot("scheduled-1-list")
        for name in ["Start now", "Actions for Quarterly review", "Schedule a session"] { assertTouchable(app.buttons[name].firstMatch, name) }
        assertTouchable(reveal(app, app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Started'")).firstMatch), "Started")
        app.swipeDown()

        // Make one.
        app.buttons["Schedule a session"].tap()
        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10), app.debugDescription)
        focusByEdge(title, "Title")
        title.typeText("Phone session")
        endEditing(app)
        shot("scheduled-2-form-top")
        let folder = reveal(app, app.textFields["Folder"])
        XCTAssertTrue(waitForValue(folder, "/Users/me/Projects/site"), "The folder is the server's home, not the phone's: \(folder.value ?? "")\n\(app.debugDescription)")
        focusByEdge(folder, "Folder")
        endEditing(app)
        for (name, element) in [("Cancel", app.buttons["Cancel"]), ("Save", app.buttons["Save"]), ("Date and time", app.datePickers.firstMatch)] { assertTouchable(element, name) }
        let prompt = app.textViews["Prompt"]
        reveal(app, prompt)
        shot("scheduled-3-form-bottom")
        prompt.tap()
        prompt.typeText("Say hello")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Phone session"].waitForExistence(timeout: 10), app.debugDescription)
        shot("scheduled-4-after-save")
        let made = try await writes("POST", "/api/scheduled").last
        XCTAssertEqual(body(made)["title"] as? String, "Phone session")
        XCTAssertEqual(body(made)["cwd"] as? String, "/Users/me/Projects/site")
        XCTAssertEqual(body(made)["prompt"] as? String, "Say hello")
        XCTAssertNotNil(body(made)["at"] as? String)

        // Start one now, on the stub only.
        reveal(app, app.buttons["Start now"].firstMatch).tap()
        try await Task.sleep(for: .seconds(2))
        let started = try await writes("POST", "/api/scheduled/").filter { ($0["pathname"] as? String)?.hasSuffix("/start") == true }
        XCTAssertEqual(started.count, 1, "One tap starts one session")

        // Edit it.
        pickMenu(app, app.buttons["Actions for Phone session"], "Edit")
        let editTitle = app.textFields["Title"]
        XCTAssertTrue(editTitle.waitForExistence(timeout: 10), app.debugDescription)
        replace(editTitle, with: "Phone session 2")
        endEditing(app)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Phone session 2"].waitForExistence(timeout: 10), app.debugDescription)
        let edited = try await writes("PATCH", "/api/scheduled/made-").last
        XCTAssertEqual(Set(body(edited).keys), ["title"], "An edit sends only what changed")

        // Delete one from the actions menu.
        pickMenu(app, app.buttons["Actions for Phone session 2"], "Delete")
        let confirm = app.buttons["Delete scheduled session"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), app.debugDescription)
        shot("scheduled-5-delete-question")
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Phone session 2"].waitForNonExistence(timeout: 10), "The deleted session is gone")
        let deleted = try await writes("DELETE", "/api/scheduled/made-")
        XCTAssertEqual(deleted.count, 1)

        // The form's own Delete, on a pending session.
        pickMenu(app, app.buttons["Actions for Quarterly review"], "Edit")
        XCTAssertTrue(app.textFields["Title"].waitForExistence(timeout: 10))
        let remove = app.buttons["Delete"]
        reveal(app, remove)
        shot("scheduled-6-form-delete")
        assertTouchable(remove, "Delete")
    }

    // MARK: Organising sessions

    // These sign in to the scratch server, which holds eight seeded sessions. Each test works on sessions of its own, because the server keeps what a test did.

    private func organiseApp() -> XCUIApplication {
        let app = launch(stub: "organise")
        signIn(app, stub: "organise")
        return app
    }

    /// A long press on a row, then one item of its menu.
    private func menu(_ app: XCUIApplication, _ title: String, _ items: String...) {
        let line = reveal(app, rowStarting(app, title))
        line.press(forDuration: 1.0)
        for item in items {
            let entry = app.buttons[item].firstMatch
            XCTAssertTrue(entry.waitForExistence(timeout: 5), "No \(item) in the menu of \(title)\n\(app.debugDescription)")
            entry.tap()
        }
    }

    private func heading(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", name)).firstMatch
    }

    /// The name sheet: type, then Save. Its buttons are checked on the way.
    private func name(_ app: XCUIApplication, as text: String, sheet: String, prompt: String = "Name") {
        let field = app.textFields[prompt]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "The \(sheet) sheet has its field\n\(app.debugDescription)")
        XCTAssertTrue(app.navigationBars[sheet].exists, "The sheet is titled \(sheet)\n\(app.debugDescription)")
        endEditing(app)
        focusByEdge(field, "\(sheet) \(prompt)")
        for (label, element) in [("Cancel", app.buttons["Cancel"]), ("Save", app.buttons["Save"])] { assertTouchable(element, "\(sheet) \(label)") }
        shot("organise-sheet-\(sheet.lowercased().replacingOccurrences(of: " ", with: "-"))")
        replace(field, with: text)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Save"].waitForNonExistence(timeout: 10), "The sheet closes\n\(app.debugDescription)")
    }

    func testOrganiseASessionFromItsMenu() throws {
        let app = organiseApp()
        shot("organise-1-list")
        assertTouchable(app.buttons["New group"].firstMatch, "New group")

        // Rename.
        menu(app, "Plan the release notes", "Rename\u{2026}")
        name(app, as: "Release plan", sheet: "Rename session", prompt: "Title")
        XCTAssertTrue(rowStarting(app, "Release plan").waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(rowStarting(app, "Plan the release notes").exists)

        // New group, then Move to it.
        app.buttons["New group"].firstMatch.tap()
        name(app, as: "Sprint nine", sheet: "New group")
        let group = heading(app, "Sprint nine")
        XCTAssertTrue(group.waitForExistence(timeout: 10), "The new group has a heading\n\(app.debugDescription)")
        menu(app, "Review the sign-in change", "Move to", "Sprint nine")
        let moved = rowStarting(app, "Review the sign-in change")
        XCTAssertTrue(moved.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(moved.frame.minY, heading(app, "Sprint nine").frame.minY, "The session sits under the group's heading")
        shot("organise-2-moved")

        // Nest under.
        menu(app, "Tidy the settings page", "Nest under", "Fix the flaky upload test")
        let child = app.staticTexts["Tidy the settings page"], parent = app.staticTexts["Fix the flaky upload test"]
        XCTAssertTrue(child.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThan(child.frame.minX, parent.frame.minX, "The nested session is indented under its parent")
        shot("organise-3-nested")

        // Pin.
        menu(app, "Add dark mode to the chart", "Pin")
        XCTAssertTrue(heading(app, "Pinned").waitForExistence(timeout: 10), "A pinned session makes the Pinned section\n\(app.debugDescription)")
        shot("organise-4-pinned")
        rowStarting(app, "Add dark mode to the chart").press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["Unpin"].firstMatch.waitForExistence(timeout: 5), "A pinned session offers Unpin")
        app.buttons["Unpin"].firstMatch.tap()
        XCTAssertTrue(heading(app, "Pinned").waitForNonExistence(timeout: 10))

        // Archive.
        menu(app, "Investigate slow startup", "Archive")
        XCTAssertTrue(rowStarting(app, "Investigate slow startup").waitForNonExistence(timeout: 10), "An archived session leaves the list")
        shot("organise-5-archived")
    }

    func testOrganiseGroupsFromTheirHeadings() throws {
        let app = organiseApp()
        for text in ["Heading one", "Heading two"] {
            app.buttons["New group"].firstMatch.tap()
            name(app, as: text, sheet: "New group")
            XCTAssertTrue(heading(app, text).waitForExistence(timeout: 10), app.debugDescription)
        }
        shot("organise-groups-1-two-groups")

        // Rename, from the long-press dialog.
        heading(app, "Heading one").press(forDuration: 1.0)
        let rename = app.buttons["Rename\u{2026}"].firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 5), "A heading's long press asks what to do\n\(app.debugDescription)")
        shot("organise-groups-2-heading-dialog")
        rename.tap()
        name(app, as: "Heading uno", sheet: "Rename group")
        XCTAssertTrue(heading(app, "Heading uno").waitForExistence(timeout: 10), app.debugDescription)

        // Move down: the first group goes below the second.
        let before = heading(app, "Heading two").frame.minY
        heading(app, "Heading uno").press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["Move down"].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["Move down"].firstMatch.tap()
        let uno = heading(app, "Heading uno")
        for _ in 0..<20 where uno.frame.minY < heading(app, "Heading two").frame.minY { usleep(300_000) }
        XCTAssertGreaterThan(uno.frame.minY, heading(app, "Heading two").frame.minY, "Move down puts the group below the next one")
        XCTAssertNotEqual(heading(app, "Heading two").frame.minY, before)
        shot("organise-groups-3-moved-down")

        // Delete, with the question.
        uno.press(forDuration: 1.0)
        let remove = app.buttons["Delete group\u{2026}"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5), app.debugDescription)
        remove.tap()
        let confirm = app.buttons["Delete group"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), app.debugDescription)
        shot("organise-groups-4-delete-question")
        confirm.tap()
        XCTAssertTrue(heading(app, "Heading uno").waitForNonExistence(timeout: 10), "The deleted group is gone")
        XCTAssertTrue(heading(app, "Heading two").exists)
    }

    func testSelectManySessionsInEditMode() throws {
        let app = organiseApp()
        let list = app.buttons["New group"].firstMatch
        menu(app, "Write the migration guide", "Select")
        let done = app.buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5), "Select starts edit mode\n\(app.debugDescription)")
        XCTAssertTrue(list.exists, "Select leaves the list on screen, with no chat opened")
        XCTAssertTrue(app.staticTexts["1 chosen"].exists, app.debugDescription)
        // The bar takes room from the list, so the chosen row is brought back above it.
        let chosen = rowStarting(app, "Write the migration guide")
        let bar = app.toolbars.firstMatch
        var visible = false
        for _ in 0..<20 where !visible {
            visible = chosen.exists && chosen.isHittable && chosen.frame.maxY <= bar.frame.minY
            if !visible { usleep(250_000) }
        }
        XCTAssertTrue(visible, "The chosen row is above the bottom bar\n\(chosen.frame) \(bar.frame)")
        shot("organise-select-1-edit-mode")
        assertTouchable(done, "Done")
        assertTouchable(app.buttons["Actions"], "Actions")

        // A tap chooses another row and opens nothing.
        reveal(app, rowStarting(app, "Check the nightly build")).tap()
        XCTAssertTrue(app.staticTexts["2 chosen"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(list.exists, "A tap in edit mode does not open a chat")
        rowStarting(app, "Write the migration guide").tap()
        XCTAssertTrue(app.staticTexts["1 chosen"].waitForExistence(timeout: 5), "A second tap takes the row off")
        rowStarting(app, "Write the migration guide").tap()
        shot("organise-select-2-two-chosen")

        // The Mac's selection menu, in the bottom bar.
        app.buttons["Actions"].tap()
        for item in ["Move to", "Nest under", "Archive 2 sessions", "Clear selection"] {
            XCTAssertTrue(app.buttons[item].firstMatch.waitForExistence(timeout: 5), "Actions offers \(item)\n\(app.debugDescription)")
        }
        shot("organise-select-3-actions")

        // A bulk Move to ends edit mode.
        app.buttons["Move to"].firstMatch.tap()
        let place = app.buttons["Pinned"].firstMatch
        XCTAssertTrue(place.waitForExistence(timeout: 5), app.debugDescription)
        place.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 10), "A finished bulk write leaves edit mode")
        XCTAssertTrue(heading(app, "Pinned").waitForExistence(timeout: 10), "Both sessions were pinned\n\(app.debugDescription)")
        shot("organise-select-4-after-move")

        // Done clears the choice.
        menu(app, "Write the migration guide", "Select")
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5), "Done leaves edit mode")
        XCTAssertTrue(list.exists)

        // Clear selection leaves it too.
        menu(app, "Write the migration guide", "Select")
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        reveal(app, rowStarting(app, "Check the nightly build")).tap()
        app.buttons["Actions"].tap()
        app.buttons["Clear selection"].firstMatch.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5), "Clear selection leaves edit mode")

        // A bulk Archive.
        menu(app, "Write the migration guide", "Select")
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        reveal(app, rowStarting(app, "Check the nightly build")).tap()
        app.buttons["Actions"].tap()
        app.buttons["Archive 2 sessions"].firstMatch.tap()
        XCTAssertTrue(rowStarting(app, "Check the nightly build").waitForNonExistence(timeout: 10), "The archived sessions leave the list\n\(app.debugDescription)")
        XCTAssertTrue(done.waitForNonExistence(timeout: 5), "Archive leaves edit mode")
        shot("organise-select-5-after-archive")
    }
}
