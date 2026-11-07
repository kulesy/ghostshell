import CoreGraphics
import ImageIO
import XCTest
@testable import GhostShellKit

final class QuoteRulesTests: XCTestCase {
    private func quote(_ text: String, from id: String = "a", title: String = "Plan") -> Quote { Quote(key: UUID().uuidString, text: text, fromID: id, fromTitle: title) }

    func testAQuoteFromTheSameSessionHasNoFromLine() {
        XCTAssertEqual(QuoteRules.message([quote("one\ntwo")], text: "reply", here: "a"), "> one\n> two\n\nreply")
    }

    func testAQuoteFromAnotherSessionNamesIt() {
        XCTAssertEqual(QuoteRules.message([quote("hello", from: "b", title: "  Fix   the\nbug ")], text: "ok", here: "a"), "From the session \"Fix the bug\":\n> hello\n\nok")
        XCTAssertEqual(QuoteRules.message([quote("hello", from: "b", title: " ")], text: "", here: nil), "From another session:\n> hello")
    }

    func testBlankLinesBecomeABareChevronAndBlocksAreSeparatedByABlankLine() {
        XCTAssertEqual(QuoteRules.message([quote("a\n\nb"), quote("c")], text: "x", here: "a"), "> a\n>\n> b\n\n> c\n\nx")
    }

    func testAQuoteAloneIsAMessage() {
        XCTAssertEqual(QuoteRules.message([quote("only")], text: "", here: "a"), "> only")
        XCTAssertEqual(QuoteRules.message([], text: "plain", here: "a"), "plain")
    }

    func testASlashCommandGoesAloneAndKeepsTheQuotes() {
        let quotes = [quote("q")]
        let sent = QuoteRules.messageFor(quotes, text: "/compact now", here: "a")
        XCTAssertEqual(sent.message, "/compact now")
        XCTAssertEqual(sent.kept, quotes)
        let plain = QuoteRules.messageFor(quotes, text: "hello", here: "a")
        XCTAssertEqual(plain.message, "> q\n\nhello")
        XCTAssertTrue(plain.kept.isEmpty)
    }

    func testCleanTidiesWhitespace() {
        XCTAssertEqual(QuoteRules.clean("  one line  \n"), "one line")
        XCTAssertEqual(QuoteRules.clean("\n\n  first  \r\nsecond\u{00A0}\t\n\n\n\nthird   \n"), "  first\nsecond\n\nthird")
    }
}

final class SlashRulesTests: XCTestCase {
    private let commands = [
        SlashCommand(name: "compact", aliases: ["shrink"]),
        SlashCommand(name: "context"),
        SlashCommand(name: "review-pr"),
        SlashCommand(name: "co"),
        SlashCommand(name: "ask", aliases: ["cool"]),
        SlashCommand(name: "model"),
    ]

    func testIsCommandNeedsASlashThenALetterThenASpaceOrTheEnd() {
        XCTAssertTrue(SlashRules.isCommand("/compact"))
        XCTAssertTrue(SlashRules.isCommand("  /compact now"))
        XCTAssertTrue(SlashRules.isCommand("/pr:review x"))
        XCTAssertFalse(SlashRules.isCommand("/1"))
        XCTAssertFalse(SlashRules.isCommand("see /compact"))
        XCTAssertFalse(SlashRules.isCommand("/usr/bin"))
    }

    func testTypedIsTheFirstWordWithTheCaretInsideOrAtItsEnd() {
        XCTAssertEqual(SlashRules.typed(in: "/com", caret: 4)?.query, "com")
        XCTAssertEqual(SlashRules.typed(in: "/com", caret: 2)?.query, "com")
        XCTAssertEqual(SlashRules.typed(in: "/com now", caret: 4)?.end, 4)
        XCTAssertNil(SlashRules.typed(in: "/com now", caret: 6))
        XCTAssertNil(SlashRules.typed(in: "/com", caret: 0))
        XCTAssertNil(SlashRules.typed(in: "hi /com", caret: 7))
        XCTAssertEqual(SlashRules.typed(in: "/", caret: 1)?.query, "")
    }

