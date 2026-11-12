import SwiftUI

/// The page's button looks, `.btn`, `.btn[data-variant="outline"]` and `.btn[data-variant="destructive"]` in `public/app.css`, at phone width.
public struct GhostButtonStyle: ButtonStyle {
    public enum Kind: Sendable { case primary, outline, destructive }
    public enum Size: Sendable { case regular, compact, icon }

    let kind: Kind
    let size: Size
    let radius: CGFloat
    let fills: Bool
    @Environment(\.isEnabled) private var enabled

    public init(_ kind: Kind = .primary, size: Size = .regular, radius: CGFloat = GhostRadius.sm, fills: Bool = false) {
        (self.kind, self.size, self.radius, self.fills) = (kind, size, radius, fills)
    }

    #if os(iOS)
    private static let touch: CGFloat = 44
    #else
    private static let touch: CGFloat = 36
    #endif

    public func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        configuration.label
            .font(.geist(14, weight: .medium))
            // The label keeps its width, as the page's flex buttons do, so a row shares out the rest and no label wraps or truncates.
            .fixedSize(horizontal: true, vertical: false)
            // The button's height is fixed, so its label stops growing at the largest standard text size rather than spilling out.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .foregroundStyle(kind == .outline ? Color.ghost.foreground : kind == .destructive ? Color.white : Color.ghost.primaryForeground)
            .padding(.horizontal, size == .icon ? 0 : size == .compact ? 12 : 16)
            .frame(width: size == .icon ? 32 : nil, height: size == .regular ? Self.touch : 32)
            .frame(maxWidth: fills ? .infinity : nil)
            .background(kind == .primary ? Color.ghost.primary : kind == .destructive ? Color.ghost.destructive : Color.ghost.card, in: shape)
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
    static func ghost(_ kind: GhostButtonStyle.Kind = .primary, size: GhostButtonStyle.Size = .regular, radius: CGFloat = GhostRadius.sm, fills: Bool = false) -> GhostButtonStyle {
        GhostButtonStyle(kind, size: size, radius: radius, fills: fills)
    }
}
