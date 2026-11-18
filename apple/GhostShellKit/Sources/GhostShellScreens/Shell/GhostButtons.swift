import SwiftUI

/// The page's button looks, `.btn`, `.btn[data-variant="outline"]`, `.btn[data-variant="destructive"]` and `.btn[data-variant="ghost"]` in `public/app.css`, at phone width.
public struct GhostButtonStyle: ButtonStyle {
    public enum Kind: Sendable { case primary, outline, destructive, ghost }
    public enum Size: Sendable { case regular, compact, icon }

    let kind: Kind
    let size: Size
    let radius: CGFloat?
    let fills: Bool
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var colorScheme

    public init(_ kind: Kind = .primary, size: Size = .regular, radius: CGFloat? = nil, fills: Bool = false) {
        (self.kind, self.size, self.radius, self.fills) = (kind, size, radius, fills)
    }

    private static let rem = GhostMetrics.current.rem
    #if os(iOS)
    private static let touch: CGFloat = 44
    #else
    private static let touch: CGFloat = 2.25 * rem
    #endif

    private var foreground: Color {
        switch kind {
        case .primary: Color.ghost.primaryForeground
        case .destructive: Color.white
        case .outline, .ghost: Color.ghost.foreground
        }
    }

    private var fill: Color {
        switch kind {
        case .primary: Color.ghost.primary
        // The page's dark destructive fill is 60% of the red, since the full red fails contrast with white text. `public/app.css`.
        case .destructive: colorScheme == .dark ? Color.ghost.destructive.opacity(0.6) : Color.ghost.destructive
        case .outline: Color.ghost.card
        case .ghost: Color.clear
        }
    }

    public func makeBody(configuration: Configuration) -> some View {
        // The page's button is `--radius-md` whatever a phone screen rounds it to, so the Mac's bevel does not follow `radius`.
        #if os(macOS)
        let shape = GhostShape(GhostRadius.md)
        #else
        let shape = GhostShape(radius ?? GhostRadius.sm)
        #endif
        configuration.label
            .font(.geist(0.875 * Self.rem, weight: .medium))
            // The label keeps its width, as the page's flex buttons do, so a row shares out the rest and no label wraps or truncates.
            .fixedSize(horizontal: true, vertical: false)
            // The button's height is fixed, so its label stops growing at the largest standard text size rather than spilling out.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .foregroundStyle(foreground)
            .padding(.horizontal, size == .icon ? 0 : (size == .compact ? 0.75 : 1) * Self.rem)
            .frame(width: size == .icon ? 2 * Self.rem : nil, height: size == .regular ? Self.touch : 2 * Self.rem)
            .frame(maxWidth: fills ? .infinity : nil)
            .background(fill, in: shape)
            .overlay { if kind == .outline { shape.strokeBorder(Color.ghost.input, lineWidth: 1) } }
            .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            #if os(iOS)
            // Only an icon needs the wider touch area. A min width on a filling button lets a row overlap its neighbours.
            .frame(minWidth: size == .icon ? 44 : nil, minHeight: 44)
            #endif
            .contentShape(Rectangle())
    }
}

public extension ButtonStyle where Self == GhostButtonStyle {
    static func ghost(_ kind: GhostButtonStyle.Kind = .primary, size: GhostButtonStyle.Size = .regular, radius: CGFloat? = nil, fills: Bool = false) -> GhostButtonStyle {
        GhostButtonStyle(kind, size: size, radius: radius, fills: fills)
    }
}
