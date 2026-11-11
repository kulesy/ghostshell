import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public extension Color {
    /// The page's palette, `public/ghost.css`, switching with the light and dark appearance.
    static let ghost = GhostPalette()
}

/// Each token holds the OKLCH values from `public/ghost.css` as written there, light first, so the two files compare by eye.
// NOTE: [11 Nov 2026] EK - Keep these in step with public/ghost.css. Nothing checks that they match.
public struct GhostPalette: Sendable {
    public let background = Color(light: .init(0.972), dark: .init(0.21))
    public let foreground = Color(light: .init(0.215), dark: .init(0.955))
    public let card = Color(light: .init(0.988), dark: .init(0.235))
    public let cardForeground = Color(light: .init(0.215), dark: .init(0.955))
    public let popover = Color(light: .init(0.988), dark: .init(0.225))
    public let primary = Color(light: .init(0.25), dark: .init(0.93))
    public let primaryForeground = Color(light: .init(0.975), dark: .init(0.2))
    public let secondary = Color(light: .init(0.925), dark: .init(0.27))
    public let muted = Color(light: .init(0.925), dark: .init(0.27))
    public let mutedForeground = Color(light: .init(0.47), dark: .init(0.74))
    public let accent = Color(light: .init(0.925), dark: .init(0.27))
    public let accentForeground = Color(light: .init(0.215), dark: .init(0.955))
    public let destructive = Color(light: .init(0.53, 0.20, 27), dark: .init(0.70, 0.17, 25))
    public let border = Color(light: .init(0.875), dark: .init(0.96, alpha: 0.12))
    public let input = Color(light: .init(0.85), dark: .init(0.96, alpha: 0.18))
    public let ring = Color(light: .init(0.45), dark: .init(0.82))
    public let sidebar = Color(light: .init(0.942), dark: .init(0.175))
    public let sidebarForeground = Color(light: .init(0.215), dark: .init(0.955))
    public let sidebarAccent = Color(light: .init(0.905), dark: .init(0.245))
    public let sidebarBorder = Color(light: .init(0.875), dark: .init(0.96, alpha: 0.10))
    public let success = Color(light: .init(0.45), dark: .init(0.82))
    public let successForeground = Color(light: .init(0.48, 0.12, 150), dark: .init(0.78, 0.13, 150))
    public let warning = Color(light: .init(0.62, 0.15, 50), dark: .init(0.72, 0.14, 58))
    public let warningForeground = Color(light: .init(0.47, 0.11, 52), dark: .init(0.82, 0.11, 65))
    public let warningMuted = Color(light: .init(0.95, 0.03, 62), dark: .init(0.29, 0.04, 60))
}

/// A colour written as CSS `oklch(L C h / alpha)`.
struct OKLCH: Sendable, Equatable {
    var lightness: Double, chroma: Double, hue: Double, alpha: Double

    init(_ lightness: Double, _ chroma: Double = 0, _ hue: Double = 0, alpha: Double = 1) {
        (self.lightness, self.chroma, self.hue, self.alpha) = (lightness, chroma, hue, alpha)
    }

    /// Linear sRGB, by Björn Ottosson's OKLab matrices (https://bottosson.github.io/posts/oklab/), clamped to the gamut.
    var linearRGB: (red: Double, green: Double, blue: Double) {
        let a = chroma * cos(hue * .pi / 180), b = chroma * sin(hue * .pi / 180)
        let l = pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
        let m = pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
        let s = pow(lightness - 0.0894841775 * a - 1.2914855480 * b, 3)
        let clamp = { (x: Double) in min(max(x, 0), 1) }
        return (clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
                clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
                clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))
    }

    var color: Color { let c = linearRGB; return Color(.sRGBLinear, red: c.red, green: c.green, blue: c.blue, opacity: alpha) }
}

extension Color {
    init(light: OKLCH, dark: OKLCH) {
        #if os(iOS) || os(tvOS) || os(visionOS)
        let (l, d) = (UIColor(light.color), UIColor(dark.color))
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? d : l })
        #elseif os(macOS)
        let (l, d) = (NSColor(light.color), NSColor(dark.color))
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? d : l })
        #else
        self = dark.color
        #endif
    }
}
