import SwiftUI

/// The page's sizes for a pointer or a finger. The page draws each screen twice: with `pointer: fine`, which is the Mac, and for a finger, which is the iPhone.
/// Colours, type and shapes are the same on both, so a view reads its sizes from here and draws one way.
struct GhostMetrics {
    /// The page's `1rem`, which a pointer sets to 15pt.
    var rem: CGFloat
    /// A row's height with the 2pt the page leaves between rows.
    var row: CGFloat
    var rowFont: CGFloat
    /// A heading's height, and the size of its name and count.
    var heading: CGFloat
    var headingFont: CGFloat
    var countFont: CGFloat
    /// The space above and below the rule between groups.
    var rule: CGFloat
    /// The square an icon button has to fill.
    var target: CGFloat
    /// A row's menu and fold buttons.
    var button: CGSize
    /// The size of the status dot.
    var dot: CGFloat
    /// The height of a footer link and the size of its text.
    var foot: CGFloat
    var footFont: CGFloat
    /// The height of an inline name field's row and of the box in it.
    var field: CGFloat
    var input: CGFloat
    /// The page's `--radius-sm` to `--radius-xl`. A pointer's bevelled corners are cut by the `--radius` of 0.4375rem, a finger's rounded ones are Safari's fallback.
    var sm: CGFloat
    var md: CGFloat
    var lg: CGFloat
    var xl: CGFloat
    /// A finger, not a pointer. The page then shows a row's second line and its menu button always, where a pointer gets them as hover text and on hover or choice.
    var touch: Bool

    static let touch = GhostMetrics(rem: 16, row: 52, rowFont: 14, heading: 44, headingFont: 12, countFont: 11, rule: 6, target: 44, button: CGSize(width: 44, height: 44), dot: 8, foot: 44, footFont: 14, field: 48, input: 36,
                                    sm: GhostRadius.sm, md: GhostRadius.md, lg: GhostRadius.lg, xl: GhostRadius.xl, touch: true)
    static let pointer = GhostMetrics(rem: 15, row: 28, rowFont: 12.2, heading: 26, headingFont: 11.25, countFont: 11, rule: 4.5, target: 32, button: CGSize(width: 24, height: 24), dot: 6, foot: 36, footFont: 13, field: 28, input: 24,
                                      sm: 0.4375 * 15 - 4, md: 0.4375 * 15 - 2, lg: 0.4375 * 15, xl: 0.4375 * 15 + 4, touch: false)

    #if os(iOS)
    static let current = touch
    #else
    static let current = pointer
    #endif

    /// What a size the page sets in `rem` becomes: the iPhone's values were read at 16pt.
    var scale: CGFloat { rem / 16 }
}

/// A rectangle with the page's corners: bevelled on a pointer (`corner-shape: bevel`) and rounded on a finger. Each corner has its own size, clockwise from the top left.
struct GhostCorner: InsettableShape {
    var topLeading: CGFloat, topTrailing: CGFloat, bottomTrailing: CGFloat, bottomLeading: CGFloat
    var inset: CGFloat = 0

    init(_ radius: CGFloat) { self.init(topLeading: radius, topTrailing: radius, bottomTrailing: radius, bottomLeading: radius) }

    init(topLeading: CGFloat, topTrailing: CGFloat, bottomTrailing: CGFloat, bottomLeading: CGFloat) {
        (self.topLeading, self.topTrailing, self.bottomTrailing, self.bottomLeading) = (topLeading, topTrailing, bottomTrailing, bottomLeading)
    }

    func inset(by amount: CGFloat) -> GhostCorner {
        var copy = self
        copy.inset += amount
        return copy
    }

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: inset, dy: inset)
        let limit = min(r.width, r.height) / 2
        func fit(_ radius: CGFloat) -> CGFloat { min(max(radius - inset, 0), limit) }
        let (tl, tr, br, bl) = (fit(topLeading), fit(topTrailing), fit(bottomTrailing), fit(bottomLeading))
        #if os(macOS)
        var path = Path()
        path.move(to: CGPoint(x: r.minX + tl, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX - tr, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX, y: r.minY + tr))
        path.addLine(to: CGPoint(x: r.maxX, y: r.maxY - br))
        path.addLine(to: CGPoint(x: r.maxX - br, y: r.maxY))
        path.addLine(to: CGPoint(x: r.minX + bl, y: r.maxY))
        path.addLine(to: CGPoint(x: r.minX, y: r.maxY - bl))
        path.addLine(to: CGPoint(x: r.minX, y: r.minY + tl))
        path.closeSubpath()
        return path
        #else
        return UnevenRoundedRectangle(topLeadingRadius: tl, bottomLeadingRadius: bl, bottomTrailingRadius: br, topTrailingRadius: tr).path(in: r)
        #endif
    }
}