    func testRankingOrder() {
        // exact, name prefix, alias prefix, part of the name, substring; server order within a rank
        let ranked = SlashRules.matching(commands, query: "co").map(\.name)
        XCTAssertEqual(ranked, ["co", "compact", "context", "ask"])
        XCTAssertEqual(SlashRules.matching(commands, query: "pr").map(\.name), ["review-pr"])
        XCTAssertEqual(SlashRules.matching(commands, query: "ode").map(\.name), ["model"])
        XCTAssertEqual(SlashRules.matching(commands, query: "SHR").map(\.name), ["compact"])
        XCTAssertEqual(SlashRules.matching(commands, query: "").count, commands.count)
        XCTAssertTrue(SlashRules.matching(commands, query: "zzz").isEmpty)
    }

    func testPickReplacesTheFirstWordAndKeepsTheRest() {
        XCTAssertEqual(SlashRules.pick("compact", in: "/co").text, "/compact ")
        XCTAssertEqual(SlashRules.pick("compact", in: "/co").caret, 9)
        XCTAssertEqual(SlashRules.pick("compact", in: "/co  now").text, "/compact  now")
        XCTAssertEqual(SlashRules.pick("compact", in: "/co now").text, "/compact now")
    }

    func testHintShowsOnlyForACommandTypedInFullWithOneSpace() {
        let list = [SlashCommand(name: "compact", hint: "[focus]", aliases: ["shrink"])]
        XCTAssertEqual(SlashRules.hint(for: list, text: "/compact "), "[focus]")
        XCTAssertEqual(SlashRules.hint(for: list, text: "/shrink "), "[focus]")
        XCTAssertEqual(SlashRules.hint(for: list, text: "/compact"), "")
        XCTAssertEqual(SlashRules.hint(for: list, text: "/compact  "), "")
        XCTAssertEqual(SlashRules.hint(for: list, text: "/compact x"), "")
        XCTAssertEqual(SlashRules.hint(for: nil, text: "/compact "), "")
    }
}

final class ComposerOptionsTests: XCTestCase {
    func testFastBeforeTheListIsOpusOnly() {
        XCTAssertTrue(ComposerOptions.takesFast("claude-opus-5-5", listed: nil))
        XCTAssertTrue(ComposerOptions.takesFast("claude-opus-5-5[1m]", listed: nil))
        XCTAssertFalse(ComposerOptions.takesFast("claude-haiku-5-5", listed: nil))
    }

    func testTheListsOwnFlagDecidesOnceItArrives() {
        let listed = [ListedModel(id: "claude-opus-5-5", label: "Opus 5.5", fast: false), ListedModel(id: "claude-haiku-5-5", label: "Haiku", fast: true)]
        XCTAssertFalse(ComposerOptions.takesFast("claude-opus-5-5", listed: listed))
        XCTAssertTrue(ComposerOptions.takesFast("claude-haiku-5-5", listed: listed))
    }

    func testMoreModelsStartWithTheLongOneAndSkipTheMainFour() {
        let listed = [ListedModel(id: "claude-opus-5-5", label: "x"), ListedModel(id: "claude-sonnet-4-5", label: "Sonnet 4.5")]
        XCTAssertEqual(ComposerOptions.moreModels(listed: listed).map(\.id), ["claude-opus-5-5[1m]", "claude-sonnet-4-5"])
        XCTAssertEqual(ComposerOptions.moreModels(listed: nil).map(\.id), ["claude-opus-5-5[1m]"])
    }

