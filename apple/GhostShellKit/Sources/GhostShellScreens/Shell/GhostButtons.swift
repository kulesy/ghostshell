import SwiftUI

/// The page's two button looks, `.btn` and `.btn[data-variant="outline"]` in `public/app.css`, at phone width.
public struct GhostButtonStyle: ButtonStyle {
    public enum Kind: Sendable { case primary, outline }
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
            .foregroundStyle(kind == .primary ? Color.ghost.primaryForeground : Color.ghost.foreground)
            .padding(.horizontal, size == .icon ? 0 : size == .compact ? 12 : 16)
            .frame(width: size == .icon ? 32 : nil, height: size == .regular ? Self.touch : 32)
            .frame(maxWidth: fills ? .infinity : nil)
            .background(kind == .primary ? Color.ghost.primary : Color.ghost.card, in: shape)
            .overlay { if kind == .outline { shape.strokeBorder(Color.ghost.input, lineWidth: 1) } }
            .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            #if os(iOS)
            .frame(minWidth: 44, minHeight: 44)
            #endif
            .contentShape(Rectangle())
    }
}

public extension ButtonStyle where Self == GhostButtonStyle {
    static func ghost(_ kind: GhostButtonStyle.Kind = .primary, size: GhostButtonStyle.Size = .regular, radius: CGFloat = GhostRadius.sm, fills: Bool = false) -> GhostButtonStyle {
        GhostButtonStyle(kind, size: size, radius: radius, fills: fills)
    }
}
