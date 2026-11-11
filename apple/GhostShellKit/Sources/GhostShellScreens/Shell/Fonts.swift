import CoreText
import Foundation
import SwiftUI

/// Geist and Geist Mono, the page's fonts, scaled with Dynamic Type like the system styles.
// NOTE: [11 Nov 2026] EK - Only the latin files ship, copied from public/vendor. Text outside them falls back to the system font,
// as the page does without its latin-ext file. Add the latin-ext files here if that fallback shows.
public extension Font {
    static func geist(_ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        GhostFonts.register()
        return .custom(GhostFonts.sans, size: size, relativeTo: style).weight(weight)
    }

    static func geistMono(_ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        GhostFonts.register()
        return .custom(GhostFonts.mono, size: size, relativeTo: style).weight(weight)
    }
}

enum GhostFonts {
    static let sans = "Geist"
    static let mono = "Geist Mono"

    private static let registered: Bool = {
        guard let folder = Bundle.module.url(forResource: "Fonts", withExtension: nil),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return false }
        let fonts = files.filter { $0.pathExtension == "woff2" }
        CTFontManagerRegisterFontURLs(fonts as CFArray, .process, true, nil)
        return !fonts.isEmpty
    }()

    /// Registers the bundled files with CoreText on first use. True when they were found.
    @discardableResult static func register() -> Bool { registered }
}
