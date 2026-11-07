import SwiftUI

/// The GhostShell mark: four plates round one eye. Ported from `public/ui/shell.js`, on the same 24-unit box.
/// The plates follow the text colour, with a black socket and a white eye.
public struct ShellMark: View {
    public init() {}

    public var body: some View {
        GeometryReader { box in
            let side = min(box.size.width, box.size.height)
            ZStack {
                ShellPlates().fill(.primary)
                Circle().fill(Color.black).frame(width: side * 8.6 / 24, height: side * 8.6 / 24)
                Circle().fill(Color.white).frame(width: side * 5 / 24, height: side * 5 / 24)
            }
            .frame(width: box.size.width, height: box.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

struct ShellPlates: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * unit, y: rect.midY - 12 * unit)
        var all = Path()
        for (turn, plate) in [(0.0, Self.tall), (90, Self.wide), (180, Self.tall), (270, Self.wide)] {
            let place = CGAffineTransform(translationX: 12, y: 12).rotated(by: turn * .pi / 180).translatedBy(x: -12, y: -12)
            all.addPath(plate.applying(place))
        }
        return all.applying(CGAffineTransform(scaleX: unit, y: unit)).applying(CGAffineTransform(translationX: origin.x, y: origin.y))
    }

    private static let tall = plate(top: 0.5, shoulder: (16.66, 6.56), left: (7.34, 6.56), tipControlRight: (14, 3.88), tipControlLeft: (10, 3.88))
    private static let wide = plate(top: 0, shoulder: (16.67, 6.55), left: (7.33, 6.55), tipControlRight: (13.95, 3.65), tipControlLeft: (10.05, 3.65))

    private static func plate(top: CGFloat, shoulder: (CGFloat, CGFloat), left: (CGFloat, CGFloat),
                              tipControlRight: (CGFloat, CGFloat), tipControlLeft: (CGFloat, CGFloat)) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 8.95, y: 8.17))
        p.addLine(to: CGPoint(x: 12, y: 6.91))
        p.addLine(to: CGPoint(x: 15.05, y: 8.17))
        p.addLine(to: CGPoint(x: shoulder.0, y: shoulder.1))
        p.addQuadCurve(to: CGPoint(x: 12, y: top), control: CGPoint(x: tipControlRight.0, y: tipControlRight.1))
        p.addQuadCurve(to: CGPoint(x: left.0, y: left.1), control: CGPoint(x: tipControlLeft.0, y: tipControlLeft.1))
        p.closeSubpath()
        return p
    }
}