    func testNames() {
        XCTAssertEqual(ComposerOptions.modelName("claude-fable-5-1"), "Fable 5.1")
        XCTAssertEqual(ComposerOptions.modelName("claude-opus-4-1-20250805"), "Opus 4.1")
        XCTAssertEqual(ComposerOptions.modelName("sonnet[1m]"), "Sonnet (1M)")
        XCTAssertEqual(ComposerOptions.modelName("gpt-x"), "gpt-x")
        XCTAssertEqual(ComposerOptions.modelName("odd", listed: [ListedModel(id: "odd", label: "Odd One")]), "Odd One")
        XCTAssertEqual(ComposerOptions.effortName("xhigh"), "Extra")
        XCTAssertEqual(ComposerOptions.modeName("bypassPermissions"), "Bypass permissions")
        XCTAssertEqual(ComposerOptions.modes.map(\.id), ["manual", "acceptEdits", "plan", "auto", "bypassPermissions"])
        XCTAssertEqual(ComposerOptions.efforts.map(\.id), ["low", "medium", "high", "xhigh", "max"])
    }
}

final class DraftTextsTests: XCTestCase {
    private func suite() -> (UserDefaults, String) {
        let name = "com.kulesy.ghostshell.test.drafts.\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    func testTextIsKeptPerSessionAndSurvivesANewReader() {
        let (defaults, name) = suite()
        defer { defaults.removePersistentDomain(forName: name) }
        DraftTexts(defaults).set("first", for: "a")
        DraftTexts(defaults).set("second", for: "b")
        DraftTexts(defaults).set("start", for: DraftTexts.new)
        let reread = DraftTexts(UserDefaults(suiteName: name)!)
        XCTAssertEqual(reread.text(for: "a"), "first")
        XCTAssertEqual(reread.text(for: "b"), "second")
        XCTAssertEqual(reread.text(for: "new"), "start")
        XCTAssertEqual(reread.text(for: "c"), "")
    }

    func testAnEmptyTextRemovesItsEntry() {
        let (defaults, name) = suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let drafts = DraftTexts(defaults)
        drafts.set("x", for: "a")
        drafts.set("", for: "a")
        XCTAssertEqual((defaults.dictionary(forKey: DraftTexts.key) as? [String: String]) ?? [:], [:])
    }

    func testClearForgetsEveryDraft() {
        let (defaults, name) = suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let drafts = DraftTexts(defaults)
        drafts.set("x", for: "a")
        drafts.set("y", for: "new")
        drafts.clear()
        XCTAssertEqual(drafts.text(for: "a"), "")
        XCTAssertEqual(drafts.text(for: "new"), "")
        XCTAssertNil(defaults.object(forKey: DraftTexts.key))
    }
}

