import CoreText
import XCTest
@testable import GhostShellScreens

final class GhostThemeTests: XCTestCase {
    func testAGreyIsItsLightnessCubedInLinearLight() {
        let c = OKLCH(0.972).linearRGB
        for channel in [c.red, c.green, c.blue] { XCTAssertEqual(channel, pow(0.972, 3), accuracy: 0.0005) }
    }

    /// CSS Color 4 gives sRGB red as oklch(0.62796 0.25768 29.2339).
    func testSRGBRedComesBackAsPureRed() {
        let c = OKLCH(0.62796, 0.25768, 29.2339).linearRGB
        XCTAssertEqual(c.red, 1, accuracy: 0.002)
        XCTAssertEqual(c.green, 0, accuracy: 0.002)
        XCTAssertEqual(c.blue, 0, accuracy: 0.002)
    }

    func testTheBundledGeistFontsRegister() {
        XCTAssertTrue(GhostFonts.register())
        for family in [GhostFonts.sans, GhostFonts.mono] {
            let font = CTFontCreateWithName(family as CFString, 12, nil)
            XCTAssertEqual(CTFontCopyFamilyName(font) as String, family)
        }
    }
}
