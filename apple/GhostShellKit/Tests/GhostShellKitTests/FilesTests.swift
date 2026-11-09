import XCTest
@testable import GhostShellKit
@testable import GhostShellScreens

final class FilesTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let fakeToken = String(repeating: "ab12", count: 16)

    private func client() async -> GhostShellClient {
        let store = MemoryTokenStore()
        await store.save(fakeToken, for: address)
        return GhostShellClient(address: address, store: store, protocols: [Stub.self])
    }

    private func bodyOf(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 256)
        while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 256); if n <= 0 { break }; data.append(buffer, count: n) }
        return data
    }

    // MARK: Routes

    func testAPathWithSpacesAndQueryCharactersTravelsAsOneQueryValue() async throws {
        Stub.reset { _ in (200, [:], #"{"name": "a.txt", "path": "/x", "kind": "text"}"#, nil) }
        let path = "/Users/me/My Notes/a?b#c&d=e+f.txt"
        _ = try await client().preview(sessionID: "s1", path: path)
        let url = try XCTUnwrap(Stub.requests().first?.url)
        XCTAssertEqual(url.path, "/api/sessions/s1/preview")
        // The server reads the query with URLSearchParams, so what it decodes must be the whole path again, and nothing may leak into another parameter.
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items.count, 1, url.absoluteString)
        XCTAssertEqual(items.first?.value, path, url.absoluteString)
        XCTAssertNil(url.fragment, url.absoluteString)
        let raw = try XCTUnwrap(url.query)
        // A literal ? is legal inside a query and URLSearchParams reads it as text, so it may stay.
        for bad in ["&", "#", " ", "+"] { XCTAssertFalse(raw.dropFirst("path=".count).contains(bad), "\(bad) in \(raw)") }
    }

    func testDownloadAddsItsFlag() async throws {
        Stub.reset { _ in (200, [:], "bytes", nil) }
        let data = try await client().fileBytes(sessionID: "s1", path: "/a b.pdf", download: true)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "bytes")
        let url = try XCTUnwrap(Stub.requests().first?.url)
        XCTAssertEqual(url.path, "/api/sessions/s1/file")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name), ["path", "download"])
    }

    func testABadImageRefIsRefusedWithNoRequest() async {
        Stub.reset { _ in (200, [:], "x", nil) }
        let client = await client()
        for ref in ["", "../x", "12.0.abc/../x", "12.0", "a.0.abc", "12.x0.abc", "12.0.ab c", "12.0.ab%2F", "12.0.abc\n", "12.0.a.b", "/12.0.abc"] {
            do { _ = try await client.imageBytes(sessionID: "s1", ref: ref); XCTFail("sent \(ref)") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(ref), ref) }
        }
        XCTAssertEqual(Stub.requests().count, 0)
    }

    func testAGoodImageRefIsFetchedFromItsRoute() async throws {
        Stub.reset { _ in (200, [:], "png", nil) }
        for ref in ["1234.0.abc-DEF_9", "0.r12.", "7.r0.00ff"] { _ = try await client().imageBytes(sessionID: "s1", ref: ref) }
        XCTAssertEqual(Stub.requests().map { $0.url?.path }, ["/api/sessions/s1/images/1234.0.abc-DEF_9", "/api/sessions/s1/images/0.r12.", "/api/sessions/s1/images/7.r0.00ff"])
    }

    func testAnOddSessionIDIsRefusedWithNoRequest() async {
        Stub.reset { _ in (200, [:], "{}", nil) }
        let client = await client()
        for id in ["", "a/b"] {
            do { _ = try await client.preview(sessionID: id, path: "/a") ; XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(id)) }
            do { _ = try await client.fileBytes(sessionID: id, path: "/a") ; XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(id)) }
            do { _ = try await client.saveFile(sessionID: id, path: "/a", text: "", base: "") ; XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(id)) }
            do { _ = try await client.chatImages(sessionID: id) ; XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(id)) }
            do { _ = try await client.imageBytes(sessionID: id, ref: "1.0.a") ; XCTFail("sent") } catch { XCTAssertEqual(error as? GhostShellError, .badPath(id)) }
        }
        XCTAssertEqual(Stub.requests().count, 0)
    }

    // MARK: Preview decoding

    func testAPreviewDecodesLeniently() throws {
        let full = Data(##"{"name":"a.md","path":"/p/a.md","size":12,"kind":"markdown","type":"text/markdown","text":"# Hi","truncated":true,"version":"abc","editable":true}"##.utf8)
        let a = try JSONDecoder().decode(FilePreview.self, from: full)
        XCTAssertEqual(a, FilePreview(name: "a.md", path: "/p/a.md", size: 12, kind: .markdown, text: "# Hi", truncated: true, version: "abc", editable: true))

        let odd = try JSONDecoder().decode(FilePreview.self, from: Data(#"{"name":"x","path":"/x","kind":"video","size":"big","tooLarge":true,"readOnly":"Read only."}"#.utf8))
        XCTAssertEqual(odd.kind, .other("video"))
        XCTAssertEqual(odd.size, 0)
        XCTAssertTrue(odd.tooLarge)
        XCTAssertEqual(odd.readOnly, "Read only.")

        let empty = try JSONDecoder().decode(FilePreview.self, from: Data("{}".utf8))
        XCTAssertEqual(empty, FilePreview(kind: .other("")))
        XCTAssertFalse(empty.editable)
        XCTAssertNil(empty.text)
    }

    // MARK: Save

    func testSavePostsTheRightJSONWithAnOriginAndReturnsThePreview() async throws {
        Stub.reset { _ in (200, [:], #"{"name":"a.txt","path":"/a.txt","kind":"text","text":"new","version":"v2","editable":true}"#, nil) }
        let saved = try await client().saveFile(sessionID: "s1", path: "/a.txt", text: "new\nline é", base: "v1")
        XCTAssertEqual(saved.version, "v2")
        let request = try XCTUnwrap(Stub.requests().first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/sessions/s1/save")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://ghost.example.com")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyOf(request)) as? [String: String])
        XCTAssertEqual(sent, ["path": "/a.txt", "text": "new\nline é", "base": "v1"])
    }

    func testAChangedFileAnswers409AsARefusalWithTheServersSentence() async {
        let why = "This file changed on disk after you opened it, so nothing was saved."
        Stub.reset { _ in (409, [:], #"{"error": "\#(why)", "changed": true}"#, nil) }
        do { _ = try await client().saveFile(sessionID: "s1", path: "/a.txt", text: "x", base: "v1"); XCTFail("saved") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 409, message: why, changed: true))
        }
    }

    func testOnly409WithChangedIsAConflict() async {
        Stub.reset { _ in (409, [:], #"{"error": "This file is already being saved."}"#, nil) }
        do { _ = try await client().saveFile(sessionID: "s1", path: "/a.txt", text: "x", base: "v1"); XCTFail("saved") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 409, message: "This file is already being saved.", changed: false))
            XCTAssertNotEqual(error as? GhostShellError, .refused(status: 409, message: "This file is already being saved.", changed: true))
        }
        Stub.reset { _ in (409, [:], #"{"error": "Changed.", "changed": true}"#, nil) }
        do { _ = try await client().saveFile(sessionID: "s1", path: "/a.txt", text: "x", base: "v1"); XCTFail("saved") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 409, message: "Changed.", changed: true))
        }
    }

    func testARefusalLosesEveryKindOfLineBreak() async {
        Stub.reset { _ in (403, [:], "{\"error\": \"One\\u2028two\\u2029three\\u0085four\\nfive\\r\\nsix\"}", nil) }
        do { _ = try await client().preview(sessionID: "s1", path: "/a"); XCTFail("sent") } catch {
            XCTAssertEqual(error as? GhostShellError, .refused(status: 403, message: "Onetwothreefourfivesix"))
        }
    }

    func testAnImageRefMustMatchTheServersShapeToTheEnd() {
        for good in ["1234.0.abc-DEF_9", "0.r12.", "7.r0.00ff"] { XCTAssertTrue(GhostShellClient.isImageRef(good), good) }
        // A trailing newline, an Arabic-Indic digit and a fullwidth digit must not pass.
        for bad in ["12.0.abc\n", "12.0.abc\n\n", "\u{0661}.0.abc", "1.\u{0661}.abc", "\u{FF11}.0.abc", "12.0.abc\u{2028}", ".0.abc", "12..abc"] {
            XCTAssertFalse(GhostShellClient.isImageRef(bad), bad.debugDescription)
        }
    }

    // MARK: The chat's pictures

    func testTheChatsPicturesDecodeInTranscriptOrderWithTheirSources() async throws {
        let body = #"""
        {"items": [
          {"kind": "user", "text": "", "images": [{"ref": "10.0.u1", "type": "image/png"}]},
          {"kind": "tool", "name": "mcp__chrome__screenshot", "images": [{"ref": "40.r0.t1", "type": "image/png"}, {"ref": "40.r1.t1", "type": "image/png"}]},
          {"kind": "mystery"},
          {"kind": "user", "text": "", "images": [{"ref": "90.0.u2", "type": "image/jpeg"}]}
        ]}
        """#
        Stub.reset { _ in (200, [:], body, nil) }
        let items = try await client().chatImages(sessionID: "s1")
        XCTAssertEqual(Stub.requests().first?.url?.path, "/api/sessions/s1/images")
        let pictures = ChatFiles.pictures(in: items)
        XCTAssertEqual(pictures.map(\.ref), ["10.0.u1", "40.r0.t1", "40.r1.t1", "90.0.u2"])
        XCTAssertEqual(pictures.map(\.tool), [nil, "mcp__chrome__screenshot", "mcp__chrome__screenshot", nil])
    }

    func testTheViewerStartsAtTheTappedPictureOrNilWhenTheChatDoesNotHoldIt() {
        let list = ["a", "b", "c"].map { ChatFiles.Picture(ref: $0) }
        XCTAssertEqual(ChatFiles.start(of: "b", in: list), 1)
        XCTAssertEqual(ChatFiles.start(of: "a", in: list), 0)
        XCTAssertNil(ChatFiles.start(of: "z", in: list))
        XCTAssertNil(ChatFiles.start(of: "a", in: []))
    }

    // MARK: Clips

    func testTheClipListIsTheUniqueAudioLinksInOrder() {
        let one = ChatMarkdown.parse("Listen to [the intro](/tmp/a.WAV:3) and `/tmp/b.mp3`.\n\n- see /tmp/c.m4a\n- and /tmp/a.WAV again\n- or /tmp/notes.txt", fileLinks: true)
        let two = ChatMarkdown.parse("> quoted /tmp/d.mp3\n\n| clip |\n|---|\n| /tmp/e.wav |\n\n**/tmp/f.m4a**", fileLinks: true)
        XCTAssertEqual(ChatFiles.clipPaths(in: [one, two]), ["/tmp/a.WAV", "/tmp/b.mp3", "/tmp/c.m4a", "/tmp/d.mp3", "/tmp/e.wav", "/tmp/f.m4a"])
        XCTAssertEqual(ChatFiles.clipPaths(in: []), [])
        XCTAssertEqual(ChatFiles.clipPaths(in: [ChatMarkdown.parse("/tmp/a.mp3 is only text without file links")]), [])
    }

    func testOnlyThreeExtensionsAreClips() {
        XCTAssertTrue(ChatFiles.isClip("/a/b.MP3"))
        XCTAssertTrue(ChatFiles.isClip("/a/b.m4a"))
        XCTAssertFalse(ChatFiles.isClip("/a/b.mp3x"))
        XCTAssertFalse(ChatFiles.isClip("/a/mp3"))
        XCTAssertFalse(ChatFiles.isClip("/a/b.flac"))
    }

    // MARK: Words

    func testSizesAndCardWords() {
        XCTAssertEqual(ChatFiles.fileSize(1), "1 byte")
        XCTAssertEqual(ChatFiles.fileSize(900), "900 bytes")
        XCTAssertEqual(ChatFiles.fileSize(1536), "1.5 KB")
        XCTAssertEqual(ChatFiles.fileSize(12 * 1024), "12 KB")
        XCTAssertEqual(ChatFiles.fileSize(Int(3.4 * 1024 * 1024)), "3.4 MB")
        XCTAssertEqual(ChatFiles.cardSize(900), "900 B")
        XCTAssertEqual(ChatFiles.cardSize(12_288), "12 KB")
        XCTAssertEqual(ChatFiles.kindName("photo.heic"), "HEIC file")
        XCTAssertEqual(ChatFiles.kindName("Makefile"), "File")
        XCTAssertEqual(ChatFiles.cardLine(ChatFile(name: "report.pdf", type: "application/pdf", size: 2048, path: "/r.pdf")), "PDF · 2 KB")
        XCTAssertEqual(ChatFiles.cardLine(ChatFile(name: "README", type: "", size: 10, path: "/README")), "File · 10 B")
    }

    func testLinesDropTheLastEmptyLineAndReadEveryLineEnding() {
        XCTAssertEqual(ChatFiles.lines(of: "a\r\nb\rc\n"), ["a", "b", "c"])
        XCTAssertEqual(ChatFiles.lines(of: "a\n\nb"), ["a", "", "b"])
        XCTAssertEqual(ChatFiles.lines(of: ""), [])
        XCTAssertEqual(ChatFiles.lines(of: "\n"), [""])
    }

    func testTileLabelsFollowThePage() {
        XCTAssertEqual(ChatFiles.tileLabel(0, of: 1, source: "Chrome"), "View image from Chrome")
        XCTAssertEqual(ChatFiles.tileLabel(1, of: 3, source: "Chrome"), "View image 2 of 3, from Chrome")
        XCTAssertEqual(ChatFiles.tileLabel(3, of: 6, source: "Chrome"), "View 3 more images")
        XCTAssertEqual(ChatFiles.overflow(4), 0)
        XCTAssertEqual(ChatFiles.overflow(5), 2)
        XCTAssertEqual(ChatFiles.toolSource("mcp__claude_ai_Gmail__search"), "Gmail")
        XCTAssertEqual(ChatFiles.toolSource("Read"), "Read")
    }
}

/// The file panel's state, against a stub server. Drafts are held in memory by server, chat and path, so each test uses a chat of its own.
@MainActor
final class FilesStoreTests: XCTestCase {
    private let address = ServerAddress("https://ghost.example.com")!
    private let path = "/work/NOTES.md"

    // The store holds its chat weakly, as the chat holds the store, so the test keeps the chats.
    private var chats: [ChatContext] = []

    override func tearDown() async throws {
        FileDrafts.forgetAll()
        chats = []
    }

    private func preview(version: String = "v1", text: String = "hello") -> String {
        #"{"name":"NOTES.md","path":"\#(path)","size":5,"kind":"text","text":"\#(text)","version":"\#(version)","editable":true}"#
    }

    private func store(session: String) async -> FilesStore {
        let tokens = MemoryTokenStore()
        await tokens.save(String(repeating: "ab12", count: 16), for: address)
        let client = GhostShellClient(address: address, store: tokens, protocols: [Stub.self])
        let chat = ChatContext(sessionID: session, client: client)
        chats.append(chat)
        return FilesStore(chat: chat)
    }

    private func wait(_ what: String, _ test: () -> Bool) async {
        for _ in 0..<100 where !test() { try? await Task.sleep(for: .milliseconds(50)) }
        XCTAssertTrue(test(), what)
    }

    private func openAndEdit(_ store: FilesStore) async {
        store.open(path: path, line: nil)
        await wait("the file opens") { store.file?.preview != nil }
        store.startEdit()
    }

    func testTypedTextIsParkedAndComesBackWhenTheFileOpensAgainInANewVisit() async {
        let body = preview()
        Stub.reset { _ in (200, [:], body, nil) }
        let first = await store(session: "park")
        await openAndEdit(first)
        first.edit?.text = "typed"
        first.parkDraft()

        let second = await store(session: "park")
        second.open(path: path, line: nil)
        await wait("the draft opens in the editor") { second.edit != nil }
        XCTAssertEqual(second.edit?.text, "typed")
        XCTAssertEqual(second.edit?.original, "hello")
        XCTAssertEqual(second.edit?.restored, true)
        XCTAssertEqual(second.edit?.conflict, false)
    }

    func testADraftOfAnOlderVersionStartsInConflictAndAnotherChatsDraftIsNotSeen() async {
        let first = await store(session: "old")
        FileDrafts.write(FileDrafts.key(address, sessionID: "old", path: path), FileDrafts.Draft(text: "mine", base: "v0"))
        Stub.reset { [body = preview(version: "v2")] _ in (200, [:], body, nil) }
        first.open(path: path, line: nil)
        await wait("the draft opens in the editor") { first.edit != nil }
        XCTAssertEqual(first.edit?.conflict, true)

        let other = await store(session: "other")
        other.open(path: path, line: nil)
        await wait("the file opens") { other.file?.preview != nil }
        XCTAssertNil(other.edit)
    }

    func testAnUnchangedEditLeavesNoDraft() async {
        let body = preview()
        Stub.reset { _ in (200, [:], body, nil) }
        let store = await store(session: "same")
        await openAndEdit(store)
        store.edit?.text = "typed"
        store.parkDraft()
        store.edit?.text = "hello"
        store.parkDraft()
        XCTAssertNil(FileDrafts.read(FileDrafts.key(address, sessionID: "same", path: path)))
    }

    func testCancelReloadsThePreviewAndForgetsTheDraft() async {
        let body = preview()
        Stub.reset { _ in (200, [:], body, nil) }
        let store = await store(session: "cancel")
        await openAndEdit(store)
        store.edit?.text = "typed"
        store.parkDraft()
        store.discardEdit()
        XCTAssertNil(store.edit)
        XCTAssertNil(FileDrafts.read(FileDrafts.key(address, sessionID: "cancel", path: path)))
        await wait("the preview is read again") { Stub.requests().filter { $0.url?.path.hasSuffix("/preview") == true }.count == 2 }
    }

    func testForgetAllEmptiesEveryDraft() {
        let key = FileDrafts.key(address, sessionID: "gone", path: path)
        FileDrafts.write(key, FileDrafts.Draft(text: "x", base: "v1"))
        FileDrafts.forgetAll()
        XCTAssertNil(FileDrafts.read(key))
    }

    func testTheDraftListKeepsTheNewestForty() {
        for index in 0..<45 { FileDrafts.write("k\(index)", FileDrafts.Draft(text: "x", base: "v")) }
        XCTAssertNil(FileDrafts.read("k4"))
        XCTAssertNotNil(FileDrafts.read("k5"))
        XCTAssertNotNil(FileDrafts.read("k44"))
    }

    func testOnlyAChangedFileShowsTheConflictAlert() async {
        let body = preview()
        for (reply, conflict, title) in [(#"{"error":"Changed on disk.","changed":true}"#, true, "Changed on disk."),
                                         (#"{"error":"This file is already being saved."}"#, false, "This file is already being saved.")] {
            Stub.reset { request in request.url?.path.hasSuffix("/save") == true ? (409, [:], reply, nil) : (200, [:], body, nil) }
            let store = await store(session: "save-\(conflict)")
            await openAndEdit(store)
            store.edit?.text = "typed"
            store.save()
            await wait("the alert shows") { store.alert != nil }
            XCTAssertEqual(store.alert?.message, title)
            XCTAssertEqual(store.alert?.conflict, conflict)
            XCTAssertEqual(store.edit?.conflict, conflict)
            XCTAssertEqual(store.edit?.saving, false)
            XCTAssertEqual(store.edit?.text, "typed")
        }
    }

    func testADisplayNameLosesBidiAndControlCharactersAndLeadingDots() {
        XCTAssertEqual(ChatFiles.displayName("notes\u{202E}gpj.exe"), "notesgpj.exe")
        XCTAssertEqual(ChatFiles.displayName("  ..\n.hidden\u{0007}.txt "), "hidden.txt")
        XCTAssertEqual(ChatFiles.displayName("report.pdf"), "report.pdf")
        XCTAssertEqual(ChatFiles.displayName("\u{202E}.. \n"), "file")
    }

    func testASavedCopyIsOfferedUnderTheFilesOwnLastPathComponent() {
        XCTAssertEqual(FilesStore.exportName("/home/me/x/report.pdf"), "report.pdf")
        XCTAssertEqual(FilesStore.exportName("~/notes/"), "notes")
        XCTAssertEqual(FilesStore.exportName("/home/me/../../etc/.passwd"), "passwd")
        XCTAssertEqual(FilesStore.exportName("/"), "file")
    }
}