final class ImagePreparerTests: XCTestCase {
    /// A picture of random pixels, which does not compress, so it forces the scaling passes.
    private func noise(_ width: Int, _ height: Int, alpha: Bool = false) -> CGImage {
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        var seed: UInt64 = 0x9E3779B97F4A7C15
        for i in 0..<bytes.count { seed = seed &* 6364136223846793005 &+ 1442695040888963407; bytes[i] = UInt8(truncatingIfNeeded: seed >> 33) }
        if !alpha { for i in stride(from: 3, to: bytes.count, by: 4) { bytes[i] = 255 } }
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        return bytes.withUnsafeMutableBytes { raw in
            let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info)!
            return context.makeImage()!
        }
    }

    private func solid(_ width: Int, _ height: Int) -> CGImage {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.9, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()!
    }

    private func encode(_ image: CGImage, _ type: String) -> Data {
        let out = NSMutableData()
        let destination = CGImageDestinationCreateWithData(out, type as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return out as Data
    }

    private func size(_ data: Data) -> (Int, Int) {
        let source = CGImageSourceCreateWithData(data as CFData, nil)!
        let p = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as! [CFString: Any]
        return (p[kCGImagePropertyPixelWidth] as! Int, p[kCGImagePropertyPixelHeight] as! Int)
    }

    func testASmallPictureGoesAsItIs() throws {
        let png = encode(solid(64, 32), "public.png")
        let prepared = try ImagePreparer.prepare(png)
        XCTAssertEqual(prepared.data, png)
        XCTAssertEqual(prepared.mediaType, "image/png")
        XCTAssertEqual(prepared.outgoing.data, png.base64EncodedString())
        XCTAssertFalse(prepared.outgoing.data.hasPrefix("data:"))
    }

    func testAWideScreenshotIsScaledToTheLongEdgeLimitAndStaysAPNG() throws {
        let png = encode(solid(3000, 1200), "public.png")
        let prepared = try ImagePreparer.prepare(png)
        XCTAssertEqual(prepared.mediaType, "image/png")
        XCTAssertEqual(size(prepared.data).0, 2000)
        XCTAssertEqual(size(prepared.data).1, 800)
    }

    func testAPictureOverTheByteLimitIsRedrawnUnderIt() throws {
        let big = encode(noise(1600, 1200), "public.png")
        XCTAssertGreaterThan(big.count, ImagePreparer.maxBytes)
        let prepared = try ImagePreparer.prepare(big)
        XCTAssertLessThanOrEqual(prepared.data.count, ImagePreparer.maxBytes)
        XCTAssertLessThanOrEqual(max(size(prepared.data).0, size(prepared.data).1), ImagePreparer.maxEdge)
        XCTAssertEqual(ImagePreparer.sniff(prepared.data), prepared.mediaType)
    }

    func testALargePhotoBecomesAJPEGWithinTheLimits() throws {
        let photo = encode(noise(2600, 1800), "public.jpeg")
        let prepared = try ImagePreparer.prepare(photo)
        XCTAssertEqual(prepared.mediaType, "image/jpeg")
        XCTAssertLessThanOrEqual(prepared.data.count, ImagePreparer.maxBytes)
        XCTAssertLessThanOrEqual(max(size(prepared.data).0, size(prepared.data).1), ImagePreparer.maxEdge)
    }

    func testATypeTheServerDoesNotTakeIsRedrawnAsAJPEG() throws {
        let tiff = encode(solid(200, 100), "public.tiff")
        XCTAssertNil(ImagePreparer.sniff(tiff))
        let prepared = try ImagePreparer.prepare(tiff)
        XCTAssertEqual(prepared.mediaType, "image/jpeg")
        XCTAssertEqual(ImagePreparer.sniff(prepared.data), "image/jpeg")
    }

    func testAnImpossibleLimitGivesUpAtASmallSize() {
        let png = encode(noise(400, 400), "public.png")
        XCTAssertThrowsError(try ImagePreparer.prepare(png, name: "n.png", maxBytes: 100)) { XCTAssertEqual($0 as? ImagePreparer.Failure, .tooBig("n.png")) }
    }

    func testNonImageBytesAreRefused() {
        XCTAssertThrowsError(try ImagePreparer.prepare(Data("not a picture".utf8), name: "x.txt")) { XCTAssertEqual($0 as? ImagePreparer.Failure, .unreadable("x.txt")) }
    }

    func testSniffReadsTheFirstBytes() {
        XCTAssertEqual(ImagePreparer.sniff(Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0])), "image/png")
        XCTAssertEqual(ImagePreparer.sniff(Data([0xFF, 0xD8, 0xFF, 0xE0])), "image/jpeg")
        XCTAssertEqual(ImagePreparer.sniff(Data("GIF89a....".utf8)), "image/gif")
        XCTAssertEqual(ImagePreparer.sniff(Data("RIFF\0\0\0\0WEBPVP8 ".utf8)), "image/webp")
        XCTAssertNil(ImagePreparer.sniff(Data("RIFF\0\0\0\0WAVEfmt ".utf8)))
    }

    func testAThumbnailIsSmallAndNilForNonImages() throws {
        let png = encode(solid(800, 400), "public.png")
        XCTAssertEqual(try XCTUnwrap(ImagePreparer.thumbnail(png, longEdge: 96)).width, 96)
        XCTAssertNil(ImagePreparer.thumbnail(Data("x".utf8), longEdge: 96))
    }
}
