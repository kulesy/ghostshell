import CoreGraphics

/// The page's corner radii at phone width, where Safari has no bevelled corners and `public/ghost.css` falls back to these.
public enum GhostRadius {
    public static let sm: CGFloat = 2
    public static let md: CGFloat = 2
    public static let base: CGFloat = 3
    public static let lg: CGFloat = 3
    public static let xl: CGFloat = 4
}

#if os(macOS)
import SwiftUI

/// The page's corner at the radius a phone uses: Chrome's bevelled corner on the Mac, where `public/ghost.css` sets `corner-shape: bevel`.
/// The phone radii 2, 3 and 4 stand for the page's `--radius-md`, `--radius-lg` and `--radius-xl`, which are 5, 7 and 11 there.
public struct GhostShape: InsettableShape {
    var radius: CGFloat
    var inset: CGFloat = 0

    public init(_ radius: CGFloat) { self.radius = radius }

    private var cut: CGFloat { radius <= 2 ? 5 : radius <= 3 ? 7 : 11 }

    public func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: inset, dy: inset)
        let c = max(0, min(cut, r.width / 2, r.height / 2))
        var p = Path()
        p.move(to: CGPoint(x: r.minX + c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY + c))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - c))
        p.addLine(to: CGPoint(x: r.maxX - c, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + c, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY - c))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
        p.closeSubpath()
        return p
    }

    public func inset(by amount: CGFloat) -> GhostShape {
        var shape = self
        shape.inset += amount
        return shape
    }
}
#else
import SwiftUI

/// The page's corner at the radius a phone uses: a continuous round, since Safari has no bevelled corner.
public struct GhostShape: InsettableShape {
    var radius: CGFloat
    var inset: CGFloat = 0

    public init(_ radius: CGFloat) { self.radius = radius }

    public func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: rect.insetBy(dx: inset, dy: inset))
    }

    public func inset(by amount: CGFloat) -> GhostShape {
        var shape = self
        shape.inset += amount
        return shape
    }
}
#endif
