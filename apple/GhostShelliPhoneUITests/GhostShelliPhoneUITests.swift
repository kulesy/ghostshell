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
    /// `attachDir` turns on the Debug hook that attaches the file named in `attach.txt` there, standing in for the Files sheet, which is empty in a Simulator.
    private func launch(prefillAddress: Bool = true, stub: String? = nil, attachDir: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        let tag = UUID().uuidString
        app.launchArguments = ["-GSKeychainService", "gs.iphone.test.\(tag)", "-GSDefaultsSuite", "gs.iphone.test.\(tag)", "-GSAppearance", appearance]
        if prefillAddress { app.launchArguments += ["-GSAddress", stub.flatMap { env["GS_ADDRESS_\($0.uppercased())"] } ?? address] }
        if let attachDir { app.launchArguments += ["-GSAttachDir", attachDir] }
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
        // The list only draws the rows on screen, and a small phone shows few of them.
        let label = app.staticTexts[expecting]
        for _ in 0..<4 where !label.waitForExistence(timeout: 6) { app.swipeUp() }
        XCTAssertTrue(label.waitForExistence(timeout: 10), app.debugDescription)
    }

    private func row(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    private func open(_ app: XCUIApplication, _ title: String, expecting text: String) {
        // The list only draws the rows on screen, and sign-in can leave a small phone scrolled past a row near the top.
        let line = reveal(app, row(app, title))
        clearOfTheBars(app, line)
        line.tap()
        XCTAssertTrue(app.staticTexts[text].firstMatch.waitForExistence(timeout: 20), "The chat \(title) did not show \(text)\n\(app.debugDescription)")
    }

    /// The content scrolls under the bars: a chat's nav bar and composer, and the list's header and footer.
    /// The test runner still counts an element under one as hittable and the tap is lost, so the element is dragged into the open area between them.
    private func clearOfTheBars(_ app: XCUIApplication, _ element: XCUIElement) {
        let height = app.windows.firstMatch.frame.height
        let bar = app.navigationBars.firstMatch
        let header = app.buttons["New"].firstMatch
        let top = max(bar.exists ? bar.frame.maxY : 0, header.exists && header.isHittable ? header.frame.maxY : 0) + 8
        // A chat's thread ends where the composer starts, and the list's footer takes about the last 110pt.
        let thread = app.scrollViews["Messages"].firstMatch
        let bottom = min(height * 0.8, thread.exists ? thread.frame.maxY - 8 : height)
        // The drag runs down the margin, since one on a code block scrolls only the code sideways.
        func drag(_ from: CGFloat, _ to: CGFloat) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: from)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: to)))
        }
        for _ in 0..<3 {
            let frame = element.frame
            if frame.minY < top { drag(0.35, 0.6) } else if frame.maxY > bottom { drag(0.6, 0.35) } else { break }
        }
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

    /// From iOS 26 a bar button sits inside a 44pt glass capsule and reports the 36pt inside it, so a bar button needs 34pt there.
    /// `bar` is for the bottom bar, whose own frame iOS 27 reports as the whole screen.
    private func assertTouchable(_ element: XCUIElement, _ name: String, bar: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        let frame = element.frame
        var least: CGFloat = 43.5
        if #available(iOS 26, *), bar || XCUIApplication().navigationBars.allElementsBoundByIndex.contains(where: { $0.frame.contains(frame) }) { least = 34 }
        XCTAssertGreaterThanOrEqual(frame.height, least, "\(name) is \(frame.height)pt tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.width, least, "\(name) is \(frame.width)pt wide", file: file, line: line)
    }

    private func get(_ path: String, stub: String? = nil) async throws -> [[String: Any]] {
        let base = stub.flatMap { env["GS_ADDRESS_\($0.uppercased())"] } ?? address
        let (data, _) = try await URLSession.shared.data(from: URL(string: base + path)!)
        return (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    /// What the chat stub recorded under `key` (send, stop, pick, upload or created).
    private func calls(_ key: String) async throws -> [Any] {
        let (data, _) = try await URLSession.shared.data(from: URL(string: address + "/__calls")!)
        return ((try JSONSerialization.jsonObject(with: data) as? [String: Any])?[key] as? [Any]) ?? []
    }

    /// The terminal requests the chat stub recorded, each `{ route, body }`.
    private func terminalRequests() async throws -> [[String: Any]] { try await get("/__terminal") }

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
        assertTouchable(app.buttons["Account"], "Account")
        assertTouchable(row(app, "Fix the flaky upload test"), "A session row")

        open(app, "Fix the flaky upload test", expecting: "Thanks. Can you add a note to the changelog?")
        shot("03-chat-rich")
        assertTouchable(app.navigationBars.firstMatch.buttons.firstMatch, "Back")
        for _ in 0..<3 { app.swipeDown() }
        shot("04-chat-scrolled")
        back(app)
        XCTAssertTrue(app.buttons["Account"].waitForExistence(timeout: 10), "Back returns to the list")

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

    /// The thread keeps its margin on both sides. Text starts one inset in from the left, and the user's bubble ends one inset in from the right,
    /// whose 13pt padding sits between the bubble's edge and its text. 16 and 13 are `ChatStyle.threadInset` and `bubblePadding` on the phone.
    private func assertThreadMargin(_ app: XCUIApplication, reply: String, user: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
        let width = app.windows.firstMatch.frame.width
        let words = app.staticTexts[reply].firstMatch
        XCTAssertTrue(words.waitForExistence(timeout: 20), "The reply \(reply) is drawn\n\(app.debugDescription)", file: file, line: line)
        XCTAssertEqual(words.frame.minX, 16, accuracy: 1, "The thread's text starts one inset from the left edge: \(words.frame)", file: file, line: line)
        guard let user else { return }
        let sent = app.staticTexts[user].firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 5), "The message \(user) is drawn", file: file, line: line)
        XCTAssertEqual(width - sent.frame.maxX, 16 + 13, accuracy: 1, "The user's bubble ends one inset from the right edge: \(sent.frame) in \(width)pt", file: file, line: line)
    }

    /// The first chat opened after sign-in looks right and a later one sat a whole inset to the left, so the chats are opened one after another.
    func testTheThreadKeepsItsMarginInEveryChatItOpens() throws {
        let app = launch()
        signIn(app)
        open(app, "Fix the flaky upload test", expecting: "Thanks. Can you add a note to the changelog?")
        back(app)
        open(app, "Push the upload fix", expecting: "Bash wants to run a command")
        assertThreadMargin(app, reply: "I need your go-ahead before I go on.", user: "Go ahead and fix it.")
        shot("margin-1-approval-bash")
        back(app)
        open(app, "Choose the test setup", expecting: "Claude is asking")
        assertThreadMargin(app, reply: "I need your go-ahead before I go on.", user: "Go ahead and fix it.")
        shot("margin-2-question")
        back(app)
        open(app, "Approve the retry plan", expecting: "Claude has a plan")
        assertThreadMargin(app, reply: "I need your go-ahead before I go on.", user: "Go ahead and fix it.")
        back(app)
        open(app, "Revenue by region", expecting: "Say the word and I will go further on any region.")
        assertThreadMargin(app, reply: "Say the word and I will go further on any region.")
        shot("margin-3-widgets")
        back(app)
        open(app, "Edit the upload helper", expecting: "I need your go-ahead before I go on.")
        assertThreadMargin(app, reply: "I need your go-ahead before I go on.", user: "Go ahead and fix it.")
    }

    // MARK: Composer

    private func openComposerChat(_ app: XCUIApplication) {
        open(app, "Rename the export helper", expecting: "I renamed it in 4 files and updated the two tests that imported it.")
    }

    private func message(_ app: XCUIApplication) -> XCUIElement { app.textFields["Message"].firstMatch }

    func testWriteAndSendAMessageWithAPhotoAndAFile() async throws {
        let attachDir = "/tmp/gs-iphone-attach-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: attachDir, withIntermediateDirectories: true)
        let notes = attachDir + "/notes.txt"
        try "Remember the export helper.\n".write(toFile: notes, atomically: true, encoding: .utf8)
        let app = launch(attachDir: attachDir)
        signIn(app)
        let sends = try await calls("send").count
        let uploads = try await calls("upload").count
        openComposerChat(app)

        // No keyboard on opening a chat, and the controls are in reach.
        XCTAssertTrue(message(app).waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.keyboards.firstMatch.exists, "A phone does not raise the keyboard when a chat opens.")
        for name in ["Attach files", "Attach photos"] { assertTouchable(app.buttons[name].firstMatch, name) }
        assertTouchable(app.buttons["Send"].firstMatch, "Send")
        XCTAssertFalse(app.buttons["Send"].firstMatch.isEnabled, "Send waits for something to send.")
        shot("composer-1-chat")

        focusByEdge(message(app), "Message")
        message(app).typeText("Please check the helper too")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))

        // The real photo picker: the newest photo in the Simulator's library is the one script put there.
        app.buttons["Attach photos"].firstMatch.tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        // The picker runs outside the app, and on iOS 27 in CI it can still say Loading after 15 seconds.
        XCTAssertTrue(photo.waitForExistence(timeout: 45), app.debugDescription)
        photo.tap()
        let add = app.buttons["Add"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), app.debugDescription)
        add.tap()
        let picture = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Image Photo 1'")).firstMatch
        XCTAssertTrue(picture.waitForExistence(timeout: 20), "The photo becomes a chip\n\(app.debugDescription)")

        // The real Files sheet opens and cancels. It lists nothing in a Simulator, so the file comes in through the Debug hook.
        app.buttons["Attach files"].firstMatch.tap()
        let cancel = app.buttons["Cancel"].firstMatch
        // The Files sheet runs outside the app, and on iOS 27 in CI it can take 20 seconds to show.
        XCTAssertTrue(cancel.waitForExistence(timeout: 45), app.debugDescription)
        cancel.tap()
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 10))
        try "1 \(notes)".write(toFile: attachDir + "/attach.txt", atomically: true, encoding: .utf8)
        let file = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'File notes.txt'")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 20), "The file becomes a chip\n\(app.debugDescription)")
        for name in ["Remove notes.txt"] { assertTouchable(app.buttons[name].firstMatch, name) }
        shot("composer-2-keyboard-attached")

        let send = app.buttons["Send"].firstMatch
        XCTAssertTrue(send.isHittable, "Send is reachable with the keyboard up\n\(app.debugDescription)")
        send.tap()
        try await Task.sleep(for: .seconds(3))
        let sent = try await calls("send")
        XCTAssertEqual(sent.count, sends + 1, "One send")
        let last = sent.last as? [String: Any]
        XCTAssertEqual(last?["id"] as? String, "composer")
        XCTAssertEqual(last?["text"] as? String, "Please check the helper too")
        // A picture goes inside the message and a file is uploaded first, then named in it.
        XCTAssertEqual((last?["images"] as? [Any])?.count, 1, "The photo goes with the message: \(String(describing: last))")
        XCTAssertEqual((last?["files"] as? [Any])?.count, 1, "The file goes with the message: \(String(describing: last))")
        let uploaded = try await calls("upload")
        XCTAssertEqual(uploaded.count, uploads + 1, "The file was uploaded")
        let upload = uploaded.last as? [String: Any]
        XCTAssertEqual(upload?["name"] as? String, "notes.txt")
        XCTAssertEqual(upload?["size"] as? Int, "Remember the export helper.\n".utf8.count)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'File notes.txt'")).firstMatch.waitForNonExistence(timeout: 10), "The chips clear after a send")
    }

    func testAMessageIsQuotedIntoTheComposer() async throws {
        let app = launch()
        signIn(app)
        openComposerChat(app)
        let text = app.staticTexts["I renamed it in 4 files and updated the two tests that imported it."].firstMatch
        text.press(forDuration: 1.2)
        let quote = app.buttons["Quote"].firstMatch
        XCTAssertTrue(quote.waitForExistence(timeout: 10), app.debugDescription)
        // A menu row is the system's own size, which iOS 27 makes 42pt on the smaller phones.
        if #unavailable(iOS 27) { assertTouchable(quote, "Quote") }
        quote.tap()
        let chip = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Quote: '")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "The quote chip appears in the composer\n\(app.debugDescription)")
        XCTAssertTrue(chip.label.contains("I renamed it in 4 files"), chip.label)
        assertTouchable(app.buttons["Remove quote"].firstMatch, "Remove quote")
        shot("composer-3-quote")
        let sends = try await calls("send").count
        app.buttons["Send"].firstMatch.tap()
        try await Task.sleep(for: .seconds(3))
        let sent = try await calls("send")
        XCTAssertEqual(sent.count, sends + 1)
        XCTAssertTrue(((sent.last as? [String: Any])?["text"] as? String ?? "").contains("I renamed it in 4 files"), "The quote goes in the message: \(String(describing: sent.last))")
    }

    func testStartANewSession() async throws {
        let app = launch()
        signIn(app)
        let before = try await calls("created").count
        // The header's New menu holds New session and New group.
        let plus = app.buttons["New"].firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 10), app.debugDescription)
        assertTouchable(plus, "New")
        plus.tap()
        let button = app.buttons["New session"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), app.debugDescription)
        button.tap()
        let folder = app.textFields["Folder"].firstMatch
        XCTAssertTrue(folder.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(waitForValue(folder, "/Users/example"), "The folder starts as the first the server lists: \(folder.value ?? "")")
        XCTAssertLessThanOrEqual(folder.frame.maxX, XCUIScreen.main.screenshot().image.size.width, "The folder row fits the screen")
        assertTouchable(app.buttons["Recent folders"].firstMatch, "Recent folders")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "A phone does not raise the keyboard on this screen")
        shot("new-session-1")
        focusByEdge(message(app), "Message")
        message(app).typeText("Start from the phone")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        shot("new-session-2-keyboard")
        let start = app.buttons["Start session"].firstMatch
        assertTouchable(start, "Start session")
        XCTAssertTrue(start.isHittable, "Start is reachable with the keyboard up\n\(app.debugDescription)")
        start.tap()
        try await Task.sleep(for: .seconds(3))
        let made = try await calls("created")
        XCTAssertEqual(made.count, before + 1)
        let sent = made.last as? [String: Any]
        XCTAssertEqual(sent?["text"] as? String, "Start from the phone")
        XCTAssertEqual(sent?["cwd"] as? String, "/Users/example")
        XCTAssertTrue(app.staticTexts["Start from the phone"].firstMatch.waitForExistence(timeout: 20), "The new session opens\n\(app.debugDescription)")
    }

    // MARK: Terminal

    func testTerminalRunsStopsAndRecalls() async throws {
        let app = launch()
        signIn(app)
        open(app, "Check the build output", expecting: "Run the upload test and show me what the build says.")
        let toggle = app.buttons["Terminal"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription)
        assertTouchable(toggle, "Terminal toggle")
        toggle.tap()
        let input = app.textFields.matching(NSPredicate(format: "label BEGINSWITH 'Send to '")).firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 15), "The terminal opens full screen with npm run dev running\n\(app.debugDescription)")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "The keyboard stays down until the box is tapped")
        let requests = try await terminalRequests().count
        for name in ["Ctrl+C", "Ctrl+D", "Tab", "Previous command", "Next command", "Send line", "Stop command", "Clear"] {
            let element = app.buttons[name].firstMatch
            XCTAssertTrue(element.exists, "\(name) is in the terminal\n\(app.debugDescription)")
            assertTouchable(element, name)
        }
        XCTAssertFalse(app.buttons["Escape"].exists, "Esc is left out of the key row")
        shot("terminal-1-running")

        // Ctrl-D ends the running command's input while the box is empty.
        app.buttons["Ctrl+D"].firstMatch.tap()
        try await Task.sleep(for: .seconds(2))
        let ended = try await terminalRequests()
        XCTAssertEqual(ended.count, requests + 1, "One request: \(ended)")
        XCTAssertEqual(ended.last?["route"] as? String, "input")
        XCTAssertEqual((ended.last?["body"] as? [String: Any])?["eof"] as? Bool, true)

        // Ctrl-C stops the running command.
        app.buttons["Ctrl+C"].firstMatch.tap()
        try await Task.sleep(for: .seconds(2))
        let stopped = try await terminalRequests()
        XCTAssertEqual(stopped.count, requests + 2, "One more request: \(stopped)")
        XCTAssertEqual(stopped.last?["route"] as? String, "stop")
        XCTAssertEqual((stopped.last?["body"] as? [String: Any])?["run"] as? String, "r3")

        // A command runs with the button, and a touch keyboard's Return adds a line instead of running it.
        let box = app.textFields.matching(NSPredicate(format: "label BEGINSWITH 'Command in '")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 15), "The box takes a command once the running one stopped\n\(app.debugDescription)")
        shot("terminal-1b-stopped")
        focusByEdge(box, "Terminal box")
        box.typeText("echo hi")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        shot("terminal-2-keyboard")
        for name in ["Ctrl+C", "Tab", "Previous command", "Run command"] { XCTAssertTrue(app.buttons[name].firstMatch.isHittable, "\(name) is reachable with the keyboard up\n\(app.debugDescription)") }
        app.buttons["Run command"].firstMatch.tap()
        try await Task.sleep(for: .seconds(2))
        let ran = try await terminalRequests()
        XCTAssertEqual(ran.last?["route"] as? String, "run")
        XCTAssertEqual((ran.last?["body"] as? [String: Any])?["command"] as? String, "echo hi")

        // Up recalls it.
        let again = app.textFields.matching(NSPredicate(format: "label BEGINSWITH 'Command in '")).firstMatch
        XCTAssertTrue(again.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(again.value as? String ?? "", "Run a command", "The box is empty after a run")
        app.buttons["Previous command"].firstMatch.tap()
        XCTAssertTrue(waitForValue(again, "echo hi"), "Up recalls the last command: \(again.value ?? "")\n\(app.debugDescription)")
        app.buttons["Tab"].firstMatch.tap()
        XCTAssertTrue((again.value as? String ?? "").contains("\t"), "Tab puts a tab in the box: \(again.value ?? "")")

        // Back closes the terminal and shows the chat.
        let backButton = app.navigationBars.firstMatch.buttons["Back"].firstMatch
        XCTAssertTrue(backButton.exists, app.debugDescription)
        assertTouchable(backButton, "Back")
        backButton.tap()
        XCTAssertTrue(app.staticTexts["Run the upload test and show me what the build says."].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["Ctrl+C"].exists, "The terminal is closed")
    }

    func testACodeBlocksRunButtonOpensTheTerminalAndRuns() async throws {
        let app = launch()
        signIn(app)
        open(app, "Check the build output", expecting: "Run the upload test and show me what the build says.")
        let run = app.buttons["Run in terminal"].firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 15), app.debugDescription)
        assertTouchable(run, "Run in terminal")
        shot("terminal-0-chat")
        // The block is above the visible part of the thread, which opens at the bottom. Tapping it unseen makes the test tool scroll to it, and the app stops answering while it does.
        for _ in 0..<6 where !run.isHittable { app.swipeDown() }
        XCTAssertTrue(run.isHittable, "Run is on screen: \(run.frame)")
        let before = try await terminalRequests().count
        run.tap()
        XCTAssertTrue(app.textFields.matching(NSPredicate(format: "label BEGINSWITH 'Send to ' OR label BEGINSWITH 'Command in '")).firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        try await Task.sleep(for: .seconds(2))
        let after = try await terminalRequests()
        XCTAssertEqual(after.count, before + 1, "The Run button runs the block once: \(after)")
        XCTAssertEqual(after.last?["route"] as? String, "run")
        XCTAssertEqual((after.last?["body"] as? [String: Any])?["source"] as? String, "block")
    }

    /// The parts of the thread that 03 and 04 do not show: a notice, a divider, a tool group opened to its rows and a tool's input, and the approval cards in their other states.
    func testThreadPartsAreDrawnLikeThePage() throws {
        let app = launch()
        signIn(app)
        open(app, "Fix the flaky upload test", expecting: "Thanks. Can you add a note to the changelog?")
        // The thread may open above or below a part, depending on how much room the composer leaves.
        // The drag runs down the thread's margin, since a swipe on the code block scrolls only the code sideways.
        let messages = app.scrollViews["Messages"].firstMatch
        func reveal(_ element: XCUIElement) {
            for _ in 0..<10 where !element.isHittable {
                let up = element.frame.minY > messages.frame.midY
                let from = messages.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: up ? 0.8 : 0.2))
                from.press(forDuration: 0.05, thenDragTo: messages.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: up ? 0.2 : 0.8)))
            }
        }
        let notice = app.staticTexts["Conversation compacted"].firstMatch
        reveal(notice)
        XCTAssertTrue(notice.isHittable, app.debugDescription)
        shot("11-chat-notice-divider")
        let group = app.buttons.matching(NSPredicate(format: "label CONTAINS '+1'")).firstMatch
        reveal(group)
        XCTAssertTrue(group.waitForExistence(timeout: 5), "The group that edited a file\n\(app.debugDescription)")
        group.tap()
        shot("12-chat-group-open")
        let tool = app.buttons.matching(NSPredicate(format: "value == 'collapsed' AND label CONTAINS 'helpers.js'")).firstMatch
        XCTAssertTrue(tool.waitForExistence(timeout: 5), app.debugDescription)
        tool.tap()
        shot("13-chat-tool-input")
        back(app)
        open(app, "Choose the test setup", expecting: "Claude is asking")
        app.buttons["node:test"].firstMatch.tap()
        shot("14-question-picked")
        back(app)
        open(app, "Edit the upload helper", expecting: "I need your go-ahead before I go on.")
        shot("15-approval-edit")
        app.buttons["All input"].firstMatch.tap()
        shot("16-approval-all-input")
    }


    func testAccountsPasskeysAndSignOut() throws {
        let app = launch()
        signIn(app)
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Accounts"].waitForExistence(timeout: 5), app.debugDescription)
        // The page's Account menu: Accounts, Passkeys, a separator and Sign out, with Sign out plain.
        let order = ["Accounts", "Passkeys", "Sign out"].map { app.buttons[$0] }
        for item in order { XCTAssertTrue(item.exists, "Account offers \(item.label)\n\(app.debugDescription)") }
        XCTAssertEqual(order.map(\.frame.minY), order.map(\.frame.minY).sorted(), "Account lists its items in the page's order")
        XCTAssertFalse(app.buttons["Sign Out"].exists, "The page says Sign out")
        shot("11-more-menu")
        app.buttons["Accounts"].tap()
        XCTAssertTrue(app.staticTexts["Work"].waitForExistence(timeout: 15), app.debugDescription)
        // The Chrome banner's two buttons sit side by side, as the page has them.
        let open = app.buttons["Open in Chrome on the Mac"], dismiss = app.buttons["Dismiss"]
        XCTAssertTrue(open.waitForExistence(timeout: 10), app.debugDescription)
        for (name, element) in [("Open in Chrome on the Mac", open), ("Dismiss", dismiss)] { assertTouchable(element, name) }
        XCTAssertEqual(open.frame.midY, dismiss.frame.midY, accuracy: 2, "The banner's buttons share a row")
        XCTAssertTrue(app.staticTexts["Plan usage"].exists, app.debugDescription)
        shot("09-accounts")
        app.swipeUp()
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Personal"].waitForExistence(timeout: 5), app.debugDescription)
        shot("09b-accounts-scrolled")
        for name in ["Switch to this", "Sign in", "Rename Personal"] { assertTouchable(app.buttons[name].firstMatch, name) }
        back(app)
        app.buttons["Account"].tap()
        app.buttons["Passkeys"].tap()
        XCTAssertTrue(app.staticTexts["MacBook Pro, Safari"].waitForExistence(timeout: 15), app.debugDescription)
        shot("10-passkeys")
        let remove = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Remove the passkey'")).firstMatch
        assertTouchable(remove, "Remove passkey")
        remove.tap()
        XCTAssertTrue(app.staticTexts["Remove this passkey?"].waitForExistence(timeout: 5), app.debugDescription)
        for name in ["Keep", "Remove"] { assertTouchable(app.buttons[name].firstMatch, name) }
        app.buttons["Keep"].tap()
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "Keep puts the Remove button back")
        back(app)
        app.buttons["Account"].tap()
        app.buttons["Sign out"].tap()
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 15), app.debugDescription)
    }

    func testAccountsAndPasskeysEmptyStates() throws {
        let app = launch(stub: "accountsEmpty")
        signIn(app)
        app.buttons["Account"].tap()
        app.buttons["Accounts"].tap()
        XCTAssertTrue(app.buttons["Add and sign in"].waitForExistence(timeout: 15), app.debugDescription)
        assertTouchable(app.buttons["Add and sign in"], "Add and sign in")
        XCTAssertTrue(app.switches["Switch accounts by itself"].exists, app.debugDescription)
        shot("09c-accounts-empty")
        back(app)
        app.buttons["Account"].tap()
        app.buttons["Passkeys"].tap()
        let none = app.staticTexts["No passkeys added yet."]
        XCTAssertTrue(none.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertLessThan(none.frame.minX, 40, "The empty line is flat on the left, not centred")
        shot("10b-passkeys-empty")
    }

    // MARK: Files

    /// The last match is the live copy of a chat's contents, because a stale copy with old frames comes first.
    private func live(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let all = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        return all.element(boundBy: max(all.count - 1, 0))
    }

    /// A link is a run inside a line of text. iOS 27 pads the line's frame by 16pt a side, so the end of the line is no longer on the link and the tap goes to the link itself.
    private func tapLink(_ app: XCUIApplication, line: String) {
        let text = live(app, line)
        clearOfTheBars(app, text)
        let link = text.links.firstMatch
        (link.exists ? link : text).coordinate(withNormalizedOffset: link.exists ? CGVector(dx: 0.5, dy: 0.5) : CGVector(dx: 0.93, dy: 0.5)).tap()
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
        // The panel offers Save once the file has loaded.
        _ = app.buttons["Save to Files"].firstMatch.waitForExistence(timeout: 10)
        let saves = app.buttons.matching(NSPredicate(format: "label == 'Save to Files'")).allElementsBoundByIndex
        XCTAssertFalse(saves.isEmpty, "A file with no preview can be saved to Files")
        for save in saves { assertTouchable(save, "Save to Files") }
        saves.last?.tap()
        // The panel's own header also says archive.zip, so the wait is for the system's Files sheet itself.
        let picker = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        XCTAssertTrue(picker.waitForExistence(timeout: 45), "Save to Files opens the Files sheet\n\(app.debugDescription)")
        XCTAssertTrue(contains(app, "archive.zip").waitForExistence(timeout: 10), "The save sheet offers the file's own name\n\(app.debugDescription)")
        sleep(1)
        shot("files-6b-save-to-files")
        // The Files sheet has Cancel on iOS 27. Where it has none, a drag down from its top edge puts it away.
        if picker.buttons["Cancel"].exists {
            picker.buttons["Cancel"].tap()
        } else {
            let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
            top.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
        }
        XCTAssertTrue(picker.waitForNonExistence(timeout: 10), "The Files sheet goes away\n\(app.debugDescription)")
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
        // A long press on a word in the widget selects it and offers the system's callout with Copy. The press goes on the text, because a fixed point lands beside the heading on the wider phones.
        // The composer takes the foot of the screen, and an earlier test's send can push the widget above the bar, so bring the text into the open area first.
        let words = app.webViews.staticTexts["Pick one and I will carry on from there."].firstMatch
        XCTAssertTrue(words.waitForExistence(timeout: 20), "The widget draws its text\n\(app.debugDescription)")
        let copy = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Copy")).firstMatch
        // On iOS 27 in CI the first press sometimes selects nothing, so a press that brings no menu is made again.
        for _ in 0..<3 {
            for _ in 0..<6 {
                let y = words.frame.midY
                if y < app.frame.height * 0.2 { app.swipeDown() } else if y > app.frame.height * 0.7 { app.swipeUp() } else { break }
            }
            words.press(forDuration: 1.3)
            if copy.waitForExistence(timeout: 4) { break }
        }
        XCTAssertTrue(copy.exists, "A long press in a widget offers Copy\n\(app.debugDescription)")
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

    /// The icon is named in capitals on a phone, so the name is matched without case.
    private func headingIcon(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label ==[c] %@", "Open the Release chat")).firstMatch
    }

    private func openGroupChat(_ app: XCUIApplication) {
        let icon = headingIcon(app)
        XCTAssertTrue(icon.waitForExistence(timeout: 5), "The heading's chat icon is a button\n\(app.debugDescription)")
        icon.tap()
        XCTAssertTrue(app.buttons["Sub sessions"].firstMatch.waitForExistence(timeout: 15), "The group chat opens\n\(app.debugDescription)")
    }

    func testAGroupHeadingOpensItsChatFromTheIconAndTheLongPress() throws {
        let app = launch(stub: "groups")
        signIn(app, expecting: "A session outside the group")
        assertTouchable(headingIcon(app), "The heading's chat icon")
        // Sign-in scrolls a small phone down to its last row, which takes the heading under the bar.
        let heading = reveal(app, rowStarting(app, "Release"))
        heading.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)).press(forDuration: 1.0)
        let item = app.buttons.matching(NSPredicate(format: "label ==[c] %@", "Open group chat")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "A long press on the heading offers Open group chat\n\(app.debugDescription)")
        shot("groups-1b-heading-menu")
        // A menu row is the system's own size, which iOS 27 makes 42pt.
        if #unavailable(iOS 27) { assertTouchable(item, "Open group chat") }
        item.tap()
        XCTAssertTrue(app.buttons["Sub sessions"].firstMatch.waitForExistence(timeout: 15), "The menu opens the group chat\n\(app.debugDescription)")
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

        app.buttons["Sub sessions"].firstMatch.tap()
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

    /// Opens a screen from the list's footer, which is how a phone reaches Routines and Scheduled sessions.
    private func openFromFooter(_ app: XCUIApplication, _ item: String) {
        let link = app.buttons[item]
        XCTAssertTrue(link.waitForExistence(timeout: 10), "The footer has \(item)\n\(app.debugDescription)")
        assertTouchable(link, item)
        link.tap()
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
        openFromFooter(app, "Routines")
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
        let own = reveal(app, app.buttons["GhostShell's own text"].firstMatch)
        shot("routines-4-form-bottom")
        XCTAssertTrue(own.isSelected, "A new routine starts on GhostShell's own text")
        assertTouchable(own, "Prompt kind: GhostShell's own text")
        assertTouchable(app.buttons["A prompt file"].firstMatch, "Prompt kind: A prompt file")
        for name in ["Model", "Effort", "Permission mode"] { assertTouchable(reveal(app, app.buttons[name].firstMatch), name) }
        let prompt = app.textViews["Prompt"]
        XCTAssertGreaterThanOrEqual(reveal(app, prompt).frame.height, 255, "The prompt box is at least 256pt tall, as the page has it")
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
        // The switch is UIKit's own control, 31pt before iOS 26 and 28pt from it; a frame or content shape on it either leaves it that size or stops it taking taps.
        if #available(iOS 26, *) { XCTAssertGreaterThanOrEqual(sync.frame.height, 28) } else { XCTAssertGreaterThanOrEqual(sync.frame.height, 31) }
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

    func testARoutineShowsInItsProjectAboveWhatIsPinned() {
        let app = routinesApp()
        XCTAssertTrue(row(app, "Routines").exists, "Home has its Routines section")
        XCTAssertFalse(app.staticTexts["Site deploy"].exists, "the routine in the Website project is not on Home")
        shot("routine-projects-1-home")

        app.buttons["Projects"].tap()
        let website = app.buttons["Website (2)"]
        XCTAssertTrue(website.waitForExistence(timeout: 5), "The Website project counts its group session and its routine once\n\(app.debugDescription)")
        website.tap()
        XCTAssertTrue(app.staticTexts["Site deploy"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Nightly check"].exists, "Home's routine is not in the project")
        // The footer also has a Routines link, so the heading is the highest element with that name.
        let top = { (label: String) in app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex.map(\.frame.minY).min() ?? .infinity }
        XCTAssertLessThan(top("Routines"), top("Pinned"), "Routines sits above Pinned in a project, as on Home")
        shot("routine-projects-2-project")

        app.buttons["Projects"].tap()
        app.buttons["Home"].tap()
        XCTAssertTrue(app.staticTexts["Nightly check"].waitForExistence(timeout: 10), app.debugDescription)
    }

    func testRoutinesAndScheduledEmptyStates() throws {
        let app = launch(stub: "routinesEmpty")
        signIn(app, stub: "routinesEmpty", expecting: "Look at the failing build")
        openFromFooter(app, "Routines")
        XCTAssertTrue(app.staticTexts["No routines yet."].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(app.staticTexts["No routines yet."].frame.minX, 40, "The empty state is left aligned, as the page has it")
        shot("routines-0-empty")
        for button in app.buttons.matching(NSPredicate(format: "label == 'New routine'")).allElementsBoundByIndex { assertTouchable(button, "New routine") }
        back(app)
        openFromFooter(app, "Scheduled")
        XCTAssertTrue(app.staticTexts["No scheduled sessions."].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(app.staticTexts["No scheduled sessions."].frame.minX, 40, "The empty state is left aligned, as the page has it")
        shot("scheduled-0-empty")
        for button in app.buttons.matching(NSPredicate(format: "label == 'Schedule a session'")).allElementsBoundByIndex { assertTouchable(button, "Schedule a session") }
    }

    func testScheduledSessions() async throws {
        let app = routinesApp()
        openFromFooter(app, "Scheduled")
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
        XCTAssertGreaterThanOrEqual(reveal(app, prompt).frame.height, 255, "The prompt box is at least 256pt tall, as the page has it")
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
        // A row can be hittable while the footer covers its middle, so it is scrolled up until it clears the bar.
        for _ in 0..<3 where line.frame.midY > app.frame.height - 110 { app.swipeUp() }
        clearOfTheBars(app, line)
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

    /// The page's inline name form: the row or heading becomes a field with its text selected, and Return saves.
    private func name(_ app: XCUIApplication, as text: String, prompt: String = "Name", shot named: String? = nil) {
        let field = app.textFields[prompt]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "The row has a field named \(prompt)\n\(app.debugDescription)")
        let sheetBar = app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Rename' OR identifier BEGINSWITH 'New group'"))
        XCTAssertTrue(sheetBar.count == 0 && !app.buttons["Save"].exists, "No name sheet opens\n\(app.debugDescription)")
        if let named { shot(named) }
        field.typeText(text + "\n")
        XCTAssertTrue(field.waitForNonExistence(timeout: 10), "The field closes once the name is saved\n\(app.debugDescription)")
    }

    /// The + menu's New group.
    private func newGroup(_ app: XCUIApplication) {
        let plus = app.buttons["New"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10), app.debugDescription)
        plus.tap()
        let item = app.buttons["New group"].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "The + menu offers New group\n\(app.debugDescription)")
        item.tap()
    }

    func testOrganiseASessionFromItsMenu() throws {
        let app = organiseApp()
        shot("organise-1-list")
        assertTouchable(app.buttons["New"], "New")

        // Rename.
        menu(app, "Plan the release notes", "Rename\u{2026}")
        name(app, as: "Release plan", prompt: "Title", shot: "organise-inline-rename")
        XCTAssertTrue(rowStarting(app, "Release plan").waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(rowStarting(app, "Plan the release notes").exists)

        // New group, then Move to it.
        newGroup(app)
        name(app, as: "Sprint nine", shot: "organise-inline-new-group")
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
        menu(app, "Add dark mode to the chart", "Unpin")
        XCTAssertTrue(heading(app, "Pinned").waitForNonExistence(timeout: 10))

        // Archive.
        menu(app, "Investigate slow startup", "Archive")
        XCTAssertTrue(rowStarting(app, "Investigate slow startup").waitForNonExistence(timeout: 10), "An archived session leaves the list")
        shot("organise-5-archived")
    }

    func testOrganiseGroupsFromTheirHeadings() throws {
        let app = organiseApp()
        for text in ["Heading one", "Heading two"] {
            newGroup(app)
            name(app, as: text)
            XCTAssertTrue(heading(app, text).waitForExistence(timeout: 10), app.debugDescription)
        }
        shot("organise-groups-1-two-groups")

        // Rename, from the long-press menu.
        heading(app, "Heading one").press(forDuration: 1.0)
        let rename = app.buttons["Rename\u{2026}"].firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 5), "A heading's long press opens its menu\n\(app.debugDescription)")
        shot("organise-groups-2-heading-menu")
        rename.tap()
        name(app, as: "Heading uno", shot: "organise-groups-2b-heading-rename")
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

    func testTheRowMoreMenuRenamesInline() throws {
        let app = organiseApp()
        // Edit mode archives the nightly build row earlier in the same run, and a pinned row stays on screen.
        let more = reveal(app, app.buttons["Actions for Add dark mode to the chart"])
        assertTouchable(more, "Actions for Add dark mode to the chart")
        more.tap()
        let rename = app.buttons["Rename\u{2026}"].firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 5), "The row's menu has the long press's items\n\(app.debugDescription)")
        shot("organise-row-more-menu")
        rename.tap()
        name(app, as: "Dark mode chart", prompt: "Title", shot: "organise-row-more-inline-rename")
        XCTAssertTrue(rowStarting(app, "Dark mode chart").waitForExistence(timeout: 10), app.debugDescription)
    }

    func testTheTopBarAndFooterMenusAndSearch() throws {
        let app = organiseApp()
        let plus = app.buttons["New"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10), app.debugDescription)
        plus.tap()
        XCTAssertTrue(app.buttons["New session"].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["New group"].firstMatch.exists)
        shot("organise-plus-menu")
        app.buttons["New group"].firstMatch.tap()
        let field = app.textFields["Name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        // Return typed while the menu is still closing can miss the field, so it waits for the keyboard first.
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        field.typeText("\n")
        XCTAssertTrue(field.waitForNonExistence(timeout: 5), "An empty name cancels\n\(app.debugDescription)")

        let account = app.buttons["Account"]
        assertTouchable(account, "Account")
        account.tap()
        for item in ["Accounts", "Passkeys", "Sign out"] {
            XCTAssertTrue(app.buttons[item].firstMatch.waitForExistence(timeout: 5), "The account menu has \(item)\n\(app.debugDescription)")
        }
        shot("organise-account-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()

        let search = app.buttons["Search"]
        assertTouchable(search, "Search")
        search.tap()
        let box = app.textFields["Search"]
        XCTAssertTrue(box.waitForExistence(timeout: 5), app.debugDescription)
        shot("organise-search-open")
        box.typeText("migration")
        let hit = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Write the migration guide'")).firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 5), "Search finds the row\n\(app.debugDescription)")
        shot("organise-search-results")
        box.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "migration".count) + "zzzz-no-match")
        XCTAssertTrue(app.staticTexts["Nothing matches that search."].waitForExistence(timeout: 5), app.debugDescription)
        shot("organise-empty-list")
        app.buttons["Close search"].tap()
        XCTAssertTrue(box.waitForNonExistence(timeout: 5), "Close hides the field")
    }

    func testSelectManySessionsInEditMode() throws {
        let app = organiseApp()
        let list = app.buttons["New"]
        menu(app, "Write the migration guide", "Select")
        let done = app.buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5), "Select starts edit mode\n\(app.debugDescription)")
        XCTAssertTrue(list.exists, "Select leaves the list on screen, with no chat opened")
        XCTAssertTrue(app.staticTexts["1 selected"].exists, app.debugDescription)
        // The bar takes room from the list, so the chosen row is brought back above it.
        let chosen = rowStarting(app, "Write the migration guide")
        let bar = app.buttons["Archive"].firstMatch
        var visible = false
        for _ in 0..<20 where !visible {
            visible = chosen.exists && chosen.isHittable && chosen.frame.maxY <= bar.frame.minY
            if !visible { usleep(250_000) }
        }
        XCTAssertTrue(visible, "The chosen row is above the select bar\n\(chosen.frame) \(bar.frame)")
        shot("organise-select-1-edit-mode")
        assertTouchable(done, "Done")
        assertTouchable(app.buttons["Actions"], "Actions")

        // A tap chooses another row and opens nothing.
        reveal(app, rowStarting(app, "Check the nightly build")).tap()
        XCTAssertTrue(app.staticTexts["2 selected"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(list.exists, "A tap in edit mode does not open a chat")
        rowStarting(app, "Write the migration guide").tap()
        XCTAssertTrue(app.staticTexts["1 selected"].waitForExistence(timeout: 5), "A second tap takes the row off")
        rowStarting(app, "Write the migration guide").tap()
        shot("organise-select-2-two-chosen")

        // The Mac's selection menu, in the select bar.
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
        XCTAssertTrue(reveal(app, heading(app, "Pinned")).exists, "Both sessions were pinned\n\(app.debugDescription)")
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
