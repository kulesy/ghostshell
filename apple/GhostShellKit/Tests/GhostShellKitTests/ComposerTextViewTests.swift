#if os(macOS)
import AppKit
import XCTest
@testable import GhostShellScreens

@MainActor
final class ComposerTextViewTests: XCTestCase {
    private func text(_ string: String) -> NSAttributedString {
        NSAttributedString(string: string, attributes: [.font: ComposerTextView.font])
    }

    private var line: CGFloat { ceil(NSLayoutManager().defaultLineHeight(for: ComposerTextView.font)) }

    func testAnEmptyOrShortDraftIsOneLineHigh() {
        XCTAssertEqual(ComposerTextView.height(of: text(""), width: 400), line)
        XCTAssertEqual(ComposerTextView.height(of: text("Hello"), width: 400), line)
    }

    func testADraftThatWrapsGrowsAndStopsAtTheCap() {
        let draft = text(String(repeating: "word ", count: 20))
        XCTAssertEqual(ComposerTextView.height(of: draft, width: 2000), line)
        XCTAssertGreaterThan(ComposerTextView.height(of: draft, width: 120), line)
        XCTAssertEqual(ComposerTextView.height(of: text(String(repeating: "word ", count: 400)), width: 120), ComposerTextView.maxHeight)
    }

    func testATrailingNewLineAddsALine() {
        XCTAssertGreaterThan(ComposerTextView.height(of: text("Hello\n"), width: 400), line)
    }

    /// Sizing must leave the live text view's container alone, or the view resizes itself while drawing and the window never settles.
    func testMeasuringLeavesTheTextViewsContainerAlone() {
        let view = NSTextView(usingTextLayoutManager: false)
        view.textContainer?.widthTracksTextView = false
        view.textContainer?.size = NSSize(width: 300, height: CGFloat.greatestFiniteMagnitude)
        view.textStorage?.setAttributedString(text(String(repeating: "word ", count: 20)))
        guard let storage = view.textStorage else { return XCTFail("no text storage") }
        _ = ComposerTextView.height(of: storage, width: 120)
        XCTAssertEqual(view.textContainer?.size.width, 300)
        XCTAssertEqual(storage.layoutManagers.count, 1)
    }
}
#endif
